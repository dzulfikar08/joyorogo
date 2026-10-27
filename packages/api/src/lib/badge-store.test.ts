import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import { badgeAward } from "@joyorogo/db/schema/badges";

import { awardAfterFood, awardOnWrite, awardUsers, loadBadgeFacts, loadLoggedDays } from "./badge-store";
import { isLoggedFood } from "./badges";
import { shiftDate } from "./engine";
import { deleteAllUserData } from "./privacy";
import { pushTestDb, seedUser } from "./push-test-db";

const { client, db } = await pushTestDb();
const at = (date: string, time = "12:00", offset = "+07:00") => Date.parse(`${date}T${time}:00${offset}`);
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));
const NOW = new Date(at("2026-11-10"));
const TODAY = "2026-11-10";

async function food(userId: string, date: string, opts: { kcal?: number; source?: string; createdAtMs?: number; protein?: number | null } = {}) {
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, source, created_at) VALUES (?, ?, ?, 'sarapan', 'Nasi', ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), userId, date, opts.kcal ?? 300, opts.protein ?? null, opts.source ?? "manual", opts.createdAtMs ?? at(date)],
  });
}
const awardsOf = async (userId: string) =>
  (await db.select().from(badgeAward).where(eq(badgeAward.userId, userId))).map((a) => `${a.badgeId}:${a.tier}`).sort();

describe("logged-day SQL matches isLoggedFood", () => {
  const created = (date: string, c: { delta: number; klMidnight?: boolean }) =>
    c.klMidnight ? at(date, "00:30", "+08:00") : at(shiftDate(date, c.delta));
  test("every case, in both zones", async () => {
    await seedUser(client, "wib");
    await seedUser(client, "kl", { timezone: "Asia/Kuala_Lumpur" });
    const cases: Array<{ name: string; kcal: number; source: string; delta: number; klMidnight?: boolean }> = [
      { name: "same day", kcal: 300, source: "manual", delta: 0 },
      { name: "no kcal", kcal: 0, source: "manual", delta: 0 },
      { name: "import", kcal: 300, source: "huawei", delta: 0 },
      { name: "2 days late", kcal: 300, source: "ai", delta: 2 },
      { name: "3 days late", kcal: 300, source: "manual", delta: 3 },
      { name: "future date", kcal: 300, source: "manual", delta: -1 },
      { name: "kl midnight", kcal: 300, source: "manual", delta: 0, klMidnight: true },
    ];
    for (const userId of ["wib", "kl"]) {
      for (const [i, c] of cases.entries()) {
        const date = shiftDate("2026-11-01", i);
        await food(userId, date, { kcal: c.kcal, source: c.source, createdAtMs: created(date, c) });
      }
    }
    for (const [userId, zone] of [["wib", "Asia/Jakarta"], ["kl", "Asia/Kuala_Lumpur"]] as const) {
      const found = new Set((await loadLoggedDays(db, [userId], "2026-10-01", "2026-12-01")).map((r) => r.date));
      for (const [i, c] of cases.entries()) {
        const date = shiftDate("2026-11-01", i);
        const expected = isLoggedFood({ date, kcal: c.kcal, source: c.source, createdAtMs: created(date, c) }, zone);
        expect({ zone, case: c.name, logged: found.has(date) }).toEqual({ zone, case: c.name, logged: expected });
      }
    }
    // The case that tells the zones apart: logged for Kuala Lumpur, a future day for Jakarta.
    const klDay = (await loadLoggedDays(db, ["kl"], "2026-11-07", "2026-11-07")).length;
    const wibDay = (await loadLoggedDays(db, ["wib"], "2026-11-07", "2026-11-07")).length;
    expect([klDay, wibDay]).toEqual([1, 0]);
  });
});

