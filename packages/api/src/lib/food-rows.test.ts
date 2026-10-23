// Guard for the "quick path drops macros" class of bug: every food_log insert goes through insertFoodRows, whose row
// type makes grams/protein/carbs/fat/fiber required keys (a number or an explicit null).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import { insertFoodRows, type FoodRowValues } from "./food-rows";

const ROOT = join(import.meta.dir, "../../../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name === "migrations") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("food_log writers", () => {
  test("no code outside lib/food-rows.ts inserts into food_log", () => {
    const offenders: string[] = [];
    for (const base of ["packages/api/src", "apps/server/src", "packages/db/src"]) {
      for (const file of sources(join(ROOT, base))) {
        const rel = relative(ROOT, file);
        if (rel === "packages/api/src/lib/food-rows.ts") continue;
        const text = readFileSync(file, "utf8");
        // drizzle: .insert(foodLog) / insert(schema.foodLog); raw SQL: INSERT INTO food_log / INSERT OR ... INTO food_log
        if (/insert\(\s*(?:\w+\.)?foodLog\b/.test(text) || /insert\s+(?:or\s+\w+\s+)?into\s+"?food_log"?/i.test(text)) offenders.push(rel);
      }
    }
    // push-test-db.ts seeds a throwaway in-memory test database with raw SQL; it is not a writer.
    expect(offenders.filter((file) => file !== "packages/api/src/lib/push-test-db.ts")).toEqual([]);
  });

  test("a row must state its macros: leaving one out does not type-check", () => {
    const base = { id: "x", userId: "u", date: "2026-10-20", meal: "snack", name: "Teh", kcal: 90, source: "manual" };
    const full: FoodRowValues = { ...base, grams: null, protein: null, carbs: null, fat: null, fiber: null };
    // @ts-expect-error protein is required: undefined/absent is how the recent-food chips lost P/K/L
    const noProtein: FoodRowValues = { ...base, grams: null, carbs: null, fat: null, fiber: null };
    // @ts-expect-error fiber is required
    const noFiber: FoodRowValues = { ...base, grams: null, protein: null, carbs: null, fat: null };
    // @ts-expect-error undefined is not an explicit null
    const undef: FoodRowValues = { ...full, protein: undefined };
    expect([full, noProtein, noFiber, undef]).toHaveLength(4);
  });

  test("a scan with many items stays under D1's 100 bound parameters per statement", async () => {
    // d1TestDb refuses what D1 refuses; SQLite alone allows thousands of parameters, which is what broke a 6-item breakfast scan.
    const { client, db } = await d1TestDb();
    await client.execute(`INSERT INTO "user" (id, name, email) VALUES ('u', 'u', 'u@test.id')`);
    const rows: FoodRowValues[] = Array.from({ length: 12 }, (_, i) => ({
      id: `row-${i}`,
      userId: "u",
      date: "2026-10-23",
      meal: "sarapan",
      name: `item ${i}`,
      kcal: 100 + i,
      grams: 50,
      protein: 1,
      carbs: 2,
      fat: 3,
      fiber: 0,
      source: "ai",
      scanId: "s".repeat(32),
      photoId: "p".repeat(32),
      plateScanId: "q".repeat(32),
      plateId: "plate",
      itemsJson: "[]",
      eatenAt: 1792718148514,
    }));
    const stored = await insertFoodRows(db, rows);
    expect(stored.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    const again = await insertFoodRows(db, rows, { ignoreConflicts: true });
    expect(again).toEqual([]);
  });
});
