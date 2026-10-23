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

/** D1 binds at most 100 parameters per statement and a row binds up to 19, so a statement carries at most 5 rows. */
const ROWS_PER_STATEMENT = 5;

/**
 * Inserts rows and answers the stored ones; with `ignoreConflicts` a row whose id exists is skipped (and not answered).
 * More than ROWS_PER_STATEMENT rows go as one batch of statements, which D1 runs as a single transaction.
 */
export async function insertFoodRows(
  db: Database,
  rows: readonly FoodRowValues[],
  options: { ignoreConflicts?: boolean } = {},
): Promise<Array<typeof foodLog.$inferSelect>> {
  const statement = (part: FoodRowValues[]) => {
    const insert = db.insert(foodLog).values(part);
    return (options.ignoreConflicts ? insert.onConflictDoNothing({ target: foodLog.id }) : insert).returning();
  };
  if (rows.length <= ROWS_PER_STATEMENT) return statement([...rows]);
  const chunks: FoodRowValues[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) chunks.push(rows.slice(i, i + ROWS_PER_STATEMENT));
  const [first, ...rest] = chunks.map(statement);
  const results = await db.batch([first!, ...rest]);
  return results.flat();
}
