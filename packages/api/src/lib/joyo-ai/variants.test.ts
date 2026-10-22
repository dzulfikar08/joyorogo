// Ported from JoyoFit (watch-fit) src/features/ai/variants.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { anthropicAdapter, parseAnthropicReply } from './adapters/anthropic';
import { openAiAdapter, parseOpenAiReply, reasoningOf, resetStreamMemory } from './adapters/openai';
import { splitThink } from './adapters/sse';
import { PROVIDERS } from './providers';
import { json, mockFetch, TEST_TOOL_SPECS as TOOL_SPECS } from './testFixtures';
import { AiError } from './types';

// Answer shapes recorded from (or written to match) the OpenAI-compatible servers people connect: GLM / Z.ai, DeepSeek, Qwen on
// vLLM, Kimi, Ollama and LM Studio, OpenRouter reasoning models, Gemini's compatible endpoint.

const KEY = 'sk-test-0123456789abcdef';
const ask = { model: 'm', system: 'SYS', messages: [{ role: 'user' as const, content: 'Review my week' }], tools: TOOL_SPECS, maxTokens: 800 };

describe('thinking models', () => {
  test('GLM that spent its whole budget thinking: no answer, finish_reason length -> truncated, with a technical line', () => {
    const body = { choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'The user wants a weekly review. First I look at sleep... '.repeat(30) } }], usage: { prompt_tokens: 3001, completion_tokens: 800, total_tokens: 3801 } };
    let error: unknown;
    try {
      parseOpenAiReply(body);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ kind: 'truncated', status: 200 });
    expect((error as AiError).detail).toContain('finish_reason=length');
    expect((error as AiError).detail).toContain('answer=0 chars');
    expect((error as AiError).detail).toMatch(/reasoning=\d+ chars/);
  });

  test('GLM with an answer: reasoning_content is kept apart and never becomes the answer', () => {
    const reply = parseOpenAiReply({ choices: [{ finish_reason: 'stop', message: { content: 'Minggu ini tidurmu stabil.', reasoning_content: 'Let me look at the data.' } }] });
    expect(reply.text).toBe('Minggu ini tidurmu stabil.');
    expect(reply.thinking).toBe('Let me look at the data.');
    expect(reply.stop).toBe('end');
  });

  test('OpenRouter: reasoning string, or reasoning_details when there is no string', () => {
    expect(reasoningOf({ reasoning: 'abc' })).toBe('abc');
    expect(reasoningOf({ reasoning_details: [{ type: 'reasoning.text', text: 'a' }, { type: 'reasoning.summary', summary: 'b' }] })).toBe('ab');
    expect(reasoningOf({ content: 'x' })).toBe('');
  });

  test('DeepSeek-R1 style <think> tags inside content become thinking, also split across the text', () => {
    const reply = parseOpenAiReply({ choices: [{ finish_reason: 'stop', message: { content: '<think>cek tidur dulu</think>Tidurmu cukup.' } }] });
    expect(reply).toMatchObject({ text: 'Tidurmu cukup.', thinking: 'cek tidur dulu' });
    expect(splitThink('a<think>b</think>c<think>d')).toEqual({ text: 'ac', thinking: 'bd' });
    expect(splitThink('plain')).toEqual({ text: 'plain', thinking: '' });
  });

  test('an answer that is only <think> tags is no answer', () => {
    expect(() => parseOpenAiReply({ choices: [{ finish_reason: 'stop', message: { content: '<think>hmm</think>' } }] })).toThrow(AiError);
  });

  test('thinking and answer as content parts (Qwen / gateways)', () => {
    const reply = parseOpenAiReply({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'reasoning', text: 'r' }, { type: 'text', text: 'Halo' }, 'lagi'] } }] });
    expect(reply).toMatchObject({ text: 'Halolagi', thinking: 'r' });
  });

  test('the reasoning of a tool round is sent back with that assistant turn (DeepSeek and GLM ask for it), and only then', async () => {
    const { fetchImpl, calls } = mockFetch([json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })]);
    await openAiAdapter.complete(
      { baseUrl: PROVIDERS.custom.baseUrl || 'https://gateway.example.com/v1', apiKey: KEY, model: 'glm-5.3-flash' },
      {
        ...ask,
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_plan', args: {} }], reasoning: 'need the plan' },
          { role: 'tool', callId: 'c1', name: 'get_plan', content: '{}' },
          { role: 'assistant', content: 'plain turn', reasoning: 'ignored' },
        ],
      },
      { fetchImpl },
    );
    const sent = (calls[0]!.body as { messages: Record<string, unknown>[] }).messages;
    expect(sent[2]).toMatchObject({ role: 'assistant', reasoning_content: 'need the plan' });
    expect(sent[4]).not.toHaveProperty('reasoning_content');
  });
});

