import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { jakartaToday, shiftDate } from "../lib/engine";
import { dayRouter } from "./day";
import { profileRouter } from "./profile";
import { syncRouter } from "./sync";

// COMPAT: clients already in the field (native builds up to 1932 until they update, web tabs opened before the deploy)
// talk to the new server. These tests pin what they still send and read:
//  - onboarding sends the old activity levels low / mid / high;
//  - Targets.assumedKcal (0) and Targets.formulaTdee (= tdee), ExerciseCredit.assumedKcal (0) and
//    day.summary.addBackNotice (false) are still present;
//  - the preferences the old builds write (exercise.assumedActive, dismissed.addBackNotice2) sync without error and
//    change nothing.

const { client, db } = await d1TestDb();

const today = jakartaToday();
const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ('lo', 'lo', 'lo@test.id', 'free', ${old}),
    ('mid', 'mid', 'mid@test.id', 'free', ${old}),
    ('hi', 'hi', 'hi@test.id', 'free', ${old}),
    ('new', 'new', 'new@test.id', 'free', ${old}),
    ('bad', 'bad', 'bad@test.id', 'free', ${old}),
    ('mom', 'mom', 'mom@test.id', 'free', ${old}),
    ('prefs', 'prefs', 'prefs@test.id', 'free', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('prefs', 1990, 'male', 170, 160, 150, '2031-01-01', 'light');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, maternal_mode, pregnancy_lmp, pregnancy_date_kind, pre_pregnancy_weight_kg)
    VALUES ('mom', 1995, 'female', 160, 60, 60, '2031-01-01', 'moderate', 'pregnant', '${shiftDate(today, -150)}', 'hpht', 60);
`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId, createdAt: new Date(old) } } } as unknown as Context,
});

const body = (activityLevel: string) =>
  ({
    birthYear: 1990,
    gender: "male",
    heightCm: 170,
    weightKg: 160,
    targetWeightKg: 150,
    targetDate: shiftDate(today, 400),
    activityLevel,
  }) as never;

const storedLevel = async (userId: string) =>
  (await client.execute({ sql: `SELECT activity_level AS l FROM profile WHERE user_id = ?`, args: [userId] })).rows[0]?.l;

describe("old onboarding sends low / mid / high", () => {
  test.each([
    ["lo", "low", "sedentary", 1.2],
    ["mid", "mid", "light", 1.375],
    ["hi", "high", "moderate", 1.55],
  ] as const)("%s: '%s' is stored as %s and the target uses its factor", async (user, sent, stored, factor) => {
    const out = await call(profileRouter.upsert, body(sent), as(user));
    expect(await storedLevel(user)).toBe(stored);
    expect(out.targets).toMatchObject({ level: stored, factor });
  });

  test("the new levels are accepted too, anything else is refused and nothing is stored", async () => {
    await call(profileRouter.upsert, body("very_active"), as("new"));
    expect(await storedLevel("new")).toBe("very_active");
    await expect(call(profileRouter.upsert, body("couch"), as("bad"))).rejects.toThrow();
    expect(await storedLevel("bad")).toBeUndefined();
  });

  test("the new setter stays strict: only the new levels", async () => {
    await expect(call(profileRouter.setActivityLevel, { level: "mid" } as never, as("new"))).rejects.toThrow();
  });
});

describe("old clients still read these fields", () => {
  test("Targets carries assumedKcal 0 and formulaTdee = tdee, from upsert, myProfile and day.summary", async () => {
    const upsert = await call(profileRouter.upsert, body("mid"), as("mid"));
    const mine = await call(profileRouter.myProfile, undefined, as("mid"));
    const summary = await call(dayRouter.summary, { date: today }, as("mid"));
    for (const targets of [upsert.targets, mine.targets!, summary.targets!]) {
      expect(targets.assumedKcal).toBe(0);
      expect(targets.formulaTdee).toBe(targets.tdee);
      expect(targets.notes).not.toContain("ADAPTIVE" as never);
    }
  });

  test("Hamil / Menyusui targets carry them too", async () => {
    const mom = (await call(dayRouter.summary, { date: today }, as("mom"))).targets!;
    expect(mom.maternal).not.toBeNull();
    expect(mom.assumedKcal).toBe(0);
    expect(mom.formulaTdee).toBe(mom.tdee);
  });

  test("the exercise credit carries assumedKcal 0 and every field the old Beranda read", async () => {
    const { exerciseCredit } = await call(dayRouter.summary, { date: today }, as("mid"));
    expect(exerciseCredit).toMatchObject({
      enabled: true,
      pct: 75,
      cap: 1000,
      allDayKcal: null,
      allDaySource: null,
      deviceWorkoutKcal: 0,
      otherWorkoutKcal: 0,
      activeKcal: 0,
      assumedKcal: 0,
      countedKcal: 0,
      capped: false,
    });
  });

  test("day.summary.addBackNotice is false (the retired card), also without a profile; the new notice is separate", async () => {
    const summary = await call(dayRouter.summary, { date: today }, as("mid"));
    expect(summary.addBackNotice).toBe(false);
    expect(summary.energyNotice).not.toBeNull();
    const bare = await call(dayRouter.summary, { date: today }, as("bad"));
    expect(bare.hasProfile).toBe(false);
    expect(bare.addBackNotice).toBe(false);
  });
});

describe("old builds write exercise.assumedActive and dismissed.addBackNotice2", () => {
  const record = (id: string, value: unknown) => ({
    kind: "pref" as const,
    id,
    json: JSON.stringify({ value }),
    updatedAt: Date.now(),
    deletedAt: null,
    rank: 0,
  });

  test("the push is accepted, and neither record changes the day's budget or the notice", async () => {
    const before = await call(dayRouter.summary, { date: today }, as("prefs"));
    const out = await call(
      syncRouter.push,
      {
        ns: "rogo",
        clientNow: Date.now(),
        records: [record("exercise.assumedActive", 300), record("dismissed.addBackNotice2", true), record("dismissed.addBackNotice", true)],
      },
      as("prefs"),
    );
    expect(out.status).toBe("ok");
    expect(out).toMatchObject({ rejected: [] });
    const after = await call(dayRouter.summary, { date: today }, as("prefs"));
    expect(after.targets!.eatKcal).toBe(before.targets!.eatKcal);
    expect(after.exerciseCredit).toEqual(before.exerciseCredit);
    // the old card's dismissal does not hide the new notice
    expect(after.energyNotice).not.toBeNull();
  });
});
