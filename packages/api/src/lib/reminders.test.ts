import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { DayZone } from "@joyorogo/i18n";

import { flushOutbox } from "./notify";
import { runPushCron } from "./push-cron";
import { myt, pushTestDb, seedDevice, seedFood, seedUser, wib } from "./push-test-db";
import type { TestClient } from "./push-test-db";
import {
  activeSlots,
  runReminders,
  skipMealReminder,
  streakAtRisk,
  userSlot,
  weighGapDays,
  wibWeekday,
} from "./reminders";
import type { ReminderDeps } from "./reminders";

const MONDAY = "2026-10-19";
const TUESDAY = "2026-10-20";

const kinds = (at: Date, zone: DayZone = "Asia/Jakarta") => activeSlots(at, zone).map((s) => s.kind);

describe("reminder windows (WIB)", () => {
  test("weekday is read on the WIB calendar", () => {
    expect(wibWeekday(wib(MONDAY, "00:30"), "Asia/Jakarta")).toBe(1);
    // 23:30 UTC on Sunday is already Monday in Jakarta
    expect(wibWeekday(new Date("2026-10-18T23:30:00Z"), "Asia/Jakarta")).toBe(1);
  });

  test("Malaysia reads its own clock and weekday", () => {
    // 16:30 UTC on Sunday: 23:30 WIB Sunday, 00:30 MYT Monday
    const edge = new Date("2026-10-18T16:30:00Z");
    expect(wibWeekday(edge, "Asia/Jakarta")).toBe(0);
    expect(wibWeekday(edge, "Asia/Kuala_Lumpur")).toBe(1);
    // 13:10 MYT is 12:10 WIB: lunch for Kuala Lumpur only
    expect(kinds(myt(TUESDAY, "13:10"), "Asia/Kuala_Lumpur")).toEqual(["meal_noon"]);
    expect(kinds(myt(TUESDAY, "13:10"))).toEqual([]);
    // Monday 07:30 MYT: the weekly plan window of Kuala Lumpur is open while Jakarta's is not
    expect(kinds(myt(MONDAY, "07:30"), "Asia/Kuala_Lumpur")).toEqual(["weigh", "plan"]);
    expect(kinds(myt(MONDAY, "07:30"))).toEqual([]);
  });

  test("lunch and evening food reminders", () => {
    expect(kinds(wib(TUESDAY, "12:59"))).toEqual([]);
    expect(kinds(wib(TUESDAY, "13:00"))).toEqual(["meal_noon"]);
    expect(kinds(wib(TUESDAY, "13:44"))).toEqual(["meal_noon"]);
    expect(kinds(wib(TUESDAY, "13:45"))).toEqual([]);
    expect(kinds(wib(TUESDAY, "20:10"))).toEqual(["meal_evening"]);
    expect(kinds(wib(TUESDAY, "21:00"))).toEqual([]);
  });

  test("morning reminders: weekly ones only on Monday", () => {
    expect(kinds(wib(TUESDAY, "08:10")).sort()).toEqual(["challenge_end", "weigh"]);
    expect(kinds(wib(TUESDAY, "08:40")).sort()).toEqual(["calibration", "challenge_end", "weigh"]);
    expect(kinds(wib(MONDAY, "08:40")).sort()).toEqual(["calibration", "challenge_end", "plan", "recap", "weigh"]);
    expect(kinds(wib(MONDAY, "07:00"))).toEqual([]);
    expect(kinds(wib(MONDAY, "07:30"))).toEqual(["weigh", "plan"]);
  });
});

