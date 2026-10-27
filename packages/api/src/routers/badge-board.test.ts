import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { computeWeek, currentWeekStart } from "../lib/leaderboard";
import { badgeRouter } from "./badge";
import { leaderboardRouter } from "./leaderboard";
import { socialRouter } from "./social";

const { client, db } = await d1TestDb();
const ENV = { BADGES_USER_IDS: "own,ann,bob" };
const now = new Date();
const today = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES ('own', 'Owner', 'own@t.id', 'free'), ('ann', 'Ann', 'ann@t.id', 'free'),
    ('bob', 'Bob', 'bob@t.id', 'free'), ('mom', 'Mom', 'mom@t.id', 'free'), ('off', 'Off', 'off@t.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, handle, public_profile, maternal_mode) VALUES
    ('own', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'owner', 1, 'none'),
    ('ann', 1990, 'female', 160, 70, 62, '2030-01-01', 'light', 'ann_k', 0, 'none'),
    ('bob', 1990, 'male', 175, 90, 80, '2030-01-01', 'light', 'bob_b', 1, 'none'),
    ('mom', 1990, 'female', 160, 60, 55, '2030-01-01', 'light', 'mom_m', 1, 'pregnant'),
    ('off', 1990, 'male', 175, 90, 80, '2030-01-01', 'light', 'off_o', 1, 'none');
  INSERT INTO badge_award (user_id, badge_id, tier) VALUES ('own', 'konsisten', 2), ('own', 'catatan-pertama', 1), ('ann', 'catatan-pertama', 1);
  INSERT INTO team (id, name, invite_code, owner_id) VALUES ('t1', 'Tim', 'ABCD2345', 'own');
  INSERT INTO team_member (team_id, user_id, role) VALUES ('t1', 'own', 'owner'), ('t1', 'ann', 'member');
`);

const as = (userId: string | null, env: Record<string, string> = ENV) =>
  ({ context: { db, env, locale: "id", waitUntil: () => {}, session: userId ? { user: { id: userId } } : null } }) as unknown as { context: Context };

describe("badge.mine and badge.forUser", () => {
  test("mine lists the whole catalogue with the highest tier earned", async () => {
    const { enabled, badges } = await call(badgeRouter.mine, undefined, as("own"));
    expect(enabled).toBe(true);
    expect(badges).toHaveLength(12);
    expect(badges.find((b) => b.id === "konsisten")).toMatchObject({ tier: 2, tiers: [7, 30, 100] });
    expect(badges.find((b) => b.id === "air-putih")).toMatchObject({ tier: 0, awardedAt: null });
  });

  test("outside the allowlist the feature does not exist", async () => {
    expect(await call(badgeRouter.mine, undefined, as("off"))).toEqual({ enabled: false, badges: [] });
    await expect(call(leaderboardRouter.board, { scope: "global" }, as("off"))).rejects.toThrow();
  });

  test("a public profile shows earned badges only", async () => {
    const { badges } = await call(badgeRouter.forUser, { handle: "owner" }, as(null));
    expect(badges.map((b) => b.id).sort()).toEqual(["catatan-pertama", "konsisten"]);
  });

  test("a private profile is NOT_FOUND to others, and its badges stay out of social.publicProfile", async () => {
    await expect(call(badgeRouter.forUser, { handle: "ann_k" }, as("bob"))).rejects.toThrow();
    const asBob = (await call(socialRouter.publicProfile, { handle: "ann_k" }, as("bob"))) as { publicProfile: boolean; badges: unknown[] };
    expect(asBob.publicProfile).toBe(false);
    expect(asBob.badges).toEqual([]);
    // The owner of the private page still sees their own.
    expect(((await call(badgeRouter.forUser, { handle: "ann_k" }, as("ann"))) as { badges: unknown[] }).badges).toHaveLength(1);
  });

  test("social.publicProfile of a public profile carries its earned badges", async () => {
    const profile = (await call(socialRouter.publicProfile, { handle: "owner" }, as(null))) as { badges: Array<{ id: string; tier: number }> };
    expect(profile.badges.map((b) => `${b.id}:${b.tier}`).sort()).toEqual(["catatan-pertama:1", "konsisten:2"]);
  });
});

describe("leaderboard prefs", () => {
  test("default is off and anonymous", async () => {
    expect(await call(leaderboardRouter.prefs, undefined, as("own"))).toMatchObject({ enabled: true, eligible: true, optIn: false, displayMode: "anonim", alias: null });
  });

  test("an alias is validated and unique", async () => {
    await expect(call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "anonim", alias: "ab" }, as("own"))).rejects.toThrow();
    await call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "anonim", alias: "Kancil_1" }, as("own"));
    expect((await call(leaderboardRouter.prefs, undefined, as("own"))).alias).toBe("kancil_1");
    await expect(call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "anonim", alias: "kancil_1" }, as("ann"))).rejects.toThrow();
  });

  test("people in Hamil or Menyusui cannot join", async () => {
    await expect(call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "anonim" }, as("mom", { BADGES_USER_IDS: "mom" }))).rejects.toThrow();
    expect((await call(leaderboardRouter.prefs, undefined, as("mom", { BADGES_USER_IDS: "mom" }))).eligible).toBe(false);
  });
});

describe("board", () => {
  const week = currentWeekStart(now);
  test("global board shows opted-in people with their display name, never email or weight", async () => {
    await call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "username" }, as("ann"));
    await call(leaderboardRouter.setPrefs, { optIn: true, displayMode: "anonim" }, as("bob"));
    for (const u of ["own", "ann", "bob"]) {
      await client.execute({ sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, created_at) VALUES (?, ?, ?, 'sarapan', 'Nasi', 300, ?)`, args: [crypto.randomUUID(), u, today, Date.now()] });
    }
    await computeWeek(db, ENV, week, now);
    const board = await call(leaderboardRouter.board, { scope: "global" }, as("own"));
    expect(board.week).toBe(week);
    expect(board.closed).toBe(false);
    expect(board.rows.map((r) => r.name).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["ann_k", "kancil_1", null]);
    expect(board.rows.find((r) => r.name === null)).toMatchObject({ anonymous: true });
    expect(board.me).toMatchObject({ isMe: true, name: "kancil_1" });
    expect(JSON.stringify(board)).not.toMatch(/@t\.id|weight|kg/);
    expect(board.rows.every((r) => r.days.length === 7)).toBe(true);
  });

  test("the team board needs membership and ranks only that team", async () => {
    await expect(call(leaderboardRouter.board, { scope: "team", teamId: "t1" }, as("bob"))).rejects.toThrow();
    await expect(call(leaderboardRouter.board, { scope: "team" }, as("own"))).rejects.toThrow();
    const team = await call(leaderboardRouter.board, { scope: "team", teamId: "t1" }, as("own"));
    expect(team.rows.map((r) => r.name).sort()).toEqual(["ann_k", "kancil_1"]);
    expect(team.rows.map((r) => r.rank).sort()).toEqual([1, 2]);
  });

  test("a week that is not a Monday or lies ahead is refused", async () => {
    await expect(call(leaderboardRouter.board, { scope: "global", week: "2026-11-10" }, as("own"))).rejects.toThrow();
    await expect(call(leaderboardRouter.board, { scope: "global", week: "2099-01-05" }, as("own"))).rejects.toThrow();
  });

  test("myRank answers the caller's rank, and null before they are on the board", async () => {
    expect((await call(leaderboardRouter.myRank, undefined, as("own"))).rank).toBeGreaterThan(0);
    await call(leaderboardRouter.setPrefs, { optIn: false, displayMode: "anonim" }, as("bob"));
    expect((await call(leaderboardRouter.myRank, undefined, as("bob"))).rank).toBeNull();
  });

  test("leaving deletes the person's snapshot rows of every week", async () => {
    await client.execute({ sql: `INSERT INTO leaderboard_week (week_start, user_id, days_logged, protein_hit_days, workout_days, streak_end, rank_global, computed_at) VALUES ('2020-01-06', 'ann', 3, 0, 0, 3, 1, 1)`, args: [] });
    await call(leaderboardRouter.setPrefs, { optIn: false, displayMode: "anonim" }, as("ann"));
    expect((await client.execute(`SELECT count(*) AS n FROM leaderboard_week WHERE user_id = 'ann'`)).rows[0]?.n).toBe(0);
  });
});

