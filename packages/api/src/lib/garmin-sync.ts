import { and, eq, gte, inArray, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dailyActivity, exerciseLog, weightLog } from "@joyorogo/db/schema/fitness";
import type { DayZone, Locale } from "@joyorogo/i18n";

import { ACTIVITY_PAGE, GarminApiError, GarminClient } from "./garmin-client";
import { GarminGrantError, freshToken, garminStatus, recordSync } from "./garmin-grant";
import { humanTypeKey, netKcal, parseActivities, parseDailySummaries, parseWeighIns } from "./garmin-parse";
import type { GarminActivity } from "./garmin-parse";
import { chunk, insertChunked } from "./d1";
import { jakartaToday, shiftDate } from "./engine";
import { EXERCISE_MAX_KCAL } from "./exercise-edit";
import { diaryMatcher } from "./import-dedupe";
import { serverT } from "./messages";
import { estimateKcal, metForStravaType } from "./met";
import { weightLookup } from "./weight-at";
import { workoutTypeLabel } from "./workout-label";

/** Days a first sync reaches back for activities and daily summaries. */
export const ACTIVITY_DAYS = 30;
/** Days a first sync reaches back for weigh-ins. */
export const WEIGHT_DAYS = 90;
/** A later sync starts this many days before the last one, so a late-arriving record is still caught. */
export const OVERLAP_DAYS = 2;
/** Pages of activities one sync reads (100 each): a month holds far fewer. */
const MAX_PAGES = 5;
/** Where else the same workout arrives from: Garmin also syncs to Health Connect, Apple Health and Strava. */
const OTHER_SOURCES = ["health_connect", "apple_health", "strava"];

export type GarminSyncFailure = "not_connected" | "expired" | "unavailable";

export class GarminSyncError extends Error {
  constructor(readonly failure: GarminSyncFailure) {
    super(`Garmin sync: ${failure}`);
    this.name = "GarminSyncError";
  }
}

export type GarminSyncResult = {
  /** Workouts added to the diary. */
  imported: number;
  /** Workouts not imported: already stored, or the same workout another source holds. */
  skipped: number;
  /** Weigh-ins added or changed. */
  weights: number;
  /** Days whose steps and active calories were added or changed. */
  days: number;
  /** Records in the answers that could not be read. */
  unparsed: number;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type GarminSyncInput = {
  db: Database;
  userId: string;
  zone: DayZone;
  locale: Locale;
  now?: Date;
  /** The fetch used for Garmin (token and data); tests pass a fake. */
  fetcher?: Fetcher;
};

/** First day of a sync window: `firstDays` back on the first sync, afterwards the last sync minus the overlap (never further than `firstDays`). */
export function syncWindowStart(today: string, lastSyncAt: Date | undefined, now: Date, firstDays: number): string {
  if (!lastSyncAt) return shiftDate(today, -firstDays);
  const sinceDays = Math.ceil((now.getTime() - lastSyncAt.getTime()) / 86_400_000) + OVERLAP_DAYS;
  return shiftDate(today, -Math.min(firstDays, Math.max(OVERLAP_DAYS, sinceDays)));
}

export const externalIdOf = (activity: GarminActivity): string => `garmin-${activity.id}`;

/** "Jalan cepat (Garmin)", or "Paddelball (Garmin)" for a kind of workout the diary has no label for. Garmin's own title is not used: its default carries the city. */
export function workoutName(locale: Locale, activity: GarminActivity): string {
  const label = workoutTypeLabel(locale, activity.type) ?? (activity.type === "OtherWorkout" ? humanTypeKey(activity.typeKey) : null);
  const t = serverT(locale, "garmin");
  return label === null ? t("workout.other") : t("workout.named", { label });
}

async function listActivities(client: GarminClient, start: string, end: string): Promise<{ activities: GarminActivity[]; unparsed: number }> {
  const activities: GarminActivity[] = [];
  let unparsed = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await client.activities(start, end, page * ACTIVITY_PAGE);
    const parsed = parseActivities(body);
    activities.push(...parsed.activities);
    unparsed += parsed.unparsed;
    if ((Array.isArray(body) ? body.length : 0) < ACTIVITY_PAGE) break;
  }
  return { activities, unparsed };
}

/**
 * Imports the user's Garmin data (docs/garmin.md):
 *
 * - Workouts → `exercise_log` (`source = 'garmin'`, `external_id = garmin-<activityId>`). Calories are Garmin's `calories`
 *   minus its `bmrCalories` (the resting energy inside it); without calories the MET estimate of the type.
 *   An activity another source already holds (same day, same kind, duration within two minutes) is not imported, and a
 *   Garmin row stored before the other copy arrived is deleted, as with COROS.
 * - Weigh-ins → `weight_log` (`source = 'garmin'`). A day that holds anything but a Garmin row is left alone.
 * - Daily steps, distance, active calories and intensity minutes → `daily_activity` (`source = 'garmin'`), under the same rule
 *   as the health stores: another source's row is replaced only by a reading with at least as many steps.
 * - Windows: 30 days (workouts, days) and 90 days (weigh-ins) on the first sync, afterwards since the last sync minus 2 days.
 */
