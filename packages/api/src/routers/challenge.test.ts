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
import { challengeRouter } from "./challenge";
import { groupRouter } from "./group";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday();
const day = (back: number) => shiftDate(today, -back);

// comp: comped Founder with a profile. free: free user with a profile.
// bare: Founder without a profile. out: free user outside every team.
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('comp', 'Comp', 'comp@test.id', 'founder'),
    ('free', 'Free', 'free@test.id', 'free'),
    ('bare', 'Bare', 'bare@test.id', 'founder'),
    ('out', 'Out', 'out@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 80, 72, '2030-01-01', 'light' FROM "user" WHERE id IN ('comp', 'free');
  INSERT INTO team (id, name, invite_code, owner_id) VALUES
    ('t1', 'Tim Satu', 'AAAAAAAA', 'comp'),
    ('t2', 'Tim Dua', 'BBBBBBBB', 'comp'),
    ('t3', 'Tim Tiga', 'CCCCCCCC', 'free');
  INSERT INTO team_member (team_id, user_id, role) VALUES
    ('t1', 'comp', 'owner'), ('t1', 'free', 'member'), ('t1', 'bare', 'member'),
    ('t2', 'comp', 'owner'),
    ('t3', 'free', 'owner'), ('t3', 'comp', 'member');
`);

const db = drizzle(client) as unknown as Database;
const HOSTED = { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" };
const as = (userId: string, env: Context["env"] = HOSTED, locale: "id" | "en" = "id") => ({
  context: {
    db,
    env,
    locale,
    waitUntil: () => {},
    session: { user: { id: userId } },
  } as unknown as Context,
});

/** Inserts a challenge straight into the DB so tests can start it in the past. */
async function seed(
  id: string,
  teamId: string,
  goal: string,
  target: number | null,
  startBack: number,
  members: { userId: string; target?: number | null; fromBack?: number }[],
  durationDays = 7,
) {
  const start = day(startBack);
  await client.execute({
    sql: `INSERT INTO team_challenge (id, team_id, created_by, title, goal, target, duration_days, start_date, end_date)
          VALUES (?, ?, 'comp', ?, ?, ?, ?, ?, ?)`,
    args: [id, teamId, `Tantangan ${id}`, goal, target, durationDays, start, shiftDate(start, durationDays - 1)],
  });
  for (const m of members) {
    await client.execute({
      sql: `INSERT INTO team_challenge_member (challenge_id, user_id, from_date, target) VALUES (?, ?, ?, ?)`,
      args: [id, m.userId, day(m.fromBack ?? startBack), m.target ?? null],
    });
  }
}

const steps = (userId: string, back: number, value: number, source = "health_connect") =>
  client.execute({
    sql: `INSERT INTO daily_activity (id, user_id, date, steps, source) VALUES (?, ?, ?, ?, ?)`,
    args: [`${userId}-s-${back}`, userId, day(back), value, source],
  });

const food = (
  userId: string,
  back: number,
  n: number,
  kcal: number,
  protein: number,
  source: "manual" | "ai",
) =>
  client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, source) VALUES (?, ?, ?, 'makan_siang', 'x', ?, ?, ?)`,
    args: [`${userId}-f-${back}-${n}`, userId, day(back), kcal, protein, source],
  });

const workout = (userId: string, back: number, n: number, source: string) =>
  client.execute({
    sql: `INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, ?, ?, 'Lari', 200, ?)`,
    args: [`${userId}-w-${back}-${n}`, userId, day(back), source],
  });

const fit = (userId: string, back: number, strain: number | null, sleepPct: number | null) =>
  client.execute({
    sql: `INSERT INTO fitness_score (id, user_id, date, strain, sleep_pct) VALUES (?, ?, ?, ?, ?)`,
    args: [`${userId}-fit-${back}`, userId, day(back), strain, sleepPct],
  });

const detail = (userId: string, challengeId: string) =>
  call(challengeRouter.detail, { challengeId }, as(userId));