describe('tool calls in the shapes servers use', () => {
  test('arguments as an object (Ollama), as a string (OpenAI), empty (no arguments) and broken JSON', () => {
    const reply = parseOpenAiReply({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'a', function: { name: 'get_daily', arguments: { from: '2026-10-01', to: '2026-10-07' } } },
              { id: 'b', function: { name: 'get_trend', arguments: '{"metric":"hrvMs","days":14}' } },
              { id: 'c', function: { name: 'get_plan', arguments: '' } },
              { id: 'd', function: { name: 'get_workout', arguments: '{"id":' } },
            ],
          },
        },
      ],
    });
    expect(reply.stop).toBe('tools');
    expect(reply.toolCalls.map((c) => c.args)).toEqual([{ from: '2026-10-01', to: '2026-10-07' }, { metric: 'hrvMs', days: 14 }, {}, {}]);
  });

  test('finish_reason "stop" with tool_calls present still counts as tools (Ollama, Gemini)', () => {
    const reply = parseOpenAiReply({ choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [{ function: { name: 'get_plan', arguments: '{}' } }] } }] });
    expect(reply.stop).toBe('tools');
    expect(reply.toolCalls[0]!.id).toBe('call_0');
  });

  test('the older function_call shape', () => {
    const reply = parseOpenAiReply({ choices: [{ finish_reason: 'function_call', message: { content: null, function_call: { name: 'get_plan', arguments: '{}' } } }] });
    expect(reply.toolCalls).toEqual([{ id: 'call_0', name: 'get_plan', args: {} }]);
  });

  test('a model that says nothing and calls nothing is an empty answer with the stop word', () => {
    let error: unknown;
    try {
      parseOpenAiReply({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] }, 200);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ kind: 'empty', status: 200 });
    expect((error as AiError).detail).toContain('finish_reason=content_filter');
    expect(() => parseOpenAiReply({ choices: [] })).toThrow(AiError);
    expect(() => parseOpenAiReply('nope')).toThrow(AiError);
  });
});

describe('Anthropic thinking and limits', () => {
  test('thinking blocks are kept apart; max_tokens with no text is truncated', () => {
    expect(parseAnthropicReply({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Halo' }], stop_reason: 'end_turn' })).toMatchObject({ text: 'Halo', thinking: 'hmm', finish: 'end_turn' });
    let error: unknown;
    try {
      parseAnthropicReply({ content: [{ type: 'thinking', thinking: 'still thinking' }], stop_reason: 'max_tokens' });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ kind: 'truncated' });
    expect((error as AiError).detail).toContain('stop_reason=max_tokens');
  });

  test('a stream that is refused with 400 falls back to a plain call', async () => {
    const { fetchImpl, calls } = mockFetch([json({ error: { message: 'stream is not supported for this model' } }, 400), json({ content: [{ type: 'text', text: 'Halo' }], stop_reason: 'end_turn' })]);
    const seen: string[] = [];
    const reply = await anthropicAdapter.complete({ baseUrl: PROVIDERS.anthropic.baseUrl, apiKey: KEY, model: 'claude-haiku-5-5' }, ask, { fetchImpl, onDelta: (d) => seen.push(d.text ?? '') });
    expect(reply.text).toBe('Halo');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toMatchObject({ stream: true });
    expect(calls[1]!.body).not.toHaveProperty('stream');
    expect(seen).toEqual(['Halo']);
  });
});

describe('fast mode (ask the model not to think at length)', () => {
  const custom = { baseUrl: 'https://gateway.example.com/v1', apiKey: KEY, model: 'glm-5.3-flash' };
  const plain = () => json({ choices: [{ finish_reason: 'stop', message: { content: 'Halo' } }] });

  test('a custom server gets the thinking switches; OpenAI proper and Gemini get nothing extra; off sends nothing', async () => {
    resetStreamMemory();
    const on = mockFetch([plain()]);
    await openAiAdapter.complete(custom, { ...ask, fast: true }, { fetchImpl: on.fetchImpl });
    expect(on.calls[0]!.body).toMatchObject({ reasoning_effort: 'low' });
    const off = mockFetch([plain()]);
    await openAiAdapter.complete(custom, ask, { fetchImpl: off.fetchImpl });
    expect(off.calls[0]!.body).not.toHaveProperty('reasoning_effort');
    const openai = mockFetch([plain()]);
    await openAiAdapter.complete({ baseUrl: PROVIDERS.openai.baseUrl, apiKey: KEY, model: 'gpt-6-luna' }, { ...ask, fast: true }, { fetchImpl: openai.fetchImpl });
    expect(openai.calls[0]!.body).not.toHaveProperty('thinking');
    expect(openai.calls[0]!.body).not.toHaveProperty('reasoning');
    const router = mockFetch([plain()]);
    await openAiAdapter.complete({ baseUrl: PROVIDERS.openrouter.baseUrl, apiKey: KEY, model: 'm' }, { ...ask, fast: true }, { fetchImpl: router.fetchImpl });
    expect(router.calls[0]!.body).toMatchObject({ reasoning: { effort: 'low' } });
  });

  test('a server that rejects the fields is asked again without them, and remembered', async () => {
    resetStreamMemory();
    const first = mockFetch([json({ error: { message: 'Unrecognized request argument: reasoning_effort' } }, 400), plain()]);
    const reply = await openAiAdapter.complete(custom, { ...ask, fast: true }, { fetchImpl: first.fetchImpl });
    expect(reply.text).toBe('Halo');
    expect(first.calls).toHaveLength(2);
    expect(first.calls[0]!.body).toHaveProperty('reasoning_effort');
    expect(first.calls[1]!.body).not.toHaveProperty('reasoning_effort');
    const next = mockFetch([plain()]);
    await openAiAdapter.complete(custom, { ...ask, fast: true }, { fetchImpl: next.fetchImpl });
    expect(next.calls[0]!.body).not.toHaveProperty('reasoning_effort');
  });

  test('another kind of failure (a bad key) is not retried', async () => {
    resetStreamMemory();
    const { fetchImpl, calls } = mockFetch([json({ error: { message: 'Incorrect API key' } }, 401)]);
    await expect(openAiAdapter.complete(custom, { ...ask, fast: true }, { fetchImpl })).rejects.toMatchObject({ kind: 'badKey' });
    expect(calls).toHaveLength(1);
  });
});
