// D1 binds at most 100 parameters per statement; d1TestDb's client throws like D1 does. These feed the real routers
// worst-case sized input: a person in many groups, a group at its member cap, a mark-read with hundreds of ids.
import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { challengeRouter } from "./challenge";
import { groupRouter } from "./group";
import { socialRouter } from "./social";

const { client, db } = await d1TestDb();

const MEMBER_CAP = 20;
const MANY_GROUPS = 130;
const MANY_IDS = 250;

const members = Array.from({ length: MEMBER_CAP }, (_, i) => `u${i}`);
const groupIds = Array.from({ length: MANY_GROUPS }, (_, i) => `g${i}`);

const today = jakartaToday();
const day = (back: number) => shiftDate(today, -back);

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ${members.map((id) => `('${id}', 'User ${id}', '${id}@test.id', 'founder')`).join(",\n    ")};
  INSERT INTO team (id, name, invite_code, owner_id) VALUES
    ('big', 'Tim Penuh', 'BIGBIGBI', 'u0'),
    ${groupIds.map((id, i) => `('${id}', 'Tim ${id}', 'C${String(i).padStart(7, "0")}', 'u0')`).join(",\n    ")};
  INSERT INTO team_member (team_id, user_id, role) VALUES
    ${members.map((id, i) => `('big', '${id}', '${i === 0 ? "owner" : "member"}')`).join(",\n    ")},
    ${groupIds.map((id) => `('${id}', 'u0', 'member')`).join(",\n    ")},
    ${groupIds.filter((_, i) => i % 2 === 1).map((id) => `('${id}', 'u1', 'member')`).join(",\n    ")};
`);

const as = (userId: string) => ({
  context: {
    db,
    env: { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" },
    locale: "id",
    waitUntil: () => {},
    session: { user: { id: userId } },
  } as unknown as Context,
});

describe("group", () => {
  test("list: a person in more groups than D1 binds ids still gets every group with its member count", async () => {
    const out = await call(groupRouter.list, undefined, as("u0"));
    expect(out).toHaveLength(MANY_GROUPS + 1);
    const byId = new Map(out.map((g) => [g.id, g.memberCount]));
    expect(byId.get("big")).toBe(MEMBER_CAP);
    expect(byId.get("g0")).toBe(1);
    expect(byId.get("g1")).toBe(2);
    expect(byId.get(`g${MANY_GROUPS - 1}`)).toBe(2);
  });

  test("detail: a group at its member cap loads every member's day", async () => {
    const out = await call(groupRouter.detail, { groupId: "big" }, as("u0"));
    expect(out.members).toHaveLength(MEMBER_CAP);
  });

  test("activity: a group at its member cap", async () => {
    await call(groupRouter.activity, { groupId: "big", limit: 50 }, as("u0"));
  });

  test("markRead: hundreds of ids mark all of the caller's nudges and nobody else's", async () => {
    const ids = Array.from({ length: MANY_IDS }, (_, i) => `nudge-${i}`);
    await client.executeMultiple(`
      INSERT INTO team_nudge (id, team_id, from_user_id, to_user_id, kind, created_at) VALUES
        ${ids.map((id) => `('${id}', 'big', 'u1', 'u0', 'poke', 1)`).join(",\n        ")},
        ('theirs', 'big', 'u1', 'u2', 'poke', 1);
    `);
    await call(groupRouter.markRead, { ids: [...ids, "theirs"] }, as("u0"));
    const read = await client.execute(`SELECT to_user_id AS who, count(*) AS n FROM team_nudge WHERE read_at IS NOT NULL GROUP BY to_user_id`);
    expect(read.rows.map((r) => [r.who, Number(r.n)])).toEqual([["u0", MANY_IDS]]);
    expect(await call(groupRouter.unreadCount, undefined, as("u2"))).toEqual({ count: 1 });
  });
});

describe("social", () => {
  test("notificationsMarkRead: hundreds of ids mark all of the caller's notifications and nobody else's", async () => {
    const ids = Array.from({ length: MANY_IDS }, (_, i) => `note-${i}`);
    await client.executeMultiple(`
      INSERT INTO social_notification (id, user_id, actor_id, kind, created_at) VALUES
        ${ids.map((id) => `('${id}', 'u0', 'u1', 'follow', 1)`).join(",\n        ")},
        ('note-theirs', 'u2', 'u1', 'follow', 1);
    `);
    await call(socialRouter.notificationsMarkRead, { ids: [...ids, "note-theirs"] }, as("u0"));
    const read = await client.execute(`SELECT user_id AS who, count(*) AS n FROM social_notification WHERE read_at IS NOT NULL GROUP BY user_id`);
    expect(read.rows.map((r) => [r.who, Number(r.n)])).toEqual([["u0", MANY_IDS]]);
  });
});

describe("challenge", () => {
  const seed = (id: string, goal: string, startBack: number, durationDays: number) =>
    client.execute({
      sql: `INSERT INTO team_challenge (id, team_id, created_by, title, goal, target, duration_days, start_date, end_date)
            VALUES (?, 'big', 'u0', ?, ?, ?, ?, ?, ?)`,
      args: [id, `Tantangan ${id}`, goal, 100, durationDays, day(startBack), shiftDate(day(startBack), durationDays - 1)],
    });
  const joinAll = (id: string) =>
    client.executeMultiple(
      `INSERT INTO team_challenge_member (challenge_id, user_id, from_date, target) VALUES
        ${members.map((m) => `('${id}', '${m}', '${day(3)}', NULL)`).join(",\n        ")};`,
    );

  test("detail: every member of a full group is judged on every goal that reads by user id", async () => {
    for (const goal of ["steps", "protein", "workouts", "strain"]) {
      await seed(`c-${goal}`, goal, 3, 7);
      await joinAll(`c-${goal}`);
      const out = await call(challengeRouter.detail, { challengeId: `c-${goal}` }, as("u0"));
      expect(out.leaderboard).toHaveLength(MEMBER_CAP);
    }
  });

  test("list: the most open plus ended challenges are all shown", async () => {
    for (let i = 0; i < 10; i++) await seed(`ended-${i}`, "steps", 20 + i, 3);
    const out = await call(challengeRouter.list, { groupId: "big" }, as("u0"));
    // c-steps/c-protein/c-workouts/c-strain are open (seeded above, 4 > MAX_OPEN is fine for a seeded row) + 10 ended
    expect(out.challenges.length).toBe(14);
  });
});
