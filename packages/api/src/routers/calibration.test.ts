import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { getProfileView } from "../lib/fit-data";
import { jakartaToday, shiftDate } from "../lib/engine";
import { weekStartOf } from "../lib/recap";
import { dayRouter } from "./day";
import { diaryRouter } from "./diary";
import { profileRouter } from "./profile";
import { statsRouter } from "./stats";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

// The automatic calibration end to end through the routers: every consumer of the plan builds it from `planQueries`
// (history window and the calibration preferences), so they all see the same target. The numbers of the calibration
// itself are pinned in lib/calibration.test.ts.

const { client, db } = await d1TestDb();

const today = jakartaToday();
const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;

// Everybody has the same body and the same 34 days of logs (steady 90 kg, 2800 kcal a day), except where noted.
const USERS = ["on", "off", "bare", "mom", "gone"] as const;
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ${USERS.map((id) => `('${id}', '${id}', '${id}@test.id', 'free', ${old})`).join(",\n    ")};
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 175, 90, 80, '${shiftDate(today, 3000)}', 'light' FROM "user" WHERE id <> 'mom';
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, maternal_mode, pregnancy_lmp, pregnancy_date_kind, pre_pregnancy_weight_kg)
    VALUES ('mom', 1995, 'female', 160, 60, 60, '${shiftDate(today, 3000)}', 'moderate', 'pregnant', '${shiftDate(today, -100)}', 'hpht', 60);
`);

const seed = (userId: string, days: number, weighSpan: number) => {
  const rows: string[] = [];
  for (let i = 1; i <= days; i += 1) {
    rows.push(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source) VALUES ('f-${userId}-${i}', '${userId}', '${shiftDate(today, -i)}', 'makan_siang', 'x', 2800, 'manual');`,
    );
  }
  for (let i = 1; i <= weighSpan + 1; i += 3) {
    rows.push(
      `INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-${userId}-${i}', '${userId}', '${shiftDate(today, -i)}', 90);`,
    );
  }
  return client.executeMultiple(rows.join("\n"));
};
for (const id of ["on", "off", "mom", "gone"]) await seed(id, 34, 60);
await seed("bare", 8, 12);

await client.execute({
  sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES ('off', 'rogo', 'pref', 'energy.calibration', ?, 1, NULL, 0, 1)`,
  args: [JSON.stringify({ value: false })],
});
// a tombstoned switch is the default (on)
await client.execute({
  sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES ('gone', 'rogo', 'pref', 'energy.calibration', ?, 1, 5, 0, 1)`,
  args: [JSON.stringify({ value: false })],
});

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId, createdAt: new Date(old) } } } as unknown as Context,
});
const summary = (userId: string) => call(dayRouter.summary, { date: today }, as(userId));

