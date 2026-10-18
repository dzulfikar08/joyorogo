import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { STRENGTH_WRITES_LOCKED_AT } from "../lib/strength-lock";
import { workoutRouter } from "./workout";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id');`);

const db = drizzle(client) as unknown as Database;
const as = (locale: "id" | "en" = "id") => ({
  context: {
    db,
    env: {},
    locale,
    waitUntil: () => {},
    session: { user: { id: "a" } },
  } as unknown as Context,
});

const session = {
  name: "Push",
  sets: [{ exerciseId: "push_up", reps: 10, weightKg: null }],
};
const customExercise = { name: "Gerakan", muscle: "dada", equipment: "bodyweight", type: "bodyweight_reps" } as const;
const routine = {
  name: "Rutinitas",
  exercises: [{ exerciseId: "push_up", restSec: 60, note: null, sets: [{ reps: 10, weightKg: null, durationSec: null }] }],
};

afterEach(() => setSystemTime());

const writes = {
  saveSession: () => call(workoutRouter.saveSession, session as never, as()),
  createCustomExercise: () => call(workoutRouter.createCustomExercise, customExercise, as()),
  deleteCustomExercise: () => call(workoutRouter.deleteCustomExercise, { id: "nope" }, as()),
  saveRoutine: () => call(workoutRouter.routines.saveRoutine, routine as never, as()),
  deleteRoutine: () => call(workoutRouter.routines.deleteRoutine, { id: "nope" }, as()),
};

describe("workout strength write lock", () => {
  test("before the grace period ends, writes behave as before", async () => {
    setSystemTime(new Date(STRENGTH_WRITES_LOCKED_AT - 1));
    const saved = await writes.saveSession();
    expect(saved.id).toBeTruthy();
    const created = await writes.createCustomExercise();
    expect(created.name).toBe("Gerakan");
    await expect(writes.deleteCustomExercise()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const savedRoutine = await writes.saveRoutine();
    expect(savedRoutine.id).toBeTruthy();
  });

  for (const [name, run] of Object.entries(writes)) {
    test(`${name} is forbidden from the lock instant on`, async () => {
      setSystemTime(new Date(STRENGTH_WRITES_LOCKED_AT));
      await expect(run()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Latihan beban pindah ke JoyoFit",
        data: { reason: "moved_to_joyofit" },
      });
    });
  }

  test("the message follows the caller's language", async () => {
    setSystemTime(new Date(STRENGTH_WRITES_LOCKED_AT + 1));
    await expect(call(workoutRouter.saveSession, session as never, as("en"))).rejects.toMatchObject({
      message: "Strength training moved to JoyoFit",
    });
  });

  test("reads and deleteSession stay open after the lock", async () => {
    setSystemTime(new Date(STRENGTH_WRITES_LOCKED_AT - 1));
    const { id } = await writes.saveSession();
    setSystemTime(new Date(STRENGTH_WRITES_LOCKED_AT + 1));
    const listed = await call(workoutRouter.listSessions, {} as never, as());
    expect(JSON.stringify(listed)).toContain(id);
    expect(await call(workoutRouter.routines.listRoutines, undefined, as())).toHaveLength(1);
    expect(await call(workoutRouter.deleteSession, { id }, as())).toBeTruthy();
    const left = await client.execute(`SELECT count(*) AS n FROM workout_session WHERE id = '${id}'`);
    expect(Number(left.rows[0]?.n)).toBe(0);
  });
});
