import { call } from "@orpc/server";
import { afterEach, expect, setSystemTime, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { jakartaToday, shiftDate } from "../lib/engine";
import { weekStartOf } from "../lib/recap";
import { activityRouter } from "./activity";
import { dayRouter } from "./day";
import { statsRouter } from "./stats";

// The weekly recap judges each day against the budget Beranda showed for it (base plus that day's activity), not the
// bare base: a day with a workout was reported "over" while Beranda said there was room left.

const { client, db } = await d1TestDb();

const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('u', 'u', 'u@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('u', 1990, 'male', 170, 108, 90, '2031-01-01', 'light');
`);

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('my', 'my', 'my@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, timezone)
    VALUES ('my', 1990, 'male', 170, 108, 90, '2031-01-01', 'light', 'Asia/Kuala_Lumpur');
`);

const as = {
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "u", createdAt: new Date(old) } } } as unknown as Context,
};

test("a day with all-day activity is judged against the same budget day.summary gives it", async () => {
  const day = shiftDate(jakartaToday(), -1);
  const quiet = shiftDate(day, -1);
  await call(activityRouter.upsert, { date: day, steps: 9000, distanceMeters: 6000, activeCalories: 1400, exerciseMinutes: 60, source: "health_connect" }, as);

  const recap = await call(statsRouter.weekRecap, { weekStart: weekStartOf(day) }, as);
  const busy = await call(dayRouter.summary, { date: day }, as);
  const recapDay = recap!.days.find((d) => d.date === day)!;
  expect(recapDay.targetKcal).toBe(Math.round(busy.targets!.eatKcal));
  expect(recapDay.targetKcal).toBeGreaterThan(recap!.days.find((d) => d.date === quiet)?.targetKcal ?? 0);
});

afterEach(() => setSystemTime());

test("the week a person is shown starts on their own Monday: Sunday 23:30 in Jakarta is already Monday in Kuala Lumpur", async () => {
  // 16:30 UTC on Sunday 2026-10-18: 23:30 WIB (still Sunday), 00:30 MYT (Monday 2026-10-19)
  setSystemTime(new Date("2026-10-18T16:30:00Z"));
  const forUser = (id: string) => ({
    context: { db, env: {}, waitUntil: () => {}, session: { user: { id, createdAt: new Date(old) } } } as unknown as Context,
  });

  const indonesian = await call(statsRouter.weekRecap, {}, forUser("u"));
  const malaysian = await call(statsRouter.weekRecap, {}, forUser("my"));
  expect(indonesian!.weekStart).toBe("2026-10-12");
  expect(malaysian!.weekStart).toBe("2026-10-19");
  expect(indonesian!.weekEnd).toBe("2026-10-18");
  expect(malaysian!.weekEnd).toBe("2026-10-25");
});

test("a month recap covers the whole calendar month, judges every past day and reads the month's weight change", async () => {
  setSystemTime(new Date("2026-11-02T05:00:00Z"));
  for (const [date, kg] of [["2026-10-01", 100], ["2026-10-15", 99], ["2026-10-31", 98]] as const) {
    await client.execute({ sql: `INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES (?, 'u', ?, ?)`, args: [crypto.randomUUID(), date, kg] });
  }
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, created_at) VALUES (?, 'u', '2026-10-31', 'sarapan', 'Nasi', 1800, 90, 0), (?, 'u', '2026-11-01', 'sarapan', 'Nasi', 1800, 90, 0)`,
    args: [crypto.randomUUID(), crypto.randomUUID()],
  });

  const october = await call(statsRouter.monthRecap, { month: "2026-10" }, as);
  expect(october!.weekStart).toBe("2026-10-01");
  expect(october!.weekEnd).toBe("2026-10-31");
  expect(october!.days).toHaveLength(31);
  expect(october!.evaluatedDays).toBe(31);
  expect(october!.loggedDays).toBe(1);
  expect(october!.weight!.changeKg).toBeLessThan(0);

  // A future month resolves to this one, judged up to yesterday only.
  const later = await call(statsRouter.monthRecap, { month: "2027-02" }, as);
  expect(later!.weekStart).toBe("2026-11-01");
  expect(later!.days).toHaveLength(30);
  expect(later!.evaluatedDays).toBe(1);
});
