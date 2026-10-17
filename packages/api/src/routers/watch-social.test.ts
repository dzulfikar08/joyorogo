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
    const { id } = await call(socialRouter.createWatchPost, { workout, detail, visibility: "grup" }, as("author"));
    const full = { locked: false, hr: detail.hr, route: detail.route };

    expect(await call(socialRouter.workoutDetail, { postId: id }, as("author"))).toEqual(full);
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("pro"))).toEqual(full);
    expect(await call(socialRouter.workoutDetail, { postId: id }, as("mate"))).toEqual({
      locked: true,
      hr: null,
      route: null,
    });
  });

  test("a non-teammate cannot see detail of a grup post", async () => {
    const { id } = await call(socialRouter.createWatchPost, { workout, detail, visibility: "grup" }, as("author"));
    await expect(call(socialRouter.workoutDetail, { postId: id }, as("out"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