export async function syncGarmin(input: GarminSyncInput): Promise<GarminSyncResult> {
  const { db, userId } = input;
  const now = input.now ?? new Date();
  const status = await garminStatus(db, userId);
  if (!status.connected) throw new GarminSyncError("not_connected");
  const today = jakartaToday(now, input.zone);
  const activityStart = syncWindowStart(today, status.lastSyncAt, now, ACTIVITY_DAYS);
  const weightStart = syncWindowStart(today, status.lastSyncAt, now, WEIGHT_DAYS);

  let fetched;
  try {
    fetched = await fetchAll(input, now, { activityStart, weightStart, end: today });
  } catch (error) {
    throw await failSync(input, error);
  }

  try {
    const workouts = await importActivities(input, fetched.activities, activityStart);
    const weights = await importWeights(input, fetched.weighIns, weightStart);
    const days = await importDays(input, fetched.days, activityStart);
    await recordSync(db, userId, { at: now });
    return { ...workouts, weights, days, unparsed: fetched.unparsed };
  } catch (error) {
    throw await failSync(input, error);
  }
}

async function fetchAll(input: GarminSyncInput, now: Date, window: { activityStart: string; weightStart: string; end: string }) {
  let token = await freshToken(input.db, input.userId, { now }, input.fetcher);
  if (!token) throw new GarminSyncError("not_connected");
  for (let attempt = 0; ; attempt++) {
    const client = new GarminClient(token, input.fetcher);
    try {
      const [listed, weights, summaries] = await Promise.all([
        listActivities(client, window.activityStart, window.end),
        client.weights(window.weightStart, window.end),
        client.dailySummaries(window.activityStart, window.end),
      ]);
      const weighIns = parseWeighIns(weights);
      const days = parseDailySummaries(summaries);
      return {
        activities: listed.activities,
        weighIns: weighIns.entries,
        days: days.days,
        unparsed: listed.unparsed + weighIns.unparsed + days.unparsed,
      };
    } catch (error) {
      if (!(error instanceof GarminApiError) || error.failure !== "unauthorized" || attempt > 0) throw error;
      // The token was refused before it expired: mint a new one and ask again.
      token = await freshToken(input.db, input.userId, { now, force: true }, input.fetcher);
      if (!token) throw new GarminSyncError("not_connected");
    }
  }
}

async function importActivities(input: GarminSyncInput, activities: readonly GarminActivity[], start: string) {
  const { db, userId } = input;
  const [storedRows, otherRows] = await Promise.all([
    db
      .select({ externalId: exerciseLog.externalId })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "garmin"), gte(exerciseLog.date, start))),
    db
      .select({ date: exerciseLog.date, type: exerciseLog.type, durationMin: exerciseLog.durationMin })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), inArray(exerciseLog.source, OTHER_SOURCES), gte(exerciseLog.date, start))),
  ]);
  const stored = new Set(storedRows.map((row) => row.externalId));
  const others = diaryMatcher(otherRows);

  const fresh: Array<{ activity: GarminActivity; externalId: string }> = [];
  const duplicateOfOther = new Set<string>();
  const seen = new Set<string>();
  for (const activity of [...activities].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (activity.date < start) continue;
    const externalId = externalIdOf(activity);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    if (others.take({ date: activity.date, type: activity.type, durationMin: activity.durationSec / 60 })) duplicateOfOther.add(externalId);
    else if (!stored.has(externalId)) fresh.push({ activity, externalId });
  }

  // Garmin rows stored before the other source's copy of the same workout arrived.
  for (const ids of chunk(
    [...duplicateOfOther].filter((id) => stored.has(id)),
    90,
  )) {
    await db.delete(exerciseLog).where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "garmin"), inArray(exerciseLog.externalId, ids)));
  }

  let imported = 0;
  if (fresh.length > 0) {
    const weightAt = await weightLookup(db, userId);
    const rows = fresh.map(({ activity, externalId }) => {
      const durationMin = activity.durationSec / 60;
      const weightKg = weightAt(activity.date);
      const net = netKcal(activity.grossKcal, activity.restingKcal, (weightKg * durationMin) / 60);
      const kcal = net ?? estimateKcal(metForStravaType(activity.type), weightKg, durationMin);
      return {
        id: crypto.randomUUID(),
        userId,
        date: activity.date,
        type: activity.type,
        name: workoutName(input.locale, activity),
        durationMin,
        kcal: Math.min(EXERCISE_MAX_KCAL, Math.max(0, Math.round(kcal))),
        source: "garmin",
        externalId,
      };
    });
    const results = await insertChunked(db, exerciseLog, rows, (insert) =>
      insert.onConflictDoNothing({ target: [exerciseLog.userId, exerciseLog.source, exerciseLog.externalId] }).returning({ id: exerciseLog.id }),
    );
    imported = results.reduce((sum, result) => sum + result.length, 0);
  }
  return { imported, skipped: seen.size - imported };
}

