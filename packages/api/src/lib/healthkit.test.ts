import { describe, expect, test } from "bun:test";

import { sleepHoursByWibDay, unionIntervals } from "./healthkit";

// 2026-10-12 22:00 WIB is 15:00 UTC.
const at = (utcIso: string) => Date.parse(utcIso);
const H = 3_600_000;

describe("unionIntervals", () => {
  test("merges overlapping samples from two sources", () => {
    const merged = unionIntervals([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T18:00:00Z") },
      { startMs: at("2026-10-12T16:00:00Z"), endMs: at("2026-10-12T21:30:00Z") },
    ]);
    expect(merged).toEqual([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T21:30:00Z") },
    ]);
  });

  test("merges touching intervals and keeps disjoint ones separate", () => {
    const merged = unionIntervals([
      { startMs: 0, endMs: H },
      { startMs: 2 * H, endMs: 3 * H },
      { startMs: H, endMs: 2 * H },
    ]);
    expect(merged).toEqual([{ startMs: 0, endMs: 3 * H }]);
  });

  test("ignores empty and inverted intervals", () => {
    const merged = unionIntervals([
      { startMs: H, endMs: H },
      { startMs: 2 * H, endMs: H },
      { startMs: 0, endMs: H },
    ]);
    expect(merged).toEqual([{ startMs: 0, endMs: H }]);
  });
});

describe("sleepHoursByWibDay", () => {
  test("double-reported stages count once", () => {
    // iPhone and Apple Watch both write the same core stretch.
    const hours = sleepHoursByWibDay([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T18:00:00Z"), value: 3 },
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T18:00:00Z"), value: 3 },
    ]);
    expect([...hours]).toEqual([["2026-10-13", 3]]);
  });

  test("keys the night by the WIB day whose morning it ended", () => {
    // 22:00 WIB Oct 12 to 06:30 WIB Oct 13 ends on the 13th.
    const hours = sleepHoursByWibDay([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T23:30:00Z"), value: 1 },
    ]);
    expect([...hours]).toEqual([["2026-10-13", 8.5]]);
  });

  test("in bed and awake samples never count", () => {
    const hours = sleepHoursByWibDay([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T23:00:00Z"), value: 0 },
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T23:00:00Z"), value: 2 },
    ]);
    expect(hours.size).toBe(0);
  });

  test("awake gaps split the night but the day total keeps both bouts", () => {
    const hours = sleepHoursByWibDay([
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T18:00:00Z"), value: 3 },
      { startMs: at("2026-10-12T18:00:00Z"), endMs: at("2026-10-12T18:30:00Z"), value: 2 },
      { startMs: at("2026-10-12T18:30:00Z"), endMs: at("2026-10-12T23:30:00Z"), value: 5 },
    ]);
    expect([...hours]).toEqual([["2026-10-13", 8]]);
  });

  test("short stage samples survive inside a night, short standalone bouts do not", () => {
    const hours = sleepHoursByWibDay([
      // 10 minute deep sample inside the night: kept, union absorbs it.
      { startMs: at("2026-10-12T15:00:00Z"), endMs: at("2026-10-12T23:30:00Z"), value: 3 },
      { startMs: at("2026-10-12T16:00:00Z"), endMs: at("2026-10-12T16:10:00Z"), value: 4 },
      // 10 minute midday nap: standalone, dropped.
      { startMs: at("2026-10-12T06:00:00Z"), endMs: at("2026-10-12T06:10:00Z"), value: 1 },
    ]);
    expect([...hours]).toEqual([["2026-10-13", 8.5]]);
  });
});
