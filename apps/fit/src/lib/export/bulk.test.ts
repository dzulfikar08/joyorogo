import { describe, expect, test } from "bun:test";

import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

import { runBulk } from "./bulk";
import type { BulkProgress } from "./bulk";
import { indoorDoc, rideDoc, runDoc } from "./fixtures";
import { SourceError } from "./source";

const docs = new Map<number, WatchWorkoutDoc>([
  [1, runDoc()],
  [2, rideDoc()],
  [3, indoorDoc()],
]);

const load = async (start: number): Promise<WatchWorkoutDoc> => {
  const doc = docs.get(start);
  if (!doc) throw new SourceError("not_found", 404);
  return doc;
};

const items = [
  { start: 1, hasGps: true },
  { start: 2, hasGps: true },
  { start: 3, hasGps: false },
];

describe("runBulk", () => {
  test("builds one file per workout in order and reports progress to the end", async () => {
    const progress: BulkProgress[] = [];
    const result = await runBulk({
      items,
      format: "fit",
      load,
      onProgress: (p) => progress.push(p),
    });
    expect(result.files.map((f) => f.name)).toEqual([
      "joyofit-20260914-0612-run.fit",
      "joyofit-20260915-0612-ride.fit",
      "joyofit-20260916-0612-treadmill.fit",
    ]);
    expect(result.problems).toEqual([]);
    expect(result.cancelled).toBe(false);
    expect(progress.map((p) => [p.done, p.total, p.exported])).toEqual([
      [0, 3, 0],
      [1, 3, 1],
      [2, 3, 2],
      [3, 3, 3],
    ]);
  });

  test("GPX skips a workout the list says has no GPS without fetching it", async () => {
    const fetched: number[] = [];
    const result = await runBulk({
      items,
      format: "gpx",
      load: (start) => {
        fetched.push(start);
        return load(start);
      },
    });
    expect(fetched).toEqual([1, 2]);
    expect(result.files).toHaveLength(2);
    expect(result.problems).toEqual([{ start: 3, problem: "no_gps" }]);
  });

  test("a document with no GPS that the list claimed had some is reported, not fatal", async () => {
    const result = await runBulk({
      items: [
        { start: 3, hasGps: true },
        { start: 1, hasGps: true },
      ],
      format: "gpx",
      load,
    });
    expect(result.problems).toEqual([{ start: 3, problem: "no_gps" }]);
    expect(result.files).toHaveLength(1);
  });

  test("a failed workout is skipped with its reason and the rest go on", async () => {
    const result = await runBulk({
      items: [
        { start: 1, hasGps: true },
        { start: 99, hasGps: true },
        { start: 2, hasGps: true },
      ],
      format: "json",
      load,
    });
    expect(result.files).toHaveLength(2);
    expect(result.problems).toEqual([{ start: 99, problem: "not_found" }]);
  });

  test("a bad document and a network failure are told apart", async () => {
    const failing = async (start: number): Promise<WatchWorkoutDoc> => {
      throw start === 1 ? new SourceError("bad_document") : new SourceError("network");
    };
    const result = await runBulk({ items, format: "json", load: failing });
    expect(result.problems.map((p) => p.problem)).toEqual(["unreadable", "network", "network"]);
  });

  test("a sign-out ends the run", async () => {
    let calls = 0;
    const result = await runBulk({
      items,
      format: "json",
      load: async (start) => {
        calls++;
        if (start === 2) throw new SourceError("unauthorized", 401);
        return load(start);
      },
    });
    expect(calls).toBe(2);
    expect(result.unauthorized).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  test("cancel stops before the next fetch and hands the signal to the loader", async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const result = await runBulk({
      items,
      format: "json",
      signal: controller.signal,
      load: async (start, signal) => {
        signals.push(signal);
        if (start === 2) controller.abort();
        return load(start);
      },
    });
    expect(result.cancelled).toBe(true);
    expect(signals).toEqual([controller.signal, controller.signal]);
    expect(result.files).toHaveLength(2);
  });

  test("a fetch aborted in flight counts as a cancel, not a problem", async () => {
    const result = await runBulk({
      items,
      format: "json",
      load: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.problems).toEqual([]);
  });

  test("two workouts that would share a file name do not overwrite each other", async () => {
    const twin = runDoc();
    const result = await runBulk({
      items: [
        { start: 1, hasGps: true },
        { start: 11, hasGps: true },
      ],
      format: "json",
      load: async (start) => (start === 1 ? runDoc() : twin),
    });
    expect(result.files.map((f) => f.name)).toEqual([
      "joyofit-20260914-0612-run.json",
      "joyofit-20260914-0612-run-2.json",
    ]);
  });
});
