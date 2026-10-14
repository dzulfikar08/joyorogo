// Writes JoyoRogo meals to Health Connect as NutritionRecords so other apps
// (JoyoFit, Huawei-free setups) can read them. Android only; required lazily
// from health-nutrition.ts like health-connect.ts.
//
// Idempotency: clientRecordId = `joyorogo:meal:<foodLog.id>`; every write
// carries clientRecordVersion = Date.now(), so Health Connect replaces the
// previous revision instead of duplicating. Deleting a meal removes the
// record by its clientRecordId.
import {
  getGrantedPermissions,
  initialize,
  insertRecords,
  deleteRecordsByUuids,
  requestPermission,
} from "react-native-health-connect";
import type { NutritionRecord } from "react-native-health-connect";

import { client } from "@/utils/orpc";

export type MealRow = {
  id: string;
  date: string;
  meal: string;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  createdAt: Date | string;
};

const TAG = "[JoyoRogo/HC-nutrition]";
export const NUTRITION_BACKFILL_DAYS = 30;
const WIB_MS = 7 * 60 * 60 * 1000;
const BATCH = 100;

// Health Connect MealType constants.
const MEAL_TYPE: Record<string, number> = {
  sarapan: 1,
  makan_siang: 2,
  makan_malam: 3,
  snack: 4,
};
// Fallback clock (WIB) when createdAt falls on another day than the meal date
// (back-dated logs).
const MEAL_HOUR_WIB: Record<string, number> = {
  sarapan: 7,
  makan_siang: 12,
  makan_malam: 19,
  snack: 16,
};

export function mealClientId(id: string): string {
  return `joyorogo:meal:${id}`;
}

async function ensureInit(): Promise<boolean> {
  try {
    return await initialize();
  } catch (e) {
    console.log(TAG, "initialize failed", e);
    return false;
  }
}

export async function hasNutritionWritePermission(): Promise<boolean> {
  if (!(await ensureInit())) return false;
  const granted = await getGrantedPermissions();
  return granted.some((p) => p.recordType === "Nutrition" && p.accessType === "write");
}

/** Prompts for Nutrition write + read (read lets us see what we wrote). */
export async function requestNutritionPermission(): Promise<boolean> {
  if (!(await ensureInit())) return false;
  await requestPermission([
    { accessType: "write", recordType: "Nutrition" },
    { accessType: "read", recordType: "Nutrition" },
  ]);
  return hasNutritionWritePermission();
}

function mealInstant(row: MealRow): Date {
  const now = Date.now();
  const created = new Date(row.createdAt);
  const createdWibDay = new Date(created.getTime() + WIB_MS).toISOString().slice(0, 10);
  let ms: number;
  if (!Number.isNaN(created.getTime()) && createdWibDay === row.date) {
    ms = created.getTime();
  } else {
    const hour = MEAL_HOUR_WIB[row.meal] ?? 12;
    ms = Date.parse(`${row.date}T${String(hour).padStart(2, "0")}:00:00+07:00`);
  }
  return new Date(Math.min(ms, now - 60_000));
}

export function toNutritionRecord(row: MealRow, version: number): NutritionRecord {
  const start = mealInstant(row);
  const end = new Date(start.getTime() + 60_000);
  const grams = (value: number | null | undefined) =>
    value && value > 0 ? { value, unit: "grams" as const } : undefined;
  return {
    recordType: "Nutrition",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    name: row.name,
    mealType: MEAL_TYPE[row.meal] ?? 0,
    energy: { value: row.kcal, unit: "kilocalories" },
    protein: grams(row.protein),
    totalCarbohydrate: grams(row.carbs),
    totalFat: grams(row.fat),
    dietaryFiber: grams(row.fiber),
    metadata: {
      clientRecordId: mealClientId(row.id),
      clientRecordVersion: version,
    },
  };
}

/** Upserts the meals. Returns the number written; 0 when permission is missing. */
export async function writeMeals(rows: MealRow[]): Promise<number> {
  const real = rows.filter((r) => r.id && !r.id.startsWith("temp-"));
  if (real.length === 0) return 0;
  if (!(await hasNutritionWritePermission())) {
    console.log(TAG, `skip write of ${real.length} meal(s): Nutrition write permission not granted`);
    return 0;
  }
  const version = Date.now();
  let written = 0;
  for (let i = 0; i < real.length; i += BATCH) {
    const slice = real.slice(i, i + BATCH);
    const ids = await insertRecords(slice.map((r) => toNutritionRecord(r, version)));
    written += ids.length;
  }
  console.log(TAG, `wrote ${written} meal(s)`, real.map((r) => mealClientId(r.id)).join(","));
  return written;
}

export async function deleteMeal(id: string): Promise<void> {
  if (!(await hasNutritionWritePermission())) {
    console.log(TAG, `skip delete ${id}: Nutrition write permission not granted`);
    return;
  }
  await deleteRecordsByUuids("Nutrition", [], [mealClientId(id)]);
  console.log(TAG, `deleted ${mealClientId(id)}`);
}

function wibDay(offset: number): string {
  return new Date(Date.now() + WIB_MS - offset * 86_400_000).toISOString().slice(0, 10);
}

/** Requests permission, then writes the last 30 WIB days of logged meals. */
export async function backfillNutrition(): Promise<{ meals: number; days: number }> {
  if (!(await requestNutritionPermission())) {
    throw new Error("Izin Nutrisi di Health Connect belum diberikan.");
  }
  const days = Array.from({ length: NUTRITION_BACKFILL_DAYS }, (_, i) => wibDay(i));
  const rows: MealRow[] = [];
  for (let i = 0; i < days.length; i += 6) {
    const lists = await Promise.all(
      days.slice(i, i + 6).map((date) => client.food.listByDate({ date })),
    );
    for (const list of lists) rows.push(...list.items);
  }
  const meals = await writeMeals(rows);
  console.log(TAG, `backfill ${NUTRITION_BACKFILL_DAYS}d: ${meals}/${rows.length} meals`);
  return { meals, days: days.length };
}
