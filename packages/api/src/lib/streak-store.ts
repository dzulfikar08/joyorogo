import { and, gte, inArray, lt, lte, ne, notInArray, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog, weightLog } from "@joyorogo/db/schema/fitness";

import { readChunked } from "./d1";
import { shiftDate } from "./engine";
import { gainDayHit } from "./gain";
import { IMPORT_SOURCE, IMPORTED_WEIGHT_SOURCES } from "./history-import";
import { buildPlan, planQueries } from "./plan";
import { readCalibrationPrefs } from "./calibration-store";
import { STREAK_MAX_DAYS, STREAK_WINDOW_DAYS, runReachesWindow, streakState } from "./streak";
import type { StreakState } from "./streak";

type FoodDay = { date: string; kcal: number };
type WeightDay = { date: string };

/** The days that count: food and weigh-in days for a normal plan, food days at 90% of the target for Naikin BB. */
function countedDays(
  food: FoodDay[],
  weight: WeightDay[],
  gainTargetKcal: number | null,
): string[] {
  return gainTargetKcal === null
    ? [...food.map((row) => row.date), ...weight.map((row) => row.date)]
    : food.filter((row) => gainDayHit(row.kcal, gainTargetKcal)).map((row) => row.date);
}

/** Per-person days before `windowStart` (back to STREAK_MAX_DAYS) for the people whose run fills the window. Imports never count. */
async function olderDays(db: Database, userIds: string[], asOf: string, windowStart: string) {
  const floor = shiftDate(asOf, -STREAK_MAX_DAYS);
  const food = await readChunked(
    userIds,
    (slice) =>
      db
        .select({
          userId: foodLog.userId,
          date: foodLog.date,
          kcal: sql<number>`sum(${foodLog.kcal})`,
        })
        .from(foodLog)
        .where(
          and(
            inArray(foodLog.userId, slice),
            gte(foodLog.date, floor),
            lt(foodLog.date, windowStart),
            ne(foodLog.source, IMPORT_SOURCE),
          ),
        )
        .groupBy(foodLog.userId, foodLog.date),
    { reserved: 3 },
  );
  const weight = await readChunked(
    userIds,
    (slice) =>
      db
        .selectDistinct({ userId: weightLog.userId, date: weightLog.date })
        .from(weightLog)
        .where(
          and(
            inArray(weightLog.userId, slice),
            gte(weightLog.date, floor),
            lt(weightLog.date, windowStart),
            notInArray(weightLog.source, IMPORTED_WEIGHT_SOURCES),
          ),
        ),
    { reserved: 3 },
  );
  return { food, weight };
}

/**
 * The streak of a person from the days the summary already read, followed further back only when the run reaches the
 * start of that window (so a 124-day streak reads 124, not 46, and almost every request adds no query).
 *
 * `days` are the counted days in the window: food and weigh-in days for a normal plan, or the per-day intake of a
 * Naikin BB plan (`gainTargetKcal` set), where a day counts from 90% of the target.
 */
export async function loadStreak(
  db: Database,
  userId: string,
  today: string,
  windowStart: string,
  days: { food: FoodDay[]; weight: WeightDay[] },
  gainTargetKcal: number | null,
): Promise<StreakState> {
  const inWindow = countedDays(days.food, days.weight, gainTargetKcal);
  const state = streakState(inWindow, today);
  if (!runReachesWindow(state, today, windowStart)) return state;
  const older = await olderDays(db, [userId], today, windowStart);
  return streakState(
    [...inWindow, ...countedDays(older.food, older.weight, gainTargetKcal)],
    today,
  );
}

/** A person to read a streak for; `gainTargetKcal` is the daily target of a Naikin BB plan, null for any other plan. */
export interface StreakSubject {
  userId: string;
  gainTargetKcal: number | null;
}

/**
 * Streaks of many people as of `asOf` (their zone's today, or the end of a finished week), the same definition as
 * day.summary: logged days, 90% days for Naikin BB, imports never, runs followed back to STREAK_MAX_DAYS. Hamil /
 * Menyusui people are not passed in and get no entry. Reads the window for everyone in one pass, then only the people
 * whose run fills it go further back.
 */
