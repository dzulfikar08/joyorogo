import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { decodeExportCursor, encodeExportCursor, type ExportSession } from "../lib/workout-export";
import { workoutRouter } from "./workout";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id'), ('b', 'b', 'b@test.id'), ('empty', 'e', 'e@test.id');`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

const DAY = 86_400_000;
const base = Date.UTC(2026, 9, 1);
const dateOf = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10);

// 120 sessions for 'a' (2 sets each, one per day, the first day has two sessions to exercise the tiebreak), one for 'b'.
const statements: string[] = [];
for (let n = 0; n < 120; n += 1) {
  const id = `s${String(n).padStart(3, "0")}`;
  const logId = `l${n}`;
  statements.push(
    `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source, external_id, created_at) VALUES ('${logId}', 'a', '${dateOf(n)}', 'angkat_beban', 'Latihan beban: x', 40, ${100 + n}, 'manual', NULL, ${base + n * DAY})`,
    `INSERT INTO workout_session (id, user_id, date, name, started_at, duration_min, note, exercise_log_id, created_at) VALUES ('${id}', 'a', '${dateOf(n)}', 'Sesi ${n}', ${n % 7 === 0 ? "NULL" : base + n * DAY}, 40, NULL, ${n % 10 === 0 ? "NULL" : `'${logId}'`}, ${base + n * DAY + 1})`,
    `INSERT INTO workout_set (id, session_id, user_id, exercise_id, position, reps, weight_kg, set_type, created_at) VALUES ('${id}-2', '${id}', 'a', 'squat', 1, 8, 80, 'normal', ${base})`,
    `INSERT INTO workout_set (id, session_id, user_id, exercise_id, position, reps, weight_kg, set_type, created_at) VALUES ('${id}-1', '${id}', 'a', 'bench_press', 0, 5, 60, 'warmup', ${base})`,
  );
}
// Same date and created_at as s119: the id breaks the tie.
statements.push(
  `INSERT INTO workout_session (id, user_id, date, name, started_at, duration_min, note, exercise_log_id, created_at) VALUES ('s119b', 'a', '${dateOf(119)}', 'Dup', NULL, 5, NULL, NULL, ${base + 119 * DAY + 1})`,
  `INSERT INTO workout_session (id, user_id, date, name, started_at, duration_min, note, exercise_log_id, created_at) VALUES ('other', 'b', '${dateOf(200)}', 'Mine not yours', NULL, 5, NULL, NULL, ${base})`,
  `INSERT INTO workout_set (id, session_id, user_id, exercise_id, position, reps, weight_kg, set_type, created_at) VALUES ('other-1', 'other', 'b', 'plank', 0, NULL, NULL, 'normal', ${base})`,
  `INSERT INTO workout_routine (id, user_id, name, note, exercises, created_at, updated_at) VALUES ('r1', 'a', 'Push A', NULL, '[{"exerciseId":"bench_press","restSec":90,"note":null,"sets":[{"setType":"normal","reps":8,"weightKg":60,"durationSec":null}]}]', ${base}, ${base + 5})`,
  `INSERT INTO workout_custom_exercise (id, user_id, name, muscle, equipment, type, created_at) VALUES ('c1', 'a', 'Curl kabel', 'biceps', 'kabel', 'weight_reps', ${base})`,
);
await client.batch(statements, "write");

interface Page {
  sessions: ExportSession[];
  nextCursor: string | null;
  routines?: Record<string, unknown>[];
  customExercises?: Record<string, unknown>[];
  total?: { sessions: number; sets: number };
}
const run = (userId: string, input: { cursor?: string; limit?: number }): Promise<Page> => call(workoutRouter.exportAll, input, as(userId)) as Promise<Page>;
async function allPages(userId: string, limit?: number): Promise<{ first: Page; sessions: Page["sessions"] }> {
  const first = await run(userId, limit ? { limit } : {});
  const sessions = [...first.sessions];
  let cursor = first.nextCursor;
  let guard = 0;
  while (cursor && guard++ < 50) {
    const next = await run(userId, limit ? { cursor, limit } : { cursor });
    expect("routines" in next).toBe(false);
    sessions.push(...next.sessions);
    cursor = next.nextCursor;
  }
  return { first, sessions };
}

