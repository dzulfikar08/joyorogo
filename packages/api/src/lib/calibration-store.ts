import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { syncRecord } from "@joyorogo/db/schema/sync";

import {
  CALIBRATION_PREF_KEY,
  CALIBRATION_PREF_KEYS,
  CALIBRATION_SEEN_PREF_KEY,
  DEFAULT_CALIBRATION_ENABLED,
  sanitizeSeenKcal,
} from "./calibration";
import { docValue } from "./exercise-credit-store";

// Server side of the automatic calibration's two synced preferences (sync_record ns 'rogo', kind 'pref', id = the key,
// json `{"value": ...}`; a tombstone or a missing row means the default). They are part of `planQueries`, so every
// consumer of buildPlan sees the same switch.

/** Query shaped for `db.batch`: the live rows of the calibration switch and of the last base target the person saw. */
export function calibrationPrefQuery(db: Database, userId: string) {
  return db
    .select({ id: syncRecord.id, json: syncRecord.json })
    .from(syncRecord)
    .where(
      and(
        eq(syncRecord.userId, userId),
        eq(syncRecord.ns, "rogo"),
        eq(syncRecord.kind, "pref"),
        inArray(syncRecord.id, [...CALIBRATION_PREF_KEYS]),
        isNull(syncRecord.deletedAt),
      ),
    );
}

export type CalibrationPrefRows = { id: string; json: string }[];

/** The same rows for several people at once (a group's members), one query; `userId` tells whose each row is. */
export function calibrationPrefsOfUsersQuery(db: Database, userIds: string[]) {
  return db
    .select({ userId: syncRecord.userId, id: syncRecord.id, json: syncRecord.json })
    .from(syncRecord)
    .where(
      and(
        inArray(syncRecord.userId, userIds),
        eq(syncRecord.ns, "rogo"),
        eq(syncRecord.kind, "pref"),
        inArray(syncRecord.id, [...CALIBRATION_PREF_KEYS]),
        isNull(syncRecord.deletedAt),
      ),
    );
}

/** The switch on and nothing acknowledged: what an account with no stored calibration preference has. */
export const DEFAULT_CALIBRATION_PREFS: CalibrationPrefs = { enabled: DEFAULT_CALIBRATION_ENABLED, seenKcal: null };

export type CalibrationPrefs = {
  enabled: boolean;
  /** the calibrated base target the person last acknowledged on Beranda; null before the first one */
  seenKcal: number | null;
};

/** The switch (default on; a malformed value is the default) and the acknowledged figure from the rows. */
export function readCalibrationPrefs(rows: CalibrationPrefRows): CalibrationPrefs {
  let enabled = DEFAULT_CALIBRATION_ENABLED;
  let seenKcal: number | null = null;
  for (const row of rows) {
    const value = docValue(row.json);
    if (row.id === CALIBRATION_PREF_KEY && typeof value === "boolean") enabled = value;
    else if (row.id === CALIBRATION_SEEN_PREF_KEY) seenKcal = sanitizeSeenKcal(value) ?? null;
  }
  return { enabled, seenKcal };
}
