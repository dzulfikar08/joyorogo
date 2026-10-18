import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dailyActivity, exerciseLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";
import { syncRecord } from "@joyorogo/db/schema/sync";

import { ADD_BACK_PREF_KEYS, addBackSettings, exerciseCredit } from "./exercise-credit";
import type { AddBackPrefKey, AddBackSettings, AllDayReading, ExerciseCredit } from "./exercise-credit";

// Server side of "Kalori olahraga": reads the person's settings from their synced preferences (sync_record ns 'rogo',
// kind 'pref', id = the key, json `{"value": ...}`; a tombstone or a missing row means the default) and builds the
// day's credit. The settings follow the account, so every client and the MCP connector see the same Sisa.

const NOTICE_KEY = "dismissed.addBackNotice2";

/** The `value` of a stored pref document, or undefined when it is not `{"value": ...}`. */
function docValue(json: string): unknown {
  try {
    const doc: unknown = JSON.parse(json);
    return typeof doc === "object" && doc !== null && "value" in doc ? doc.value : undefined;
  } catch {
    return undefined;
  }
}

/** Query shaped for `db.batch`: the live (not deleted) rows of the preferences the day's budget reads. */
export function addBackPrefQuery(db: Database, userId: string) {
  return db
    .select({ id: syncRecord.id, json: syncRecord.json })
    .from(syncRecord)
    .where(
      and(
        eq(syncRecord.userId, userId),
        eq(syncRecord.ns, "rogo"),
        eq(syncRecord.kind, "pref"),
        inArray(syncRecord.id, [...ADD_BACK_PREF_KEYS, NOTICE_KEY]),
        isNull(syncRecord.deletedAt),
      ),
    );
}

export type AddBackPrefRows = { id: string; json: string }[];

/** Settings and notice state from the rows of `addBackPrefQuery`. */
export function readAddBackPrefs(rows: AddBackPrefRows): { settings: AddBackSettings; noticeDismissed: boolean } {
  const values: Partial<Record<AddBackPrefKey, unknown>> = {};
  let noticeDismissed = false;
  for (const row of rows) {
    if (row.id === NOTICE_KEY) noticeDismissed = docValue(row.json) === true;
    else values[row.id as AddBackPrefKey] = docValue(row.json);
  }
  return { settings: addBackSettings(values), noticeDismissed };
}

/** The all-day readings of the credit from a `daily_activity` row (Health Connect / Apple Health) and a JoyoFit score row. */
export function dayReadings(
  activity: { activeCalories: number; source: string } | undefined,
  score: { activeKcal: number | null } | undefined,
): AllDayReading[] {
  return [
    { source: "joyofit", kcal: score?.activeKcal },
    { source: activity?.source === "apple_health" ? "apple_health" : "health_connect", kcal: activity?.activeCalories },
  ];
}

/** Queries for the exercise rows, the health store's rollup and the JoyoFit all-day energy of one day, shaped for `db.batch`. */
export function creditDayQueries(db: Database, userId: string, date: string) {
  return [
    db
      .select({ kcal: exerciseLog.kcal, source: exerciseLog.source, externalId: exerciseLog.externalId })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.date, date))),
    db
      .select({ steps: dailyActivity.steps, activeCalories: dailyActivity.activeCalories, source: dailyActivity.source })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.date, date)))
      .limit(1),
    db
      .select({ activeKcal: fitnessScore.activeKcal })
      .from(fitnessScore)
      .where(and(eq(fitnessScore.userId, userId), eq(fitnessScore.date, date)))
      .limit(1),
  ] as const;
}

/** The day's credit on its own, for callers that do not already hold the rows (reminders, fasting day, coach). */
export async function loadDayCredit(db: Database, userId: string, date: string): Promise<ExerciseCredit> {
  const [prefs, [rows, activity, score]] = await Promise.all([
    addBackPrefQuery(db, userId),
    db.batch(creditDayQueries(db, userId, date)),
  ]);
  return exerciseCredit({
    settings: readAddBackPrefs(prefs).settings,
    rows,
    readings: dayReadings(activity[0], score[0]),
    steps: activity[0]?.steps ?? null,
  });
}
