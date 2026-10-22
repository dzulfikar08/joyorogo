// Platform facade for the Health Connect nutrition mirror. Android only;
// react-native-health-connect must not load on other platforms.
import { Platform } from "react-native";

import type * as Nutrition from "@/src/lib/health-connect-nutrition";

function load(): typeof Nutrition | null {
  if (Platform.OS !== "android") return null;
  return require("@/src/lib/health-connect-nutrition") as typeof Nutrition;
}

export function isNutritionMirrorSupported(): boolean {
  return Platform.OS === "android";
}

export async function backfillNutritionToHealth() {
  const mod = load();
  if (!mod) return { meals: 0, days: 0 };
  return mod.backfillNutrition();
}

// Routers other than food whose procedures add or remove food_log rows.
const OTHER_WRITERS: Record<string, readonly string[]> = {
  savedFood: ["relog"],
  place: ["relog"],
  mealPlan: ["eat", "undoEat"],
};

function mirrorOtherWriter(mod: typeof Nutrition, router: string, op: string, output: unknown): Promise<unknown> | null {
  if (op === "relog") {
    const items = (output as { items?: Nutrition.MealRow[] } | null)?.items;
    return items?.length ? mod.writeMeals(items) : null;
  }
  if (router === "mealPlan" && op === "eat") {
    const row = (output as { row?: Nutrition.MealRow } | null)?.row;
    return row ? mod.writeMeals([row]) : null;
  }
  if (router === "mealPlan" && op === "undoEat") {
    const id = (output as { removedLogId?: string } | null)?.removedLogId;
    return id ? mod.deleteMeal(id) : null;
  }
  return null;
}

/**
 * Called by the oRPC link after food.add / addScan / update / recalculatePlate (applied) / remove succeed.
 * Fire-and-forget: a Health Connect failure must never break meal logging.
 */
export function mirrorFoodCall(path: readonly string[], input: unknown, output: unknown): void {
  const mod = path[0] === "food" || path[0] in OTHER_WRITERS ? load() : null;
  if (!mod) return;
  const op = path[1];
  let job: Promise<unknown> | null = null;
  if (path[0] !== "food") {
    // Favorit and place re-logs create diary rows; the plan screen logs / un-logs one planned meal.
    if (OTHER_WRITERS[path[0]]?.includes(op ?? "")) job = mirrorOtherWriter(mod, path[0], op ?? "", output);
  } else if (op === "add" || op === "update") {
    if (output) job = mod.writeMeals([output as Nutrition.MealRow]);
  } else if (op === "addScan") {
    const items = (output as { items?: Nutrition.MealRow[] } | null)?.items;
    if (items?.length) job = mod.writeMeals(items);
  } else if (op === "recalculatePlate") {
    const updated = (output as { updated?: Nutrition.MealRow[] } | null)?.updated;
    if (updated?.length) job = mod.writeMeals(updated);
  } else if (op === "remove") {
    const id = (input as { id?: string } | null)?.id;
    if (id) job = mod.deleteMeal(id);
  }
  job?.catch((e) => console.log("[JoyoRogo/HC-nutrition] mirror failed", op, e));
}
