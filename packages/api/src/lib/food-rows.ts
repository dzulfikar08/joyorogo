// The one place a food_log row is inserted. Every writer (food.add, addScan, importHistory, plan "Sudah makan", plate and
// favorite re-logs) goes through insertFoodRows, whose row type makes grams, protein, carbs, fat and fiber REQUIRED keys:
// a writer must say a number or an explicit null for each, so a new path cannot silently drop macros the way the
// recent-food chips did (kcal only: NULL P/K/L counted as 0 g in every total). food-rows.test.ts fails when a food_log
// insert appears anywhere else.
import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";

export type FoodRowValues = Omit<
  typeof foodLog.$inferInsert,
  "grams" | "protein" | "carbs" | "fat" | "fiber" | "source" | "createdAt"
> & {
  /** null = unknown (never 0 by default). */
  grams: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** "manual" | "ai" | "barcode" | "copy" | "huawei" (db/schema/fitness.ts). */
  source: string;
};

/** Inserts rows and answers the stored ones; with `ignoreConflicts` a row whose id exists is skipped (and not answered). */
export function insertFoodRows(
  db: Database,
  rows: readonly FoodRowValues[],
  options: { ignoreConflicts?: boolean } = {},
): Promise<Array<typeof foodLog.$inferSelect>> {
  const insert = db.insert(foodLog).values([...rows]);
  return (options.ignoreConflicts ? insert.onConflictDoNothing({ target: foodLog.id }) : insert).returning();
}
