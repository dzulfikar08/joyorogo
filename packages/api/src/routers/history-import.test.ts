import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { loadFacts } from "../lib/challenge-db";
import { foodRouter } from "./food";
import { waterRouter } from "./water";
import { weightRouter } from "./weight";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id'), ('b', 'b', 'b@test.id');`);

const as = (id = "a") => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id } } } as unknown as Context,
});

const today = jakartaToday();
const day = (back: number) => shiftDate(today, -back);
const rows = async (table: string, userId = "a") =>
  (await client.execute({ sql: `SELECT * FROM ${table} WHERE user_id = ? ORDER BY date`, args: [userId] })).rows as unknown as Record<string, unknown>[];

describe("weight.importHistory", () => {
  test("adds past days as source huawei, with the body values it has", async () => {
    const out = await call(
      weightRouter.importHistory,
      { entries: [{ date: day(100), weightKg: 89.2 }, { date: day(90), weightKg: 88.5, bodyFatPct: 25.1 }] },
      as(),
    );
    expect(out).toEqual({ added: 2, skipped: 0 });
    const r = await rows("weight_log");
    expect(r.map((x) => [x.date, x.weight_kg, x.source, x.body_fat_pct])).toEqual([
      [day(100), 89.2, "huawei", null],
      [day(90), 88.5, "huawei", 25.1],
    ]);
  });

  test("a second import adds nothing", async () => {
    const out = await call(weightRouter.importHistory, { entries: [{ date: day(100), weightKg: 89.2 }, { date: day(90), weightKg: 88.5 }] }, as());
    expect(out).toEqual({ added: 0, skipped: 2 });
    expect((await rows("weight_log")).length).toBe(2);
  });

  test("a day the person already weighed is never written over, and today and the future are refused", async () => {
    await call(weightRouter.checkIn, { weightKg: 80, date: day(50) }, as());
    const out = await call(
      weightRouter.importHistory,
      { entries: [{ date: day(50), weightKg: 99 }, { date: today, weightKg: 98 }, { date: shiftDate(today, 3), weightKg: 97 }] },
      as(),
    );
    expect(out.added).toBe(0);
    const r = await rows("weight_log");
    expect(r.find((x) => x.date === day(50))).toMatchObject({ weight_kg: 80, source: "manual" });
    expect(r.some((x) => x.date === today)).toBe(false);
  });

  test("the newest weigh-in stays the latest: an older imported day never replaces it", async () => {
    await call(weightRouter.checkIn, { weightKg: 79, date: day(1) }, as());
    await call(weightRouter.importHistory, { entries: [{ date: day(200), weightKg: 120 }] }, as());
    const h = await call(weightRouter.history, { limit: 50 }, as());
    expect(h.summary.latestKg).toBe(79);
    expect(h.entries.at(-1)?.date).toBe(day(1));
  });

  test("another person's days are not touched", async () => {
    await call(weightRouter.importHistory, { entries: [{ date: day(100), weightKg: 60 }] }, as("b"));
    expect((await rows("weight_log", "b")).length).toBe(1);
    expect((await rows("weight_log", "a")).find((x) => x.date === day(100))).toMatchObject({ weight_kg: 89.2 });
  });
});

