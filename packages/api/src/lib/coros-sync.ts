import { and, eq, gte, inArray } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { exerciseLog } from "@joyorogo/db/schema/fitness";
import type { DayZone, Locale } from "@joyorogo/i18n";

import { CorosGrantError, freshAccessToken, grantStatus, recordSync } from "./coros-grant";
import type { CorosEnv } from "./coros-grant";
import { CorosMcpClient, CorosMcpError } from "./coros-mcp";
import { corosWorkoutType } from "./coros-parse";
import type { CorosActivity } from "./coros-parse";
import { chunk, insertChunked } from "./d1";
import { jakartaToday, shiftDate } from "./engine";
import { EXERCISE_MAX_KCAL } from "./exercise-edit";
import { diaryMatcher } from "./import-dedupe";
import { serverT } from "./messages";
import { estimateKcal, metForStravaType } from "./met";
import { weightLookup } from "./weight-at";
import { workoutTypeLabel } from "./workout-label";

/** Days a first sync reaches back. */
export const FIRST_SYNC_DAYS = 14;
/** The longest reach back of a later sync, however long ago the last one was. */
export const MAX_SYNC_DAYS = 30;
/** A later sync starts this many days before the last one, so a late-arriving activity is still caught. */
export const OVERLAP_DAYS = 2;
/** Activities one sync asks COROS for. */
const RECORD_LIMIT = 50;
/** getActivityDetail calls per sync (one subrequest each); activities past it get the MET estimate. */
const DETAIL_CALLS = 30;
const DETAIL_CONCURRENCY = 4;
/** Where else the same workout arrives from: COROS also syncs to Health Connect, Apple Health and Strava. */
const OTHER_SOURCES = ["health_connect", "apple_health", "strava"];

export type CorosSyncFailure = "not_connected" | "expired" | "unavailable";

export class CorosSyncError extends Error {
  constructor(readonly failure: CorosSyncFailure) {
    super(`COROS sync: ${failure}`);
    this.name = "CorosSyncError";
  }
}

