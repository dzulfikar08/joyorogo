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

/**
 * Called by the oRPC link after food.add / addScan / update / remove succeed.
 * Fire-and-forget: a Health Connect failure must never break meal logging.
 */
export function mirrorFoodCall(path: readonly string[], input: unknown, output: unknown): void {
  if (path[0] !== "food") return;
  const mod = load();
  if (!mod) return;
  const op = path[1];
  let job: Promise<unknown> | null = null;
  if (op === "add" || op === "update") {
    if (output) job = mod.writeMeals([output as Nutrition.MealRow]);
  } else if (op === "addScan") {
    const items = (output as { items?: Nutrition.MealRow[] } | null)?.items;
    if (items?.length) job = mod.writeMeals(items);
  } else if (op === "remove") {
    const id = (input as { id?: string } | null)?.id;
    if (id) job = mod.deleteMeal(id);
  }
  job?.catch((e) => console.log("[JoyoRogo/HC-nutrition] mirror failed", op, e));
}
