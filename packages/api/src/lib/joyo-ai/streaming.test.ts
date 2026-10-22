// Ported from JoyoFit (watch-fit) src/features/ai/streaming.test.ts, adapted for JoyoRogo.
import { beforeEach, describe, expect, test } from 'bun:test';

import { anthropicAdapter } from './adapters/anthropic';
import { openAiAdapter, resetStreamMemory } from './adapters/openai';
import { createSseParser, createThinkSplitter, type SseEvent } from './adapters/sse';
import { PROVIDERS } from './providers';
import { json, mockFetch, TEST_TOOL_SPECS as TOOL_SPECS } from './testFixtures';
import type { StreamDelta } from './types';

beforeEach(resetStreamMemory);

const KEY = 'sk-test-0123456789abcdef';
const request = { model: 'm', system: 'SYS', messages: [{ role: 'user' as const, content: 'hai' }], tools: TOOL_SPECS, maxTokens: 800 };
const enc = new TextEncoder();

/** An SSE response whose bytes arrive in the given pieces (so events and even characters can be cut anywhere). */
function sse(pieces: string[], status = 200): Response {
  const bytes = pieces.map((p) => enc.encode(p));
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < bytes.length) controller.enqueue(bytes[i++]!);
        else controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

const frame = (data: unknown): string => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => frame({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe('SSE parser', () => {
  const events = (input: string[]): SseEvent[] => {
    const out: SseEvent[] = [];
    const parser = createSseParser((e) => out.push(e));
    for (const piece of input) parser.push(piece);
    parser.flush();
    return out;
  };

  test('events, named events, multi-line data, comments, CRLF and CR line ends', () => {
    expect(events(['data: a\n\ndata: b\n\n'])).toEqual([{ event: null, data: 'a' }, { event: null, data: 'b' }]);
    expect(events(['event: message_start\ndata: {"x":1}\n\n'])).toEqual([{ event: 'message_start', data: '{"x":1}' }]);
    expect(events(['data: one\ndata: two\n\n'])).toEqual([{ event: null, data: 'one\ntwo' }]);
    expect(events([': keep-alive\n\ndata: x\n\n'])).toEqual([{ event: null, data: 'x' }]);
    expect(events(['data: a\r\n\r\ndata: b\r\n\r\n'])).toEqual([{ event: null, data: 'a' }, { event: null, data: 'b' }]);
    expect(events(['data: a\r\rdata: b\r\r'])).toEqual([{ event: null, data: 'a' }, { event: null, data: 'b' }]);
    expect(events(['data:nospace\n\n'])).toEqual([{ event: null, data: 'nospace' }]);
  });

  test('a split anywhere gives the same events, a CRLF split between chunks is one line end, and a last event without a blank line is flushed', () => {
    const whole = 'event: a\ndata: {"t":"x"}\n\ndata: [DONE]\n\n';
    for (let cut = 1; cut < whole.length; cut++) expect(events([whole.slice(0, cut), whole.slice(cut)])).toEqual(events([whole]));
    expect(events(['data: a\r', '\n\r', '\ndata: b\n'])).toEqual([{ event: null, data: 'a' }, { event: null, data: 'b' }]);
    expect(events(['data: tail'])).toEqual([{ event: null, data: 'tail' }]);
  });
});

describe('think splitter across chunks', () => {
  test('a tag cut in two chunks is held until whole; nothing is lost', () => {
    const s = createThinkSplitter();
    const out = ['Hai <th', 'ink>cek ', 'data</thi', 'nk> lanjut <', 'b>x'].map((c) => s.push(c));
    const end = s.end();
    expect(out.map((o) => o.text).join('') + end.text).toBe('Hai  lanjut <b>x');
    expect(out.map((o) => o.thinking).join('') + end.thinking).toBe('cek data');
  });
});

describe('OpenAI-compatible streaming', () => {
  const conn = { baseUrl: PROVIDERS.openrouter.baseUrl, apiKey: KEY, model: 'anthropic/claude-haiku-5.5' };

  test('text arrives in pieces and the same reply comes back; usage from the final chunk; the request asks for a stream with usage', async () => {
    const { fetchImpl, calls } = mockFetch([
      sse([
        chunk({ role: 'assistant', content: '' }),
        chunk({ content: 'Tidur' }),
        chunk({ content: 'mu cukup.' }),
        chunk({}, 'stop'),
        frame({ choices: [], usage: { prompt_tokens: 3000, completion_tokens: 42 } }),
        frame('[DONE]'),
      ]),
    ]);
    const seen: StreamDelta[] = [];
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: (d) => seen.push(d) });
    expect(seen).toEqual([{ text: 'Tidur' }, { text: 'mu cukup.' }]);
    expect(reply).toMatchObject({ text: 'Tidurmu cukup.', thinking: '', stop: 'end', finish: 'stop', usage: { inputTokens: 3000, outputTokens: 42 } });
    expect(calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(calls[0]!.headers.Accept).toBe('text/event-stream');
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  test('GLM style: reasoning_content deltas first, then content; the two never mix', async () => {
    const { fetchImpl } = mockFetch([
      sse([chunk({ reasoning_content: 'Mari lihat ' }), chunk({ reasoning_content: 'datanya.' }), chunk({ content: 'Minggu ini ' }), chunk({ content: 'bagus.' }, 'stop'), frame('[DONE]')]),
    ]);
    const seen: StreamDelta[] = [];
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: (d) => seen.push(d) });
    expect(seen.filter((d) => d.thinking).map((d) => d.thinking).join('')).toBe('Mari lihat datanya.');
    expect(reply).toMatchObject({ text: 'Minggu ini bagus.', thinking: 'Mari lihat datanya.' });
  });

  test('a thinking model that runs out of budget while thinking streams its reasoning, then fails as truncated', async () => {
    const { fetchImpl } = mockFetch([sse([chunk({ reasoning_content: 'x'.repeat(50) }), chunk({}, 'length'), frame('[DONE]')])]);
    await expect(openAiAdapter.complete(conn, request, { fetchImpl, onDelta: () => {} })).rejects.toMatchObject({ kind: 'truncated' });
  });

  test('inline <think> tags in streamed content go to thinking, even when a tag is cut', async () => {
    const { fetchImpl } = mockFetch([sse([chunk({ content: '<thi' }), chunk({ content: 'nk>cek</th' }), chunk({ content: 'ink>Jawaban.' }, 'stop')])]);
    const seen: StreamDelta[] = [];
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: (d) => seen.push(d) });
    expect(reply).toMatchObject({ text: 'Jawaban.', thinking: 'cek' });
    expect(seen.map((d) => d.text ?? '').join('')).toBe('Jawaban.');
  });

  test('tool calls assembled from deltas by index: name in the first piece, arguments in many; two calls; a call with no id gets one', async () => {
    const { fetchImpl } = mockFetch([
      sse([
        chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_trend', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"metric":"hr' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'vMs","days":14}' } }] }),
        chunk({ tool_calls: [{ index: 1, id: '', function: { name: 'get_plan', arguments: '{}' } }] }, 'tool_calls'),
        frame('[DONE]'),
      ]),
    ]);
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: () => {} });
    expect(reply.stop).toBe('tools');
    expect(reply.toolCalls).toEqual([
      { id: 'call_a', name: 'get_trend', args: { metric: 'hrvMs', days: 14 } },
      { id: 'call_1', name: 'get_plan', args: {} },
    ]);
  });

  test('Gemini style: every call has index 0 omitted and arrives whole in one chunk each', async () => {
    const { fetchImpl } = mockFetch([
      sse([
        chunk({ tool_calls: [{ function: { name: 'get_plan', arguments: '{}' } }] }),
        chunk({ tool_calls: [{ function: { name: 'get_trend', arguments: '{"metric":"steps","days":7}' } }] }, 'stop'),
      ]),
    ]);
    const reply = await openAiAdapter.complete({ baseUrl: PROVIDERS.gemini.baseUrl, apiKey: KEY, model: 'gemini-3.8-flash' }, request, { fetchImpl, onDelta: () => {} });
    expect(reply.toolCalls.map((c) => c.name)).toEqual(['get_plan', 'get_trend']);
    expect(reply.toolCalls[1]!.args).toEqual({ metric: 'steps', days: 7 });
  });

  test('bytes cut inside a multi-byte character and inside an event are put back together', async () => {
    const whole = enc.encode(chunk({ content: 'Tidur \u00e9n 7 jam \u2014 bagus' }) + chunk({}, 'stop'));
    const cut = whole.indexOf(0xc3) + 1;
    const parts = [whole.slice(0, cut), whole.slice(cut, cut + 9), whole.slice(cut + 9)];
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }), { status: 200 });
    const { fetchImpl } = mockFetch([response]);
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: () => {} });
    expect(reply.text).toBe('Tidur \u00e9n 7 jam \u2014 bagus');
  });

  test('an error inside the stream becomes a typed error; an HTTP error is mapped like a plain call and never leaks the key', async () => {
    const mid = mockFetch([sse([chunk({ content: 'sebagian' }), frame({ error: { message: 'upstream exploded' } })])]);
    await expect(openAiAdapter.complete(conn, request, { fetchImpl: mid.fetchImpl, onDelta: () => {} })).rejects.toMatchObject({ kind: 'server' });
    const http = mockFetch([json({ error: { message: `Invalid key ${KEY}` } }, 401)]);
    const error = await openAiAdapter.complete(conn, request, { fetchImpl: http.fetchImpl, onDelta: () => {} }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'badKey', status: 401 });
    expect(JSON.stringify(error)).not.toContain('0123456789abcdef');
  });

  test('a server that refuses `stream_options` is asked again without it (and remembered); one that refuses `stream` too gets a plain call, and the answer reaches onDelta in one piece', async () => {
    const custom = { baseUrl: 'https://gateway.example.com/v1', apiKey: KEY, model: 'glm-5.3-flash' };
    const first = mockFetch([json({ error: { message: 'unknown field stream_options' } }, 400), sse([chunk({ content: 'Halo' }, 'stop'), frame('[DONE]')])]);
    expect((await openAiAdapter.complete(custom, request, { fetchImpl: first.fetchImpl, onDelta: () => {} })).text).toBe('Halo');
    expect(first.calls.map((c) => (c.body as { stream_options?: unknown }).stream_options !== undefined)).toEqual([true, false]);
    // remembered: the next question does not try it again
    const next = mockFetch([sse([chunk({ content: 'Lagi' }, 'stop')])]);
    await openAiAdapter.complete(custom, request, { fetchImpl: next.fetchImpl, onDelta: () => {} });
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]!.body).not.toHaveProperty('stream_options');

    resetStreamMemory();
    const { fetchImpl, calls } = mockFetch([json({ error: { message: 'stream is not supported' } }, 400), json({ error: { message: 'stream is not supported' } }, 400), json({ choices: [{ finish_reason: 'stop', message: { content: 'Halo' } }] })]);
    const seen: StreamDelta[] = [];
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: (d) => seen.push(d) });
    expect(reply.text).toBe('Halo');
    expect(calls.map((c) => (c.body as { stream?: boolean }).stream === true)).toEqual([true, true, false]);
    expect(seen).toEqual([{ text: 'Halo' }]);
  });

  test('a custom endpoint is asked for token usage like the others', async () => {
    const { fetchImpl, calls } = mockFetch([sse([chunk({ content: 'ok' }, 'stop'), frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })])]);
    const reply = await openAiAdapter.complete({ baseUrl: 'https://gateway.example.com/v1', apiKey: KEY, model: 'm' }, request, { fetchImpl, onDelta: () => {} });
    expect(calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(reply.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  test('a runtime whose response has no readable body falls back to a plain call', async () => {
    const noBody = { ok: true, status: 200, body: null, text: async () => '' } as unknown as Response;
    const { fetchImpl, calls } = mockFetch([noBody, json({ choices: [{ finish_reason: 'stop', message: { content: 'Halo' } }] })]);
    const reply = await openAiAdapter.complete(conn, request, { fetchImpl, onDelta: () => {} });
    expect(reply.text).toBe('Halo');
    expect(calls).toHaveLength(2);
  });

  test('without onDelta nothing streams', async () => {
    const { fetchImpl, calls } = mockFetch([json({ choices: [{ finish_reason: 'stop', message: { content: 'Halo' } }] })]);
    await openAiAdapter.complete(conn, request, { fetchImpl });
    expect(calls[0]!.body).not.toHaveProperty('stream');
  });

  test('a stream that stalls is a timeout after the idle limit; leaving the screen aborts it', async () => {
    const stalled = () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    const hang = ((_: string, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        const response = stalled();
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        resolve(response);
        init?.signal?.addEventListener('abort', () => void response.body?.cancel().catch(() => {}));
      })) as unknown as typeof fetch;
    await expect(openAiAdapter.complete(conn, request, { fetchImpl: hang, onDelta: () => {}, timeoutMs: 30 })).rejects.toMatchObject({ kind: 'timeout' });
    const controller = new AbortController();
    const pending = openAiAdapter.complete(conn, request, { fetchImpl: hang, onDelta: () => {}, timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('what a server refuses is blamed on the right extra', () => {
  const custom = { baseUrl: 'https://gateway.example.com/v1', apiKey: KEY, model: 'glm-5.3-flash' };

  test('fast-mode fields refused: the next try still streams, with usage; only fast is remembered as refused', async () => {
    resetStreamMemory();
    const { fetchImpl, calls } = mockFetch([json({ error: { message: 'Unknown parameter: reasoning_effort' } }, 400), sse([chunk({ content: 'Halo' }, 'stop'), frame('[DONE]')])]);
    const reply = await openAiAdapter.complete(custom, { ...request, fast: true }, { fetchImpl, onDelta: () => {} });
    expect(reply.text).toBe('Halo');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true }, reasoning_effort: 'low' });
    expect(calls[1]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(calls[1]!.body).not.toHaveProperty('reasoning_effort');
    // the next question streams with usage and without the fast fields
    const next = mockFetch([sse([chunk({ content: 'Lagi' }, 'stop')])]);
    await openAiAdapter.complete(custom, { ...request, fast: true }, { fetchImpl: next.fetchImpl, onDelta: () => {} });
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(next.calls[0]!.body).not.toHaveProperty('reasoning_effort');
  });

  test('a refusal that is not about the extras (still 400 on the plain call) is reported, and nothing is learned', async () => {
    resetStreamMemory();
    const bad = () => json({ error: { message: 'messages too long' } }, 400);
    const { fetchImpl, calls } = mockFetch([bad(), bad(), bad(), bad()]);
    await expect(openAiAdapter.complete(custom, { ...request, fast: true }, { fetchImpl, onDelta: () => {} })).rejects.toMatchObject({ kind: 'badRequest' });
    expect(calls).toHaveLength(4);
    const after = mockFetch([sse([chunk({ content: 'ok' }, 'stop')])]);
    await openAiAdapter.complete(custom, request, { fetchImpl: after.fetchImpl, onDelta: () => {} });
    expect(after.calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
});

describe('Anthropic streaming', () => {
  const conn = { baseUrl: PROVIDERS.anthropic.baseUrl, apiKey: KEY, model: 'claude-haiku-5-5' };
  const ev = (type: string, body: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;

  test('thinking, text and a tool call, with usage from message_start and message_delta', async () => {
    const { fetchImpl, calls } = mockFetch([
      sse([
        ev('message_start', { message: { id: 'm', usage: { input_tokens: 2900, output_tokens: 1 } } }),
        ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
        ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Lihat HRV.' } }),
        ev('content_block_stop', { index: 0 }),
        ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Saya cek ' } }),
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'dulu.' } }),
        ev('content_block_stop', { index: 1 }),
        ev('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_trend', input: {} } }),
        ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '{"metric":"hrvMs",' } }),
        ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '"days":14}' } }),
        ev('content_block_stop', { index: 2 }),
        ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 61 } }),
        ev('message_stop', {}),
      ]),
    ]);
    const seen: StreamDelta[] = [];
    const reply = await anthropicAdapter.complete(conn, request, { fetchImpl, onDelta: (d) => seen.push(d) });
    expect(calls[0]!.body).toMatchObject({ stream: true });
    expect(calls[0]!.headers['x-api-key']).toBe(KEY);
    expect(seen).toEqual([{ thinking: 'Lihat HRV.' }, { text: 'Saya cek ' }, { text: 'dulu.' }]);
    expect(reply).toMatchObject({ text: 'Saya cek dulu.', thinking: 'Lihat HRV.', stop: 'tools', finish: 'tool_use', usage: { inputTokens: 2900, outputTokens: 61 } });
    expect(reply.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_trend', args: { metric: 'hrvMs', days: 14 } }]);
  });

  test('ping events are ignored and an overloaded error event is a server error', async () => {
    const ok = mockFetch([sse([ev('ping', {}), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }), ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Halo' } }), ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } })])]);
    expect((await anthropicAdapter.complete(conn, request, { fetchImpl: ok.fetchImpl, onDelta: () => {} })).text).toBe('Halo');
    const bad = mockFetch([sse([ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })])]);
    await expect(anthropicAdapter.complete(conn, request, { fetchImpl: bad.fetchImpl, onDelta: () => {} })).rejects.toMatchObject({ kind: 'server' });
  });
});