export type CorosSyncResult = {
  imported: number;
  /** Activities not imported: already stored, or the same workout another source holds. */
  skipped: number;
  /** Records in the answer that could not be read. */
  unparsed: number;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type CorosSyncInput = {
  db: Database;
  env: CorosEnv;
  userId: string;
  zone: DayZone;
  locale: Locale;
  now?: Date;
  /** The fetch used for COROS (token endpoint and MCP); tests pass a fake. */
  fetcher?: Fetcher;
};

/** "Lari (COROS)", the title COROS gave, or "Latihan COROS" for a kind of workout the diary has no label for. */
export function workoutName(locale: Locale, type: string, title: string | null): string {
  const t = serverT(locale, "coros");
  const label = title ?? workoutTypeLabel(locale, type);
  return label === null ? t("workout.other") : t("workout.named", { label });
}

const yyyymmdd = (date: string) => date.replaceAll("-", "");

export const externalIdOf = (activity: CorosActivity): string =>
  activity.labelId !== null
    ? `coros-${activity.labelId}`
    : // No identifier in the list: day, sport, start and length still tell two activities apart.
      `coros-${activity.date}-${activity.sportType}-${activity.startedAt?.replace(/\D/g, "") ?? "x"}-${activity.durationSec}`;

/** `since` the last sync minus the overlap, never further back than MAX_SYNC_DAYS; the first sync reaches FIRST_SYNC_DAYS. */
export function syncWindowStart(today: string, lastSyncAt: Date | undefined, now: Date): string {
  if (!lastSyncAt) return shiftDate(today, -FIRST_SYNC_DAYS);
  const sinceDays = Math.ceil((now.getTime() - lastSyncAt.getTime()) / 86_400_000) + OVERLAP_DAYS;
  return shiftDate(today, -Math.min(MAX_SYNC_DAYS, Math.max(OVERLAP_DAYS, sinceDays)));
}

async function listActivities(input: CorosSyncInput, start: string, now: Date) {
  const fetcher = input.fetcher;
  let token = await freshAccessToken(input.db, input.env, input.userId, { now }, fetcher);
  if (!token) throw new CorosSyncError("not_connected");
  for (let attempt = 0; ; attempt++) {
    const client = new CorosMcpClient(token.accessToken, fetcher);
    try {
      // End date "" = today in the COROS account's own time zone.
      return { client, ...(await client.querySportRecords(yyyymmdd(start), "", RECORD_LIMIT)) };
    } catch (error) {
      if (!(error instanceof CorosMcpError) || error.failure !== "unauthorized" || attempt > 0) throw error;
      // The access token was refused before it expired: refresh once and ask again.
      token = await freshAccessToken(input.db, input.env, input.userId, { now, force: true }, fetcher);
      if (!token) throw new CorosSyncError("not_connected");
    }
  }
}

/** Calories of each activity by its identifier; an activity whose detail cannot be read is absent (the MET estimate covers it). */
async function detailKcal(client: CorosMcpClient, activities: readonly CorosActivity[]): Promise<Map<string, number>> {
  const kcal = new Map<string, number>();
  const withId = activities.filter((a) => a.labelId !== null).slice(0, DETAIL_CALLS);
  for (const group of chunk(withId, DETAIL_CONCURRENCY)) {
    await Promise.all(
      group.map(async (activity) => {
        try {
          const detail = await client.getActivityDetail(activity.labelId!, activity.sportType);
          if (detail.calories !== null) kcal.set(activity.labelId!, detail.calories);
        } catch (error) {
          // A token the server just refused ends the sync; anything else costs this activity its measured calories only.
          if (error instanceof CorosMcpError && error.failure === "unauthorized") throw error;
        }
      }),
    );
  }
  return kcal;
}

/**
 * Imports the user's COROS activities into the diary (`exercise_log.source = 'coros'`, `external_id = coros-<labelId>`).
 *
 * - Window: the last 14 days on the first sync, afterwards since the last sync minus 2 days (at most 30).
 * - Calories: `getActivityDetail`; without them the MET estimate of the workout type, the weight on that day and the duration.
 * - Duplicates: COROS also writes to Health Connect, Apple Health and Strava. An activity that one of those already holds
 *   (same day, same kind of workout, duration within two minutes) is not imported, and a COROS row stored before the other
 *   source's copy arrived is deleted, so a workout counts once whichever source reached the diary first.
 * - Idempotent: the unique (user, source, external_id) index; an activity already stored costs no detail call.
 * - A record that cannot be read is counted in `unparsed` and skipped.
 */
export async function syncCoros(input: CorosSyncInput): Promise<CorosSyncResult> {
  const now = input.now ?? new Date();
  const status = await grantStatus(input.db, input.userId);
  if (!status.connected) throw new CorosSyncError("not_connected");
  const today = jakartaToday(now, input.zone);
  const start = syncWindowStart(today, status.lastSyncAt, now);

  let listed;
  try {
    listed = await listActivities(input, start, now);
  } catch (error) {
    throw await failSync(input, error);
  }
  const { client, activities, unparsed } = listed;

  const [storedRows, otherRows] = await Promise.all([
    input.db
      .select({ externalId: exerciseLog.externalId })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, input.userId), eq(exerciseLog.source, "coros"), gte(exerciseLog.date, start))),
    input.db
      .select({ date: exerciseLog.date, type: exerciseLog.type, durationMin: exerciseLog.durationMin })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, input.userId), inArray(exerciseLog.source, OTHER_SOURCES), gte(exerciseLog.date, start))),
  ]);
  const stored = new Set(storedRows.map((row) => row.externalId));
  const others = diaryMatcher(otherRows);

  const fresh: Array<{ activity: CorosActivity; externalId: string; type: string }> = [];
  const duplicateOfOther = new Set<string>();
  const seen = new Set<string>();
  // COROS filters by its own day; an activity before our window start is not ours to look at again.
  const ordered = activities.filter((a) => a.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  for (const activity of ordered) {
    const externalId = externalIdOf(activity);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const type = corosWorkoutType(activity.sportType);
    const held = others.take({ date: activity.date, type, durationMin: (activity.durationSec ?? 0) / 60 });
    if (held) duplicateOfOther.add(externalId);
    else if (!stored.has(externalId)) fresh.push({ activity, externalId, type });
  }

  // COROS rows stored before the other source's copy of the same workout arrived.
  const superseded = [...duplicateOfOther].filter((id) => stored.has(id));
  for (const ids of chunk(superseded, 90)) {
    await input.db
      .delete(exerciseLog)
      .where(and(eq(exerciseLog.userId, input.userId), eq(exerciseLog.source, "coros"), inArray(exerciseLog.externalId, ids)));
  }

  let imported = 0;
  if (fresh.length > 0) {
    let kcalById: Map<string, number>;
    try {
      kcalById = await detailKcal(
        client,
        fresh.map((f) => f.activity),
      );
    } catch (error) {
      throw await failSync(input, error);
    }
    const weightAt = await weightLookup(input.db, input.userId);
    const rows = fresh.map(({ activity, externalId, type }) => {
      const durationMin = (activity.durationSec ?? 0) / 60;
      const measured = activity.labelId === null ? undefined : kcalById.get(activity.labelId);
      const kcal = measured ?? estimateKcal(metForStravaType(type), weightAt(activity.date), durationMin);
      return {
        id: crypto.randomUUID(),
        userId: input.userId,
        date: activity.date,
        type,
        name: workoutName(input.locale, type, activity.name),
        durationMin,
        kcal: Math.min(EXERCISE_MAX_KCAL, Math.max(0, Math.round(kcal))),
        source: "coros",
        externalId,
      };
    });
    const results = await insertChunked(input.db, exerciseLog, rows, (insert) =>
      insert.onConflictDoNothing({ target: [exerciseLog.userId, exerciseLog.source, exerciseLog.externalId] }).returning({ id: exerciseLog.id }),
    );
    imported = results.reduce((sum, result) => sum + result.length, 0);
  }

  await recordSync(input.db, input.userId, { at: now });
  return { imported, skipped: seen.size - imported, unparsed };
}

/** Maps a failure to the error the caller sees, and keeps it on the account row for the next status. */
async function failSync(input: CorosSyncInput, error: unknown): Promise<unknown> {
  if (error instanceof CorosSyncError) return error;
  const expired =
    (error instanceof CorosGrantError && error.failure === "rejected") ||
    (error instanceof CorosMcpError && error.failure === "unauthorized");
  const reason = expired ? "expired" : "unavailable";
  if (!(error instanceof CorosGrantError && error.failure === "rejected")) {
    // A refused refresh token already deleted the row; anything else keeps it and notes what went wrong.
    await recordSync(input.db, input.userId, { error: error instanceof Error ? error.message : String(error) });
  }
  return new CorosSyncError(reason);
}