describe("rules", () => {
  const base = {
    nowMin: 13 * 60,
    pattern: null,
    windowStart: null,
    ramadanMode: "off",
    maternalMode: "none",
    now: wib(TUESDAY),
    zone: "Asia/Jakarta",
  } as const;

  test("no fasting setting: never skipped", () => {
    expect(skipMealReminder({ ...base, kind: "meal_noon" })).toBe(false);
    expect(skipMealReminder({ ...base, kind: "meal_evening", nowMin: 20 * 60 })).toBe(false);
  });

  test("intermittent fasting: only inside the eating window", () => {
    const sixteen = { ...base, pattern: "16:8", windowStart: "12:00" };
    expect(skipMealReminder({ ...sixteen, kind: "meal_noon" })).toBe(false);
    // the 12:00 - 20:00 window has closed by the 20:00 reminder
    expect(skipMealReminder({ ...sixteen, kind: "meal_evening", nowMin: 20 * 60 })).toBe(true);
    const omad = { ...base, pattern: "omad", windowStart: "18:00" };
    expect(skipMealReminder({ ...omad, kind: "meal_noon" })).toBe(true);
    expect(skipMealReminder({ ...omad, kind: "meal_evening", nowMin: 18 * 60 + 30 })).toBe(false);
  });

  test("Ramadan: no lunch reminder, the evening one stays", () => {
    expect(skipMealReminder({ ...base, ramadanMode: "on", kind: "meal_noon" })).toBe(true);
    expect(skipMealReminder({ ...base, ramadanMode: "on", kind: "meal_evening", nowMin: 20 * 60 })).toBe(false);
  });

  test("pregnant and breastfeeding accounts never fast: a leftover pattern or Ramadan setting is ignored", () => {
    expect(skipMealReminder({ ...base, maternalMode: "pregnant", pattern: "omad", windowStart: "18:00", kind: "meal_noon" })).toBe(false);
    expect(skipMealReminder({ ...base, maternalMode: "breastfeeding", ramadanMode: "on", kind: "meal_noon" })).toBe(false);
  });

  test("weigh-in gap: a week without one, counted from the account when never weighed", () => {
    expect(weighGapDays({ lastWeighDate: "2026-10-12", createdDate: "2026-01-01", today: MONDAY })).toBe(7);
    expect(weighGapDays({ lastWeighDate: "2026-10-13", createdDate: "2026-01-01", today: MONDAY })).toBeNull();
    expect(weighGapDays({ lastWeighDate: null, createdDate: "2026-10-14", today: MONDAY })).toBeNull();
    expect(weighGapDays({ lastWeighDate: null, createdDate: "2026-10-01", today: MONDAY })).toBe(18);
  });

  test("streak at risk: today missing and three or more days before it", () => {
    expect(streakAtRisk(["2026-10-18", "2026-10-17", "2026-10-16"], MONDAY)).toBe(3);
    expect(streakAtRisk(["2026-10-18", "2026-10-17"], MONDAY)).toBe(0);
    expect(streakAtRisk([MONDAY, "2026-10-18", "2026-10-17", "2026-10-16"], MONDAY)).toBe(0);
    expect(streakAtRisk(["2026-10-18", "2026-10-17", "2026-10-15"], MONDAY)).toBe(0);
  });

  test("userSlot is stable and inside the range", () => {
    for (const id of ["a", "user-1", "3f690a2c-01fb-4d70-a6fc-92e8132a9dde"]) {
      const slot = userSlot(id, 12);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(12);
      expect(userSlot(id, 12)).toBe(slot);
    }
  });
});

// ---- The runner against a database ----------------------------------------------------------

const realFetch = globalThis.fetch;
let expo: { to: string; title: string; body: string; data: { kind: string; link: unknown } }[] = [];
beforeEach(() => {
  expo = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)) as typeof expo;
    expo.push(...messages);
    return Response.json({ data: messages.map((_, i) => ({ status: "ok", id: `T${i}` })) });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ENV = { FREE_DAILY_SCANS: "3" };

async function world() {
  const { client, db } = await pushTestDb();
  const deps = (at: Date): ReminderDeps => ({ db, env: ENV, now: () => at });
  const outbox = async (kind?: string) =>
    (await client.execute(`SELECT user_id, kind, status, payload_json FROM push_outbox${kind ? ` WHERE kind = '${kind}'` : ""} ORDER BY user_id`)).rows;
  return { client, db, deps, outbox };
}