describe("workout.exportAll", () => {
  test("first page: 50 newest sessions plus routines, custom exercises and totals", async () => {
    const first = await run("a", {});
    expect(first.sessions).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(first.sessions[0]!.id).toBe("s119b");
    expect(first.sessions[1]!.id).toBe("s119");
    expect(first.routines).toHaveLength(1);
    expect(first.routines![0]).toMatchObject({ id: "r1", name: "Push A", note: null });
    expect(typeof first.routines![0]!.createdAt).toBe("string");
    expect(first.customExercises).toEqual([
      { id: "c1", name: "Curl kabel", muscle: "biceps", equipment: "kabel", type: "weight_reps", createdAt: new Date(base).toISOString() },
    ]);
    expect(first.total).toEqual({ sessions: 121, sets: 240 });
  });

  test("walks every session exactly once in (date, created_at, id) descending order", async () => {
    const { sessions } = await allPages("a");
    expect(sessions).toHaveLength(121);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(121);
    const keys = sessions.map((s) => [s.date, s.createdAt, s.id] as const);
    const sorted = [...keys].sort((x, y) => (x[0] === y[0] ? (x[1] === y[1] ? (x[2] < y[2] ? 1 : -1) : x[1] < y[1] ? 1 : -1) : x[0] < y[0] ? 1 : -1));
    expect(keys).toEqual(sorted);
  });

  test("a smaller page size pages the same way", async () => {
    const { sessions } = await allPages("a", 7);
    expect(sessions).toHaveLength(121);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(121);
  });

  test("sets come in position order, kcal from the mirror, null without one", async () => {
    const { sessions } = await allPages("a");
    const s5 = sessions.find((s) => s.id === "s005")!;
    expect(s5.sets.map((x) => [x.id, x.position, x.exerciseId, x.setType])).toEqual([
      ["s005-1", 0, "bench_press", "warmup"],
      ["s005-2", 1, "squat", "normal"],
    ]);
    expect(s5.sets[1]).toMatchObject({ reps: 8, weightKg: 80, durationSec: null, rpe: null, note: null, supersetGroup: null });
    expect(s5.kcal).toBe(105);
    expect(sessions.find((s) => s.id === "s010")!.kcal).toBeNull();
    expect(sessions.find((s) => s.id === "s119b")!.sets).toEqual([]);
    expect(sessions.find((s) => s.id === "s007")!.startedAt).toBeNull();
    expect(sessions.find((s) => s.id === "s008")!.startedAt).toBe(new Date(base + 8 * DAY).toISOString());
  });

  test("never returns another account's data", async () => {
    const { sessions, first } = await allPages("b");
    expect(sessions.map((s) => s.id)).toEqual(["other"]);
    expect(sessions[0]!.sets.map((x) => x.id)).toEqual(["other-1"]);
    expect(first.routines).toEqual([]);
    expect(first.customExercises).toEqual([]);
    expect(first.total).toEqual({ sessions: 1, sets: 1 });
  });

  test("an account with nothing gets an empty first page", async () => {
    expect(await run("empty", {})).toEqual({ sessions: [], nextCursor: null, routines: [], customExercises: [], total: { sessions: 0, sets: 0 } });
  });

  test("a made-up cursor and a page size over 50 are refused", async () => {
    await expect(run("a", { cursor: "not-a-cursor" })).rejects.toThrow();
    await expect(run("a", { limit: 51 })).rejects.toThrow();
  });
});

describe("export cursor", () => {
  test("round trips and rejects anything else", () => {
    const cursor = { date: "2026-10-18", createdAt: 1_790_000_000_000, id: "abc-123" };
    expect(decodeExportCursor(encodeExportCursor(cursor))).toEqual(cursor);
    expect(decodeExportCursor("%%%")).toBeNull();
    expect(decodeExportCursor(btoa("[1,2,3]"))).toBeNull();
    expect(decodeExportCursor(btoa(JSON.stringify(["x", 1, "id"])))).toBeNull();
    expect(decodeExportCursor(btoa("{}"))).toBeNull();
  });
});