export async function loadStreaks(
  db: Database,
  asOf: string,
  subjects: StreakSubject[],
): Promise<Map<string, StreakState>> {
  const out = new Map<string, StreakState>();
  if (subjects.length === 0) return out;
  const ids = subjects.map((subject) => subject.userId);
  const windowStart = shiftDate(asOf, -STREAK_WINDOW_DAYS);
  const food = await readChunked(
    ids,
    (slice) =>
      db
        .select({
          userId: foodLog.userId,
          date: foodLog.date,
          kcal: sql<number>`sum(${foodLog.kcal})`,
        })
        .from(foodLog)
        .where(
          and(
            inArray(foodLog.userId, slice),
            gte(foodLog.date, windowStart),
            lte(foodLog.date, asOf),
            ne(foodLog.source, IMPORT_SOURCE),
          ),
        )
        .groupBy(foodLog.userId, foodLog.date),
    { reserved: 4 },
  );
  const weight = await readChunked(
    ids,
    (slice) =>
      db
        .selectDistinct({ userId: weightLog.userId, date: weightLog.date })
        .from(weightLog)
        .where(
          and(
            inArray(weightLog.userId, slice),
            gte(weightLog.date, windowStart),
            lte(weightLog.date, asOf),
            notInArray(weightLog.source, IMPORTED_WEIGHT_SOURCES),
          ),
        ),
    { reserved: 4 },
  );
  const byUser = <T extends { userId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.userId, [...(map.get(row.userId) ?? []), row]);
    return map;
  };
  const foodBy = byUser(food);
  const weightBy = byUser(weight);

  const counted = new Map<string, string[]>();
  const far: StreakSubject[] = [];
  for (const subject of subjects) {
    const days = countedDays(
      foodBy.get(subject.userId) ?? [],
      weightBy.get(subject.userId) ?? [],
      subject.gainTargetKcal,
    );
    counted.set(subject.userId, days);
    const state = streakState(days, asOf);
    out.set(subject.userId, state);
    if (runReachesWindow(state, asOf, windowStart)) far.push(subject);
  }
  if (far.length === 0) return out;

  const older = await olderDays(
    db,
    far.map((subject) => subject.userId),
    asOf,
    windowStart,
  );
  const olderFood = byUser(older.food);
  const olderWeight = byUser(older.weight);
  for (const subject of far) {
    const days = countedDays(
      olderFood.get(subject.userId) ?? [],
      olderWeight.get(subject.userId) ?? [],
      subject.gainTargetKcal,
    );
    out.set(subject.userId, streakState([...(counted.get(subject.userId) ?? []), ...days], asOf));
  }
  return out;
}

/** One person's streak as of `asOf` (the caller leaves Hamil / Menyusui out). See `loadStreaks`. */
export async function loadUserStreak(
  db: Database,
  userId: string,
  asOf: string,
  gainTargetKcal: number | null,
): Promise<StreakState> {
  return (await loadStreaks(db, asOf, [{ userId, gainTargetKcal }])).get(userId)!;
}

/**
 * The plan side of a streak for a person whose plan is not at hand: the Naikin BB target (null for any other plan)
 * and whether they are in Hamil / Menyusui, where no streak is kept.
 */
export async function streakPlanOf(
  db: Database,
  userId: string,
  today: string,
): Promise<{ maternal: boolean; gainTargetKcal: number | null }> {
  const [profRows, latest, weighIns, intake, exercise, prefRows] = await db.batch(
    planQueries(db, userId, today),
  );
  const prof = profRows[0];
  if (!prof) return { maternal: false, gainTargetKcal: null };
  const plan = buildPlan(
    prof,
    {
      latestWeightKg: latest[0]?.weightKg ?? null,
      weighIns,
      intake,
      exercise,
      prefs: readCalibrationPrefs(prefRows),
    },
    today,
  );
  return {
    maternal: plan.maternal !== null,
    gainTargetKcal: plan.targets.gain ? plan.targets.eatKcal : null,
  };
}