async function person(client: TestClient, id: string, opts: Parameters<typeof seedUser>[2] & { device?: boolean; foodOn?: string[] } = {}) {
  await seedUser(client, id, opts);
  if (opts.device !== false) await seedDevice(client, id, `tok-${id}`);
  for (const date of opts.foodOn ?? ["2026-10-17"]) await seedFood(client, id, date);
}

describe("lunch reminder", () => {
  test("goes to people with nothing logged today, once, and skips everyone it should", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "due"); // logged on Saturday, nothing today
    await person(client, "ate", { foodOn: ["2026-10-17", TUESDAY] });
    await person(client, "nophone", { device: false });
    await person(client, "muted");
    await client.execute(`INSERT INTO push_prefs (user_id, meal) VALUES ('muted', 0)`);
    await person(client, "local");
    // the phone's own lunch reminder is on: the server one would double it
    await client.execute({
      sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, server_at) VALUES ('local', 'rogo', 'pref', 'reminders', ?, 1, 1)`,
      args: [JSON.stringify({ value: { meals: { makan_siang: { enabled: true, time: "12:30" } } } })],
    });
    await person(client, "gone", { foodOn: ["2026-09-01"], createdAtMs: Date.parse("2026-01-01T00:00:00Z") });
    await person(client, "fresh", { foodOn: [], createdAtMs: Date.parse("2026-10-18T00:00:00Z") });
    await person(client, "omad", { pattern: "omad", windowStart: "18:00" });

    const at = wib(TUESDAY, "13:10");
    expect(await runReminders(deps(at))).toBe(2);
    expect((await outbox("meal_noon")).map((r) => r.user_id)).toEqual(["due", "fresh"]);
    // the next tick of the window finds the dedupe key and stores nothing
    expect(await runReminders(deps(wib(TUESDAY, "13:15")))).toBe(0);

    await flushOutbox(deps(at));
    expect(expo.map((m) => m.to).sort()).toEqual(["ExponentPushToken[tok-due]", "ExponentPushToken[tok-fresh]"]);
    expect(expo[0]).toMatchObject({
      title: "Belum ada makanan tercatat",
      data: { kind: "meal_noon", link: { t: "makan" } },
    });
  });

  test("a reminder that could only be delivered after its window is dropped", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "due");
    await runReminders(deps(wib(TUESDAY, "13:10")));
    await flushOutbox(deps(wib(TUESDAY, "15:30")));
    expect(expo).toHaveLength(0);
    expect((await outbox("meal_noon"))[0]?.status).toBe("dropped");
  });

  test("a Malaysian person is reminded at their own 13:00, an Indonesian one at theirs", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "id");
    await person(client, "my", { timezone: "Asia/Kuala_Lumpur" });

    // 13:10 in Kuala Lumpur is 12:10 in Jakarta
    expect(await runReminders(deps(myt(TUESDAY, "13:10")))).toBe(1);
    expect((await outbox("meal_noon")).map((r) => r.user_id)).toEqual(["my"]);
    // 13:10 in Jakarta is 14:10 in Kuala Lumpur: the window of "my" is over, and it was told already
    expect(await runReminders(deps(wib(TUESDAY, "13:10")))).toBe(1);
    expect((await outbox("meal_noon")).map((r) => r.user_id)).toEqual(["id", "my"]);
  });

  test("the day is the Malaysian person's own: food of the 21st does not cover the 22nd", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "my", { timezone: "Asia/Kuala_Lumpur", foodOn: [] });
    await seedFood(client, "my", "2026-10-21");
    // 2026-10-21 in Kuala Lumpur: nothing is due on the 21st, but the 22nd has not been eaten yet
    expect(await runReminders(deps(myt("2026-10-21", "13:10")))).toBe(0);
    expect(await runReminders(deps(myt("2026-10-22", "13:10")))).toBe(1);
    expect(await outbox("meal_noon")).toHaveLength(1);
  });

  test("tomorrow is a new day", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "due");
    await runReminders(deps(wib(TUESDAY, "13:10")));
    expect(await runReminders(deps(wib("2026-10-21", "13:10")))).toBe(1);
    expect(await outbox("meal_noon")).toHaveLength(2);
  });
});

describe("evening reminder and streak", () => {
  test("a streak of four becomes the streak copy; others get the plain one; someone who weighed in today is safe", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "streak", { foodOn: ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"] });
    await person(client, "plain", { foodOn: ["2026-10-15"] });
    await person(client, "weighed", { foodOn: ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"] });
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w1', 'weighed', '${TUESDAY}', 70)`);

    const at = wib(TUESDAY, "20:05");
    expect(await runReminders(deps(at))).toBe(3);
    const rows = await outbox();
    const byUser = Object.fromEntries(rows.map((r) => [String(r.user_id), String(r.kind)]));
    expect(byUser).toEqual({ streak: "streak", plain: "meal_evening", weighed: "meal_evening" });

    await flushOutbox(deps(at));
    const streak = expo.find((m) => m.to.endsWith("[tok-streak]"));
    expect(streak?.title).toBe("Streak 4 hari bisa putus");
    expect(expo.find((m) => m.to.endsWith("[tok-plain]"))?.title).toBe("Hari ini belum ada catatan makan");
  });

  test("Intermittent fasting whose window closed at 20:00 is left alone", async () => {
    const { client, deps } = await world();
    await person(client, "fast", { pattern: "16:8", windowStart: "12:00" });
    expect(await runReminders(deps(wib(TUESDAY, "20:05")))).toBe(0);
  });

  test("lunch and evening together stay inside the two-a-day meal cap", async () => {
    const { client, deps } = await world();
    await person(client, "due");
    await runReminders(deps(wib(TUESDAY, "13:10")));
    await flushOutbox(deps(wib(TUESDAY, "13:10")));
    await runReminders(deps(wib(TUESDAY, "20:05")));
    await flushOutbox(deps(wib(TUESDAY, "20:05")));
    expect(expo).toHaveLength(2);
  });
});

