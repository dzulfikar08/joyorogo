// Ported from JoyoFit (watch-fit) src/features/ai/adapters/anthropic.ts, adapted for JoyoRogo.
import { isRecord, type Json } from '../json';
import type { Adapter, CallOptions, ModelInfo, ModelReply, ModelRequest, NeutralMessage, ProviderConnection, StreamDelta, ToolCall, Usage } from '../types';
import { AiError } from '../types';
import { CALL_TIMEOUT_MS, LIST_TIMEOUT_MS, postJson, postStream } from './http';

export const ANTHROPIC_VERSION = '2023-06-01';
/** Claude 5 models think adaptively and thinking tokens count against `max_tokens`; the headroom keeps a short answer from being cut off by it. */
export const THINKING_HEADROOM = 1200;
/** Claude 5 models take `output_config.effort`; older ones do not, so it is only sent for these. */
const EFFORT_MODELS = /^claude-(haiku|sonnet|opus|fable|mythos)-5/;

/** Anthropic wants strictly alternating roles: tool results ride in a user turn, and neighbours of one role are merged. */
function toWireMessages(messages: readonly NeutralMessage[]): Json[] {
  const wire: Json[] = [];
  const push = (role: 'user' | 'assistant', blocks: Json[]) => {
    const last = wire.at(-1);
    if (last && last.role === role) (last.content as Json[]).push(...blocks);
    else wire.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'user') push('user', [{ type: 'text', text: message.content }]);
    else if (message.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: message.callId, content: message.content }]);
    else {
      const blocks: Json[] = [];
      if (message.content !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      if (blocks.length > 0) push('assistant', blocks);
    }
  }
  return wire;
}

/** The body of `POST {baseUrl}/v1/messages`. Exported for the request-mapping tests. */
export function buildAnthropicBody(request: ModelRequest, opts: { stream?: boolean } = {}): Json {
  const body: Json = {
    model: request.model,
    max_tokens: request.maxTokens + THINKING_HEADROOM,
    system: request.system,
    messages: toWireMessages(request.messages),
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  }
  if (EFFORT_MODELS.test(request.model)) body.output_config = { effort: 'low' };
  if (opts.stream) body.stream = true;
  return body;
}

const usageOf = (raw: unknown, into: Usage | null): Usage | null => {
  if (!isRecord(raw)) return into;
  const base = into ?? { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: Number(raw.input_tokens) || base.inputTokens,
    outputTokens: Number(raw.output_tokens) || base.outputTokens,
  };
};

function finishReply(parts: { text: string; thinking: string; toolCalls: ToolCall[]; usage: Usage | null; reason: string | null; status: number }): ModelReply {
  const { text, thinking, toolCalls, reason } = parts;
  if (toolCalls.length === 0 && text.trim() === '') {
    const detail = `stop_reason=${reason ?? 'none'}; answer=${text.length} chars; thinking=${thinking.length} chars`;
    throw new AiError(reason === 'max_tokens' ? 'truncated' : 'empty', parts.status, detail);
  }
  const stop = toolCalls.length > 0 ? 'tools' : reason === 'max_tokens' ? 'length' : reason === 'end_turn' || reason === 'stop_sequence' ? 'end' : 'other';
  return { text, thinking, toolCalls, usage: parts.usage, stop, finish: reason };
}

/** Reads a Messages answer. Exported for the response-mapping tests. */
export function parseAnthropicReply(body: unknown, status = 200): ModelReply {
  if (!isRecord(body) || !Array.isArray(body.content)) throw new AiError('server', status, 'the answer had no content list');
  let text = '';
  let thinking = '';
  const toolCalls: ToolCall[] = [];
  for (const block of body.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block.type === 'thinking' && typeof block.thinking === 'string') thinking += block.thinking;
    else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.push({ id: block.id, name: block.name, args: isRecord(block.input) ? block.input : {} });
    }
  }
  return finishReply({ text, thinking, toolCalls, usage: usageOf(body.usage, null), reason: typeof body.stop_reason === 'string' ? body.stop_reason : null, status });
}

interface Block {
  type: string;
  id: string;
  name: string;
  json: string;
}

