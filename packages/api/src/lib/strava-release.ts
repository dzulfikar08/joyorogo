import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { exerciseLog, stravaAccount, stravaRelease } from "@joyorogo/db/schema/fitness";
import { D1_MAX_PARAMS, chunk } from "./d1";
import { type StravaCapacity, connectedAthletes } from "./strava-capacity";
import { type StravaGrantEnv, revoke } from "./strava-grant";
import { effectiveTier } from "./tiers";

/**
 * Releasing Strava slots (docs/strava.md "Capacity"): an idle free user's grant is revoked at Strava, the row deleted
 * with everything JoyoRogo imported from Strava (the same as a disconnect), and a `strava_release` row tells the user
 * why on the next status call. Paying users (`effectiveTier`, which covers the owner's `founder` comp) are never
 * released. "Idle" = the grant row has not changed for that long: `updated_at` moves on every token refresh, and an
 * access token lasts six hours, so any use of Strava by either product refreshes it within a day.
 */

export const RELEASE_REASON = "released_for_pro";
const DAY_MS = 86_400_000;
/** Most athletes one call releases; the cron needs at most `reserve`. */
export const RELEASE_MAX = 50;

export type ReleaseOutcome = "released" | "would_release" | "paid" | "not_found";

export type ReleaseResult = {
  athleteId: string;
  outcome: ReleaseOutcome;
  /** Strava confirmed the revoke; only for `released`. */
  revoked?: boolean;
  /** Accounts that linked this athlete. */
  users: number;
  /** Latest `updated_at` of the athlete's rows (last token use), ISO. */
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

const holderColumns = {
  userId: stravaAccount.userId,
  athleteId: stravaAccount.athleteId,
  refreshToken: stravaAccount.refreshToken,
  updatedAt: stravaAccount.updatedAt,
  tier: user.tier,
  founderUntil: user.founderUntil,
};

/** Athlete id -> its rows, in the order the rows came. */
function byAthlete(rows: Holder[]): Map<string, Holder[]> {
  const grouped = new Map<string, Holder[]>();
  for (const row of rows) grouped.set(row.athleteId, [...(grouped.get(row.athleteId) ?? []), row]);
  return grouped;
}

const lastUse = (rows: Holder[]) => new Date(Math.max(...rows.map((r) => r.updatedAt.getTime())));

/**
 * Revokes the athlete's grant and drops every row of it, the imported Strava activities of those users, and leaves
 * the notice. Strava keeps one grant per athlete and application, so one confirmed revoke covers all rows.
 */
async function releaseOne(
  db: Database,
  env: StravaGrantEnv,
  rows: Holder[],
  trigger: "idle" | "manual",
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
  await db.batch([
    dropImported(firstSlice),
    ...otherSlices.map(dropImported),
    db.delete(stravaAccount).where(eq(stravaAccount.athleteId, athleteId)),
    ...userIds.map((userId) => {
      const notice = { athleteId, reason: RELEASE_REASON, revoked, releasedAt: now };
      return db
        .insert(stravaRelease)
        .values({ userId, ...notice })
        .onConflictDoUpdate({ target: stravaRelease.userId, set: notice });
    }),
  ]);
  const lastUsedAt = lastUse(rows).toISOString();
  console.log(
    JSON.stringify({
      event: "strava_slot_released",
      trigger,
      athleteId,
      userIds,
      revoked,
      lastUsedAt,
      reason: RELEASE_REASON,
    }),
  );
  return { athleteId, outcome: "released", revoked, users: rows.length, lastUsedAt };
}

const isPaid = (rows: Holder[], now: Date) => rows.some((r) => effectiveTier(r, now) === "founder");

/**
 * Releases idle free athletes, longest unused first: rows untouched for `olderThanDays`, none of whose accounts is a
 * paying user, at most `max`. `dryRun` reports what would go and changes nothing.
 */
export async function releaseIdleFree(
  db: Database,
  env: StravaGrantEnv,
  options: { olderThanDays: number; max: number; dryRun?: boolean; now?: Date },
): Promise<ReleaseResult[]> {
  const now = options.now ?? new Date();
  const max = Math.min(Math.max(0, Math.floor(options.max)), RELEASE_MAX);
  if (max === 0) return [];
  const cutoff = new Date(now.getTime() - options.olderThanDays * DAY_MS);
  // The table holds one row per connected account (capacity-bound, a handful): read it whole and group by athlete,
  // which is idle only when all of its rows are.
  const rows = await db
    .select(holderColumns)
    .from(stravaAccount)
    .innerJoin(user, eq(user.id, stravaAccount.userId));
  const chosen = [...byAthlete(rows)]
    .filter(([, held]) => lastUse(held).getTime() < cutoff.getTime() && !isPaid(held, now))
    .sort(([, a], [, b]) => lastUse(a).getTime() - lastUse(b).getTime())
    .slice(0, max);
  const results: ReleaseResult[] = [];
  for (const [athleteId, held] of chosen) {
    results.push(
      options.dryRun
        ? {
            athleteId,
            outcome: "would_release",
            users: held.length,
            lastUsedAt: lastUse(held).toISOString(),
          }
        : await releaseOne(db, env, held, "idle", now),
    );
  }
  return results;
}

/**
 * Releases the named athletes (the owner's one-off call, `POST /internal/strava/release`), whether idle or not. An
 * athlete linked to a paying account is refused (`paid`), an unknown one is `not_found`.
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
    .select(holderColumns)
    .from(stravaAccount)
    .innerJoin(user, eq(user.id, stravaAccount.userId))
    .where(inArray(stravaAccount.athleteId, ids));
  const grouped = byAthlete(rows);
  const results: ReleaseResult[] = [];
  for (const athleteId of ids) {
    const held = grouped.get(athleteId);
    if (!held) {
      results.push({ athleteId, outcome: "not_found", users: 0 });
    } else if (isPaid(held, now)) {
      results.push({
        athleteId,
        outcome: "paid",
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
      results.push(await releaseOne(db, env, held, "manual", now));
    }
  }
  return results;
}

/**
 * The cron's part (every tick, apps/server/src/index.ts): while fewer than `reserve` slots are free, release idle free
 * athletes until the reserve is back. One count query when nothing is needed.
 */
export async function keepPaidReserve(
  db: Database,
  env: StravaGrantEnv,
  capacity: StravaCapacity,
  now = new Date(),
): Promise<ReleaseResult[]> {
  const free = capacity.capacity - (await connectedAthletes(db));
  if (free >= capacity.reserve) return [];
  return releaseIdleFree(db, env, {
    olderThanDays: capacity.idleDays,
    max: capacity.reserve - free,
    now,
  });
}

export type StravaReleaseNotice = { at: Date; reason: typeof RELEASE_REASON };

/** Why the user's Strava is gone, when JoyoRogo released it; null otherwise (or once they connected again). */
export async function releaseNotice(
  db: Database,
  userId: string,
): Promise<StravaReleaseNotice | null> {
  const [row] = await db
    .select({ at: stravaRelease.releasedAt })
    .from(stravaRelease)
    .where(eq(stravaRelease.userId, userId))
    .limit(1);
  return row ? { at: row.at, reason: RELEASE_REASON } : null;
}
