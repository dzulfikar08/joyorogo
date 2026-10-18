import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { profileRouter } from "./profile";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday();
const lapsedDate = shiftDate(today, -10);

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('cut', 'cut', 'cut@test.id', 'founder'),
    ('lapsed', 'lapsed', 'lapsed@test.id', 'founder');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES
    ('cut', 1990, 'male', 170, 160, 150, '${shiftDate(today, 120)}', 'mid'),
    ('lapsed', 1990, 'male', 170, 80, 70, '${lapsedDate}', 'mid');
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

describe("profile.updateTargets target date", () => {
  test("a date in the future is saved and the daily target moves with it", async () => {
    const before = await call(profileRouter.myProfile, undefined, as("cut"));
    const out = await call(
      profileRouter.updateTargets,
      { targetWeightKg: 150, targetDate: shiftDate(today, 60) },
      as("cut"),
    );
    const after = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(after.profile?.targetDate).toBe(shiftDate(today, 60));
    // 10 kg in 60 days asks for more than 120 days did, so the plan eats less (or sits on the floor).
    expect(out.targets.eatKcal).toBeLessThanOrEqual(before.targets!.eatKcal);
    expect(out.targets.deficitKcal).toBeGreaterThan(before.targets!.deficitKcal);
  });

  test("today, the past and a non-date are refused and nothing is written", async () => {
    const saved = shiftDate(today, 60);
    for (const targetDate of [today, shiftDate(today, -3), "2026-02-30", shiftDate(today, 4000)]) {
      await expect(
        call(profileRouter.updateTargets, { targetWeightKg: 150, targetDate }, as("cut")),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const row = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(row.profile?.targetDate).toBe(saved);
  });

  test("a weight edit that re-sends a lapsed date still goes through", async () => {
    const out = await call(
      profileRouter.updateTargets,
      { targetWeightKg: 72, targetDate: lapsedDate },
      as("lapsed"),
    );
    expect(out.targets.notes).toContain("PLAN_CLAMPED");
    const row = await call(profileRouter.myProfile, undefined, as("lapsed"));
    expect(row.profile?.targetWeightKg).toBe(72);
  });

  test("a lapsed date can be replaced by a future one", async () => {
    await call(
      profileRouter.updateTargets,
      { targetWeightKg: 72, targetDate: shiftDate(today, 90) },
      as("lapsed"),
    );
    const row = await call(profileRouter.myProfile, undefined, as("lapsed"));
    expect(row.profile?.targetDate).toBe(shiftDate(today, 90));
  });
});

describe("profile.previewTargets", () => {
  test("shows the numbers a date would give without saving it", async () => {
    const stored = (await call(profileRouter.myProfile, undefined, as("cut"))).profile!.targetDate;
    const out = await call(
      profileRouter.previewTargets,
      { targetWeightKg: 150, targetDate: shiftDate(today, 150) },
      as("cut"),
    );
    // stored: 60 days (clamped at 1000/day); 150 days asks for ~513/day.
    expect(out.check.status).toBe("ok");
    expect(out.next.deficitKcal).toBeLessThan(out.current.deficitKcal);
    expect(out.next.eatKcal).toBeGreaterThan(out.current.eatKcal);
    const row = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(row.profile?.targetDate).toBe(stored);
  });
});
