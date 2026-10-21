import { describe, expect, test } from "bun:test";

import {
  STRENGTH_LIMITS,
  buildPullPage,
  firstServerAt,
  strengthPullSchema,
  strengthPushSchema,
  strengthRecordSchema,
  validateStrengthRecord,
  type PullRow,
  type StrengthKind,
  type StrengthRecordInput,
} from "./strength-record";

const set = (id: string) => ({ id, type: "normal", weightKg: 60, reps: 8, seconds: null, rpe: null, done: true, doneAt: 5 });
const workout = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  name: "Push",
  startedAt: 1,
  endedAt: 2,
  durationSec: 3000,
  note: "",
  routineId: null,
  planKey: null,
  exercises: [{ key: "k1", exerciseId: "barbell_bench_press", note: "", restSec: 90, supersetGroup: null, sets: [set("s1")] }],
  workoutStart: 10,
  kcal: 220,
  kcalSource: "estimate",
  updatedAt: 100,
  deletedAt: null,
  ...over,
});

const record = (kind: StrengthKind, doc: Record<string, unknown>, over: Partial<StrengthRecordInput> = {}): StrengthRecordInput => ({
  kind,
  id: String(doc.id),
  json: JSON.stringify(doc),
  updatedAt: Number(doc.updatedAt ?? 0),
  deletedAt: (doc.deletedAt as number | null | undefined) ?? null,
  ...over,
});

describe("validateStrengthRecord", () => {
  test("accepts every kind", () => {
    expect(validateStrengthRecord(record("workout", workout()))).toEqual({ ok: true });
    expect(
      validateStrengthRecord(
        record("routine", {
          id: "r1",
          name: "A",
          folderId: "f1",
          note: "",
          exercises: [{ exerciseId: "squat", restSec: null, note: "", supersetGroup: 1, sets: [{ type: "warmup", weightKg: null, reps: 10, seconds: null }] }],
          sortOrder: 3,
          createdAt: 1,
          updatedAt: 2,
          deletedAt: null,
        }),
      ),
    ).toEqual({ ok: true });
    expect(validateStrengthRecord(record("folder", { id: "f1", name: "Gym", sortOrder: 0, updatedAt: 1, deletedAt: null }))).toEqual({ ok: true });
    expect(
      validateStrengthRecord(
        record("exercise", { id: "custom_lx1abc", name: "Cable curl", primary: ["biceps"], equipment: "cable", timed: false, updatedAt: 1, deletedAt: null }),
      ),
    ).toEqual({ ok: true });
    expect(validateStrengthRecord(record("pref", { id: "barbell_bench_press", restSec: 120, updatedAt: 1, deletedAt: null }))).toEqual({ ok: true });
  });

  test("imported history ids and custom rogo exercise ids are fine", () => {
    const id = `rogo:${"a".repeat(36)}`;
    const doc = workout({
      id,
      workoutStart: null,
      exercises: [{ key: "e0", exerciseId: "custom_rogo_8c1f2a3b-0000-4000-8000-000000000000", note: "", restSec: null, supersetGroup: null, sets: [set("x")] }],
    });
    expect(validateStrengthRecord(record("workout", doc))).toEqual({ ok: true });
  });

  test("a tombstone keeps its document", () => {
    expect(validateStrengthRecord(record("workout", workout({ deletedAt: 500, updatedAt: 500 })))).toEqual({ ok: true });
  });

  test("keeps keys it does not know (a newer app)", () => {
    expect(validateStrengthRecord(record("workout", workout({ futureField: { a: 1 } })))).toEqual({ ok: true });
  });

  test("takes the per-exercise `timed` measure on workouts, routines and prefs, and only as a boolean", () => {
    const timedSet = { ...set("s1"), reps: null, seconds: 45 };
    const timedWorkout = workout({ exercises: [{ key: "k1", exerciseId: "plank", timed: true, note: "", restSec: null, supersetGroup: null, sets: [timedSet] }] });
    const rec = record("workout", timedWorkout);
    expect(validateStrengthRecord(rec)).toEqual({ ok: true });
    expect(JSON.parse(rec.json)).toEqual(timedWorkout);
    const routine = { id: "r1", name: "A", folderId: null, note: "", exercises: [{ exerciseId: "plank", timed: false, restSec: null, note: "", supersetGroup: null, sets: [] }], sortOrder: 1, createdAt: 1, updatedAt: 2, deletedAt: null };
    expect(validateStrengthRecord(record("routine", routine))).toEqual({ ok: true });
    expect(validateStrengthRecord(record("pref", { id: "plank", restSec: null, timed: true, updatedAt: 1, deletedAt: null }))).toEqual({ ok: true });
    expect(validateStrengthRecord(record("pref", { id: "plank", restSec: 60, timed: null, updatedAt: 1, deletedAt: null }))).toEqual({ ok: true });
    expect(validateStrengthRecord(record("workout", workout({ exercises: [{ ...timedWorkout.exercises[0], timed: "yes" }] })))).toEqual({ ok: false, reason: "shape" });
  });

  test("rejects a wrong shape, a wrong id, bad JSON and an oversize document", () => {
    expect(validateStrengthRecord(record("workout", workout({ name: 5 })))).toEqual({ ok: false, reason: "shape" });
    expect(validateStrengthRecord(record("workout", workout(), { id: "other" }))).toEqual({ ok: false, reason: "id_mismatch" });
    expect(validateStrengthRecord({ kind: "workout", id: "w1", json: "{nope", updatedAt: 1, deletedAt: null })).toEqual({ ok: false, reason: "not_json" });
    const big = workout({ note: "x".repeat(STRENGTH_LIMITS.maxJsonBytes) });
    expect(validateStrengthRecord(record("workout", big))).toEqual({ ok: false, reason: "too_large" });
  });

  test("caps on exercises, sets, notes and ids", () => {
    const exercise = (n: number) => ({ key: `k${n}`, exerciseId: "plank", note: "", restSec: null, supersetGroup: null, sets: [] });
    expect(
      validateStrengthRecord(record("workout", workout({ exercises: Array.from({ length: 61 }, (_, n) => exercise(n)) }))),
    ).toEqual({ ok: false, reason: "shape" });
    expect(
      validateStrengthRecord(record("workout", workout({ exercises: Array.from({ length: 60 }, (_, n) => exercise(n)) }))),
    ).toEqual({ ok: true });
    const sets = (n: number) => Array.from({ length: n }, (_, i) => set(`s${i}`));
    const withSets = (n: number) => workout({ exercises: [{ key: "k", exerciseId: "plank", note: "", restSec: null, supersetGroup: null, sets: sets(n) }] });
    expect(validateStrengthRecord(record("workout", withSets(60)))).toEqual({ ok: true });
    expect(validateStrengthRecord(record("workout", withSets(61)))).toEqual({ ok: false, reason: "shape" });
    expect(validateStrengthRecord(record("workout", workout({ note: "x".repeat(2001) })))).toEqual({ ok: false, reason: "shape" });
    expect(validateStrengthRecord(record("workout", workout({ id: "w".repeat(65) })))).toEqual({ ok: false, reason: "shape" });
    expect(
      validateStrengthRecord(record("workout", workout({ exercises: [{ ...exercise(0), exerciseId: "Bad Slug!" }] }))),
    ).toEqual({ ok: false, reason: "shape" });
  });

  test("rejects out of range numbers and set types", () => {
    expect(validateStrengthRecord(record("workout", workout({ kcal: -1 })))).toEqual({ ok: false, reason: "shape" });
    expect(validateStrengthRecord(record("workout", workout({ kcalSource: "guess" })))).toEqual({ ok: false, reason: "shape" });
    const badSet = { ...set("s"), type: "superset" };
    expect(
      validateStrengthRecord(
        record("workout", workout({ exercises: [{ key: "k", exerciseId: "plank", note: "", restSec: null, supersetGroup: null, sets: [badSet] }] })),
      ),
    ).toEqual({ ok: false, reason: "shape" });
  });
});