describe("awards", () => {
  test("a full Monday to Sunday week earns the first entry, the 7-day streak and the perfect week, once", async () => {
    await seedUser(client, "week");
    for (const d of run("2026-11-02", 7)) await food("week", d);
    expect(await awardUsers(db, ["week"], TODAY, NOW)).toEqual({ users: 1, awarded: 3 });
    expect(await awardsOf("week")).toEqual(["catatan-pertama:1", "konsisten:1", "minggu-sempurna:1"]);
    // Idempotent: a second run, and the write path, add nothing and never move the first award date.
    expect(await awardUsers(db, ["week"], TODAY, new Date(NOW.getTime() + 86_400_000))).toEqual({ users: 1, awarded: 0 });
    await awardOnWrite(db, { BADGES_USER_IDS: "week" }, "week", "catatan-pertama");
    expect(await awardsOf("week")).toHaveLength(3);
    const [first] = await db.select().from(badgeAward).where(and(eq(badgeAward.userId, "week"), eq(badgeAward.badgeId, "konsisten")));
    expect(first?.awardedAt.getTime()).toBe(NOW.getTime());
  });

  test("a 30-day streak earns tiers 1 and 2, and a lapse later never takes them back", async () => {
    await seedUser(client, "long");
    for (const d of run("2026-10-01", 30)) await food("long", d);
    await awardUsers(db, ["long"], TODAY, NOW);
    expect((await awardsOf("long")).filter((a) => a.startsWith("konsisten"))).toEqual(["konsisten:1", "konsisten:2"]);
    await client.execute(`DELETE FROM food_log WHERE user_id = 'long'`);
    await awardUsers(db, ["long"], TODAY, NOW);
    expect((await awardsOf("long")).filter((a) => a.startsWith("konsisten"))).toHaveLength(2);
  });

  test("imports, empty entries and week-old backdating are not logged days, so they earn nothing", async () => {
    await seedUser(client, "cheat");
    for (const d of run("2026-10-01", 20)) await food("cheat", d, { source: "huawei" });
    for (const d of run("2026-10-21", 10)) await food("cheat", d, { kcal: 0 });
    for (const d of run("2026-09-01", 10)) await food("cheat", d, { createdAtMs: at(TODAY) });
    await awardUsers(db, ["cheat"], TODAY, NOW);
    expect(await awardsOf("cheat")).toEqual([]);
  });

  test("weigh-ins never count", async () => {
    await seedUser(client, "weigher");
    for (const d of run("2026-10-01", 30)) {
      await client.execute({ sql: `INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES (?, 'weigher', ?, 80)`, args: [crypto.randomUUID(), d] });
    }
    await awardUsers(db, ["weigher"], TODAY, NOW);
    expect(await awardsOf("weigher")).toEqual([]);
  });

  test("workout days count only for device or JoyoFit rows", async () => {
    await seedUser(client, "mover");
    const exercise = (date: string, source: string) =>
      client.execute({ sql: `INSERT INTO exercise_log (id, user_id, date, name, kcal, source, external_id) VALUES (?, 'mover', ?, 'Lari', 100, ?, ?)`, args: [crypto.randomUUID(), date, source, source === "manual" ? null : `${source}:${date}`] });
    for (const d of run("2026-10-01", 5)) await exercise(d, "manual");
    for (const d of run("2026-10-10", 3)) await exercise(d, "strava");
    for (const d of run("2026-10-20", 10)) await exercise(d, "health_connect");
    const facts = (await loadBadgeFacts(db, ["mover"], TODAY)).get("mover");
    expect(facts?.workoutDays).toBe(10);
    await awardUsers(db, ["mover"], TODAY, NOW);
    expect(await awardsOf("mover")).toEqual(["latihan-10:1", "latihan-pertama:1"]);
  });

  test("water counts days at 8 glasses", async () => {
    await seedUser(client, "drinker");
    for (const [i, d] of run("2026-10-01", 12).entries()) {
      await client.execute({ sql: `INSERT INTO water_log (user_id, date, glasses) VALUES ('drinker', ?, ?)`, args: [d, i < 7 ? 8 : 7] });
    }
    await awardUsers(db, ["drinker"], TODAY, NOW);
    expect(await awardsOf("drinker")).toEqual(["air-putih:1"]);
  });

  test("protein days compare the day's protein with the goal; Hamil and Menyusui have none", async () => {
    await seedUser(client, "lifter");
    await seedUser(client, "bumil", { maternal: "pregnant" });
    // height 170, weight 80: 1.5 g/kg of min(80, 71) = 107 g
    for (const u of ["lifter", "bumil"]) for (const d of run("2026-10-01", 10)) await food(u, d, { protein: 110 });
    await food("lifter", "2026-10-20", { protein: 50 });
    const [lifter, bumil] = [(await loadBadgeFacts(db, ["lifter"], TODAY)).get("lifter"), (await loadBadgeFacts(db, ["bumil"], TODAY)).get("bumil")];
    expect(lifter?.proteinDays).toBe(10);
    expect(bumil?.proteinDays).toBe(0);
  });

  test("Ramadan: decided after the window closes, for people who turned Ramadan mode on or fast", async () => {
    await seedUser(client, "puasa", { ramadan: "on" });
    await seedUser(client, "iseng"); // ramadan off, no fasting pattern
    for (const u of ["puasa", "iseng"]) for (const d of run("2027-02-08", 20)) await food(u, d);
    const lastDay = "2027-03-09";
    expect((await loadBadgeFacts(db, ["puasa"], lastDay)).get("puasa")?.ramadanDays).toBe(0);
    expect((await loadBadgeFacts(db, ["puasa"], "2027-03-10")).get("puasa")?.ramadanDays).toBe(20);
    expect((await loadBadgeFacts(db, ["iseng"], "2027-03-10")).get("iseng")?.ramadanDays).toBe(0);
    await awardUsers(db, ["puasa", "iseng"], "2027-03-10", new Date(at("2027-03-10")));
    expect((await awardsOf("puasa")).filter((a) => a.startsWith("ramadan"))).toEqual(["ramadan-konsisten:1"]);
    expect((await awardsOf("iseng")).filter((a) => a.startsWith("ramadan"))).toEqual([]);
  });

  test("team footprint: 7 logged days after joining a team", async () => {
    await seedUser(client, "owner");
    await seedUser(client, "joiner");
    await client.execute(`INSERT INTO team (id, name, invite_code, owner_id) VALUES ('t1', 'Tim', 'ABCD2345', 'owner')`);
    await client.execute({ sql: `INSERT INTO team_member (team_id, user_id, role, joined_at) VALUES ('t1', 'joiner', 'member', ?)`, args: [at("2026-11-01")] });
    for (const d of run("2026-10-25", 14)) await food("joiner", d); // 25..07 Nov: 7 days from the 1st
    expect((await loadBadgeFacts(db, ["joiner"], TODAY)).get("joiner")?.teamDays).toBe(7);
    await awardUsers(db, ["joiner"], TODAY, NOW);
    expect((await awardsOf("joiner")).filter((a) => a.startsWith("jejak"))).toEqual(["jejak-tim:1"]);
  });

  test("finished a challenge: stayed to the end and logged on at least half of the days", async () => {
    await seedUser(client, "owner2");
    await seedUser(client, "stayer");
    await seedUser(client, "ghost");
    await client.execute(`INSERT INTO team (id, name, invite_code, owner_id) VALUES ('t2', 'Tim2', 'EFGH2345', 'owner2')`);
    await client.execute(`INSERT INTO team_challenge (id, team_id, title, goal, duration_days, start_date, end_date) VALUES ('c1', 't2', 'Catat', 'protein', 7, '2026-11-01', '2026-11-07')`);
    for (const u of ["stayer", "ghost"]) await client.execute({ sql: `INSERT INTO team_challenge_member (challenge_id, user_id, from_date) VALUES ('c1', ?, '2026-11-01')`, args: [u] });
    for (const d of run("2026-11-01", 5)) await food("stayer", d);
    await food("ghost", "2026-11-02");
    await awardUsers(db, ["stayer", "ghost"], TODAY, NOW);
    expect((await awardsOf("stayer")).filter((a) => a.startsWith("tantangan"))).toEqual(["tantangan-selesai:1"]);
    expect((await awardsOf("ghost")).filter((a) => a.startsWith("tantangan"))).toEqual([]);
  });

  test("more users than D1 binds in one statement are evaluated in chunks", async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `bulk${i}`);
    const statements = ids.flatMap((id) => [
      `INSERT INTO "user" (id, name, email, tier) VALUES ('${id}', '${id}', '${id}@t.id', 'free')`,
      `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES ('${id}', 1990, 'male', 170, 80, 72, '2030-01-01', 'light')`,
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal, created_at) VALUES ('f-${id}', '${id}', '2026-11-03', 'sarapan', 'Nasi', 300, ${at("2026-11-03")})`,
    ]);
    await client.executeMultiple(statements.join(";\n"));
    const result = await awardUsers(db, ids, TODAY, NOW);
    expect(result).toEqual({ users: 130, awarded: 130 });
  });
});

describe("write path", () => {
  test("only allowlisted users are awarded at write time", async () => {
    await seedUser(client, "on");
    await seedUser(client, "off");
    const env = { BADGES_USER_IDS: "on" };
    await awardOnWrite(db, env, "on", "pemindai-pertama");
    await awardOnWrite(db, env, "off", "pemindai-pertama");
    expect(await awardsOf("on")).toEqual(["pemindai-pertama:1"]);
    expect(await awardsOf("off")).toEqual([]);
  });

  test("a saved meal that is a logged day earns the first entry; an AI scan also earns the scanner badge", async () => {
    await seedUser(client, "first");
    const env = { BADGES_USER_IDS: "first" };
    const zone = async () => "Asia/Jakarta" as const;
    await awardAfterFood(db, env, "first", zone, [{ date: "2026-11-10", kcal: 0, source: "manual", createdAt: NOW }]);
    expect(await awardsOf("first")).toEqual([]);
    await awardAfterFood(db, env, "first", zone, [{ date: "2026-11-10", kcal: 300, source: "ai", createdAt: NOW }]);
    expect(await awardsOf("first")).toEqual(["catatan-pertama:1", "pemindai-pertama:1"]);
  });
});

describe("privacy", () => {
  test("deleting the account data removes badges, the leaderboard choice and every weekly row", async () => {
    await seedUser(client, "wipe");
    await client.executeMultiple(`
      INSERT INTO badge_award (user_id, badge_id, tier) VALUES ('wipe', 'konsisten', 1);
      INSERT INTO leaderboard_pref (user_id, opt_in, display_mode, alias) VALUES ('wipe', 1, 'anonim', 'wipeme');
      INSERT INTO leaderboard_week (week_start, user_id, days_logged, protein_hit_days, workout_days, streak_end, rank_global, computed_at)
        VALUES ('2026-11-02', 'wipe', 5, 1, 1, 5, 1, 1), ('2026-11-09', 'wipe', 2, 0, 0, 2, 3, 1);
    `);
    await deleteAllUserData(db, "wipe");
    for (const table of ["badge_award", "leaderboard_pref", "leaderboard_week"]) {
      expect((await client.execute(`SELECT count(*) AS n FROM ${table} WHERE user_id = 'wipe'`)).rows[0]?.n).toBe(0);
    }
  });
});
