import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { FIT_WEB_LIMITS } from "../lib/fit-web";
import { fitWebRouter } from "./fit-web";

const { client, db } = await d1TestDb();

// 2026-10-10 06:00 WIB and 2026-10-10 23:30 WIB are the same WIB day; 2026-10-11 00:10 WIB is the next one.
const wib = (iso: string) => Math.floor(Date.parse(`${iso}+07:00`) / 1000);
const early = wib("2026-10-10T06:00:00");
const late = wib("2026-10-10T23:30:00");
const nextDay = wib("2026-10-11T00:10:00");
const outside = wib("2026-09-01T06:00:00");

const workoutRow = (
  user: string,
  start: number,
  over: Record<string, string | number | null> = {},
) => {
  const row = {
    user_id: user,
    start,
    workout_number: 0,
    sport_name: "Outdoor Run",
    sport_kind: "run",
    elapsed_sec: 1800,
    moving_sec: 1700,
    distance_m: 5000,
    elev_gain_m: 20,
    avg_hr: 150,
    max_hr: 175,
    calories: 320,
    steps: 5000,
    point_count: 1800,
    has_gps: 1,
    has_analysis: 1,
    imported: 0,
    complete: 1,
    engine_rev: 1,
    blob_bytes: 1000,
    content_hash: `h${start}`,
    version: 1,
    created_at: start,
    updated_at: start,
    deleted_at: null,
    ...over,
  };
  const cols = Object.keys(row);
  return {
    sql: `INSERT INTO watch_workout (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    args: Object.values(row),
  };
};

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('pro', 'pro', 'pro@test.id', 'founder'),
    ('free', 'free', 'free@test.id', 'free');
  INSERT INTO fitness_score (id, user_id, date, recovery_pct, strain, sleep_pct, readiness, sleep_hours, resting_hr, hrv_ms, vo2max, load_ratio)
    VALUES
      ('s1', 'pro', '2026-10-09', 62, 11.5, 90, 'Balanced', 7.1, 52, 61.4, 48.2, 1.1),
      ('s2', 'pro', '2026-10-10', 70, 14.2, 100, 'Primed', 7.8, 51, 66.0, 48.3, 1.2),
      ('s3', 'free', '2026-10-10', 40, 8, 70, 'Strained', 5.5, 60, 40, 40, 1);
`);
for (const row of [
  workoutRow("pro", early),
  workoutRow("pro", late, { sport_name: "Road Cycling", sport_kind: "ride", distance_m: 24000 }),
  workoutRow("pro", nextDay, {
    sport_name: "Pool Swimming",
    sport_kind: "swim",
    has_gps: 0,
    has_analysis: 0,
    distance_m: 800,
  }),
  workoutRow("pro", outside),
  // A deleted workout keeps its row as a tombstone and must never be listed.
  workoutRow("pro", early + 3600, { deleted_at: Date.now(), blob_bytes: 0 }),
  workoutRow("free", early),
]) {
  await client.execute(row);
}

// FREE_DAILY_SCANS turns the paywall on; without it every account counts as Pro.
const as = (userId: string, env: Record<string, string> = { FREE_DAILY_SCANS: "3" }) => ({
  context: {
    db,
    env,
    locale: "en",
    waitUntil: () => {},
    session: { user: { id: userId, createdAt: new Date(0) } },
  } as unknown as Context,
});

describe("fitWeb.workouts", () => {
  test("lists the workouts that started in the WIB day window, newest first, without tombstones", async () => {
    const result = await call(
      fitWebRouter.workouts,
      { from: "2026-10-10", to: "2026-10-11" },
      as("pro"),
    );
    expect(result.from).toBe("2026-10-10");
    expect(result.to).toBe("2026-10-11");
    expect(result.truncated).toBe(false);
    expect(result.items.map((i) => i.start)).toEqual([nextDay, late, early]);
    expect(result.items.map((i) => i.date)).toEqual(["2026-10-11", "2026-10-10", "2026-10-10"]);
  });

  test("a row carries what a table needs and nothing of the document", async () => {
    const result = await call(
      fitWebRouter.workouts,
      { from: "2026-10-10", to: "2026-10-10" },
      as("pro"),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      start: early,
      date: "2026-10-10",
      sportName: "Outdoor Run",
      sportKind: "run",
      elapsedSec: 1800,
      movingSec: 1700,
      distanceM: 5000,
      elevGainM: 20,
      avgHr: 150,
      maxHr: 175,
      calories: 320,
      hasGps: true,
      hasAnalysis: true,
      imported: false,
    });
  });

  test("never reads another account's workouts", async () => {
    const result = await call(
      fitWebRouter.workouts,
      { from: "2026-10-10", to: "2026-10-10" },
      as("free", {}),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items.every((i) => i.start === early)).toBe(true);
    const mine = await call(
      fitWebRouter.workouts,
      { from: "2026-10-10", to: "2026-10-10" },
      as("pro"),
    );
    expect(mine.items).toHaveLength(2);
  });

  test("defaults to the last 90 days", async () => {
    const result = await call(fitWebRouter.workouts, {}, as("pro"));
    const days =
      (Date.parse(`${result.to}T00:00:00Z`) - Date.parse(`${result.from}T00:00:00Z`)) / 86_400_000 +
      1;
    expect(days).toBe(90);
  });

  test("refuses a window that is backwards, malformed or longer than a year", async () => {
    await expect(
      call(fitWebRouter.workouts, { from: "2026-10-11", to: "2026-10-10" }, as("pro")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(fitWebRouter.workouts, { from: "2026-02-31", to: "2026-03-02" }, as("pro")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(call(fitWebRouter.workouts, { from: "10/10/2026" }, as("pro"))).rejects.toThrow();
    const tooLong = FIT_WEB_LIMITS.days + 1;
    const to = "2026-10-19";
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - (tooLong - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(call(fitWebRouter.workouts, { from, to }, as("pro"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("fitWeb.recovery", () => {
  test("returns the days oldest first, with the numbers the MCP connector reads", async () => {
    const result = await call(
      fitWebRouter.recovery,
      { from: "2026-10-01", to: "2026-10-19" },
      as("pro"),
    );
    expect(result.days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10"]);
    expect(result.days[1]).toMatchObject({
      date: "2026-10-10",
      recoveryPct: 70,
      strain: 14.2,
      sleepHours: 7.8,
      sleepSource: "joyofit",
      restingHrBpm: 51,
      hrvMs: 66,
      vo2maxMlKgMin: 48.3,
      loadRatio: 1.2,
    });
  });

  test("never reads another account's days", async () => {
    const result = await call(
      fitWebRouter.recovery,
      { from: "2026-10-01", to: "2026-10-19" },
      as("free", {}),
    );
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.recoveryPct).toBe(40);
  });

  test("a window without data is an empty list, not an error", async () => {
    const result = await call(
      fitWebRouter.recovery,
      { from: "2020-01-01", to: "2020-01-31" },
      as("pro"),
    );
    expect(result.days).toEqual([]);
  });
});

describe("Pro gate", () => {
  test("a free account on a paywalled server gets FORBIDDEN with the paywall flag, in its own language", async () => {
    const paywall = {
      code: "FORBIDDEN",
      data: { paywall: true },
      message: "JoyoFit web is for JoyoRogo Pro.",
    };
    await expect(call(fitWebRouter.recovery, {}, as("free"))).rejects.toMatchObject(paywall);
    await expect(call(fitWebRouter.workouts, {}, as("free"))).rejects.toMatchObject(paywall);
    const id = as("free");
    id.context.locale = "id";
    await expect(call(fitWebRouter.workouts, {}, id)).rejects.toMatchObject({
      message: "JoyoFit web khusus pengguna JoyoRogo Pro.",
    });
  });

  test("a server without a paywall unlocks every account", async () => {
    const result = await call(
      fitWebRouter.workouts,
      { from: "2026-10-10", to: "2026-10-10" },
      as("free", {}),
    );
    expect(result.items).toHaveLength(1);
  });

  test("a signed-out caller is UNAUTHORIZED, not FORBIDDEN", async () => {
    const anonymous = {
      context: { db, env: {}, locale: "en", waitUntil: () => {} } as unknown as Context,
    };
    await expect(call(fitWebRouter.workouts, {}, anonymous)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
