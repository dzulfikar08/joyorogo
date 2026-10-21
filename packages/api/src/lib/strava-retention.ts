import { and, eq, inArray, lt, lte, or } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { exerciseLog } from "@joyorogo/db/schema/fitness";

/**
 * Strava API Policy 6.2 (Cache and Retention): "You may not retain Strava Data in your cache for longer than seven (7)
 * days." Imported activities (`exercise_log.source = 'strava'`) are that cache. They are deleted whole, calories
 * included: the policy has no exception for derived or diary data (docs/strava.md).
 *
 * A row expires when its activity day (`date`, WIB) is on or before `stravaRetentionCutoff`, which is at most 7 days
 * after the activity started, or when it was fetched (`created_at`, which an edit never changes) more than 7 days ago.
 * The second test stops a user from keeping a row by moving its date forward. `strava.sync` skips activities that fail
 * the first test, so a scrubbed activity is never re-imported.
 */
export const STRAVA_RETENTION_DAYS = 7;

// WIB on purpose: one global cutoff for the cron over all users; the `created_at` test bounds a user in another zone to 7 days.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Newest WIB day (YYYY-MM-DD) that is already expired at `now`: rows dated on or before it must not exist, and
 * activities that started on or before it are not imported.
 */
export function stravaRetentionCutoff(now: Date = new Date()): string {
  const expiredBefore = now.getTime() - STRAVA_RETENTION_DAYS * DAY_MS + WIB_OFFSET_MS;
  return new Date(expiredBefore).toISOString().slice(0, 10);
}

const BATCH_SIZE = 200;
// A runaway guard, not a limit anyone should reach: 50 batches of 200 rows.
const MAX_BATCHES = 50;

/**
 * Deletes every expired `source = 'strava'` row of every user, `batchSize` rows per statement so no single D1 query
 * runs long. Idempotent: a second run right after finds nothing. Returns the number of rows deleted.
 */
export async function scrubExpiredStravaRows(
  db: Database,
  now: Date = new Date(),
  batchSize: number = BATCH_SIZE,
): Promise<number> {
  const cutoff = stravaRetentionCutoff(now);
  const fetchedBefore = new Date(now.getTime() - STRAVA_RETENTION_DAYS * DAY_MS);
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const gone = await db
      .delete(exerciseLog)
      .where(
        inArray(
          exerciseLog.id,
          db
            .select({ id: exerciseLog.id })
            .from(exerciseLog)
            .where(
              and(
                eq(exerciseLog.source, "strava"),
                or(lte(exerciseLog.date, cutoff), lt(exerciseLog.createdAt, fetchedBefore)),
              ),
            )
            .limit(batchSize),
        ),
      )
      .returning({ id: exerciseLog.id });
    deleted += gone.length;
    if (gone.length < batchSize) break;
  }
  return deleted;
}
