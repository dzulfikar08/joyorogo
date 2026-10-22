// New for JoyoRogo: the hosted engine's fetch shim, exercised through the real OpenAI adapter.
import { describe, expect, test } from 'bun:test';

import { openAiAdapter, resetStreamMemory } from './adapters/openai';
import { TEST_TOOL_SPECS } from './testFixtures';
import { workersAiFetch } from './workers-ai-fetch';
import { AiError, type StreamDelta } from './types';

const CONN = { baseUrl: 'workers-ai://', apiKey: '-', model: 'ignored' };
const ask = { model: 'ignored', system: 'SYS', messages: [{ role: 'user' as const, content: 'Mana yang lebih tinggi serat?' }], tools: TEST_TOOL_SPECS, maxTokens: 800 };

function binding(results: unknown[]) {
  const runs: { model: string; input: Record<string, unknown> }[] = [];
  return {
    runs,
    ai: {
      async run(model: string, input: unknown) {
        runs.push({ model, input: input as Record<string, unknown> });
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

const sse = (...events: unknown[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });

describe('non-streaming', () => {
  test('a completion object is answered as JSON through the OpenAI adapter; the model is the server one and no header is forwarded', async () => {
    resetStreamMemory();
    const b = binding([{ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Pepaya.' } }], usage: { prompt_tokens: 120, completion_tokens: 7 } }]);
    const reply = await openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(b.ai, '@cf/google/gemma-4-26b-a4b-it') });
    expect(reply.text).toBe('Pepaya.');
    expect(reply.usage).toEqual({ inputTokens: 120, outputTokens: 7 });
    expect(b.runs[0]!.model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(b.runs[0]!.input).not.toHaveProperty('model');
    expect(b.runs[0]!.input).not.toHaveProperty('stream_options');
    expect(b.runs[0]!.input.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'Mana yang lebih tinggi serat?' }]);
    expect(Array.isArray(b.runs[0]!.input.tools)).toBe(true);
  });
  test('the legacy { response, tool_calls } shape becomes a completion with tool calls', async () => {
    resetStreamMemory();
    const b = binding([{ response: '', tool_calls: [{ name: 'get_day', arguments: { date: '2026-10-22' } }] }]);
    const reply = await openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(b.ai, 'm') });
    expect(reply.toolCalls).toEqual([{ id: 'call_0', name: 'get_day', args: { date: '2026-10-22' } }]);
    expect(reply.stop).toBe('tools');
  });
  test('a binding error is an HTTP error the adapter words: capacity is a rate limit, anything else a server error', async () => {
    resetStreamMemory();
    const capacity = binding([new Error('3040: Capacity temporarily exceeded')]);
    await expect(openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(capacity.ai, 'm') })).rejects.toMatchObject({ kind: 'rateLimit', status: 429 });
    const broken = binding([new Error('boom')]);
    await expect(openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(broken.ai, 'm') })).rejects.toBeInstanceOf(AiError);
  });
  test('GET /models answers an empty list; other paths 404', async () => {
    const f = workersAiFetch(binding([]).ai, 'm');
    const models = (await (await f('workers-ai:///models')).json()) as { data: unknown[] };
    expect(models.data).toEqual([]);
    expect((await f('workers-ai:///other', { method: 'POST', body: '{}' } as RequestInit)).status).toBe(404);
  });
});

describe('streaming', () => {
  test('the binding SSE passes through as the answer arrives', async () => {
    resetStreamMemory();
    const b = binding([sse({ choices: [{ delta: { content: 'Pep' } }] }, { choices: [{ delta: { content: 'aya' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }, '[DONE]')]);
    const deltas: StreamDelta[] = [];
    const reply = await openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(b.ai, 'm'), onDelta: (d) => deltas.push(d) });
    expect(deltas.map((d) => d.text).join('')).toBe('Pepaya');
    expect(reply.text).toBe('Pepaya');
    expect(b.runs[0]!.input.stream).toBe(true);
  });
  test('an object answer to a streaming call is encoded as SSE, tool calls included', async () => {
    resetStreamMemory();
    const b = binding([{ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'get_targets', arguments: '{}' } }] } }] }]);
    const reply = await openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(b.ai, 'm'), onDelta: () => {} });
    expect(reply.toolCalls).toEqual([{ id: 'call_a', name: 'get_targets', args: {} }]);
  });
  test('a tool-call round trip: the tool result goes back to the binding as a tool message', async () => {
    resetStreamMemory();
    const b = binding([
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_day', arguments: '{"date":"2026-10-22"}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Sisa 600 kkal.' } }] },
    ]);
    const fetchImpl = workersAiFetch(b.ai, 'm');
    const first = await openAiAdapter.complete(CONN, ask, { fetchImpl });
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'get_day', args: { date: '2026-10-22' } }]);
    const second = await openAiAdapter.complete(
      CONN,
      { ...ask, messages: [...ask.messages, { role: 'assistant', content: '', toolCalls: first.toolCalls }, { role: 'tool', callId: 'call_1', name: 'get_day', content: '{"remaining":{"kcal":600}}' }] },
      { fetchImpl },
    );
    expect(second.text).toBe('Sisa 600 kkal.');
    const messages = b.runs[1]!.input.messages as { role: string; tool_call_id?: string; content?: string }[];
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1', content: '{"remaining":{"kcal":600}}' });
    expect(messages.at(-2)).toMatchObject({ role: 'assistant' });
  });
  test('an abort rejects like fetch does and reaches the caller as aborted', async () => {
    resetStreamMemory();
    const never = { run: () => new Promise<unknown>(() => {}) };
    const controller = new AbortController();
    const pending = openAiAdapter.complete(CONN, ask, { fetchImpl: workersAiFetch(never, 'm'), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});
