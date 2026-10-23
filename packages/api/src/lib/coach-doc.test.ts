import { d1TestDb } from "@joyorogo/db/test-d1";
import { describe, expect, test } from "bun:test";


import { COACH_DOC_LIMITS, coachDocSchema, readCoachDoc, writeCoachDoc } from "./coach-doc";
import type { CoachDoc } from "./coach-doc";
import { coachDailyCap } from "./coach-limit";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1', 'a', 'a@test.id'), ('u2', 'b', 'b@test.id');`);

const empty: CoachDoc = { version: 1, plan: null, planUpdatedAt: 0, done: {}, logs: {} };
const plan = {
  id: "p1",
  kind: "strength" as const,
  goal: "strengthFull" as const,
  level: "beginner" as const,
  daysPerWeek: 3,
  setting: "home" as const,
  weekdays: [0, 2, 4],
  startDay: "2026-10-12",
  weeks: 8,
  createdAt: 1,
  updatedAt: 1,
  adjust: {},
};

describe("coach doc store", () => {
  test("nothing stored reads as rev 0", async () => {
    expect(await readCoachDoc(db, "u1")).toEqual({ rev: 0, doc: null });
  });

  test("first write needs baseRev 0, a second writer from rev 0 conflicts", async () => {
    expect(await writeCoachDoc(db, "u1", 0, { ...empty, plan, planUpdatedAt: 5 })).toEqual({ status: "ok", rev: 1 });
    const loser = await writeCoachDoc(db, "u1", 0, empty);
    expect(loser.status).toBe("conflict");
    expect(loser.status === "conflict" && loser.rev).toBe(1);
    expect(loser.status === "conflict" && loser.doc?.plan?.id).toBe("p1");
  });

  test("a write from the current rev bumps it; a stale or future baseRev stores nothing", async () => {
    expect(await writeCoachDoc(db, "u1", 1, empty)).toEqual({ status: "ok", rev: 2 });
    expect((await writeCoachDoc(db, "u1", 1, empty)).status).toBe("conflict");
    expect((await writeCoachDoc(db, "u1", 9, empty)).status).toBe("conflict");
    expect((await readCoachDoc(db, "u1")).rev).toBe(2);
    expect((await writeCoachDoc(db, "u2", 3, empty)).status).toBe("conflict");
    expect(await readCoachDoc(db, "u2")).toEqual({ rev: 0, doc: null });
  });
});

describe("coach doc schema", () => {
  test("strips unknown keys and accepts the app's empty doc", () => {
    const parsed = coachDocSchema.parse({ ...empty, extra: 1 });
    expect("extra" in parsed).toBe(false);
  });

  test("accepts the Lari-jalan run/walk restart goal and still rejects an unknown goal", () => {
    const runWalk = { ...plan, kind: "run" as const, goal: "runWalk" as const, setting: null, daysPerWeek: 3, weekdays: [1, 3, 5], weeks: 8 };
    expect(coachDocSchema.safeParse({ ...empty, plan: runWalk }).success).toBe(true);
    expect(coachDocSchema.safeParse({ ...empty, plan: { ...runWalk, goal: "runSprint" } }).success).toBe(false);
  });

  test("caps: weeks, done, logs, sets", () => {
    expect(coachDocSchema.safeParse({ ...empty, plan: { ...plan, weeks: COACH_DOC_LIMITS.maxWeeks + 1 } }).success).toBe(false);
    const done = Object.fromEntries(Array.from({ length: COACH_DOC_LIMITS.maxDone + 1 }, (_, i) => [`k${i}`, { workoutStart: null, at: 1, manual: true, skipped: false }]));
    expect(coachDocSchema.safeParse({ ...empty, done }).success).toBe(false);
    const sets = Array.from({ length: COACH_DOC_LIMITS.maxSetsPerExercise + 1 }, () => ({ reps: 5, seconds: null, weightKg: null }));
    expect(coachDocSchema.safeParse({ ...empty, logs: { a: { at: 1, exercises: [{ exerciseId: "x", sets }] } } }).success).toBe(false);
    expect(coachDocSchema.safeParse({ ...empty, version: 2 }).success).toBe(false);
  });
});

describe("coach daily cap", () => {
  test("default 20, 0 disables, garbage falls back", () => {
    expect(coachDailyCap({})).toBe(20);
    expect(coachDailyCap({ COACH_DAILY_CAP: "0" })).toBe(0);
    expect(coachDailyCap({ COACH_DAILY_CAP: "5" })).toBe(5);
    expect(coachDailyCap({ COACH_DAILY_CAP: "abc" })).toBe(20);
    expect(coachDailyCap({ COACH_DAILY_CAP: "-3" })).toBe(20);
  });
});
