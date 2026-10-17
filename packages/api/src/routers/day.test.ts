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
import { dayRouter } from "./day";
import { fitnessRouter } from "./fitness";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday();
const inOneDay = Date.now() + 24 * 60 * 60 * 1000;
const lapsed = Date.now() - 24 * 60 * 60 * 1000;

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, founder_until) VALUES
    ('free', 'free', 'free@test.id', 'free', NULL),
    ('lapsed', 'lapsed', 'lapsed@test.id', 'free', ${lapsed}),
    ('paid', 'paid', 'paid@test.id', 'free', ${inOneDay}),
    ('comp', 'comp', 'comp@test.id', 'founder', NULL),
    ('bare', 'bare', 'bare@test.id', 'founder', NULL);
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 80, 72, '2030-01-01', 'mid' FROM "user" WHERE id != 'bare';
`);

const db = drizzle(client) as unknown as Database;
const ctx = (userId: string, env: Context["env"] = { FREE_DAILY_SCANS: "3" }) =>
  ({
    db,
    env,
    waitUntil: () => {},
    session: { user: { id: userId } },
  }) as unknown as Context;
const as = (userId: string, env?: Context["env"]) => ({ context: ctx(userId, env) });

const push = (userId: string, date: string, scores: Record<string, unknown>) =>
  call(fitnessRouter.upsertScores, { days: [{ date, ...scores }] } as never, as(userId));

// A user's own history: 3 frequent foods on 3 past days, with macros.
async function seedHistory(userId: string) {
  const rows: string[] = [];
  for (const back of [1, 2, 3]) {
    const date = shiftDate(today, -back);
    rows.push(
      `('${userId}-${back}-a', '${userId}', '${date}', 'makan_siang', 'Dada ayam bakar', 280, 35, 2, 8)`,
      `('${userId}-${back}-b', '${userId}', '${date}', 'makan_malam', 'Tempe goreng', 200, 14, 10, 12)`,
      `('${userId}-${back}-c', '${userId}', '${date}', 'sarapan', 'Telur dadar', 150, 12, 1, 10)`,
    );
  }
  await client.execute(
    `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat) VALUES ${rows.join(",")}`,
  );
}

describe("day.readinessGuidance premium gate", () => {
  test("a free user gets only `locked`, even with scores and history", async () => {
    await push("free", today, { recoveryPct: 20, strain: 16 });
    await seedHistory("free");
    const out = await call(dayRouter.readinessGuidance, undefined, as("free"));
    expect(out).toEqual({ status: "locked" });
  });

  test("a lapsed Founder period is locked again", async () => {
    await push("lapsed", today, { recoveryPct: 20 });
    expect(await call(dayRouter.readinessGuidance, undefined, as("lapsed"))).toEqual({
      status: "locked",
    });
  });

  test("a server without a paywall unlocks it for everyone", async () => {
    await push("free", today, { recoveryPct: 20 });
    const out = await call(dayRouter.readinessGuidance, undefined, as("free", {}));
    expect(out.status).toBe("ready");
  });

  test("a paid Founder gets guidance from their own scores, targets, diary and history", async () => {
    await push("paid", today, { recoveryPct: 20, strain: 15, sleepPct: 90, readiness: "Strained" });
    await seedHistory("paid");
    await client.execute(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat)
       VALUES ('paid-today', 'paid', '${today}', 'sarapan', 'Telur dadar', 300, 24, 2, 20)`,
    );

    const out = await call(dayRouter.readinessGuidance, undefined, as("paid"));
    if (out.status !== "ready") throw new Error(`expected ready, got ${out.status}`);
    const { guidance } = out;
    expect(guidance.focus).toBe("fuel_recover");

    // The numbers are the diary's own: same kcal and protein targets as day.summary.
    const summary = await call(dayRouter.summary, { date: today }, as("paid"));
    expect(guidance.numbers?.eatKcal).toBe(summary.targets?.eatKcal);
    expect(guidance.numbers?.protein.targetG).toBe(summary.protein?.targetG);
    expect(guidance.numbers?.eatenKcal).toBe(300);
    expect(guidance.numbers?.protein.eatenG).toBe(24);
    expect(guidance.numbers?.carbs.boostG).toBeGreaterThan(0);

    // Food comes from the user's own history; what was eaten today is left out.
    const names = guidance.foods.map((f) => f.name);
    expect(names).toContain("Dada ayam bakar");
    expect(names).not.toContain("Telur dadar");
    expect(guidance.foods.find((f) => f.name === "Dada ayam bakar")).toMatchObject({
      source: "riwayat",
      days: 3,
      kcal: 280,
      proteinG: 35,
    });
  });

  test("only today's scores drive the guidance, an earlier day's do not", async () => {
    await push("comp", shiftDate(today, -1), { recoveryPct: 10 });
    expect(await call(dayRouter.readinessGuidance, undefined, as("comp"))).toEqual({
      status: "none",
    });
  });

  test("a Founder without a profile gets qualitative guidance and no foods", async () => {
    await push("bare", today, { strain: 16, recoveryPct: 20 });
    const out = await call(dayRouter.readinessGuidance, undefined, as("bare"));
    if (out.status !== "ready") throw new Error(`expected ready, got ${out.status}`);
    expect(out.guidance.numbers).toBeNull();
    expect(out.guidance.foods).toEqual([]);
    expect(out.guidance.basis).toBeNull();
  });
});

describe("day.kcalSeries", () => {
  test("sums food per day, marks untouched days null, and ignores other users and Strava rows", async () => {
    const d1 = shiftDate(today, -3);
    const d2 = shiftDate(today, -2);
    const d3 = shiftDate(today, -1);
    await client.execute(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES
        ('ks-1', 'comp', '${d1}', 'sarapan', 'a', 400.4),
        ('ks-2', 'comp', '${d1}', 'makan_siang', 'b', 600),
        ('ks-3', 'bare', '${d3}', 'sarapan', 'other user', 999)`,
    );
    await client.execute(
      `INSERT INTO exercise_log (id, user_id, date, name, kcal, source)
       VALUES ('ks-ex', 'comp', '${d2}', 'Run', 500, 'strava')`,
    );
    const out = await call(dayRouter.kcalSeries, { from: d1, to: d3 }, as("comp"));
    expect(out).toEqual([
      { date: d1, kcal: 1000 },
      { date: d2, kcal: null },
      { date: d3, kcal: null },
    ]);
  });

  test("rejects reversed and oversized ranges", async () => {
    await expect(
      call(dayRouter.kcalSeries, { from: today, to: shiftDate(today, -1) }, as("comp")),
    ).rejects.toThrow();
    await expect(
      call(dayRouter.kcalSeries, { from: shiftDate(today, -500), to: today }, as("comp")),
    ).rejects.toThrow();
  });
});
