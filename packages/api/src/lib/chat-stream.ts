/**
 * Decoder for a Workers AI chat stream (`stream: true`): server-sent events
 * whose `data:` lines are OpenAI-style chunks, ending with `[DONE]`.
 *
 *   data: {"choices":[{"delta":{"content":"{\""},"finish_reason":null}],"usage":{"completion_tokens":1,...}}
 *   data: {"choices":[{"delta":{...},"finish_reason":"stop"}],...}
 *   data: {"response":"","usage":{"prompt_tokens":300,"completion_tokens":51,"neurons":4.1,...}}
 *   data: [DONE]
 *
 * Per-token chunks carry usage increments; the closing `response` chunk
 * carries the cumulative total, which wins when present. Events can be split
 * across reads or arrive several to a read, so lines are buffered.
 */
export class ChatStreamDecoder {
  private buffer = "";
  private increments: Record<string, number> = {};
  private total: Record<string, unknown> | null = null;
  /** Every content character received so far. */
  text = "";
  /** Reasoning deltas, for models that answer inside their reasoning. */
  reasoning = "";
  finish: string | null = null;
  /** `[DONE]` arrived. */
  done = false;

  /** Feed decoded text; returns the content added by it ("" when none). */
  push(chunk: string): string {
    this.buffer += chunk;
    let added = "";
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trimEnd();
      this.buffer = this.buffer.slice(newline + 1);
      added += this.line(line);
      newline = this.buffer.indexOf("\n");
    }
    return added;
  }

  /** Whatever sits in the buffer without a trailing newline (stream ended). */
  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? this.line(rest) : "";
  }

  /** Token accounting for the cost ledger; null when the stream carried none. */
  get usage(): Record<string, unknown> | null {
    if (this.total) return this.total;
    return Object.keys(this.increments).length > 0 ? { ...this.increments } : null;
  }

  private line(line: string): string {
    if (!line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      this.done = true;
      return "";
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return "";
    }
    const c = chunk as {
      response?: unknown;
      usage?: Record<string, unknown>;
      choices?: Array<{
        delta?: { content?: unknown; reasoning_content?: unknown };
        text?: unknown;
        finish_reason?: unknown;
      }>;
    };
    let added = "";
    const choice = c.choices?.[0];
    if (typeof choice?.delta?.content === "string") added = choice.delta.content;
    else if (typeof choice?.text === "string") added = choice.text;
    else if (typeof c.response === "string") added = c.response;
    if (typeof choice?.finish_reason === "string") this.finish = choice.finish_reason;
    if (typeof choice?.delta?.reasoning_content === "string") {
      this.reasoning += choice.delta.reasoning_content;
    }
    if (c.usage && typeof c.usage === "object") {
      if ("response" in c) {
        this.total = c.usage;
      } else {
        for (const [key, value] of Object.entries(c.usage)) {
          if (typeof value === "number") this.increments[key] = (this.increments[key] ?? 0) + value;
        }
      }
    }
    this.text += added;
    return added;
  }
}
