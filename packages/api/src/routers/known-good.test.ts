// "Menu biasa yang muat" end to end on the D1-guarded database: the habits come from the user's own diary (imports and
// other users left out), a favorite is offered as itself, and the pick logs through the existing paths.
import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { fitKnownGood } from "../lib/known-good";
import { foodRouter } from "./food";
import { savedFoodRouter } from "./saved-food";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('k1', 'k1', 'k1@test.id'), ('k2', 'k2', 'k2@test.id');
`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
const k1 = as("k1");
const today = jakartaToday();
const day = (back: number) => shiftDate(today, -back);

describe("savedFood.knownGood", () => {
  test("foods logged on 3 days come back; imports, 2-day foods and other users do not", async () => {
    for (const back of [1, 3, 5]) {
      await call(foodRouter.add, { date: day(back), meal: "sarapan", name: "Oatmeal pisang", kcal: 320, protein: 10, carbs: 55, fat: 6, grams: 300 }, k1);
    }
    for (const back of [2, 4]) {
      await call(foodRouter.add, { date: day(back), meal: "sarapan", name: "Roti bakar", kcal: 280 }, k1);
    }
    for (const back of [1, 2, 3]) {
      await call(foodRouter.add, { date: day(back), meal: "makan_siang", name: "Nasi padang", kcal: 800 }, as("k2"));
    }
    // An import (Huawei Health) never makes a habit.
    await client.executeMultiple(
      [1, 2, 3]
        .map(
          (back) =>
            `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source, created_at) VALUES ('imp${back}', 'k1', '${day(back)}', 'snack', 'Teh manis', 90, 'huawei', ${Date.now()});`,
        )
        .join("\n"),
    );

    const { meals } = await call(savedFoodRouter.knownGood, undefined, k1);
    expect(meals.map((meal) => meal.name)).toEqual(["Oatmeal pisang"]);
    expect(meals[0]).toMatchObject({ kcal: 320, days: 3, meals: ["sarapan"], savedFoodId: null, protein: 10, grams: 300 });
  });

  test("a habit that is a favorite is offered as the favorite and relogs through it", async () => {
    const [latest] = (await call(foodRouter.listByDate, { date: day(1) }, k1)).items.filter((row) => row.name === "Oatmeal pisang");
    const saved = await call(savedFoodRouter.save, { foodId: latest!.id }, k1);
    await call(savedFoodRouter.rename, { id: saved.id, name: "Sarapan biasa" }, k1);

    const { meals } = await call(savedFoodRouter.knownGood, undefined, k1);
    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({ name: "Sarapan biasa", kcal: 320, savedFoodId: saved.id });

    // Today, nothing eaten, an 1800 kcal budget: breakfast's share (25%, 450 kcal) holds it.
    const fit = fitKnownGood(meals, "sarapan", { eatKcal: 1800, eatenKcal: 0, eatenByMeal: {}, ramadan: false });
    expect(fit.map((meal) => meal.savedFoodId)).toEqual([saved.id]);
    const relogged = await call(savedFoodRouter.relog, { id: fit[0]!.savedFoodId!, date: today, meal: "sarapan" }, k1);
    expect(relogged.items[0]).toMatchObject({ name: "Oatmeal pisang", kcal: 320, date: today });
  });

  test("a food hidden from the recent chips is not offered", async () => {
    for (const back of [6, 7, 8]) {
      await call(foodRouter.add, { date: day(back), meal: "snack", name: "Kerupuk", kcal: 60 }, k1);
    }
    expect((await call(savedFoodRouter.knownGood, undefined, k1)).meals.map((meal) => meal.name)).toContain("Kerupuk");
    await call(foodRouter.hideRecent, { name: "Kerupuk" }, k1);
    expect((await call(savedFoodRouter.knownGood, undefined, k1)).meals.map((meal) => meal.name)).not.toContain("Kerupuk");
  });
});
