import { describe, expect, test } from "bun:test";

import { backfillBadges, runBadgesCron } from "./badge-cron";
import { shiftDate } from "./engine";
import { pushTestDb, seedUser } from "./push-test-db";

const { client, db } = await pushTestDb();
const at = (date: string, time = "12:00") => new Date(`${date}T${time}:00+07:00`);
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

await seedUser(client, "u1");
await seedUser(client, "u2");
for (const d of run("2026-11-02", 7)) {
  await client.execute({ sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, created_at) VALUES (?, 'u1', ?, 'sarapan', 'Nasi', 300, ?)`, args: [crypto.randomUUID(), d, at(d).getTime()] });
}
await client.execute(`INSERT INTO leaderboard_pref (user_id, opt_in) VALUES ('u1', 1)`);
const count = async (table: string) => Number((await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

describe("runBadgesCron", () => {
  test("does nothing while the flag is empty", async () => {
    const report = await runBadgesCron({ db, env: {}, now: () => at("2026-11-10", "00:10") });
    expect(report).toEqual({ nightly: null, board: false, closedWeek: false });
    expect(await count("badge_award")).toBe(0);
  });

  test("a midday tick off the half hour does nothing", async () => {
    const report = await runBadgesCron({ db, env: { BADGES_USER_IDS: "u1" }, now: () => at("2026-11-10", "12:12") });
    expect(report).toEqual({ nightly: null, board: false, closedWeek: false });
  });

  test("the night tick awards allowlisted users only, and a repeat adds nothing", async () => {
    const env = { BADGES_USER_IDS: "u1" };
    const first = await runBadgesCron({ db, env, now: () => at("2026-11-10", "00:12") });
    expect(first.nightly).toEqual({ users: 1, awarded: 3 });
    const again = await runBadgesCron({ db, env, now: () => at("2026-11-10", "00:12") });
    expect(again.nightly).toEqual({ users: 1, awarded: 0 });
  });

  test("the half-hour tick writes the running week's board; Monday 00:30 also closes last week", async () => {
    const env = { BADGES_USER_IDS: "*" };
    // Monday 2026-11-09 00:30 WIB: last week (11-02) was a full week for u1.
    const report = await runBadgesCron({ db, env, now: () => at("2026-11-09", "00:31") });
    expect(report).toMatchObject({ board: true, closedWeek: true });
    const rows = (await client.execute(`SELECT week_start, days_logged FROM leaderboard_week WHERE user_id = 'u1'`)).rows;
    expect(rows).toEqual([expect.objectContaining({ week_start: "2026-11-02", days_logged: 7 })]);
  });
});

describe("backfillBadges", () => {
  test("pages through users in id order, only allowlisted ones", async () => {
    await client.execute(`DELETE FROM badge_award`);
    const env = { BADGES_USER_IDS: "u1,u2" };
    const a = await backfillBadges(db, env, { limit: 1, now: at("2026-11-10") });
    expect(a).toEqual({ processed: 1, awarded: 3, next: "u1" });
    const b = await backfillBadges(db, env, { limit: 1, after: a.next, now: at("2026-11-10") });
    expect(b).toEqual({ processed: 1, awarded: 0, next: "u2" });
    const c = await backfillBadges(db, env, { limit: 1, after: b.next, now: at("2026-11-10") });
    expect(c).toEqual({ processed: 0, awarded: 0, next: null });
  });
});
