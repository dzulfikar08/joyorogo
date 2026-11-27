// "Cek sesekali" (spot-check mode): someone who has learned their usual foods logs only new or unusual meals. Not
// logging on a day is their normal, so nothing treats it as a lapse: no meal or streak-risk push (lib/reminders), no
// win-back mail (apps/server lifecycle-email), no "N days without a log" on Beranda. Weigh-in reminders stay.
// Stored as the synced pref below (rogo-prefs.ts): `{"value": true}` while on, no live record while off.

export const SPOT_CHECK_PREF_KEY = "logging.spotCheck";

/**
 * SQL condition (raw, for a correlated subquery) that the person `userIdSql` has spot-check mode on. `userIdSql` must be
 * a trusted column reference such as `profile.user_id`.
 */
export function spotCheckOnSql(userIdSql: string): string {
  return `EXISTS (SELECT 1 FROM sync_record sc WHERE sc.user_id = ${userIdSql} AND sc.ns = 'rogo' AND sc.kind = 'pref'
    AND sc.id = '${SPOT_CHECK_PREF_KEY}' AND sc.deleted_at IS NULL AND json_extract(sc.json, '$.value') = 1)`;
}
