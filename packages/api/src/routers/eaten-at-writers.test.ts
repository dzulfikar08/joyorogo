// Every food_log writer takes the optional "jam makan" and validates it the same way (lib/eaten-at.ts):
// not later than a few minutes from now, on the diary day (or 00:00-03:59 after it), at most 45 days old.

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { eatenAtDay, eatenAtFromClock } from "../lib/eaten-at";
import { jakartaToday, shiftDate } from "../lib/engine";
import { foodRouter } from "./food";
import { placeRouter } from "./place";
import { plateRouter } from "./plate";
import { savedFoodRouter } from "./saved-food";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('w1', 'w1', 'w1@test.id');`);
const as = { context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "w1" } } } as unknown as Context };

const DAY = shiftDate(jakartaToday(), -2);
const OTHER = shiftDate(DAY, -1);
const at = (clock: string, date = DAY) => eatenAtFromClock(date, clock)!;
const stored = async (id: string) => (await client.execute({ sql: "SELECT eaten_at FROM food_log WHERE id = ?", args: [id] })).rows[0]?.eaten_at;

describe("food.add validation", () => {
  const base = { meal: "makan_malam" as const, name: "Nasi", kcal: 300 };

  test("a few minutes ahead is fine, eleven is not", async () => {
    const soon = Date.now() + 5 * 60_000;
    const ok = await call(foodRouter.add, { ...base, date: eatenAtDay(soon), eatenAt: soon }, as);
    expect(ok!.eatenAt).toBe(soon);
    const late = Date.now() + 11 * 60_000;
    await expect(call(foodRouter.add, { ...base, date: eatenAtDay(late), eatenAt: late }, as)).rejects.toThrow("invalid_eaten_at:too_far_ahead");
  });

  test("a time on another day is refused with the reason", async () => {
    await expect(call(foodRouter.add, { ...base, date: DAY, eatenAt: at("12:00", OTHER) }, as)).rejects.toThrow("invalid_eaten_at:wrong_day");
  });

  test("late night after the diary day is allowed up to 03:59", async () => {
    const row = await call(foodRouter.add, { ...base, date: DAY, eatenAt: at("02:30", shiftDate(DAY, 1)) }, as);
    expect(row!.eatenAt).toBe(at("02:30", shiftDate(DAY, 1)));
  });
});

describe("favorites and plate re-logs", () => {
  test("savedFood.relog stores the time and refuses a wrong-day one", async () => {
    const first = await call(foodRouter.add, { date: DAY, meal: "sarapan", name: "Bubur", kcal: 250 }, as);
    const saved = await call(savedFoodRouter.save, { foodId: first!.id }, as);
    const done = await call(savedFoodRouter.relog, { id: saved.id, date: DAY, meal: "sarapan", eatenAt: at("07:20") }, as);
    expect(done.items[0]!.eatenAt).toBe(at("07:20"));
    await expect(call(savedFoodRouter.relog, { id: saved.id, date: DAY, meal: "sarapan", eatenAt: at("07:20", OTHER) }, as)).rejects.toThrow("invalid_eaten_at");
    await expect(call(savedFoodRouter.relog, { id: saved.id, date: DAY, meal: "sarapan", eatenAt: Date.now() + 3_600_000 }, as)).rejects.toThrow("invalid_eaten_at");
  });

  test("place.relog stores the time and refuses a wrong-day one", async () => {
    const visit = await call(foodRouter.add, { date: OTHER, meal: "makan_siang", name: "Soto", kcal: 400, plate: { place: "Warung Eaten" } }, as);
    const body = { plateId: visit!.plateId!, date: DAY, meal: "makan_siang" as const };
    const done = await call(placeRouter.relog, { ...body, eatenAt: at("13:05") }, as);
    expect(done.items[0]!.eatenAt).toBe(at("13:05"));
    await expect(call(placeRouter.relog, { ...body, eatenAt: at("13:05", OTHER) }, as)).rejects.toThrow("invalid_eaten_at");
  });
});

describe("plate.update eatenAt", () => {
  test("sets the time of every row of the plate, clears it, and validates against the plate's day", async () => {
    const a = await call(foodRouter.add, { date: DAY, meal: "makan_malam", name: "Nasi", kcal: 200, plate: { name: "Nasi ayam" } }, as);
    const b = await call(foodRouter.add, { date: DAY, meal: "makan_malam", name: "Ayam", kcal: 260, plateId: a!.plateId! }, as);
    await call(plateRouter.update, { id: a!.plateId!, eatenAt: at("12:30") }, as);
    expect([await stored(a!.id), await stored(b!.id)]).toEqual([at("12:30"), at("12:30")]);
    await expect(call(plateRouter.update, { id: a!.plateId!, eatenAt: at("12:30", OTHER) }, as)).rejects.toThrow("invalid_eaten_at:wrong_day");
    expect(await stored(b!.id)).toBe(at("12:30"));
    await call(plateRouter.update, { id: a!.plateId!, eatenAt: null }, as);
    expect([await stored(a!.id), await stored(b!.id)]).toEqual([null, null]);
  });

  test("moving the plate and setting a time together validates against the new day and keeps the time", async () => {
    const a = await call(foodRouter.add, { date: DAY, meal: "makan_siang", name: "Mie", kcal: 350, plate: { name: "Mie ayam" } }, as);
    await call(plateRouter.update, { id: a!.plateId!, date: OTHER, eatenAt: at("19:10", OTHER) }, as);
    expect(await stored(a!.id)).toBe(at("19:10", OTHER));
    await expect(call(plateRouter.update, { id: a!.plateId!, date: DAY, eatenAt: at("19:10", OTHER) }, as)).rejects.toThrow("invalid_eaten_at:wrong_day");
  });
});

describe("food.update eatenAt", () => {
  test("sets, refuses a future time and clears", async () => {
    const row = await call(foodRouter.add, { date: DAY, meal: "makan_malam", name: "Sate", kcal: 450 }, as);
    await call(foodRouter.update, { id: row!.id, eatenAt: at("12:30") }, as);
    expect(await stored(row!.id)).toBe(at("12:30"));
    await expect(call(foodRouter.update, { id: row!.id, eatenAt: Date.now() + 3_600_000 }, as)).rejects.toThrow("invalid_eaten_at");
    await call(foodRouter.update, { id: row!.id, eatenAt: null }, as);
    expect(await stored(row!.id)).toBeNull();
  });
});