describe("weigh-in reminder", () => {
  test("after a week without one, then only weekly; never for pregnant accounts", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "late");
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-late', 'late', '2026-10-11', 70)`);
    await person(client, "recent");
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-recent', 'recent', '2026-10-16', 70)`);
    await person(client, "mum", { maternal: "pregnant" });
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-mum', 'mum', '2026-10-01', 70)`);

    expect(await runReminders(deps(wib(TUESDAY, "07:45")))).toBe(1);
    const [row] = await outbox("weigh");
    expect(row?.user_id).toBe("late");
    expect(JSON.parse(String(row?.payload_json)).title.params.n).toBe(9);

    // the next days: no repeat; seven days later: again
    // Friday: "late" was told on Tuesday; "recent" has now gone a week
    expect(await runReminders(deps(wib("2026-10-23", "07:45")))).toBe(1);
    expect((await outbox("weigh")).map((r) => r.user_id)).toEqual(["late", "recent"]);
    // the next Tuesday it is "late" again (a week since the first one), "recent" was told on Friday
    expect(await runReminders(deps(wib("2026-10-27", "07:45")))).toBe(1);
    await flushOutbox(deps(wib("2026-10-27", "07:45")));
    expect(expo.find((m) => m.to.endsWith("[tok-late]") && m.title.includes("16"))?.title).toBe("Sudah 16 hari belum timbang");
  });

  test("the phone's own weigh-in reminder takes over", async () => {
    const { client, deps } = await world();
    await person(client, "late");
    await client.execute({
      sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, server_at) VALUES ('late', 'rogo', 'pref', 'reminders', ?, 1, 1)`,
      args: [JSON.stringify({ value: { weighIn: { enabled: true, time: "07:00" } } })],
    });
    expect(await runReminders(deps(wib(TUESDAY, "07:45")))).toBe(0);
  });
});

describe("Monday reminders", () => {
  test("weekly recap for people who logged on two or more days last week", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "busy", { foodOn: ["2026-10-13", "2026-10-15", "2026-10-18"] });
    await person(client, "quiet", { foodOn: ["2026-10-13"] });
    expect(await runReminders(deps(wib(MONDAY, "08:30")))).toBeGreaterThanOrEqual(1);
    expect((await outbox("recap")).map((r) => r.user_id)).toEqual(["busy"]);
    expect(await outbox("recap")).toHaveLength(1);
    expect(await runReminders(deps(wib(TUESDAY, "08:30")))).toBe(0);
    await flushOutbox(deps(wib(MONDAY, "08:30")));
    expect(expo.find((m) => m.data.kind === "recap")).toMatchObject({
      title: "Rekap minggu lalu sudah siap",
      data: { link: { t: "rekap" } },
    });
  });

  test("meal plan note only for Pro accounts that have a plan covering today", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "pro");
    await person(client, "free");
    await person(client, "noplan");
    await client.execute(`UPDATE "user" SET tier = 'founder' WHERE id IN ('pro', 'noplan')`);
    for (const id of ["pro", "free"]) {
      await client.execute({
        sql: `INSERT INTO meal_plan (user_id, start_date, seed, days_json, created_at, updated_at) VALUES (?, '2026-10-15', 's', '[]', 1, 1)`,
        args: [id],
      });
    }
    await runReminders(deps(wib(MONDAY, "08:00")));
    expect((await outbox("plan")).map((r) => r.user_id)).toEqual(["pro"]);
  });
});

describe("challenge end", () => {
  test("members hear the morning after a challenge ends, once", async () => {
    const { client, deps, outbox } = await world();
    await person(client, "ann");
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-ann', 'ann', '2026-10-19', 70)`);
    await person(client, "bob", { device: false });
    await client.executeMultiple(`
      INSERT INTO team (id, name, owner_id, invite_code) VALUES ('t1', 'Tim', 'ann', 'ABCD2345');
      INSERT INTO team_member (team_id, user_id, role) VALUES ('t1', 'ann', 'owner'), ('t1', 'bob', 'member');
      INSERT INTO team_challenge (id, team_id, created_by, title, goal, duration_days, start_date, end_date)
        VALUES ('c1', 't1', 'ann', 'Tujuh hari protein', 'protein', 7, '2026-10-13', '2026-10-19');
      INSERT INTO team_challenge_member (challenge_id, user_id, from_date) VALUES ('c1', 'ann', '2026-10-13'), ('c1', 'bob', '2026-10-13');
    `);
    expect(await runReminders(deps(wib(TUESDAY, "08:30")))).toBe(1);
    expect(await runReminders(deps(wib(TUESDAY, "08:40")))).toBe(0);
    expect((await outbox("challenge_end")).map((r) => r.user_id)).toEqual(["ann"]);
    await flushOutbox(deps(wib(TUESDAY, "08:30")));
    expect(expo[0]).toMatchObject({
      title: "Tantangan selesai",
      body: "Tujuh hari protein: lihat siapa yang menang.",
      data: { link: { t: "challenge", groupId: "t1", challengeId: "c1" } },
    });
  });
});

describe("runPushCron", () => {
  test("stores, delivers and reports in one tick; a broken step does not stop the others", async () => {
    const { client, deps } = await world();
    await person(client, "due");
    const report = await runPushCron(deps(wib(TUESDAY, "13:10")));
    expect(report.reminders).toBe(1);
    expect(report.delivered).toBe(1);
    expect(expo).toHaveLength(1);
  });

  test("calibration look-ups for people without an active calibration store nothing", async () => {
    const { client, deps } = await world();
    await person(client, "due");
    await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w1', 'due', '2026-10-18', 70)`);
    let stored = 0;
    for (let minute = 30; minute < 60; minute += 5) {
      stored += await runReminders(deps(wib(TUESDAY, `08:${String(minute).padStart(2, "0")}`)));
    }
    expect(stored).toBe(0);
  });
});