describe("food.importHistory", () => {
  const meal = (over: Record<string, unknown> = {}) => ({
    key: "r1:0",
    date: day(80),
    meal: "makan_siang" as const,
    name: "Makanan Huawei Health",
    kcal: 584,
    protein: 12,
    ...over,
  });
  const foodRows = async () => rows("food_log");

  test("adds a past meal with its macros, source huawei and no plate", async () => {
    const eatenAt = Date.parse(`${day(80)}T05:00:00Z`); // 12:00 in Jakarta
    const out = await call(foodRouter.importHistory, { meals: [meal({ eatenAt })] }, as());
    expect(out).toEqual({ added: 1, skipped: 0 });
    expect((await foodRows())[0]).toMatchObject({ source: "huawei", kcal: 584, protein: 12, carbs: null, meal: "makan_siang", plate_id: null, eaten_at: eatenAt });
  });

  test("the same key again is a no-op", async () => {
    const out = await call(foodRouter.importHistory, { meals: [meal()] }, as());
    expect(out).toEqual({ added: 0, skipped: 1 });
    expect((await foodRows()).length).toBe(1);
  });

  test("an eaten-at on another day is dropped, not an error", async () => {
    await call(foodRouter.importHistory, { meals: [meal({ key: "r2:0", kcal: 100, eatenAt: Date.parse(`${day(70)}T05:00:00Z`) })] }, as());
    expect((await foodRows()).find((r) => r.kcal === 100)).toMatchObject({ eaten_at: null });
  });

  test("a meal the person already logged on that day and slot with the same kcal is not added again", async () => {
    await client.execute({
      sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source) VALUES ('m1', 'a', ?, 'sarapan', 'Nasi uduk', 450, 'manual')`,
      args: [day(60)],
    });
    const out = await call(foodRouter.importHistory, { meals: [meal({ key: "r3:0", date: day(60), meal: "sarapan", kcal: 450.4 })] }, as());
    expect(out).toEqual({ added: 0, skipped: 1 });
  });

  test("today and future days are refused", async () => {
    const out = await call(foodRouter.importHistory, { meals: [meal({ key: "r4:0", date: today }), meal({ key: "r5:0", date: shiftDate(today, 2) })] }, as());
    expect(out.added).toBe(0);
  });

  test("imported meals are not a logged day for a challenge, a real one is", async () => {
    const facts = await loadFacts(db, "calories", ["a"], day(81), day(79), 2000);
    expect(facts.get("a")?.get(day(80))).toBeUndefined();
    await client.execute({
      sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source) VALUES ('real', 'a', ?, 'sarapan', 'Roti', 300, 'manual')`,
      args: [day(80)],
    });
    const after = await loadFacts(db, "calories", ["a"], day(81), day(79), 2000);
    expect(after.get("a")?.get(day(80))).toBeDefined();
  });

  test("ids of two people never collide", async () => {
    await call(foodRouter.importHistory, { meals: [meal({ key: "same:0", date: day(40), kcal: 321 })] }, as("a"));
    const out = await call(foodRouter.importHistory, { meals: [meal({ key: "same:0", date: day(40), kcal: 321 })] }, as("b"));
    expect(out.added).toBe(1);
  });
});

describe("water.importHistory", () => {
  test("adds past days, never writes over a day that has a count, and a second run adds nothing", async () => {
    await client.execute({ sql: `INSERT INTO water_log (user_id, date, glasses) VALUES ('a', ?, 3)`, args: [day(30)] });
    const input = { days: [{ date: day(31), glasses: 7 }, { date: day(30), glasses: 9 }, { date: today, glasses: 2 }] };
    expect(await call(waterRouter.importHistory, input, as())).toEqual({ added: 1, skipped: 2 });
    expect(await call(waterRouter.importHistory, input, as())).toEqual({ added: 0, skipped: 3 });
    const r = (await client.execute(`SELECT date, glasses FROM water_log WHERE user_id = 'a' ORDER BY date`)).rows as unknown as { date: string; glasses: number }[];
    expect(r.map((x) => [x.date, x.glasses])).toEqual([[day(31), 7], [day(30), 3]]);
  });
});

describe("food.importHistory carries what the export has", () => {
  test("weight in grams, P/K/L and fibre are stored; what the export lacks stays null, never 0", async () => {
    const out = await call(
      foodRouter.importHistory,
      {
        meals: [
          { key: "full", date: day(30), meal: "sarapan", name: "Bubur ayam", kcal: 320, grams: 250, protein: 14, carbs: 48, fat: 8, fiber: 2 },
          { key: "kcalonly", date: day(30), meal: "snack", name: "Roti", kcal: 150 },
        ],
      },
      as("b"),
    );
    expect(out).toEqual({ added: 2, skipped: 0 });
    const r = (await rows("food_log", "b")).filter((x) => String(x.id).endsWith(":full") || String(x.id).endsWith(":kcalonly")).sort((x, y) => String(x.name).localeCompare(String(y.name)));
    expect(r.map((x) => [x.name, x.grams, x.protein, x.carbs, x.fat, x.fiber, x.source])).toEqual([
      ["Bubur ayam", 250, 14, 48, 8, 2, "huawei"],
      ["Roti", null, null, null, null, null, "huawei"],
    ]);
  });
});