/** Weigh-ins new to the diary or changed in Garmin; a day another source holds is left alone. */
async function importWeights(input: GarminSyncInput, entries: ReturnType<typeof parseWeighIns>["entries"], start: string): Promise<number> {
  const { db, userId } = input;
  const existing = await db
    .select({ date: weightLog.date, weightKg: weightLog.weightKg, source: weightLog.source })
    .from(weightLog)
    .where(and(eq(weightLog.userId, userId), gte(weightLog.date, start)));
  const byDate = new Map(existing.map((row) => [row.date, row]));
  // The last weigh-in of a day wins inside the answer.
  const latest = new Map(entries.filter((entry) => entry.date >= start).map((entry) => [entry.date, entry]));
  const rows = [...latest.values()]
    .filter((entry) => {
      const held = byDate.get(entry.date);
      return !held || (held.source === "garmin" && held.weightKg !== entry.weightKg);
    })
    .map((entry) => ({
      id: crypto.randomUUID(),
      userId,
      date: entry.date,
      weightKg: entry.weightKg,
      bodyFatPct: entry.bodyFatPct ?? null,
      waterPct: entry.waterPct ?? null,
      boneKg: entry.boneKg ?? null,
      source: "garmin" as const,
    }));
  const results = await insertChunked(db, weightLog, rows, (insert) =>
    insert
      .onConflictDoUpdate({
        target: [weightLog.userId, weightLog.date],
        set: {
          weightKg: sql`excluded.weight_kg`,
          bodyFatPct: sql`excluded.body_fat_pct`,
          waterPct: sql`excluded.water_pct`,
          boneKg: sql`excluded.bone_kg`,
        },
        // Never over a day another source holds, even if one arrived since the read above.
        setWhere: sql`${weightLog.source} = 'garmin'`,
      })
      .returning({ id: weightLog.id }),
  );
  return results.reduce((sum, result) => sum + result.length, 0);
}

/** Days whose rollup is new or changed; another source's row is replaced only by a reading with at least as many steps. */
async function importDays(input: GarminSyncInput, days: ReturnType<typeof parseDailySummaries>["days"], start: string): Promise<number> {
  const { db, userId } = input;
  const existing = await db
    .select({
      date: dailyActivity.date,
      steps: dailyActivity.steps,
      distanceMeters: dailyActivity.distanceMeters,
      activeCalories: dailyActivity.activeCalories,
      exerciseMinutes: dailyActivity.exerciseMinutes,
      source: dailyActivity.source,
    })
    .from(dailyActivity)
    .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.date, start)));
  const byDate = new Map(existing.map((row) => [row.date, row]));
  const rows = days
    .filter((day) => day.date >= start)
    .filter((day) => {
      const held = byDate.get(day.date);
      if (!held) return true;
      if (held.source !== "garmin") return day.steps >= held.steps;
      return (
        held.steps !== day.steps ||
        held.distanceMeters !== day.distanceMeters ||
        held.activeCalories !== day.activeCalories ||
        held.exerciseMinutes !== day.exerciseMinutes
      );
    })
    .map((day) => ({ id: crypto.randomUUID(), userId, ...day, source: "garmin" }));
  const results = await insertChunked(db, dailyActivity, rows, (insert) =>
    insert
      .onConflictDoUpdate({
        target: [dailyActivity.userId, dailyActivity.date],
        set: {
          steps: sql`excluded.steps`,
          distanceMeters: sql`excluded.distance_meters`,
          activeCalories: sql`excluded.active_calories`,
          exerciseMinutes: sql`excluded.exercise_minutes`,
          source: sql`excluded.source`,
        },
        setWhere: sql`${dailyActivity.source} = 'garmin' or excluded.steps >= ${dailyActivity.steps}`,
      })
      .returning({ id: dailyActivity.id }),
  );
  return results.reduce((sum, result) => sum + result.length, 0);
}

/** Maps a failure to the error the caller sees, and keeps it on the account row for the next status. */
async function failSync(input: GarminSyncInput, error: unknown): Promise<unknown> {
  if (error instanceof GarminSyncError) return error;
  const rejected = error instanceof GarminGrantError && error.failure === "rejected";
  const expired = rejected || (error instanceof GarminApiError && error.failure === "unauthorized");
  // A refused key already deleted the row; anything else keeps it and notes what went wrong (messages never carry a secret).
  if (!rejected) await recordSync(input.db, input.userId, { error: error instanceof Error ? error.message : String(error) });
  return new GarminSyncError(expired ? "expired" : "unavailable");
}
