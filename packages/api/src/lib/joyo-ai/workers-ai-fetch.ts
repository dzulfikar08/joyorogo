// New for JoyoRogo (the hosted engine). Not a port: JoyoFit has no server-side engine.
// A `fetch` shim so the OpenAI adapter (`adapters/openai.ts`) can drive a Workers AI binding: it takes the adapter's
// `POST {baseUrl}/chat/completions` JSON body, calls `ai.run(model, body)` (Workers AI accepts OpenAI-style `messages`, `tools`,
// `tool_choice`, `stream` and `chat_template_kwargs`) and answers with a `Response` the adapter already understands.
// Nothing from the request headers is forwarded, and the model in the body is replaced by the server's own.
// [NOT VERIFIED] The streamed `tool_calls` shape of Gemma 4 on Workers AI; the OpenAI-shaped chunks are passed through as they come.
import { isRecord } from './json';

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const errorResponse = (status: number, message: string): Response => jsonResponse({ error: { message } }, status);

/** Request fields the binding does not take: the model is the server's, `stream_options` is an OpenAI-only extra. */
const DROPPED: Record<string, true> = { model: true, stream_options: true };

/** The body for `ai.run`: the adapter's fields minus the ones the binding does not know; `max_completion_tokens` becomes `max_tokens`. */
function inputOf(body: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (DROPPED[key]) continue;
    input[key === 'max_completion_tokens' ? 'max_tokens' : key] = value;
  }
  return input;
}

function toolCallsOf(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((c, i) => {
    const call = isRecord(c) ? c : {};
    const fn = isRecord(call.function) ? call.function : call;
    const args = fn.arguments;
    return {
      id: typeof call.id === 'string' && call.id !== '' ? call.id : `call_${i}`,
      type: 'function',
      function: { name: typeof fn.name === 'string' ? fn.name : '', arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
    };
  });
}

/** What the binding returned as an OpenAI chat completion: passed through when it already is one, else built from `{ response, tool_calls, usage }`. */
function completionOf(result: unknown): Record<string, unknown> {
  if (isRecord(result) && Array.isArray(result.choices)) return result;
  const r = isRecord(result) ? result : {};
  const toolCalls = toolCallsOf(r.tool_calls);
  const text = typeof r.response === 'string' ? r.response : '';
  const usage = isRecord(r.usage) ? r.usage : undefined;
  return {
    object: 'chat.completion',
    choices: [{ index: 0, finish_reason: toolCalls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }],
    ...(usage ? { usage } : {}),
  };
}

/** One OpenAI-shaped completion as the SSE bytes of a stream: one chunk with the whole message, a finish, then `[DONE]`. */
function sseOf(completion: Record<string, unknown>): ReadableStream<Uint8Array> {
  const choice = Array.isArray(completion.choices) && isRecord(completion.choices[0]) ? completion.choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map((c, index) => ({ index, ...(isRecord(c) ? c : {}) })) : undefined;
  const delta = { role: 'assistant', content: typeof message.content === 'string' ? message.content : '', ...(calls ? { tool_calls: calls } : {}) };
  const chunks = [
    { object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] },
    { object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop' }], ...(isRecord(completion.usage) ? { usage: completion.usage } : {}) },
  ];
  const text = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const statusOf = (message: string): number => (/capacity|rate|too many|quota|limit/i.test(message) ? 429 : 500);

/** Rejects when the caller's signal aborts, like a real `fetch`. The binding itself cannot be cancelled. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', abort);
        reject(e);
      },
    );
  });
}

export function workersAiFetch(ai: AiBinding, model: string): typeof fetch {
  const shim = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url.pathname.endsWith('/models')) return jsonResponse({ data: [] });
    if (method !== 'POST' || !url.pathname.endsWith('/chat/completions')) return errorResponse(404, 'not found');

    let body: unknown;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    if (!isRecord(body)) return errorResponse(400, 'invalid request body');

    const stream = body.stream === true;
    let result: unknown;
    try {
      result = await abortable(ai.run(model, inputOf(body)), init?.signal);
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : 'model error';
      return errorResponse(statusOf(message), message.slice(0, 240));
    }

    if (stream) {
      const sse = { headers: { 'Content-Type': 'text/event-stream' } };
      if (result instanceof ReadableStream) return new Response(result as ReadableStream<Uint8Array>, sse);
      return new Response(sseOf(completionOf(result)), sse);
    }
    return jsonResponse(completionOf(result));
  };
  return shim as unknown as typeof fetch;
}
