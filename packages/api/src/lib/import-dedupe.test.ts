import { describe, expect, test } from "bun:test";

import { absorbingRow, crossSourceMatcher, workoutClassOf } from "./import-dedupe";

const row = (durationMin: number | null, type: string | null = "Run", date = "2026-10-17") => ({ date, type, durationMin });

describe("crossSourceMatcher", () => {
  test("the same workout read by the other source is a duplicate", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 31 })).toBe(true);
  });

  test("another day, type or a different length is a different workout", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-18", type: "Run", durationMin: 30 })).toBe(false);
    expect(matcher.claim({ date: "2026-10-17", type: "Ride", durationMin: 30 })).toBe(false);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 33 })).toBe(false);
  });

  test("a stored row absorbs one candidate only: two real walks of the same length both stay", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(true);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(false);
  });

  test("rows without a duration never match", () => {
    expect(crossSourceMatcher([row(null)]).claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(false);
  });
});

describe("workoutClassOf", () => {
  test("Health Connect names and JoyoRogo keys of one kind share a class", () => {
    expect(workoutClassOf("Walk")).toBe(workoutClassOf("jalan_cepat"));
    expect(workoutClassOf("Run")).toBe(workoutClassOf("lari"));
    expect(workoutClassOf("Ride")).toBe(workoutClassOf("sepeda"));
    expect(workoutClassOf("OtherWorkout")).toBe(workoutClassOf("latihan"));
    expect(workoutClassOf("Walk")).not.toBe(workoutClassOf("Run"));
  });

  test("an unmapped type is its own class; no type has none", () => {
    expect(workoutClassOf("Elliptical")).toBe("Elliptical");
    expect(workoutClassOf(null)).toBeNull();
  });
});

describe("absorbingRow", () => {
  const watch = (durationMin: number, id = "w1", type = "jalan_cepat") => ({ id, date: "2026-10-18", type, durationMin });
  const imported = (durationMin: number, id = "h1", type = "Walk") => ({ id, date: "2026-10-18", type, durationMin });
  const candidate = (durationMin: number, type: string) => ({ date: "2026-10-18", type, durationMin });

  test("a Health Connect workout is absorbed by JoyoFit's watch row of the same kind and length", () => {
    expect(absorbingRow(candidate(31, "Walk"), "imported", [watch(30)], [])?.id).toBe("w1");
  });

  test("a watch workout is absorbed by the import already stored", () => {
    expect(absorbingRow(candidate(30, "jalan_cepat"), "watch", [], [imported(30)])?.id).toBe("h1");
  });

  test("another kind, day or length stands alone", () => {
    expect(absorbingRow(candidate(30, "Run"), "imported", [watch(30)], [])).toBeNull();
    expect(absorbingRow(candidate(40, "Walk"), "imported", [watch(30)], [])).toBeNull();
    expect(absorbingRow({ ...candidate(30, "Walk"), date: "2026-10-19" }, "imported", [watch(30)], [])).toBeNull();
  });

  test("a row that already stands for its pair absorbs nothing more", () => {
    // The watch row and the import are one workout: a second import of the same shape is a real second workout.
    expect(absorbingRow(candidate(30, "Walk"), "imported", [watch(30)], [imported(30)])).toBeNull();
    expect(absorbingRow(candidate(30, "jalan_cepat"), "watch", [watch(30)], [imported(30)])).toBeNull();
  });

  test("two watch rows and one import: the second import is still absorbed by the free watch row", () => {
    expect(absorbingRow(candidate(30, "Walk"), "imported", [watch(30, "w1"), watch(30, "w2")], [imported(30)])?.id).toBe("w2");
  });

  test("rows without a duration never absorb", () => {
    expect(absorbingRow(candidate(30, "Walk"), "imported", [{ id: "w", date: "2026-10-18", type: "jalan_cepat", durationMin: null }], [])).toBeNull();
  });
});
