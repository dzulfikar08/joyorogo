// Ported from JoyoFit (watch-fit) src/features/ai/adapters/http.ts, adapted for JoyoRogo.
import { AiError, type AiErrorKind, type CallOptions } from '../types';
import { createSseParser, type SseEvent } from './sse';

/** The deadline of one call that is not streamed: thinking models can take a minute before they answer at all. */
export const CALL_TIMEOUT_MS = 90_000;
/** A streamed answer is cut when nothing arrives for this long once it has started. */
export const STREAM_IDLE_MS = 25_000;
/** The wait for the first byte of a streamed answer (the model is reading the data and thinking). */
export const FIRST_BYTE_MS = 60_000;
/** Listing models is a plain read; give it less time than an answer. */
export const LIST_TIMEOUT_MS = 15_000;

const MAX_BODY_CHARS = 400_000;

export function cleanDetail(text: string | null | undefined, key: string): string | null {
  if (!text) return null;
  let out = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A provider may echo a truncated key back in its error; never show or keep it.
  if (key.length >= 8) out = out.split(key).join('[key]');
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/g, '$1...').replace(/\bAIza[A-Za-z0-9_-]{4}[A-Za-z0-9_-]*/g, 'AIza...');
  return out.slice(0, 240) || null;
}

/** Pulls the message out of the usual error bodies: `{error:{message}}`, `{error:"text"}`, `{message}`, `[{error:{message}}]`. */
export function errorMessageOf(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first === 'string') return first;
  if (typeof first !== 'object' || first === null) return null;
  const record = first as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return typeof record.message === 'string' ? record.message : null;
}

const QUOTA_WORDS = /insufficient[_ ]quota|credit balance|billing|insufficient (credits|funds)|out of credits|exceeded your current quota|payment required|quota exceeded|resource[_ ]exhausted/i;
const TOOLS_WORDS = /tool|function[_ ]call/i;
const NO_SUPPORT = /not support|unsupported|does not allow|no endpoints? found|doesn't support|cannot use|invalid.*tool/i;

/** Maps a provider's HTTP failure to a cause the person can act on. The status decides first, then the provider's own words. */
export function kindForStatus(status: number, message: string | null): AiErrorKind {
  const text = message ?? '';
  if (status === 401) return 'badKey';
  if (status === 402) return 'quota';
  if (status === 403) return QUOTA_WORDS.test(text) ? 'quota' : 'forbidden';
  if (status === 404) return TOOLS_WORDS.test(text) && NO_SUPPORT.test(text) ? 'noTools' : 'modelNotFound';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return QUOTA_WORDS.test(text) ? 'quota' : 'rateLimit';
  if (status === 400 || status === 422) {
    if (QUOTA_WORDS.test(text)) return 'quota';
    if (TOOLS_WORDS.test(text) && NO_SUPPORT.test(text)) return 'noTools';
    if (/model/i.test(text) && /(not found|does not exist|unknown|invalid model|no such)/i.test(text)) return 'modelNotFound';
    if (/api key|authentication|invalid x-api-key/i.test(text)) return 'badKey';
    return 'badRequest';
  }
  if (status >= 500 || status === 529) return 'server';
  return 'badRequest';
}

/**
 * One JSON request with a deadline and the caller's abort signal. Failures become an {@link AiError}: no answer in time is
 * `timeout`, a refused connection `network`, the caller's own abort `aborted`. The key is only ever put in `headers` and is
 * stripped from every message kept from an error.
 */
export async function postJson(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown },
  options: CallOptions,
  defaultTimeoutMs: number,
  key: string,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? defaultTimeoutMs);
  const outer = options.signal;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) {
      clearTimeout(timer);
      throw new AiError('aborted');
    }
    outer.addEventListener('abort', onAbort, { once: true });
  }
  const mark = options.mark;
  if (init.method === 'POST') mark?.('request-plain');
  try {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers: { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        credentials: 'omit',
      });
      if (init.method === 'POST') mark?.('headers-plain', { status: response.status });
      text = (await response.text()).slice(0, MAX_BODY_CHARS);
      if (init.method === 'POST') mark?.('body-plain', { bytes: text.length });
    } catch {
      if (outer?.aborted) throw new AiError('aborted');
      throw new AiError(timedOut ? 'timeout' : 'network');
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = errorMessageOf(body) ?? (body === null ? text : null);
      throw new AiError(kindForStatus(response.status, message), response.status, cleanDetail(message, key));
    }
    if (body === null) throw new AiError('server', response.status, cleanDetail(text, key));
    return body;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

/** The longest a streamed answer may run in total, however steadily it arrives. */
export const STREAM_TOTAL_MS = 180_000;

export type StreamOutcome = 'done' | 'unsupported';

/**
 * A POST that answers with server-sent events. `options.timeoutMs` (default 25 s) is an IDLE limit: it restarts with every chunk, so a
 * long answer that keeps arriving is not cut, while a stalled one is; {@link STREAM_TOTAL_MS} caps the whole answer. Returns
 * `unsupported` BEFORE any event when the runtime has no streaming body or text decoder (then the caller answers without
 * streaming). Failures are the same {@link AiError}s as {@link postJson}: an HTTP error is read as a normal error body.
 */
export async function postStream(
  url: string,
  init: { headers: Record<string, string>; body: unknown },
  options: CallOptions,
  key: string,
  onEvent: (event: SseEvent) => void,
): Promise<StreamOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const idleMs = options.timeoutMs ?? STREAM_IDLE_MS;
  // Until the first byte the model may still be reading the question and thinking; after it, silence means a stalled stream.
  let started = false;
  const controller = new AbortController();
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, started ? idleMs : Math.max(idleMs, FIRST_BYTE_MS));
  };
  const total = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STREAM_TOTAL_MS);
  const outer = options.signal;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) {
      clearTimeout(total);
      throw new AiError('aborted');
    }
    outer.addEventListener('abort', onAbort, { once: true });
  }
  arm();
  const mark = options.mark;
  mark?.('request');
  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...init.headers },
        body: JSON.stringify(init.body),
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch {
      if (outer?.aborted) throw new AiError('aborted');
      throw new AiError(timedOut ? 'timeout' : 'network');
    }
    started = true;
    arm();
    mark?.('headers', { status: response.status, stream: response.body ? 1 : 0, type: response.headers?.get?.('content-type') ?? '' });
    if (!response.ok) {
      let text = '';
      try {
        text = (await response.text()).slice(0, MAX_BODY_CHARS);
      } catch {
        if (outer?.aborted) throw new AiError('aborted');
      }
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      const message = errorMessageOf(body) ?? (body === null ? text : null);
      throw new AiError(kindForStatus(response.status, message), response.status, cleanDetail(message, key));
    }
    const reader = response.body?.getReader?.();
    if (!reader || typeof TextDecoder === 'undefined') return 'unsupported';
    const decoder = new TextDecoder();
    let chunks = 0;
    const parser = createSseParser(onEvent);
    // A runtime whose body does not end its pending read on abort would hang: cancel the reader ourselves.
    controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        if (chunks === 0) mark?.('first-chunk', { bytes: value?.length ?? 0 });
        chunks += 1;
        if (value) parser.push(decoder.decode(value, { stream: true }));
      }
      if (controller.signal.aborted) throw new AiError(outer?.aborted ? 'aborted' : 'timeout');
      parser.push(decoder.decode());
      parser.flush();
      mark?.('stream-end', { chunks });
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (outer?.aborted) throw new AiError('aborted');
      throw new AiError(timedOut ? 'timeout' : 'network');
    }
    return 'done';
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    outer?.removeEventListener('abort', onAbort);
  }
}
