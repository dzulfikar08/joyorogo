import { describe, expect, test } from "bun:test";

import { analyzeStreaming, applyScanEvent, streamUnavailable } from "./scan-live";
import type { LiveRow, ScanStreamEvent } from "./scan-live";
import type { StreamedItem } from "./vision";

const item = (name: string, kcal: number): StreamedItem => ({
  name,
  kcal,
  kind: "makanan",
  matched: false,
});

async function* events(list: Array<ScanStreamEvent<string> | Error>): AsyncGenerator<ScanStreamEvent<string>> {
  for (const entry of list) {
    if (entry instanceof Error) throw entry;
    yield entry;
  }
}

describe("applyScanEvent", () => {
  test("a name becomes a row, its item fills it in place", () => {
    let rows: LiveRow[] = [];
    rows = applyScanEvent(rows, { type: "name", index: 0, name: "nasi goreng" });
    expect(rows).toEqual([{ index: 0, name: "nasi goreng" }]);
    rows = applyScanEvent(rows, { type: "item", index: 0, item: item("nasi goreng", 350) });
    expect(rows).toEqual([{ index: 0, name: "nasi goreng", item: item("nasi goreng", 350) }]);
  });

  test("rows stay ordered by index even when an index is skipped", () => {
    let rows: LiveRow[] = [];
    rows = applyScanEvent(rows, { type: "item", index: 2, item: item("c", 3) });
    rows = applyScanEvent(rows, { type: "name", index: 0, name: "a" });
    expect(rows.map((row) => row.index)).toEqual([0, 2]);
  });

  test("reset clears the list", () => {
    const rows = applyScanEvent([{ index: 0, name: "a" }], { type: "reset" });
    expect(rows).toEqual([]);
  });
});

describe("streamUnavailable", () => {
  test("only a pre-event transport failure or an unknown procedure may fall back", () => {
    expect(streamUnavailable(new TypeError("Network request failed"), false)).toBe(true);
    expect(streamUnavailable(Object.assign(new Error("x"), { code: "NOT_FOUND" }), false)).toBe(true);
    expect(streamUnavailable(new TypeError("Network request failed"), true)).toBe(false);
    expect(streamUnavailable(Object.assign(new Error("x"), { code: "UNPROCESSABLE_CONTENT" }), false)).toBe(false);
    expect(streamUnavailable(Object.assign(new Error("x"), { code: "FORBIDDEN" }), false)).toBe(false);
    expect(streamUnavailable(Object.assign(new Error("x"), { name: "AbortError" }), false)).toBe(false);
  });
});

describe("analyzeStreaming", () => {
  test("reports rows as they arrive and returns the done result", async () => {
    const seen: string[][] = [];
    let clock = 0;
    const outcome = await analyzeStreaming<string>({
      open: async () =>
        events([
          { type: "name", index: 0, name: "teh" },
          { type: "item", index: 0, item: item("teh", 60) },
          { type: "done", result: "FINAL" },
        ]),
      fallback: () => Promise.reject(new Error("must not run")),
      onRows: (rows) => seen.push(rows.map((row) => `${row.name}${row.item ? ":" + row.item.kcal : ""}`)),
      now: () => (clock += 100),
    });
    expect(outcome).toEqual({
      result: "FINAL",
      streamed: true,
      timing: { firstNameMs: 100, firstItemMs: 200, doneMs: 300 },
    });
    expect(seen).toEqual([["teh"], ["teh:60"]]);
  });

  test("a transport failure before any event runs the plain call", async () => {
    const outcome = await analyzeStreaming<string>({
      open: () => Promise.reject(new TypeError("Network request failed")),
      fallback: () => Promise.resolve("PLAIN"),
      onRows: () => {},
    });
    expect(outcome.result).toBe("PLAIN");
    expect(outcome.streamed).toBe(false);
  });

  test("a failure after events is surfaced, not retried through the plain call", async () => {
    let plainRuns = 0;
    await expect(
      analyzeStreaming<string>({
        open: async () => events([{ type: "name", index: 0, name: "a" }, new TypeError("dropped")]),
        fallback: () => {
          plainRuns += 1;
          return Promise.resolve("PLAIN");
        },
        onRows: () => {},
      }),
    ).rejects.toThrow("dropped");
    expect(plainRuns).toBe(0);
  });

  test("a server verdict on the stream is final", async () => {
    const verdict = Object.assign(new Error("bukan makanan"), { code: "UNPROCESSABLE_CONTENT" });
    await expect(
      analyzeStreaming<string>({
        open: async () => events([verdict]),
        fallback: () => Promise.resolve("PLAIN"),
        onRows: () => {},
      }),
    ).rejects.toBe(verdict);
  });

  test("an empty stream with no result falls back", async () => {
    const outcome = await analyzeStreaming<string>({
      open: async () => events([]),
      fallback: () => Promise.resolve("PLAIN"),
      onRows: () => {},
    });
    expect(outcome.streamed).toBe(false);
  });
});