describe("wire schemas", () => {
  test("unknown kinds are rejected", () => {
    expect(strengthRecordSchema.safeParse({ kind: "gizmo", id: "a", json: "{}", updatedAt: 1, deletedAt: null }).success).toBe(false);
    expect(strengthRecordSchema.safeParse({ kind: "pref", id: "a", json: "{}", updatedAt: 1, deletedAt: null }).success).toBe(true);
  });

  test("a push has at most 100 records", () => {
    const one = { kind: "pref", id: "a", json: "{}", updatedAt: 1, deletedAt: null };
    expect(strengthPushSchema.safeParse({ records: Array.from({ length: 100 }, () => one) }).success).toBe(true);
    expect(strengthPushSchema.safeParse({ records: Array.from({ length: 101 }, () => one) }).success).toBe(false);
  });

  test("a pull starts at 0 and has at most 200 per page", () => {
    expect(strengthPullSchema.parse({})).toEqual({ since: 0 });
    expect(strengthPullSchema.safeParse({ since: 5, limit: 200 }).success).toBe(true);
    expect(strengthPullSchema.safeParse({ since: 5, limit: 201 }).success).toBe(false);
    expect(strengthPullSchema.safeParse({ since: -1 }).success).toBe(false);
  });
});

const row = (serverAt: number, json = "{}"): PullRow => ({ kind: "pref", id: `p${serverAt}`, json, updatedAt: serverAt, deletedAt: null, serverAt });

describe("buildPullPage", () => {
  test("an empty page keeps the asked cursor", () => {
    expect(buildPullPage([], 7, 200)).toEqual({ records: [], cursor: 7, hasMore: false });
  });

  test("the extra row only says there is more", () => {
    const page = buildPullPage([row(1), row(2), row(3)], 0, 2);
    expect(page.records.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(page.cursor).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(buildPullPage([row(1), row(2)], 0, 2).hasMore).toBe(false);
  });

  test("a page stops at the byte budget but never before its first record", () => {
    const fat = "x".repeat(STRENGTH_LIMITS.pullPageBytes - 10);
    const page = buildPullPage([row(1, fat), row(2, fat)], 0, 200);
    expect(page.records).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const huge = "x".repeat(STRENGTH_LIMITS.pullPageBytes + 10);
    expect(buildPullPage([row(1, huge)], 0, 200).records).toHaveLength(1);
  });
});

describe("firstServerAt", () => {
  test("is after now and after everything stored", () => {
    expect(firstServerAt(1000, null)).toBe(1000);
    expect(firstServerAt(1000, 999)).toBe(1000);
    expect(firstServerAt(1000, 1000)).toBe(1001);
    expect(firstServerAt(1000, 5000)).toBe(5001);
  });
});
