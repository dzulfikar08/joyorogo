// Ported from JoyoFit (watch-fit) src/features/ai/adapters.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { ADAPTERS } from './adapters';
import { anthropicAdapter, ANTHROPIC_VERSION, buildAnthropicBody, parseAnthropicReply, THINKING_HEADROOM } from './adapters/anthropic';
import { kindForStatus } from './adapters/http';
import { buildOpenAiBody, OPENAI_HEADROOM, openAiAdapter, parseOpenAiModels, parseOpenAiReply } from './adapters/openai';
import { PROVIDERS } from './providers';
import { json, mockFetch, TEST_TOOL_SPECS as TOOL_SPECS } from './testFixtures';
import { AiError, type ModelRequest, type NeutralMessage } from './types';

const KEY = 'sk-test-SECRET-1234567890abcdef';
const history: NeutralMessage[] = [
  { role: 'user', content: 'Kenapa HRV-ku turun?' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_trend', args: { metric: 'hrvMs', days: 14 } }] },
  { role: 'tool', callId: 'call_1', name: 'get_trend', content: '{"mean":38}' },
];
const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({ model: 'm', system: 'SYS', messages: history, tools: TOOL_SPECS, maxTokens: 800, ...over });

describe('OpenAI-compatible request mapping', () => {
  test('system first, tool call and tool result in wire form, tools as functions', () => {
    const body = buildOpenAiBody(PROVIDERS.openrouter.baseUrl, request()) as { messages: Record<string, unknown>[]; tools: { type: string; function: { name: string } }[]; max_tokens: number };
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_trend', arguments: '{"metric":"hrvMs","days":14}' } }],
    });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"mean":38}' });
    expect(body.tools.map((t) => t.function.name)).toEqual(TOOL_SPECS.map((t) => t.name));
    expect(body.tools[0]!.type).toBe('function');
    // the answer budget plus room for the reasoning of thinking models
    expect(body.max_tokens).toBe(800 + OPENAI_HEADROOM);
  });

  test('OpenAI uses max_completion_tokens; Gemini asks for low reasoning; custom URLs get the plain fields', () => {
    expect(buildOpenAiBody(PROVIDERS.openai.baseUrl, request())).toMatchObject({ max_completion_tokens: 800 + OPENAI_HEADROOM });
    expect(buildOpenAiBody(PROVIDERS.openai.baseUrl, request())).not.toHaveProperty('max_tokens');
    expect(buildOpenAiBody(PROVIDERS.gemini.baseUrl, request())).toMatchObject({ max_tokens: 800 + OPENAI_HEADROOM, reasoning_effort: 'low' });
    const custom = buildOpenAiBody('http://192.168.1.5:11434/v1', request());
    expect(custom).toMatchObject({ max_tokens: 800 + OPENAI_HEADROOM });
    expect(custom).not.toHaveProperty('reasoning_effort');
  });

  test('no tools key when the model has none', () => {
    expect(buildOpenAiBody(PROVIDERS.openai.baseUrl, request({ tools: undefined }))).not.toHaveProperty('tools');
  });

  test('sends the key as a bearer header to the chat completions URL and parses the answer', async () => {
    const { fetchImpl, calls } = mockFetch([json({ choices: [{ message: { content: 'Halo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 40 } })]);
    const reply = await openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'gpt-6-luna' }, request({ messages: [{ role: 'user', content: 'hai' }] }), { fetchImpl });
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
    expect(reply).toEqual({ text: 'Halo', thinking: '', toolCalls: [], usage: { inputTokens: 1200, outputTokens: 40 }, stop: 'end', finish: 'stop' });
  });
});

describe('OpenAI-compatible response mapping', () => {
  test('tool calls: arguments are parsed from JSON text, a missing id is replaced, bad JSON becomes empty args', () => {
    const reply = parseOpenAiReply({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'abc', type: 'function', function: { name: 'get_daily', arguments: '{"from":"2026-10-01","to":"2026-10-07"}' } },
              { id: '', type: 'function', function: { name: 'get_plan', arguments: '' } },
              { type: 'function', function: { name: 'get_trend', arguments: '{broken' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(reply.stop).toBe('tools');
    expect(reply.toolCalls).toEqual([
      { id: 'abc', name: 'get_daily', args: { from: '2026-10-01', to: '2026-10-07' } },
      { id: 'call_1', name: 'get_plan', args: {} },
      { id: 'call_2', name: 'get_trend', args: {} },
    ]);
  });

  test('content parts, length stop and a missing usage', () => {
    const reply = parseOpenAiReply({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'length' }] });
    expect(reply).toMatchObject({ text: 'ab', stop: 'length', usage: null });
  });

  test('an answer without a message is an empty-answer error', () => {
    expect(() => parseOpenAiReply({ choices: [] })).toThrow(AiError);
  });

  test('model list: Gemini prefix stripped, non-chat models left out, tool support read from OpenRouter', () => {
    const models = parseOpenAiModels({
      data: [
        { id: 'models/gemini-3.8-flash' },
        { id: 'text-embedding-3-small' },
        { id: 'whisper-1' },
        { id: 'anthropic/claude-haiku-5.5', supported_parameters: ['tools', 'max_tokens'] },
        { id: 'some/plain-model', supported_parameters: ['max_tokens'] },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-haiku-5.5', 'gemini-3.8-flash', 'some/plain-model']);
    expect(models.find((m) => m.id === 'anthropic/claude-haiku-5.5')!.tools).toBe(true);
    expect(models.find((m) => m.id === 'some/plain-model')!.tools).toBe(false);
    expect(models.find((m) => m.id === 'gemini-3.8-flash')!.tools).toBeNull();
  });
});

describe('Anthropic request and response mapping', () => {
  test('system is a top-level field; tool use and tool results become content blocks; roles alternate', () => {
    const body = buildAnthropicBody(request({ messages: [...history, { role: 'user', content: 'dan tidurku?' }] })) as {
      system: string;
      max_tokens: number;
      messages: { role: string; content: Record<string, unknown>[] }[];
      tools: { name: string; input_schema: unknown }[];
      output_config?: unknown;
    };
    expect(body.system).toBe('SYS');
    expect(body.max_tokens).toBe(800 + THINKING_HEADROOM);
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[1]!.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'get_trend', input: { metric: 'hrvMs', days: 14 } }]);
    // the tool result and the next user text share one user turn
    expect(body.messages[2]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"mean":38}' },
      { type: 'text', text: 'dan tidurku?' },
    ]);
    expect(body.tools[0]!.name).toBe(TOOL_SPECS[0]!.name);
    expect(body.tools[0]).toHaveProperty('input_schema');
  });

  test('effort is only sent to Claude 5 models', () => {
    expect(buildAnthropicBody(request({ model: 'claude-haiku-5-5' }))).toMatchObject({ output_config: { effort: 'low' } });
    expect(buildAnthropicBody(request({ model: 'claude-haiku-4-5' }))).not.toHaveProperty('output_config');
  });

  test('headers: x-api-key and anthropic-version; URL is /v1/messages', async () => {
    const { fetchImpl, calls } = mockFetch([json({ content: [{ type: 'text', text: 'Halo' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 20 } })]);
    const reply = await anthropicAdapter.complete({ baseUrl: PROVIDERS.anthropic.baseUrl, apiKey: KEY, model: 'claude-haiku-5-5' }, request({ messages: [{ role: 'user', content: 'hai' }], tools: undefined }), { fetchImpl });
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers['x-api-key']).toBe(KEY);
    expect(calls[0]!.headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(calls[0]!.headers).not.toHaveProperty('Authorization');
    expect(reply).toEqual({ text: 'Halo', thinking: '', toolCalls: [], usage: { inputTokens: 900, outputTokens: 20 }, stop: 'end', finish: 'end_turn' });
  });

  test('tool_use blocks become tool calls; thinking blocks are ignored; max_tokens is a length stop', () => {
    const reply = parseAnthropicReply({
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'Saya cek dulu.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_trend', input: { metric: 'hrvMs', days: 14 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(reply.stop).toBe('tools');
    expect(reply.text).toBe('Saya cek dulu.');
    expect(reply.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_trend', args: { metric: 'hrvMs', days: 14 } }]);
    expect(parseAnthropicReply({ content: [{ type: 'text', text: 'cut' }], stop_reason: 'max_tokens' }).stop).toBe('length');
  });

  test('both adapters are registered by kind', () => {
    expect(ADAPTERS.openai).toBe(openAiAdapter);
    expect(ADAPTERS.anthropic).toBe(anthropicAdapter);
  });
});

describe('errors are mapped to a cause and never leak the key', () => {
  const failing = async (status: number, body: unknown, adapter = openAiAdapter) => {
    const { fetchImpl } = mockFetch([json(body, status)]);
    return adapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl }).then(
      () => null,
      (e: unknown) => e as AiError,
    );
  };

  test('401 is a bad key, 402 and quota words are quota, plain 429 is a rate limit', async () => {
    expect((await failing(401, { error: { message: 'Incorrect API key provided' } }))!.kind).toBe('badKey');
    expect((await failing(402, { error: { message: 'Insufficient credits' } }))!.kind).toBe('quota');
    expect((await failing(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }))!.kind).toBe('quota');
    expect((await failing(429, { error: { message: 'Rate limit reached for requests' } }))!.kind).toBe('rateLimit');
    expect((await failing(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, anthropicAdapter))!.kind).toBe('quota');
  });

  test('model not found, no tool support, server errors', async () => {
    expect((await failing(404, { error: { message: 'The model `gpt-9` does not exist' } }))!.kind).toBe('modelNotFound');
    expect((await failing(404, { error: { message: 'No endpoints found that support tool use' } }))!.kind).toBe('noTools');
    expect((await failing(400, { error: { message: 'This model does not support function calling' } }))!.kind).toBe('noTools');
    expect((await failing(503, { error: { message: 'overloaded' } }))!.kind).toBe('server');
    expect(kindForStatus(529, null)).toBe('server');
  });

  test('the provider echoing the key in its message does not keep it', async () => {
    const error = await failing(401, { error: { message: `Invalid key ${KEY} for project` } });
    expect(error!.detail).toBeTruthy();
    expect(error!.detail).not.toContain(KEY);
    expect(error!.detail).not.toContain('SECRET');
    expect(String(error!.message)).not.toContain(KEY);
  });

  test('no connection is a network error; a slow provider is a timeout; the caller aborting is aborted', async () => {
    const down = mockFetch([new Error('Network request failed')]);
    await expect(openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl: down.fetchImpl })).rejects.toMatchObject({ kind: 'network' });

    const hang = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });

    const controller = new AbortController();
    const pending = openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl: hang, signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await expect(openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl: hang, signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('a non-JSON success body is a server error, not a crash', async () => {
    const { fetchImpl } = mockFetch([new Response('<html>gateway</html>', { status: 200 })]);
    await expect(openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'm' }, request(), { fetchImpl })).rejects.toMatchObject({ kind: 'server' });
  });
});