describe("create: Founder gate and validation", () => {
  const input = { groupId: "t1", goal: "steps", target: 8000, durationDays: 7 } as const;

  test("a free user is refused on the server with a paywall error", async () => {
    const err = await call(challengeRouter.create, input, as("free")).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN", data: { paywall: true, reason: "challenge" } });
    const counted = await client.execute(`SELECT count(*) AS n FROM team_challenge`);
    expect(Number(counted.rows[0]?.n)).toBe(0);
  });

  test("a Founder creates, joins automatically, and the default title is set", async () => {
    const { id } = await call(challengeRouter.create, input, as("comp"));
    const out = await detail("comp", id);
    expect(out.challenge).toMatchObject({
      title: "8.000 langkah, 7 hari",
      goal: "steps",
      target: 8000,
      status: "active",
      dayNumber: 1,
      daysLeft: 6,
      rule: "Minimal 8.000 langkah per hari",
    });
    expect(out.leaderboard.map((e) => e.userId)).toEqual(["comp"]);
    expect(out.me.joined).toBe(true);
    // Steps goal with nothing synced yet: the client is told how to connect.
    expect(out.me.deviceHint).toContain("Health Connect");
    await call(challengeRouter.remove, { challengeId: id }, as("comp"));
  });

  test("a server without a paywall lets anyone host", async () => {
    const { id } = await call(challengeRouter.create, input, as("free", {}));
    await call(challengeRouter.remove, { challengeId: id }, as("free", {}));
  });

  test("a non-member cannot host in a team", async () => {
    await expect(
      call(challengeRouter.create, { ...input, groupId: "t2" }, as("bare")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("invalid inputs are rejected with Indonesian messages", async () => {
    await expect(
      call(challengeRouter.create, { ...input, durationDays: 10 }, as("comp")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pilih durasi 7, 14, atau 30 hari." });
    await expect(
      call(challengeRouter.create, { ...input, target: null }, as("comp")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(challengeRouter.create, { ...input, startDate: day(1) }, as("comp")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(challengeRouter.create, { ...input, goal: "protein", target: 100 }, as("comp")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("messages, titles and goal wording follow the caller's language", async () => {
    await expect(
      call(challengeRouter.create, { ...input, durationDays: 10 }, as("comp", HOSTED, "en")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pick 7, 14 or 30 days." });
    await expect(
      call(challengeRouter.create, { ...input, groupId: "t2" }, as("bare", HOSTED, "en")),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Group not found." });
    const { id } = await call(challengeRouter.create, input, as("comp", HOSTED, "en"));
    const out = await call(challengeRouter.detail, { challengeId: id }, as("comp", HOSTED, "en"));
    expect(out.challenge).toMatchObject({
      title: "8,000 steps, 7 days",
      rule: "At least 8,000 steps a day",
      goalLabel: "Daily steps",
      unit: "steps",
    });
    expect(out.me.deviceHint).toContain("Health Connect");
    await call(challengeRouter.remove, { challengeId: id }, as("comp"));
  });

  test("a group holds at most 3 running challenges", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await call(challengeRouter.create, { ...input, groupId: "t2" }, as("comp"))).id);
    }
    await expect(
      call(challengeRouter.create, { ...input, groupId: "t2" }, as("comp")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await call(challengeRouter.remove, { challengeId: ids[0]! }, as("comp"));
    await call(challengeRouter.create, { ...input, groupId: "t2" }, as("comp"));
  });

  test("a Founder without a profile cannot host a protein challenge", async () => {
    await expect(
      call(challengeRouter.create, { groupId: "t1", goal: "protein", target: null, durationDays: 7 }, as("bare")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("profil") });
  });
});

describe("steps: leaderboard, streaks, joining", () => {
  test("ranks by hit days, judges today on what is already reached", async () => {
    await seed("c-steps", "t1", "steps", 8000, 3, [{ userId: "comp" }, { userId: "free" }]);
    await Promise.all([
      steps("comp", 3, 9000),
      steps("comp", 2, 9000),
      steps("comp", 1, 5000),
      steps("comp", 0, 9000),
      steps("free", 3, 9000),
      steps("free", 2, 1000),
      steps("free", 1, 9000),
    ]);

    const out = await detail("free", "c-steps");
    const [first, second] = out.leaderboard;
    expect(first).toMatchObject({
      userId: "comp",
      rank: 1,
      hitDays: 3,
      missDays: 1,
      streak: 1,
      bestStreak: 2,
      judgedDays: 4,
      totalDays: 7,
      todayStatus: "hit",
      todayValue: 9000,
      isMe: false,
    });
    expect(first?.hitsByBasis).toEqual({ device: 3, photo: 0, manual: 0 });
    expect(second).toMatchObject({
      userId: "free",
      rank: 2,
      hitDays: 2,
      missDays: 1,
      streak: 1,
      bestStreak: 1,
      judgedDays: 3,
      todayStatus: "pending",
      isMe: true,
    });
    expect(out.share).toMatchObject({ rank: 2, participants: 2, hitDays: 2, judgedDays: 3 });
    expect(out.challenge.dayNumber).toBe(4);
    expect(out.challenge.daysLeft).toBe(3);
    // Steps are device data: values are shared on the board.
    expect(first?.days.map((d) => d.value)).toEqual([9000, 9000, 5000, 9000]);
  });

  test("a late joiner is counted from the join day, free users can join", async () => {
    await call(challengeRouter.join, { challengeId: "c-steps" }, as("bare"));
    await call(challengeRouter.join, { challengeId: "c-steps" }, as("bare"));
    const out = await detail("bare", "c-steps");
    const bare = out.leaderboard.find((e) => e.userId === "bare");
    expect(bare).toMatchObject({ fromDate: today, rank: 3, hitDays: 0, judgedDays: 0, totalDays: 4 });
    expect(out.leaderboard).toHaveLength(3);
  });

  test("outsiders see nothing and cannot join", async () => {
    await expect(detail("out", "c-steps")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(challengeRouter.join, { challengeId: "c-steps" }, as("out")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("an ended challenge cannot be joined but still shows its result", async () => {
    await seed("c-old", "t1", "steps", 8000, 10, [{ userId: "comp" }], 7);
    await steps("comp", 9, 9000);
    await expect(
      call(challengeRouter.join, { challengeId: "c-old" }, as("free")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const out = await detail("comp", "c-old");
    expect(out.challenge).toMatchObject({ status: "ended", daysLeft: 0, dayNumber: 7 });
    expect(out.canJoin).toBe(false);
    expect(out.leaderboard[0]).toMatchObject({ hitDays: 1, judgedDays: 7, missDays: 6 });
  });

  test("list shows my progress, participants and canHost per tier", async () => {
    const free = await call(challengeRouter.list, { groupId: "t1" }, as("free"));
    expect(free.canHost).toBe(false);
    const steps_ = free.challenges.find((c) => c.id === "c-steps");
    expect(steps_).toMatchObject({ joined: true, participants: 3, hitDays: 2, judgedDays: 3, creatorName: "Comp" });
    expect(free.challenges.find((c) => c.id === "c-old")?.status).toBe("ended");
    const comp = await call(challengeRouter.list, { groupId: "t1" }, as("comp"));
    expect(comp.canHost).toBe(true);
    await expect(call(challengeRouter.list, { groupId: "t1" }, as("out"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("protein and calories: personal targets and honest labels", () => {
  test("joining snapshots the member's own protein target", async () => {
    const { id } = await call(
      challengeRouter.create,
      { groupId: "t1", goal: "protein", target: null, durationDays: 7 },
      as("comp"),
    );
    await call(challengeRouter.join, { challengeId: id }, as("free"));
    // 80 kg man, 170 cm: 1.5 g/kg of min(80, healthy top 72) = 108 g.
    const mine = await detail("free", id);
    expect(mine.me).toMatchObject({ joined: true, target: 108 });
    expect(mine.challenge).toMatchObject({ target: null, rule: "Penuhi target protein harianmu" });
    // A member without a profile cannot take part in a personal-target goal.
    await expect(
      call(challengeRouter.join, { challengeId: id }, as("bare")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("profil") });
    await call(challengeRouter.remove, { challengeId: id }, as("comp"));
  });

  test("manual vs photo entries are labelled, and diary numbers stay private", async () => {
    await seed("c-protein", "t1", "protein", null, 2, [
      { userId: "comp", target: 108 },
      { userId: "free", target: 108 },
    ]);
    await Promise.all([
      food("comp", 2, 1, 600, 120, "manual"),
      food("free", 2, 1, 400, 60, "ai"),
      food("free", 2, 2, 400, 60, "ai"),
      food("comp", 1, 1, 500, 50, "manual"),
      food("free", 1, 1, 500, 30, "ai"),
      food("free", 1, 2, 500, 90, "manual"),
    ]);

    const asFree = await detail("free", "c-protein");
    const comp = asFree.leaderboard.find((e) => e.userId === "comp")!;
    const free = asFree.leaderboard.find((e) => e.userId === "free")!;
    // d-2: comp 120 g typed (manual hit), free 120 g all scanned (photo hit).
    expect(comp.days[0]).toMatchObject({ status: "hit", basis: "manual", value: null });
    expect(free.days[0]).toMatchObject({ status: "hit", basis: "photo", value: 120 });
    // d-1: comp 50 g miss; free 120 g but a typed entry makes it manual.
    expect(comp.days[1]).toMatchObject({ status: "miss", value: null });
    expect(free.days[1]).toMatchObject({ status: "hit", basis: "manual", value: 120 });
    expect(free.target).toBe(108);
    expect(comp.target).toBeNull();
    expect(free.hitsByBasis).toEqual({ device: 0, photo: 1, manual: 1 });
    // Today nothing is logged yet: pending, never a miss.
    expect(free.todayStatus).toBe("pending");

    const asComp = await detail("comp", "c-protein");
    expect(asComp.leaderboard.find((e) => e.userId === "comp")?.days[0]?.value).toBe(120);
  });

  test("calories: within target hits, over misses, today stays pending", async () => {
    await seed("c-cal", "t1", "calories", null, 2, [{ userId: "comp", target: 2000 }]);
    await Promise.all([
      // Entries add up per day: the protein test already logged 600 kcal on d-2 and 500 on d-1.
      food("comp", 2, 9, 1000, 0, "manual"),
      food("comp", 1, 9, 2000, 0, "manual"),
      food("comp", 0, 9, 1500, 0, "manual"),
    ]);
    const me = (await detail("comp", "c-cal")).leaderboard[0]!;
    expect(me.days.map((d) => d.status)).toEqual(["hit", "miss", "pending"]);
    expect(me).toMatchObject({ hitDays: 1, missDays: 1, judgedDays: 2 });
  });
});

describe("workouts, strain and sleep", () => {
  test("workouts label device sessions and typed ones, and ignore rest and Strava days", async () => {
    await seed("c-work", "t1", "workouts", 1, 2, [{ userId: "comp" }]);
    await Promise.all([
      workout("comp", 2, 1, "health_connect"),
      workout("comp", 1, 1, "manual"),
      workout("comp", 0, 1, "rest"),
      // Strava API policy: Strava activities never count in a challenge.
      workout("comp", 1, 2, "strava"),
    ]);
    const me = (await detail("comp", "c-work")).leaderboard[0]!;
    expect(me.days.map((d) => [d.status, d.basis])).toEqual([
      ["hit", "device"],
      ["hit", "manual"],
      ["pending", null],
    ]);
    expect(me.hitsByBasis).toEqual({ device: 1, photo: 0, manual: 1 });
  });

  test("a JoyoFit strength row is a verified device session", async () => {
    await seed("c-work-fit", "t1", "workouts", 1, 2, [{ userId: "free" }]);
    await Promise.all([workout("free", 2, 1, "joyofit"), workout("free", 1, 1, "manual")]);
    const me = (await detail("free", "c-work-fit")).leaderboard[0]!;
    expect(me.days.map((d) => [d.status, d.basis])).toEqual([
      ["hit", "device"],
      ["hit", "manual"],
      ["pending", null],
    ]);
  });

  test("strain and sleep read the JoyoFit scores", async () => {
    await seed("c-strain", "t1", "strain", 10, 2, [{ userId: "comp" }]);
    await seed("c-sleep", "t1", "sleep", 90, 2, [{ userId: "comp" }, { userId: "free" }]);
    await Promise.all([fit("comp", 2, 12, 95), fit("comp", 1, 9, null), fit("free", 2, null, 80)]);

    const strain = (await detail("comp", "c-strain")).leaderboard[0]!;
    expect(strain.days.map((d) => [d.status, d.value])).toEqual([
      ["hit", 12],
      ["miss", 9],
      ["pending", null],
    ]);
    expect(strain.days[0]?.basis).toBe("device");

    const sleep = (await detail("comp", "c-sleep")).leaderboard;
    expect(sleep.find((e) => e.userId === "comp")?.days[0]).toMatchObject({ status: "hit", value: 95 });
    expect(sleep.find((e) => e.userId === "free")?.days[0]).toMatchObject({ status: "miss", value: 80 });
  });

  test("a device goal with no synced data explains what to connect", async () => {
    await seed("c-hint", "t1", "strain", 10, 1, [{ userId: "free" }]);
    const out = await detail("free", "c-hint");
    expect(out.me.deviceHint).toContain("JoyoFit");
  });
});

describe("leaving, deleting, cleanup", () => {
  test("only the host or the team owner can delete a challenge", async () => {
    const { id } = await call(
      challengeRouter.create,
      { groupId: "t3", goal: "steps", target: 8000, durationDays: 7 },
      as("comp"),
    );
    await call(challengeRouter.join, { challengeId: id }, as("free"));
    const asFree = await detail("free", id);
    expect(asFree.challenge.canDelete).toBe(true); // owner of t3
    await expect(
      call(challengeRouter.remove, { challengeId: "c-steps" }, as("free")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await call(challengeRouter.remove, { challengeId: id }, as("free"));
    await expect(detail("comp", id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("leaving a challenge removes the member's row only", async () => {
    await call(challengeRouter.leave, { challengeId: "c-steps" }, as("bare"));
    const out = await detail("comp", "c-steps");
    expect(out.leaderboard.map((e) => e.userId).sort()).toEqual(["comp", "free"]);
  });

  test("leaving the team drops the member from its challenges", async () => {
    await call(groupRouter.leave, { groupId: "t1" }, as("free"));
    const out = await detail("comp", "c-steps");
    expect(out.leaderboard.map((e) => e.userId)).toEqual(["comp"]);
    const rows = (await client.execute(`SELECT user_id FROM team_challenge_member WHERE user_id = 'free' AND challenge_id IN (SELECT id FROM team_challenge WHERE team_id = 't1')`)).rows;
    expect(rows).toHaveLength(0);
  });

  test("the owner removing a member also drops their challenge rows", async () => {
    await client.execute(`INSERT INTO team_member (team_id, user_id, role) VALUES ('t1', 'free', 'member')`);
    await call(challengeRouter.join, { challengeId: "c-steps" }, as("free"));
    await call(groupRouter.removeMember, { groupId: "t1", userId: "free" }, as("comp"));
    const out = await detail("comp", "c-steps");
    expect(out.leaderboard.map((e) => e.userId)).toEqual(["comp"]);
  });

  test("deleting the team cascades its challenges", async () => {
    await client.execute(`PRAGMA foreign_keys = ON`);
    await client.execute(`DELETE FROM team WHERE id = 't1'`);
    const rows = (await client.execute(`SELECT id FROM team_challenge WHERE team_id = 't1'`)).rows;
    expect(rows).toHaveLength(0);
  });
});
