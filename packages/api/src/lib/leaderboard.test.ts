import { asc, eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import { leaderboardWeek } from "@joyorogo/db/schema/badges";

import { shiftDate } from "./engine";
import { computeWeek, currentWeekStart } from "./leaderboard";
import { pushTestDb, seedUser } from "./push-test-db";

const { client, db } = await pushTestDb();
const at = (date: string, time = "12:00", offset = "+07:00") => Date.parse(`${date}T${time}:00${offset}`);
const WEEK = "2026-11-09";
// Thursday of that week, midday WIB: Monday to Thursday count so far.
const NOW = new Date(at("2026-11-12"));
const ENV = { BADGES_USER_IDS: "*" };

async function join(userId: string, opts: { alias?: string; optIn?: boolean; maternal?: string } = {}) {
  await seedUser(client, userId, { maternal: opts.maternal });
  await client.execute({
    sql: `INSERT INTO leaderboard_pref (user_id, opt_in, display_mode, alias) VALUES (?, ?, 'anonim', ?)`,
    args: [userId, opts.optIn === false ? 0 : 1, opts.alias ?? null],
  });
}
async function log(userId: string, days: string[], extra: { protein?: number } = {}) {
  for (const date of days) {
    await client.execute({
      sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, created_at) VALUES (?, ?, ?, 'sarapan', 'Nasi', 300, ?, ?)`,
      args: [crypto.randomUUID(), userId, date, extra.protein ?? null, at(date)],
    });
  }
}
const days = (n: number) => Array.from({ length: n }, (_, i) => shiftDate(WEEK, i));
const board = async () => db.select().from(leaderboardWeek).where(eq(leaderboardWeek.weekStart, WEEK)).orderBy(asc(leaderboardWeek.rankGlobal));

describe("computeWeek", () => {
  test("the current week is the Monday in WIB", () => {
    expect(currentWeekStart(NOW)).toBe(WEEK);
    // Sunday 23:30 UTC is already Monday in WIB
    expect(currentWeekStart(new Date(Date.parse("2026-11-15T17:30:00Z")))).toBe("2026-11-16");
  });

  test("ranks by days logged, then workout days, then protein days; ties split by alias", async () => {
    await join("a", { alias: "zed" });
    await join("b", { alias: "abe" });
    await join("c", { alias: "mid" });
    await join("d", { alias: "top" });
    await log("a", days(3));
    await log("b", days(3));
    await log("c", days(3), { protein: 150 });
    await log("d", days(4));
    const report = await computeWeek(db, ENV, WEEK, NOW);
    expect(report).toEqual({ optedIn: 4, ranked: 4, removed: 0 });
    // d: 4 days; c: 3 days with protein; b and a tie on everything but the alias.
    expect((await board()).map((r) => `${r.rankGlobal}:${r.userId}`)).toEqual(["1:d", "2:c", "3:b", "4:a"]);
    const [first] = await board();
    expect(first).toMatchObject({ daysLogged: 4, daysMask: 0b1111 });
  });

  test("recomputing is idempotent and follows new logs", async () => {
    await log("a", [shiftDate(WEEK, 3)]);
    await computeWeek(db, ENV, WEEK, NOW);
    await computeWeek(db, ENV, WEEK, NOW);
    const rows = await board();
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.userId === "a")?.daysLogged).toBe(4);
  });

  test("people in maternal mode, opted out, not allowed or with nothing logged are not on the board", async () => {
    await join("mom", { maternal: "pregnant" });
    await join("out", { optIn: false });
    await join("idle");
    await log("mom", days(5));
    await log("out", days(5));
    await computeWeek(db, ENV, WEEK, NOW);
    expect((await board()).map((r) => r.userId).sort()).toEqual(["a", "b", "c", "d"]);
    // The allowlist is the flag: nobody allowed = an empty board, and old rows go.
    const report = await computeWeek(db, { BADGES_USER_IDS: "d" }, WEEK, NOW);
    expect(report.ranked).toBe(1);
    expect((await board()).map((r) => r.userId)).toEqual(["d"]);
  });

  test("a person who becomes maternal or opts out is removed on the next run", async () => {
    await computeWeek(db, ENV, WEEK, NOW);
    expect((await board()).length).toBe(4);
    await client.execute(`UPDATE profile SET maternal_mode = 'breastfeeding' WHERE user_id = 'c'`);
    await client.execute(`UPDATE leaderboard_pref SET opt_in = 0 WHERE user_id = 'b'`);
    const report = await computeWeek(db, ENV, WEEK, NOW);
    expect(report.removed).toBe(2);
    expect((await board()).map((r) => r.userId).sort()).toEqual(["a", "d"]);
  });

  test("more opted-in people than D1 binds in one statement (130) are ranked in chunks", async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `lb${String(i).padStart(3, "0")}`);
    const sql = ids.flatMap((id, i) => {
      const n = (i % 4) + 1;
      return [
        `INSERT INTO "user" (id, name, email, tier) VALUES ('${id}', '${id}', '${id}@t.id', 'free')`,
        `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES ('${id}', 1990, 'male', 170, 80, 72, '2030-01-01', 'light')`,
        `INSERT INTO leaderboard_pref (user_id, opt_in, display_mode) VALUES ('${id}', 1, 'anonim')`,
        ...days(n).map((d, j) => `INSERT INTO food_log (id, user_id, date, meal, name, kcal, created_at) VALUES ('${id}-${j}', '${id}', '${d}', 'sarapan', 'Nasi', 300, ${at(d)})`),
      ];
    });
    await client.executeMultiple(sql.join(";\n"));
    const report = await computeWeek(db, ENV, WEEK, NOW);
    expect(report.ranked).toBe(132); // the 130 and the two left from the test before (a, d)
    const rows = await board();
    expect(rows.map((r) => r.rankGlobal)).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
    expect(rows[0]?.daysLogged).toBe(4);
  });
});
