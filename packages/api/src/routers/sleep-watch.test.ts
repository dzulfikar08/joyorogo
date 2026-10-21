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
import { getRecoveryDays } from "../lib/fit-data";
import { dayRouter } from "./day";
import { fitnessRouter } from "./fitness";
import { sleepRouter } from "./sleep";

// JoyoFit pushes the hours its watch measured for the night that ended today (fitness_score.sleep_hours). The Beranda
// tile and the Tidur screen read sleep_log only, so a person who sleeps with a watch and never types the number saw "–".

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('watch', 'watch', 'watch@test.id', 'free'),
    ('manual', 'manual', 'manual@test.id', 'free'),
    ('import', 'import', 'import@test.id', 'free'),
    ('pct', 'pct', 'pct@test.id', 'free'),
    ('none', 'none', 'none@test.id', 'free'),
    ('solo', 'solo', 'solo@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 80, 70, '2031-01-01', 'mid' FROM "user";
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: userId, createdAt: new Date(0) } },
  } as unknown as Context,
});

const today = jakartaToday();
const yesterday = shiftDate(today, -1);
// sleep_log keys a night by the day it started; the morning it ended is the day after.
const nightKey = yesterday;

const push = (userId: string, day: Record<string, unknown>) =>
  call(fitnessRouter.upsertScores, { days: [{ date: today, ...day }] }, as(userId));
const summaryHours = async (userId: string, date = today) =>
  (await call(dayRouter.summary, { date }, as(userId))).sleepHoursLastNight;
const logNight = (
  userId: string,
  hours: number,
  source: "manual" | "health_connect" | "apple_health",
) => call(sleepRouter.log, { date: nightKey, hours, source }, as(userId));

describe("sleep hours measured by the JoyoFit watch", () => {
  test("a pushed night shows on the Beranda tile and the Tidur screen without any sleep_log row", async () => {
    // The owner's case: JoyoFit sent 6.4 h for the morning of 2026-10-19 and sleep_log had nothing for the night.
    await push("watch", { sleepHours: 6.4, sleepPct: 79, readiness: "Balanced" });

    expect(await summaryHours("watch")).toBe(6.4);

    const night = await call(sleepRouter.getForDate, { date: nightKey }, as("watch"));
    expect(night).toMatchObject({ userId: "watch", date: nightKey, hours: 6.4, source: "joyofit" });
    // The default night is the one that ended today.
    expect((await call(sleepRouter.getForDate, {}, as("watch")))?.hours).toBe(6.4);
  });

  test("the watch's hours belong to the morning they were pushed for, not to the next night", async () => {
    // The night that ended today is not the night that starts today, and the day before has its own value.
    expect(await call(sleepRouter.getForDate, { date: today }, as("watch"))).toBeNull();
    expect(await summaryHours("watch", yesterday)).toBeNull();
  });

  test("a manual entry is the person's own number and beats the watch", async () => {
    await push("manual", { sleepHours: 6.4 });
    await logNight("manual", 7.5, "manual");

    expect(await summaryHours("manual")).toBe(7.5);
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("manual"))).toMatchObject({
      hours: 7.5,
      source: "manual",
    });
  });

  test("the watch's reading beats a Health Connect / Apple Health import of the same night", async () => {
    await logNight("import", 7, "apple_health");
    expect(await summaryHours("import")).toBe(7);

    await push("import", { sleepHours: 6.4 });
    expect(await summaryHours("import")).toBe(6.4);
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("import"))).toMatchObject({
      hours: 6.4,
      source: "joyofit",
    });
  });

  test("a push with the share of need but no hours (an older JoyoFit) leaves the tile to the log", async () => {
    await push("pct", { sleepPct: 71, readiness: "Strained" });
    expect(await summaryHours("pct")).toBeNull();
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("pct"))).toBeNull();

    await logNight("pct", 5, "health_connect");
    expect(await summaryHours("pct")).toBe(5);
  });

  test("a later push without hours keeps the hours already stored", async () => {
    await push("watch", { strain: 9.5 });
    expect(await summaryHours("watch")).toBe(6.4);
  });

  test("no log and no watch hours is no night", async () => {
    expect(await summaryHours("none")).toBeNull();
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("none"))).toBeNull();
  });

  test("the AI connector reads the same hours and source as the tile", async () => {
    const [watch] = await getRecoveryDays(db, "watch", today, today);
    expect(watch).toMatchObject({ sleepHours: 6.4, sleepSource: "joyofit" });
    const [manual] = await getRecoveryDays(db, "manual", today, today);
    expect(manual).toMatchObject({ sleepHours: 7.5, sleepSource: "manual" });
    const [imported] = await getRecoveryDays(db, "import", today, today);
    expect(imported).toMatchObject({ sleepHours: 6.4, sleepSource: "joyofit" });
  });
});

describe("sleep.clearManual", () => {
  test("a manual night hides the watch's number but reports it as the alternative", async () => {
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("manual"))).toMatchObject({
      hours: 7.5,
      source: "manual",
      alternative: { hours: 6.4, source: "joyofit" },
    });
  });

  test("clearing the manual entry shows the watch hours again; other users and sources are untouched", async () => {
    await logNight("solo", 8, "manual");
    const importedBefore = await call(sleepRouter.getForDate, { date: nightKey }, as("import"));

    const night = await call(sleepRouter.clearManual, { date: nightKey }, as("manual"));
    expect(night).toMatchObject({ hours: 6.4, source: "joyofit", alternative: null });
    expect(await summaryHours("manual")).toBe(6.4);

    // Another user's manual row survives.
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("solo"))).toMatchObject({ hours: 8, source: "manual" });
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("import"))).toEqual(importedBefore);
  });

  test("an import row is not a manual entry and is never deleted", async () => {
    await logNight("pct", 9, "health_connect");
    await call(sleepRouter.clearManual, { date: nightKey }, as("pct"));
    expect(await call(sleepRouter.getForDate, { date: nightKey }, as("pct"))).toMatchObject({ hours: 9, source: "health_connect" });
  });

  test("with no watch reading the night is empty afterwards", async () => {
    expect(await call(sleepRouter.clearManual, { date: nightKey }, as("solo"))).toBeNull();
    expect(await summaryHours("solo")).toBeNull();
  });
});
