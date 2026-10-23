// Fasting windows judge when food was EATEN ("jam makan", food_log.eaten_at), not when it was typed in:
// dinner logged at 21:00 with a lunch time of 12:30 is inside a 12:00-20:00 window, and moving the time moves it.

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { eatenAtFromClock } from "../lib/eaten-at";
import { jakartaToday, shiftDate } from "../lib/engine";
import { fastingRouter } from "./fasting";
import { foodRouter } from "./food";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('f1', 'f1', 'f1@test.id');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, fasting_pattern, fasting_window_start)
  VALUES ('f1', 1990, 'male', 170, 80, 70, '2030-01-01', 'light', '16:8', '12:00');
`);

const as = { context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "f1" } } } as unknown as Context };

// Yesterday: every clock time on it is already behind the server clock, whatever time the test runs.
const DAY = shiftDate(jakartaToday(), -1);
const at = (clock: string) => eatenAtFromClock(DAY, clock)!;
const dinner = { date: DAY, meal: "makan_malam" as const, name: "Nasi goreng", kcal: 600 };

const today = () => call(fastingRouter.today, { date: DAY }, as);

describe("fasting window uses the eaten time", () => {
  test("dinner logged later with eatenAt 12:30 is inside the window, not flagged", async () => {
    await call(foodRouter.add, { ...dinner, eatenAt: at("12:30") }, as);
    const day = await today();
    expect(day.outsideWindow).toEqual([]);
    expect(day.outsideWindowKcal).toBe(0);
    expect(day.lastMeal).toMatchObject({ time: "12:30", kcal: 600 });
  });

  test("a time outside the window is flagged with that time", async () => {
    await call(foodRouter.add, { ...dinner, name: "Roti", kcal: 250, eatenAt: at("07:15") }, as);
    const day = await today();
    expect(day.outsideWindow).toEqual([{ meal: "makan_malam", kcal: 250, time: "07:15" }]);
    expect(day.outsideWindowKcal).toBe(250);
  });

  test("editing the eaten time moves a row out of the window, and back in", async () => {
    const row = await call(foodRouter.add, { ...dinner, name: "Bubur", kcal: 300, eatenAt: at("13:00") }, as);
    expect((await today()).outsideWindow.some((log) => log.kcal === 300)).toBe(false);
    await call(foodRouter.update, { id: row!.id, eatenAt: at("22:45") }, as);
    expect((await today()).outsideWindow).toContainEqual({ meal: "makan_malam", kcal: 300, time: "22:45" });
    await call(foodRouter.update, { id: row!.id, eatenAt: at("18:30") }, as);
    expect((await today()).outsideWindow.some((log) => log.kcal === 300)).toBe(false);
  });

  test("the week view keeps a day whose late log carries an in-window eaten time", async () => {
    const week = await call(fastingRouter.week, undefined, as);
    const mine = week.days.find((d) => d.date === DAY);
    // Yesterday also holds the 07:15 breakfast row from above: that day is not kept...
    expect(mine?.kept).toBe(false);
    // ...and a day with only in-window eaten times is.
    const other = shiftDate(DAY, -1);
    await call(foodRouter.add, { date: other, meal: "makan_malam", name: "Soto", kcal: 400, eatenAt: eatenAtFromClock(other, "13:10")! }, as);
    const again = await call(fastingRouter.week, undefined, as);
    expect(again.days.find((d) => d.date === other)?.kept).toBe(true);
  });

  test("a back-filled meal with no time is not judged by the minute it was typed in", async () => {
    const old = shiftDate(DAY, -3);
    await call(foodRouter.add, { date: old, meal: "makan_malam", name: "Mie", kcal: 500 }, as);
    const day = await call(fastingRouter.today, { date: old }, as);
    expect(day.outsideWindow).toEqual([]);
    expect(day.lastMeal).toBeNull();
    const week = await call(fastingRouter.week, undefined, as);
    // only days with a timed log count; a day of untimed back-fill stays "nothing known"
    expect(week.days.find((d) => d.date === old)?.kept ?? null).toBeNull();
  });
});
