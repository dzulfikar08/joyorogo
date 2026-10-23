import { call } from "@orpc/server";
import { afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { workoutRouter } from "./workout";

// d1TestDb's client throws like D1 on a statement with more than 100 bound parameters.
const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id');`);

const as = () => ({
  context: { db, env: {}, locale: "id", waitUntil: () => {}, session: { user: { id: "a" } } } as unknown as Context,
});

afterEach(() => setSystemTime());

const DAY = 86_400_000;
const base = Date.UTC(2026, 0, 1);
const dateOf = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  // 130 earlier sessions, one set each; the oldest one (n = 0) holds the heaviest squat, and every session also logs
  // a set of its own exercise `ex<n % 100>` for the `previous` test.
  const statements: string[] = [];
  for (let n = 0; n < 130; n += 1) {
    const id = `s${n}`;
    statements.push(
      `INSERT INTO workout_session (id, user_id, date, name, created_at) VALUES ('${id}', 'a', '${dateOf(n)}', 'Sesi ${n}', ${base + n * DAY})`,
      `INSERT INTO workout_set (id, session_id, user_id, exercise_id, position, reps, weight_kg, set_type, created_at) VALUES ('${id}-sq', '${id}', 'a', 'squat', 0, 5, ${n === 0 ? 100 : 60}, 'normal', ${base})`,
      `INSERT INTO workout_set (id, session_id, user_id, exercise_id, position, reps, weight_kg, set_type, created_at) VALUES ('${id}-ex', '${id}', 'a', 'ex${n % 100}', 1, ${n + 1}, 10, 'normal', ${base})`,
    );
  }
  await client.batch(statements, "write");
});

describe("workout D1 parameter limit", () => {
  test("saveSession stores the largest allowed session (200 sets) in order", async () => {
    setSystemTime(new Date(Date.UTC(2026, 8, 1)));
    const sets = Array.from({ length: 200 }, (_, i) => ({ exerciseId: "push_up", reps: (i % 50) + 1, weightKg: null }));
    const saved = await call(workoutRouter.saveSession, { name: "Besar", sets } as never, as());
    expect(saved.sets).toHaveLength(200);
    expect(saved.sets.map((s) => s.position)).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(saved.sets.map((s) => s.reps)).toEqual(sets.map((s) => s.reps));
    // Saving it again replaces all of them atomically.
    const again = await call(workoutRouter.saveSession, { id: saved.id, name: "Besar", sets: sets.slice(0, 150) } as never, as());
    expect(again.sets).toHaveLength(150);
  });

  test("records are measured against all prior sessions, not only the first 100 read", async () => {
    setSystemTime(new Date(Date.UTC(2026, 8, 1)));
    // 90 kg x5 beats every set but the 100 kg one in the oldest of 130 sessions (the last slice of the read).
    const notRecord = await call(workoutRouter.saveSession, { name: "Ringan", sets: [{ exerciseId: "squat", reps: 5, weightKg: 90 }] } as never, as());
    expect(notRecord.prs.filter((pr) => pr.exerciseId === "squat")).toEqual([]);
    const record = await call(workoutRouter.saveSession, { name: "Berat", sets: [{ exerciseId: "squat", reps: 5, weightKg: 110 }] } as never, as());
    expect(record.prs.some((pr) => pr.exerciseId === "squat")).toBe(true);
  });

  test("previous answers for 100 exercises at once", async () => {
    const exerciseIds = Array.from({ length: 100 }, (_, i) => `ex${i}`);
    const result = await call(workoutRouter.previous, { exerciseIds }, as());
    expect(Object.keys(result).sort()).toEqual([...exerciseIds].sort());
    // ex5 was logged in sessions 5 and 105; the newer one (reps 106) is the one shown.
    expect(result.ex5).toEqual([{ setType: "normal", reps: 106, weightKg: 10, durationSec: null }]);
    expect(result.ex99).toEqual([{ setType: "normal", reps: 100, weightKg: 10, durationSec: null }]);
  });
});
