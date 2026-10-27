// Weekly consistency leaderboard, database side (docs/badges.md). The snapshot of a week holds the rows of people who opted
// in; ranking order is `compareScores` (days logged, workout days, protein days, streak, alias). Weight and body data are
// never read here. People in Hamil / Menyusui are left out: a ranking of how much they log is not for them.
import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { leaderboardPref, leaderboardWeek } from "@joyorogo/db/schema/badges";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

import { LEADERBOARD_STREAK_DAYS, badgesEnabled, rankWeek, weekScore, weekStartOf } from "./badges";
import type { BadgesEnv, RankInput } from "./badges";
import { loadLoggedDays, loadUserInputs, loadWorkoutDays } from "./badge-store";
import { chunk, D1_MAX_PARAMS, insertChunked } from "./d1";
import { jakartaToday, shiftDate } from "./engine";

const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);

/** The Monday of the current week in WIB (the week of the leaderboard is cut in WIB for everyone). */
export function currentWeekStart(now: Date): string {
  return weekStartOf(jakartaToday(now, DEFAULT_DAY_ZONE));
}

export type ComputeReport = { optedIn: number; ranked: number; removed: number };

/**
 * Recomputes the snapshot of the week starting `weekStart` (a Monday) for everyone who is opted in and allowed:
 * rows are upserted, and rows of people who opted out, are in maternal mode or logged nothing are removed. Days after
 * `now` do not count, so a running week is a live board and a closed week is final once it has been computed.
 */
export async function computeWeek(db: Database, env: BadgesEnv, weekStart: string, now: Date): Promise<ComputeReport> {
  const asOf = (() => {
    const today = jakartaToday(now, DEFAULT_DAY_ZONE);
    const end = shiftDate(weekStart, 6);
    return today < end ? today : end;
  })();
  const prefs = (await db.select({ userId: leaderboardPref.userId, alias: leaderboardPref.alias }).from(leaderboardPref).where(eq(leaderboardPref.optIn, true))).filter((p) =>
    badgesEnabled(env, p.userId),
  );
  const userIds = prefs.map((p) => p.userId);
  const inputs = await loadUserInputs(db, userIds);
  const eligible = userIds.filter((id) => {
    const input = inputs.get(id);
    return input !== undefined && !input.maternal;
  });

  const [logged, workouts] = await Promise.all([
    loadLoggedDays(db, eligible, shiftDate(weekStart, -LEADERBOARD_STREAK_DAYS), asOf),
    loadWorkoutDays(db, eligible, weekStart, asOf),
  ]);
  const loggedBy = new Map<string, string[]>();
  const proteinBy = new Map<string, string[]>();
  for (const row of logged) {
    (loggedBy.get(row.userId) ?? loggedBy.set(row.userId, []).get(row.userId)!).push(row.date);
    const goal = inputs.get(row.userId)?.proteinGoalG ?? null;
    if (goal !== null && row.protein >= goal) (proteinBy.get(row.userId) ?? proteinBy.set(row.userId, []).get(row.userId)!).push(row.date);
  }
  const workoutBy = new Map<string, string[]>();
  for (const row of workouts) (workoutBy.get(row.userId) ?? workoutBy.set(row.userId, []).get(row.userId)!).push(row.date);

  const aliasOf = new Map(prefs.map((p) => [p.userId, p.alias ?? ""]));
  const scored = eligible
    .map((userId): RankInput & { daysMask: number } => ({
      userId,
      alias: aliasOf.get(userId) ?? "",
      ...weekScore({
        weekStart,
        asOf,
        loggedDays: loggedBy.get(userId) ?? [],
        proteinDays: proteinBy.get(userId) ?? [],
        workoutDays: workoutBy.get(userId) ?? [],
      }),
    }))
    .filter((row) => row.daysLogged > 0);
  const ranked = rankWeek(scored);

  await insertChunked(
    db,
    leaderboardWeek,
    ranked.map((row) => ({
      weekStart,
      userId: row.userId,
      daysLogged: row.daysLogged,
      proteinHitDays: row.proteinHitDays,
      workoutDays: row.workoutDays,
      streakEnd: row.streakEnd,
      daysMask: row.daysMask,
      rankGlobal: row.rank,
      computedAt: now,
    })),
    (insert) =>
      insert.onConflictDoUpdate({
        target: [leaderboardWeek.weekStart, leaderboardWeek.userId],
        set: {
          daysLogged: sqlExcluded("days_logged"),
          proteinHitDays: sqlExcluded("protein_hit_days"),
          workoutDays: sqlExcluded("workout_days"),
          streakEnd: sqlExcluded("streak_end"),
          daysMask: sqlExcluded("days_mask"),
          rankGlobal: sqlExcluded("rank_global"),
          computedAt: sqlExcluded("computed_at"),
        },
      }),
  );

  const keep = new Set(ranked.map((r) => r.userId));
  const existing = await db.select({ userId: leaderboardWeek.userId }).from(leaderboardWeek).where(eq(leaderboardWeek.weekStart, weekStart));
  const stale = existing.map((r) => r.userId).filter((id) => !keep.has(id));
  for (const slice of chunk(stale, D1_MAX_PARAMS - 1)) {
    await db.delete(leaderboardWeek).where(and(eq(leaderboardWeek.weekStart, weekStart), inArray(leaderboardWeek.userId, slice)));
  }
  return { optedIn: userIds.length, ranked: ranked.length, removed: stale.length };
}
