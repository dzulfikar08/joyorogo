import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday } from "../lib/engine";
import type { WorkoutAnalysis } from "../lib/workout-analysis";
import { workoutAnalysisSchema } from "../lib/workout-analysis-schema";
import { fitnessRouter } from "./fitness";
import { groupRouter } from "./group";
import { socialRouter } from "./social";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

// author/mate: free teammates. pro: Founder teammate. out: free, in no team.
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('author', 'Author', 'author@test.id', 'free'),
    ('mate', 'Mate', 'mate@test.id', 'free'),
    ('pro', 'Pro', 'pro@test.id', 'founder'),
    ('out', 'Out', 'out@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 80, 72, '2030-01-01', 'mid' FROM "user";
  INSERT INTO team (id, name, invite_code, owner_id) VALUES ('t1', 'Tim', 'AAAAAAAA', 'author');
  INSERT INTO team_member (team_id, user_id, role) VALUES
    ('t1', 'author', 'owner'), ('t1', 'mate', 'member'), ('t1', 'pro', 'member');
`);

const db = drizzle(client) as unknown as Database;
const HOSTED = { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" };
const as = (userId: string) => ({
  context: {
    db,
    env: HOSTED,
    locale: "id",
    waitUntil: () => {},
    session: { user: { id: userId } },
  } as unknown as Context,
});
const today = jakartaToday();

describe("group fitness sharing", () => {
  const scores = { recoveryPct: 62, strain: 11.4, sleepPct: 88, readiness: "Balanced" as const };
  const member = async (viewer: string, userId: string) => {
    const out = await call(groupRouter.detail, { groupId: "t1" }, as(viewer));
    return out.members.find((m) => m.userId === userId);
  };

  test("another member's scores stay hidden until they opt in; own row always shows", async () => {
    await call(fitnessRouter.upsertScores, { days: [{ date: today, ...scores }] }, as("author"));

    expect((await member("mate", "author"))?.shareFitness).toBe(false);
    expect((await member("mate", "author"))?.today.fitness).toBeNull();
    expect((await member("author", "author"))?.today.fitness).toEqual(scores);

    await call(groupRouter.setShareFitness, { groupId: "t1", shareFitness: true }, as("author"));
    expect((await member("mate", "author"))?.shareFitness).toBe(true);
    expect((await member("mate", "author"))?.today.fitness).toEqual(scores);
  });

  test("a member without a score row has no fitness even when sharing", async () => {
    await call(groupRouter.setShareFitness, { groupId: "t1", shareFitness: true }, as("mate"));
    expect((await member("author", "mate"))?.today.fitness).toBeNull();
  });
});

const N = 20;
const ramp = (from: number, to: number) =>
  Array.from({ length: N }, (_, i) => from + ((to - from) * i) / (N - 1));

/** A realistic 42.5 minute, 6.2 km run on a 20-sample grid that matches `w`. */
function analysisFor(w: { startedAt: number; durationMin: number }): WorkoutAnalysis {
  const elapsedSec = w.durationMin * 60;
  const dist = ramp(0, 6200).map((d) => Math.round(d));
  return {
    v: 1,
    sport: { name: "Lari", kind: "run" },
    startedAt: w.startedAt,
    elapsedSec,
    movingSec: elapsedSec - 40,
    distanceM: 6200,
    elevation: { gainM: 48, lossM: 45, minM: 12, maxM: 41 },
    series: {
      stepSec: 135,
      n: N,
      dist,
      hr: ramp(118, 176).map((v, i) => (i === 7 ? null : Math.round(v))),
      pace: ramp(402, 365).map((v, i) => (i === 0 ? null : Math.round(v))),
      alt: ramp(14, 38).map((v) => Math.round(v * 10) / 10),
      cad: ramp(160, 172).map(Math.round),
      power: null,
      track: ramp(0, 1).map((f, i) => (i < 2 ? null : ([-6.2 - f * 0.01, 106.8 + f * 0.01] as [number, number]))),
    },
    splits: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      n,
      distM: n === 7 ? 200 : 1000,
      sec: n === 7 ? 71 : 410 - n * 4,
      paceSecKm: n === 7 ? 355 : 410 - n * 4,
      hr: 140 + n * 5,
      gainM: 7,
      lossM: 6,
      cad: 166,
    })),
    laps: [
      { n: 1, startSec: 0, sec: 1275, distM: 3100, paceSecKm: 411, avgHr: 145, maxHr: 160, avgCad: 164, gainM: 25 },
      { n: 2, startSec: 1275, sec: 1275, distM: 3100, paceSecKm: 411, avgHr: 163, maxHr: 178, avgCad: 170, gainM: 23 },
    ],
    hrZones: { maxHr: 190, source: "age", bounds: [95, 114, 133, 152, 171, 190], sec: [120, 600, 900, 700, 230], belowSec: 0 },
    paceZones: {
      thresholdSecKm: 340,
      zones: [
        { key: "recovery", fromSecKm: null, toSecKm: 460, sec: 0 },
        { key: "endurance", fromSecKm: 460, toSecKm: 400, sec: 1400 },
        { key: "tempo", fromSecKm: 400, toSecKm: 360, sec: 900 },
        { key: "threshold", fromSecKm: 360, toSecKm: 330, sec: 250 },
        { key: "vo2", fromSecKm: 330, toSecKm: null, sec: 0 },
      ],
    },
    bestEfforts: [
      { key: "400m", sec: 98, atM: 5800, rank: 2 },
      { key: "1k", sec: 372, atM: 5200, rank: null },
    ],
    effort: { strain: 11.4, trimp: 96, band: "hard", addedToDay: 11.4 },
    load: {
      trimp: 96,
      acute: 410,
      chronicWeekly: 360,
      ratio: 1.14,
      watchLoad: null,
      aerobicEffect: 3.4,
      anaerobicEffect: null,
      recoveryHours: 36,
    },
    calories: { kcal: 410, fatG: null, carbG: null },
    comparison: {
      basis: "distance",
      items: [{ startedAt: w.startedAt - 7 * 86_400_000, distM: 6050, sec: 2610, paceSecKm: 431, avgHr: 149, gainM: 40 }],
    },
    stats: {
      avgHr: 151,
      maxHr: 178,
      minHr: 118,
      avgPaceSecKm: 411,
      bestPaceSecKm: 352,
      avgSpeedMs: 2.43,
      maxSpeedMs: 3.1,
      avgCad: 166,
      maxCad: 174,
      avgPower: null,
      maxPower: null,
      normalizedPower: null,
      avgStrideM: 0.88,
    },
  };
}

/** Within every per-field cap, yet far past the 200 KB serialized ceiling (full-precision floats). */
function oversizeAnalysis(w: { startedAt: number; durationMin: number }): WorkoutAnalysis {
  const base = analysisFor(w);
  const n = 720;
  const f = (i: number, lo: number, hi: number) => lo + ((hi - lo) * (i + 0.123456789012345)) / n;
  const col = (lo: number, hi: number) => Array.from({ length: n }, (_, i) => f(i, lo, hi));
  base.series = {
    stepSec: 4,
    n,
    dist: col(0, 6200),
    hr: col(120, 180),
    pace: col(300, 500),
    alt: col(10, 40),
    cad: col(150, 180),
    power: col(100, 300),
    track: Array.from({ length: n }, (_, i) => [-6.2 - f(i, 0, 0.1), 106.8 + f(i, 0, 0.1)] as [number, number]),
  };
  base.splits = Array.from({ length: 250 }, (_, i) => ({
    n: i + 1,
    distM: f(i, 990, 1010),
    sec: f(i, 380, 420),
    paceSecKm: f(i, 380, 420),
    hr: f(i, 140, 170),
    gainM: f(i, 1, 9),
    lossM: f(i, 1, 9),
    cad: f(i, 160, 170),
  }));
  base.laps = Array.from({ length: 300 }, (_, i) => ({
    n: i + 1,
    startSec: f(i, 0, 2500),
    sec: f(i, 20, 30),
    distM: f(i, 90, 110),
    paceSecKm: f(i, 380, 420),
    avgHr: f(i, 140, 170),
    maxHr: f(i, 150, 180),
    avgCad: f(i, 160, 170),
    gainM: f(i, 1, 9),
  }));
  return base;
}

describe("watch posts", () => {
  const workout = {
    sportName: "Lari",
    startedAt: Date.now() - 3_600_000,
    durationMin: 42.5,
    kcal: 410,
    distanceM: 6200,
    avgHr: 151,
    maxHr: 178,
  };
  const detail = {
    hr: { intervalSec: 5, bpm: [120, null, 150] },
    route: [
      [-6.2, 106.8],
      [-6.21, 106.81],
    ] as [number, number][],
  };

  test("createWatchPost stores the summary stats and the detail row", async () => {
    const { id, visibility } = await call(
      socialRouter.createWatchPost,
      { workout, detail, caption: "Pagi", visibility: "grup" },
      as("author"),
    );
    expect(visibility).toBe("grup");

    const post = await client.execute({ sql: "SELECT * FROM post WHERE id = ?", args: [id] });
    expect(post.rows[0]).toMatchObject({ kind: "latihan", title: "Lari", kcal: 410, duration_min: 42.5 });
    expect(JSON.parse(String(post.rows[0]?.stats_json))).toEqual({
      source: "joyofit",
      distanceM: 6200,
      avgHr: 151,
      maxHr: 178,
      startedAt: workout.startedAt,
      hasDetail: 1,
    });
    const row = await client.execute({ sql: "SELECT * FROM post_workout_detail WHERE post_id = ?", args: [id] });
    expect(JSON.parse(String(row.rows[0]?.hr_json))).toEqual(detail.hr);
    expect(JSON.parse(String(row.rows[0]?.route_json))).toEqual(detail.route);
  });

  test("a summary-only post has no detail row", async () => {
    const { id } = await call(socialRouter.createWatchPost, { workout, visibility: "grup" }, as("author"));
    const post = await client.execute({ sql: "SELECT stats_json FROM post WHERE id = ?", args: [id] });
    expect(JSON.parse(String(post.rows[0]?.stats_json)).hasDetail).toBe(0);
    const rows = await client.execute({ sql: "SELECT 1 FROM post_workout_detail WHERE post_id = ?", args: [id] });
    expect(rows.rows).toHaveLength(0);
    await expect(call(socialRouter.workoutDetail, { postId: id }, as("author"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("workoutDetail: author and Pro viewers get the data, free teammates are locked", async () => {
    const { id } = await call(
      socialRouter.createWatchPost,
      { workout, detail: { ...detail, analysis: analysisFor(workout) }, visibility: "grup" },
      as("author"),
    );
    const full = { locked: false, hr: detail.hr, route: detail.route, analysis: analysisFor(workout) };

    expect(await call(socialRouter.workoutDetail, { postId: id }, as("author"))).toEqual(full);
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("pro"))).toEqual(full);
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("mate"))).toEqual({
      locked: true,
      hr: null,
      route: null,
      analysis: null,
    });
  });

  test("legacy hr/route-only posts still work and have a null analysis", async () => {
    const { id } = await call(socialRouter.createWatchPost, { workout, detail, visibility: "grup" }, as("author"));
    const row = await client.execute({ sql: "SELECT analysis_json FROM post_workout_detail WHERE post_id = ?", args: [id] });
    expect(row.rows[0]?.analysis_json).toBeNull();
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("pro"))).toEqual({
      locked: false,
      hr: detail.hr,
      route: detail.route,
      analysis: null,
    });
  });

  test("an analysis-only post stores analysis_json, nothing in hr/route, and sets hasDetail", async () => {
    const analysis = analysisFor(workout);
    const { id } = await call(
      socialRouter.createWatchPost,
      { workout, detail: { analysis }, visibility: "grup" },
      as("author"),
    );
    const post = await client.execute({ sql: "SELECT stats_json FROM post WHERE id = ?", args: [id] });
    expect(JSON.parse(String(post.rows[0]?.stats_json)).hasDetail).toBe(1);
    const row = await client.execute({ sql: "SELECT * FROM post_workout_detail WHERE post_id = ?", args: [id] });
    expect(row.rows[0]?.hr_json).toBeNull();
    expect(row.rows[0]?.route_json).toBeNull();
    expect(JSON.parse(String(row.rows[0]?.analysis_json))).toEqual(analysis);
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("author"))).toEqual({
      locked: false,
      hr: null,
      route: null,
      analysis,
    });
  });

  test("a corrupt analysis_json yields a null analysis, not an error", async () => {
    const { id } = await call(
      socialRouter.createWatchPost,
      { workout, detail: { analysis: analysisFor(workout) }, visibility: "grup" },
      as("author"),
    );
    await client.execute({ sql: "UPDATE post_workout_detail SET analysis_json = ? WHERE post_id = ?", args: ["{not json", id] });
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("author"))).toEqual({
      locked: false,
      hr: null,
      route: null,
      analysis: null,
    });
    await client.execute({ sql: "UPDATE post_workout_detail SET analysis_json = ? WHERE post_id = ?", args: ['{"v":1}', id] });
    expect((await call(socialRouter.workoutDetail, { postId: id }, as("author"))).analysis).toBeNull();
  });

  test("rejects an analysis whose series arrays do not match n", async () => {
    const analysis = analysisFor(workout);
    analysis.series!.hr = analysis.series!.hr!.slice(0, 19);
    await expect(
      call(socialRouter.createWatchPost, { workout, detail: { analysis }, visibility: "grup" }, as("author")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejects out-of-range values, unknown keys and too many samples", async () => {
    const post = (analysis: unknown) =>
      call(socialRouter.createWatchPost, { workout, detail: { analysis } as never, visibility: "grup" }, as("author"));
    const badHr = analysisFor(workout);
    badHr.series!.hr![3] = 400;
    await expect(post(badHr)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(post({ ...analysisFor(workout), extra: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(post({ ...analysisFor(workout), v: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const many = analysisFor(workout);
    many.splits = Array.from({ length: 251 }, (_, i) => ({ ...many.splits[0]!, n: i + 1 }));
    await expect(post(many)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejects an analysis larger than 200 KB", async () => {
    const analysis = oversizeAnalysis(workout);
    expect(JSON.stringify(analysis).length).toBeGreaterThan(200_000);
    expect(workoutAnalysisSchema.safeParse(analysis).error?.issues.map((i) => i.message)).toContain(
      "Workout analysis is larger than 200000 bytes",
    );
    await expect(
      call(socialRouter.createWatchPost, { workout, detail: { analysis }, visibility: "grup" }, as("author")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejects an analysis that disagrees with the workout, with a localized message", async () => {
    const wrongStart = { ...analysisFor(workout), startedAt: workout.startedAt + 1000 };
    await expect(
      call(socialRouter.createWatchPost, { workout, detail: { analysis: wrongStart }, visibility: "grup" }, as("author")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Analisis latihan") });

    const wrongLength = { ...analysisFor(workout), elapsedSec: workout.durationMin * 60 + 61 };
    await expect(
      call(socialRouter.createWatchPost, { workout, detail: { analysis: wrongLength }, visibility: "grup" }, as("author")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const withinTolerance = { ...analysisFor(workout), elapsedSec: workout.durationMin * 60 + 59 };
    await call(socialRouter.createWatchPost, { workout, detail: { analysis: withinTolerance }, visibility: "grup" }, as("author"));
  });

  test("a non-teammate cannot see detail of a grup post", async () => {
    const { id } = await call(socialRouter.createWatchPost, { workout, detail, visibility: "grup" }, as("author"));
    await expect(call(socialRouter.workoutDetail, { postId: id }, as("out"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
