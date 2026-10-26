import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { exerciseLog, stravaAccount, stravaRelease } from "@joyorogo/db/schema/fitness";
import { D1_MAX_PARAMS, chunk } from "./d1";
import { type StravaGrantEnv, revoke } from "./strava-grant";
import { effectiveTier } from "./tiers";

/**
 * Freeing Strava slots by hand (docs/strava.md "Capacity"): the owner names athletes whose connection has gone unused,
 * and each one's grant is revoked at Strava, its rows deleted with everything JoyoRogo imported from Strava (the same
 * as a disconnect), and a `strava_release` row tells the user on the next status call that the connection was
 * released because it was not used. Nothing here runs by itself. As a safety guard for this admin tool, an athlete
 * linked to a Pro account (`effectiveTier`, which covers the owner's comp) is refused; the user-facing rules never look
 * at plans.
 */

/** `strava_release.reason`: the connection went unused. */
export const RELEASE_REASON = "idle";
/** Most athletes one call releases. */
export const RELEASE_MAX = 50;

export type ReleaseOutcome = "released" | "would_release" | "protected" | "not_found";

export type ReleaseResult = {
  athleteId: string;
  outcome: ReleaseOutcome;
  /** Strava confirmed the revoke; only for `released`. */
  revoked?: boolean;
  /** Accounts that linked this athlete. */
  users: number;
  /** Latest `updated_at` of the athlete's rows (last token refresh), ISO. */
  lastUsedAt?: string;
};

type Holder = {
  userId: string;
  athleteId: string;
  refreshToken: string;
  updatedAt: Date;
  tier: "free" | "founder";
  founderUntil: Date | null;
};

const lastUse = (rows: Holder[]) => new Date(Math.max(...rows.map((r) => r.updatedAt.getTime())));

/**
 * Revokes the athlete's grant and drops every row of it, the imported Strava activities of those users, and leaves
 * the notice. Strava keeps one grant per athlete and application, so one confirmed revoke covers all rows.
 */
async function releaseOne(
  db: Database,
  env: StravaGrantEnv,
  rows: Holder[],
  now: Date,
): Promise<ReleaseResult> {
  const athleteId = rows[0]!.athleteId;
  let revoked = false;
  for (const token of new Set(rows.map((r) => r.refreshToken)))
    revoked = (await revoke(env, token)) || revoked;
  const userIds = rows.map((r) => r.userId);
  const [firstSlice = [], ...otherSlices] = chunk(userIds, D1_MAX_PARAMS - 1);
  const dropImported = (slice: string[]) =>
    db
      .delete(exerciseLog)
      .where(and(inArray(exerciseLog.userId, slice), eq(exerciseLog.source, "strava")));
  const notice = { athleteId, reason: RELEASE_REASON, revoked, releasedAt: now };
  await db.batch([
    dropImported(firstSlice),
    ...otherSlices.map(dropImported),
    db.delete(stravaAccount).where(eq(stravaAccount.athleteId, athleteId)),
    ...userIds.map((userId) =>
      db
        .insert(stravaRelease)
        .values({ userId, ...notice })
        .onConflictDoUpdate({ target: stravaRelease.userId, set: notice }),
    ),
  ]);
  const lastUsedAt = lastUse(rows).toISOString();
  console.log(
    JSON.stringify({ event: "strava_slot_released", athleteId, userIds, revoked, lastUsedAt }),
  );
  return { athleteId, outcome: "released", revoked, users: rows.length, lastUsedAt };
}

/**
 * Releases the named athletes (`POST /internal/strava/release`). An athlete linked to a Pro account is refused
 * (`protected`), an unknown one is `not_found`; `dryRun` reports and changes nothing.
 */
export async function releaseAthletes(
  db: Database,
  env: StravaGrantEnv,
  athleteIds: string[],
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<ReleaseResult[]> {
  const now = options.now ?? new Date();
  const ids = [...new Set(athleteIds)].slice(0, Math.min(RELEASE_MAX, D1_MAX_PARAMS));
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      userId: stravaAccount.userId,
      athleteId: stravaAccount.athleteId,
      refreshToken: stravaAccount.refreshToken,
      updatedAt: stravaAccount.updatedAt,
      tier: user.tier,
      founderUntil: user.founderUntil,
    })
    .from(stravaAccount)
    .innerJoin(user, eq(user.id, stravaAccount.userId))
    .where(inArray(stravaAccount.athleteId, ids));
  const results: ReleaseResult[] = [];
  for (const athleteId of ids) {
    const held = rows.filter((r) => r.athleteId === athleteId);
    if (held.length === 0) {
      results.push({ athleteId, outcome: "not_found", users: 0 });
    } else if (held.some((r) => effectiveTier(r, now) === "founder")) {
      results.push({
        athleteId,
        outcome: "protected",
        users: held.length,
        lastUsedAt: lastUse(held).toISOString(),
      });
    } else if (options.dryRun) {
      results.push({
        athleteId,
        outcome: "would_release",
        users: held.length,
        lastUsedAt: lastUse(held).toISOString(),
      });
    } else {
      results.push(await releaseOne(db, env, held, now));
    }
  }
  return results;
}

/** When JoyoRogo released the user's Strava connection; null otherwise (or once they connected again). */
export async function releasedAt(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: stravaRelease.releasedAt })
    .from(stravaRelease)
    .where(eq(stravaRelease.userId, userId))
    .limit(1);
  return row?.at ?? null;
}
