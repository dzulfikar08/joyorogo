import { describe, expect, test } from "bun:test";

import { hostedMessages } from "./hosted-input";

const line = (role: "user" | "assistant", content: string) => ({ role, content });

describe("hosted chat input", () => {
  test("keeps the last 12 turns and starts with the person", () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      line(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    );
    const out = hostedMessages(history);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0]!.role).toBe("user");
    expect(out[out.length - 1]!.content).toBe("m19");
  });

  test("a window that opens on an answer drops that answer", () => {
    const history = [line("user", "a"), line("assistant", "b"), line("user", "c")];
    expect(hostedMessages(history.slice(1))).toEqual([line("user", "c")]);
  });

  test("long messages are cut to what the server accepts", () => {
    const [only] = hostedMessages([line("user", "x".repeat(5_000))]);
    expect(only!.content).toHaveLength(2_000);
  });

  test("nothing from the person, nothing to send", () => {
    expect(hostedMessages([])).toEqual([]);
    expect(hostedMessages([line("assistant", "hi")])).toEqual([]);
  });
});