describe("day.summary", () => {
  test("on by default: the target is built on the measured TDEE, the formula is kept beside it", async () => {
    const { targets, calibrationNotice } = await summary("on");
    expect(targets!.calibration).toMatchObject({ enabled: true, status: "active", measuredKcal: expect.any(Number) });
    expect(targets!.calibration!.usedKcal).toBe(targets!.tdee);
    expect(targets!.calibration!.formulaKcal).toBeLessThan(targets!.tdee);
    expect(targets!.formulaTdee).toBe(targets!.tdee);
    expect(targets!.assumedKcal).toBe(0);
    // nothing was acknowledged yet, and the base moved by well over 50 kcal from the formula target
    expect(calibrationNotice).toMatchObject({ toKcal: targets!.eatKcal - targets!.exerciseKcal });
    expect(calibrationNotice!.fromKcal).toBeLessThan(calibrationNotice!.toKcal);
  });

  test("off: the pure formula for the very same logs, and no notice", async () => {
    const on = await summary("on");
    const off = await summary("off");
    expect(off.targets!.calibration).toMatchObject({ enabled: false, status: "off", usedKcal: null });
    expect(off.targets!.calibration!.measuredKcal).toBe(on.targets!.calibration!.measuredKcal);
    expect(off.targets!.tdee).toBe(off.targets!.calibration!.formulaKcal);
    expect(off.targets!.eatKcal).toBeLessThan(on.targets!.eatKcal);
    expect(off.calibrationNotice).toBeNull();
  });

  test("a tombstoned switch is the default, on", async () => {
    expect((await summary("gone")).targets!.calibration!.status).toBe("active");
  });

  test("too little data: formula, with the progress to show", async () => {
    const { targets, calibrationNotice } = await summary("bare");
    expect(targets!.calibration).toMatchObject({ status: "collecting", loggedDays: 8, spanDaysNeeded: 21, loggedDaysNeeded: 20 });
    expect(targets!.tdee).toBe(targets!.calibration!.formulaKcal);
    expect(calibrationNotice).toBeNull();
  });

  test("Hamil / Menyusui: untouched, and no calibration block", async () => {
    const { targets, calibrationNotice } = await summary("mom");
    expect(targets!.maternal).not.toBeNull();
    expect(targets!.calibration ?? null).toBeNull();
    expect(calibrationNotice).toBeNull();
  });

  test("the movement the budget already holds follows the calibrated TDEE", async () => {
    const on = (await summary("on")).targets!;
    const off = (await summary("off")).targets!;
    expect(on.includedKcal).toBeGreaterThan(off.includedKcal);
  });
});

describe("every consumer sees the same plan", () => {
  test("myProfile, the diary month, the weekly recap and the MCP profile view agree with day.summary", async () => {
    const day = (await summary("on")).targets!;
    const mine = (await call(profileRouter.myProfile, undefined, as("on"))).targets!;
    expect(mine.eatKcal).toBe(day.eatKcal - day.exerciseKcal);
    expect(mine.calibration).toEqual(day.calibration);

    const month = await call(diaryRouter.monthTotals, { month: today.slice(0, 7), kind: "semua" }, as("on"));
    expect(month.targetKcal).toBe(mine.eatKcal);

    const recap = await call(statsRouter.weekRecap, { weekStart: weekStartOf(today) }, as("on"));
    expect(recap?.targetKcal).toBe(mine.eatKcal);

    const view = await getProfileView(db, "on", DEFAULT_DAY_ZONE, today);
    expect(view.dailyTargets?.eatKcal).toBe(mine.eatKcal);
    expect(view.dailyTargets?.tdeeKcal).toBe(mine.tdee);

    const offMine = (await call(profileRouter.myProfile, undefined, as("off"))).targets!;
    const offView = await getProfileView(db, "off", DEFAULT_DAY_ZONE, today);
    expect(offView.dailyTargets?.eatKcal).toBe(offMine.eatKcal);
    expect(offMine.eatKcal).toBeLessThan(mine.eatKcal);
  });
});

describe("profile.activityGuide", () => {
  test("on: the calibration state, and no level suggestion from the trend (it is superseded)", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("on"));
    expect(guide.autoCalibration).toMatchObject({ enabled: true, status: "active" });
    expect(guide.calibration).toBeNull();
  });

  test("off: the suggestion card stays, beside the off state with the measured number", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("off"));
    expect(guide.autoCalibration).toMatchObject({ enabled: false, status: "off" });
    expect(guide.calibration).toMatchObject({ measuredKcal: expect.any(Number), level: expect.any(String) });
  });

  test("Hamil / Menyusui: neither", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("mom"));
    expect(guide.autoCalibration).toBeNull();
    expect(guide.calibration).toBeNull();
  });
});

describe("an old client's view of the payload", () => {
  test("every field it read before is still there with the same meaning; the new ones are additive", async () => {
    const { targets } = await summary("on");
    for (const key of ["bmr", "level", "factor", "tdee", "formulaTdee", "assumedKcal", "includedKcal", "eatKcal", "exerciseKcal", "burnKcal"]) {
      expect(targets).toHaveProperty(key);
    }
    expect(targets!.level).toBe("light");
    expect(targets!.factor).toBe(1.375);
  });
});
