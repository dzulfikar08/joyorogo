// Cron side of badges and the leaderboard (docs/badges.md), called from the five-minute Worker tick in apps/server.
//   - nightly, the first tick from 00:10 WIB: tiered and period badges for the people whose numbers can have moved;
//   - every 30 minutes: the running week's leaderboard snapshot;
//   - Monday from 00:30 WIB: the week that just closed, once more, so its board is final.
// Every step is idempotent (INSERT OR IGNORE awards, upserted snapshot rows), so a missed or repeated tick costs nothing.
import { asc, between, eq, gt, gte } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { teamChallenge, teamChallengeMember } from "@joyorogo/db/schema/challenge";
import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

import { awardUsers } from "./badge-store";
import { RAMADAN_WINDOWS, badgesAllowlist, badgesEnabled, badgesForEveryone } from "./badges";
import type { BadgesEnv } from "./badges";
import { chunk } from "./d1";
import { jakartaToday, shiftDate } from "./engine";
import { wibMinutes } from "./fasting";
import { computeWeek, currentWeekStart } from "./leaderboard";

/** Users evaluated per group: each group is one set of fact queries, every one bounded by readChunked. */
const GROUP_SIZE = 25;
/** Most users one nightly run evaluates when the flag is `*`; the rest are caught on a later night or by the backfill. */
export const NIGHTLY_MAX_USERS = 1000;
/** A night looks this many days back for activity (so a missed night is caught the next one). */
const ACTIVITY_DAYS = 3;

export type BadgeCronDeps = { db: Database; env: BadgesEnv; now?: () => Date };
export type BadgeCronReport = { nightly: { users: number; awarded: number } | null; board: boolean; closedWeek: boolean };

/** Whose numbers can have moved since the last night: the allowlist, plus (flag `*`) whoever logged, finished a challenge or closed a Ramadan window lately. */
export async function nightlyUsers(db: Database, env: BadgesEnv, now: Date): Promise<string[]> {
  const ids = new Set(badgesAllowlist(env));
  if (badgesForEveryone(env)) {
    const today = jakartaToday(now, DEFAULT_DAY_ZONE);
    const since = shiftDate(today, -ACTIVITY_DAYS);
    const active = await db
      .selectDistinct({ userId: foodLog.userId })
      .from(foodLog)
      .where(gte(foodLog.createdAt, new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000)))
      .limit(NIGHTLY_MAX_USERS);
    for (const row of active) ids.add(row.userId);
    const finishing = await db
      .selectDistinct({ userId: teamChallengeMember.userId })
      .from(teamChallengeMember)
      .innerJoin(teamChallenge, eq(teamChallenge.id, teamChallengeMember.challengeId))
      .where(between(teamChallenge.endDate, since, shiftDate(today, -1)))
      .limit(NIGHTLY_MAX_USERS);
    for (const row of finishing) ids.add(row.userId);
    for (const window of RAMADAN_WINDOWS) {
      if (window.end >= today || window.end < since) continue;
      const inWindow = await db
        .selectDistinct({ userId: foodLog.userId })
        .from(foodLog)
        .where(between(foodLog.date, window.start, window.end))
        .limit(NIGHTLY_MAX_USERS);
      for (const row of inWindow) ids.add(row.userId);
    }
  }
  return [...ids].filter((id) => badgesEnabled(env, id)).slice(0, NIGHTLY_MAX_USERS);
}

/** Evaluates every badge of `userIds` against their history (the nightly job and the backfill share this). */
export async function awardGroups(db: Database, userIds: readonly string[], now: Date): Promise<{ users: number; awarded: number }> {
  const today = jakartaToday(now, DEFAULT_DAY_ZONE);
  let users = 0;
  let awarded = 0;
  for (const group of chunk(userIds, GROUP_SIZE)) {
    const result = await awardUsers(db, group, today, now);
    users += result.users;
    awarded += result.awarded;
  }
  return { users, awarded };
}

/**
 * Backfill: awards what people already earned, `limit` users per call in user-id order after `after` (null = from the start).
 * `next` is the cursor for the following call, null when the last page was done. Admin-triggered (POST /api/admin/badges/backfill);
 * the first nightly run also covers the allowlisted users, so for an owner-only rollout no call is needed.
 */
export async function backfillBadges(
  db: Database,
  env: BadgesEnv,
  options: { after?: string | null; limit?: number; now?: Date } = {},
): Promise<{ processed: number; awarded: number; next: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const page = await db
    .select({ userId: profile.userId })
    .from(profile)
    .where(options.after ? gt(profile.userId, options.after) : undefined)
    .orderBy(asc(profile.userId))
    .limit(limit);
  const enabled = page.map((p) => p.userId).filter((id) => badgesEnabled(env, id));
  const { awarded } = await awardGroups(db, enabled, options.now ?? new Date());
  return { processed: enabled.length, awarded, next: page.length === limit ? (page[page.length - 1]?.userId ?? null) : null };
}

/** One five-minute tick. Each step is isolated: one failing never skips the others. */
export async function runBadgesCron(deps: BadgeCronDeps): Promise<BadgeCronReport> {
  const report: BadgeCronReport = { nightly: null, board: false, closedWeek: false };
  const { db, env } = deps;
  if ((env.BADGES_USER_IDS ?? "").trim() === "") return report;
  const now = (deps.now ?? (() => new Date()))();
  // WIB on purpose: the board and the nightly job are the shared clock of the product, not one person's day.
  const minutes = wibMinutes(now, DEFAULT_DAY_ZONE);
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      console.error(`[badges] ${name} failed`, error);
    }
  };
  if (minutes >= 10 && minutes < 15) {
    await step("nightly", async () => {
      report.nightly = await awardGroups(db, await nightlyUsers(db, env, now), now);
    });
  }
  if (minutes % 30 < 5) {
    await step("board", async () => {
      await computeWeek(db, env, currentWeekStart(now), now);
      report.board = true;
    });
  }
  const isMonday = new Date(now.getTime() + 7 * 3_600_000).getUTCDay() === 1;
  if (isMonday && minutes >= 30 && minutes < 35) {
    await step("closed-week", async () => {
      await computeWeek(db, env, shiftDate(currentWeekStart(now), -7), now);
      report.closedWeek = true;
    });
  }
  return report;
}