/** Collects the events of a streamed Messages answer into the reply the non-streaming call returns. */
export function createAnthropicStream(onDelta: ((delta: StreamDelta) => void) | undefined, status = 200) {
  let text = '';
  let thinking = '';
  let usage: Usage | null = null;
  let reason: string | null = null;
  const blocks = new Map<number, Block>();

  const emit = (delta: StreamDelta) => {
    if (delta.text) text += delta.text;
    if (delta.thinking) thinking += delta.thinking;
    if (delta.text || delta.thinking) onDelta?.(delta);
  };

  return {
    /** One event: Anthropic puts the event type in the JSON `type` as well, so only `data` is read. */
    push(data: string): void {
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (!isRecord(event)) return;
      switch (event.type) {
        case 'message_start':
          if (isRecord(event.message)) usage = usageOf(event.message.usage, usage);
          break;
        case 'content_block_start': {
          const block = isRecord(event.content_block) ? event.content_block : {};
          const index = Number(event.index);
          blocks.set(index, { type: String(block.type ?? ''), id: typeof block.id === 'string' ? block.id : '', name: typeof block.name === 'string' ? block.name : '', json: '' });
          if (block.type === 'text' && typeof block.text === 'string') emit({ text: block.text });
          break;
        }
        case 'content_block_delta': {
          const delta = isRecord(event.delta) ? event.delta : {};
          if (delta.type === 'text_delta' && typeof delta.text === 'string') emit({ text: delta.text });
          else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') emit({ thinking: delta.thinking });
          else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const block = blocks.get(Number(event.index));
            if (block) block.json += delta.partial_json;
          }
          break;
        }
        case 'message_delta':
          if (isRecord(event.delta) && typeof event.delta.stop_reason === 'string') reason = event.delta.stop_reason;
          usage = usageOf(event.usage, usage);
          break;
        case 'error': {
          const error = isRecord(event.error) ? event.error : {};
          const message = typeof error.message === 'string' ? error.message.slice(0, 240) : 'error event in the stream';
          // `overloaded_error` is a busy server; the rest are the same causes as an HTTP error.
          throw new AiError(error.type === 'overloaded_error' ? 'server' : error.type === 'rate_limit_error' ? 'rateLimit' : error.type === 'authentication_error' ? 'badKey' : 'server', status, message);
        }
        default:
          break;
      }
    },
    result(): ModelReply {
      const toolCalls: ToolCall[] = [];
      for (const block of [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b)) {
        if (block.type !== 'tool_use' || block.name === '') continue;
        let input: unknown = {};
        try {
          input = block.json.trim() === '' ? {} : JSON.parse(block.json);
        } catch {
          input = {};
        }
        toolCalls.push({ id: block.id || `toolu_${toolCalls.length}`, name: block.name, args: isRecord(input) ? input : {} });
      }
      return finishReply({ text, thinking, toolCalls, usage, reason, status });
    },
  };
}

export function parseAnthropicModels(body: unknown): ModelInfo[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const out: ModelInfo[] = [];
  for (const raw of body.data) {
    if (isRecord(raw) && typeof raw.id === 'string') out.push({ id: raw.id, tools: true });
  }
  return out;
}

const headers = (key: string): Record<string, string> => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION });

async function complete(conn: ProviderConnection, request: ModelRequest, options: CallOptions = {}): Promise<ModelReply> {
  const url = `${conn.baseUrl}/v1/messages`;
  if (options.onDelta) {
    const stream = createAnthropicStream(options.onDelta);
    try {
      const outcome = await postStream(url, { headers: headers(conn.apiKey), body: buildAnthropicBody(request, { stream: true }) }, options, conn.apiKey, (event) => stream.push(event.data));
      if (outcome === 'done') return stream.result();
    } catch (error) {
      if (!(error instanceof AiError) || error.kind !== 'badRequest' || error.status === null) throw error;
    }
  }
  const body = await postJson(url, { method: 'POST', headers: headers(conn.apiKey), body: buildAnthropicBody(request) }, options, CALL_TIMEOUT_MS, conn.apiKey);
  const reply = parseAnthropicReply(body);
  if (options.onDelta) options.onDelta({ ...(reply.thinking ? { thinking: reply.thinking } : {}), ...(reply.text ? { text: reply.text } : {}) });
  return reply;
}

export const anthropicAdapter: Adapter = {
  complete,
  async listModels(conn, options = {}) {
    const body = await postJson(`${conn.baseUrl}/v1/models?limit=100`, { method: 'GET', headers: headers(conn.apiKey) }, options, LIST_TIMEOUT_MS, conn.apiKey);
    return parseAnthropicModels(body);
  },
};
