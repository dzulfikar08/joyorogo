import { describe, expect, test } from "bun:test";

import { ChatStreamDecoder } from "./chat-stream";

const chunk = (content: string, usage = { prompt_tokens: 0, completion_tokens: 1, neurons: 0.5 }) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }], usage })}\n\n`;

const STREAM =
  chunk("", { prompt_tokens: 300, completion_tokens: 0, neurons: 2 }) +
  chunk('{"items"') +
  chunk(":[]}") +
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, neurons: 0 } })}\n\n` +
  `data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 300, completion_tokens: 51, neurons: 4.1 } })}\n\n` +
  "data: [DONE]\n\n";

describe("ChatStreamDecoder", () => {
  test("collects content, finish reason and the cumulative usage", () => {
    const decoder = new ChatStreamDecoder();
    expect(decoder.push(STREAM)).toBe('{"items":[]}');
    expect(decoder.text).toBe('{"items":[]}');
    expect(decoder.finish).toBe("stop");
    expect(decoder.done).toBe(true);
    expect(decoder.usage).toEqual({ prompt_tokens: 300, completion_tokens: 51, neurons: 4.1 });
  });

  test("events split at any byte give the same text", () => {
    const decoder = new ChatStreamDecoder();
    let added = "";
    for (let i = 0; i < STREAM.length; i += 13) added += decoder.push(STREAM.slice(i, i + 13));
    expect(added).toBe('{"items":[]}');
    expect(decoder.done).toBe(true);
  });

  test("usage falls back to the summed increments when no closing total comes", () => {
    const decoder = new ChatStreamDecoder();
    decoder.push(chunk("a") + chunk("b"));
    expect(decoder.usage).toEqual({ prompt_tokens: 0, completion_tokens: 2, neurons: 1 });
  });

  test("a last event without a trailing newline is read on flush", () => {
    const decoder = new ChatStreamDecoder();
    expect(decoder.push(chunk("x").trimEnd())).toBe("");
    expect(decoder.flush()).toBe("x");
  });

  test("legacy {response} chunks, garbage lines and reasoning deltas are tolerated", () => {
    const decoder = new ChatStreamDecoder();
    decoder.push(
      `data: ${JSON.stringify({ response: "ha" })}\n\n: keepalive\n\ndata: {not json\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "mikir" } }] })}\n\n`,
    );
    expect(decoder.text).toBe("ha");
    expect(decoder.reasoning).toBe("mikir");
  });
});
