// Badges, database side (docs/badges.md): the logged-day query, the facts behind each badge, and the idempotent awards.
// Every caller-sized statement goes through lib/d1.ts (D1 binds at most 100 parameters).
import { and, between, eq, gte, inArray, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { badgeAward } from "@joyorogo/db/schema/badges";
import { teamChallenge, teamChallengeMember } from "@joyorogo/db/schema/challenge";
import { exerciseLog, foodLog, profile, scanCorrection, waterLog } from "@joyorogo/db/schema/fitness";
import { teamMember } from "@joyorogo/db/schema/social";
import { resolveDayZone, DEFAULT_REGION } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import {
  BACKDATE_DAYS,
  WATER_GLASSES_TARGET,
  badgesEnabled,
  closedRamadanWindows,
  evaluate,
  isLoggedFood,
  longestRun,
  perfectWeeks,
  ramadanDaysIn,
} from "./badges";
import type { Award, BadgeFacts, BadgesEnv } from "./badges";
import { insertChunked, readChunked } from "./d1";
import { daysBetween, idealWeightRange, proteinTargetG, shiftDate } from "./engine";
import { PROTEIN_G_PER_KG } from "./gain";
import { IMPORT_SOURCE } from "./history-import";
import { maternalFromRow } from "./maternal";
import { STREAK_MAX_DAYS } from "./streak";

/** exercise_log sources written by a device or a tracked workout; typed-in rows and Strava (owner-only display) never count. */
export const VERIFIED_EXERCISE_SOURCES = ["health_connect", "apple_health", "joyofit"];

// --- Logged day, in SQL ------------------------------------------------------------------------------------------------

/**
 * Seconds a stored UTC instant is shifted to read the person's calendar day: the two UTC+8 zones, else WIB. Mirrors
 * `dayZoneOffsetMs`; a test pins the whole predicate to `isLoggedFood` for every zone.
 */
const ZONE_OFFSET_SEC = sql`(case when ${profile.timezone} in ('Asia/Kuala_Lumpur', 'Asia/Singapore') then 28800 else 25200 end)`;
const WRITTEN_ON = sql`date(${foodLog.createdAt} / 1000 + ${ZONE_OFFSET_SEC}, 'unixepoch')`;

/** The logged-day predicate on `food_log` joined to `profile` (isLoggedFood): energy, not imported, written 0 to 2 days after its day. */
export const LOGGED_DAY_WHERE = and(
  sql`${foodLog.kcal} > 0`,
  ne(foodLog.source, IMPORT_SOURCE),
  sql`${WRITTEN_ON} >= ${foodLog.date}`,
  sql`${WRITTEN_ON} <= date(${foodLog.date}, '+${sql.raw(String(BACKDATE_DAYS))} days')`,
);

export type LoggedDay = { userId: string; date: string; protein: number };

/** Logged days of `userIds` between `from` and `to` (inclusive), with the day's summed protein (grams, rows without it count 0). */
export async function loadLoggedDays(db: Database, userIds: readonly string[], from: string, to: string): Promise<LoggedDay[]> {
  return readChunked(
    userIds,
    (slice) =>
      db
        .select({
          userId: foodLog.userId,
          date: foodLog.date,
          protein: sql<number>`coalesce(sum(${foodLog.protein}), 0)`,
        })
        .from(foodLog)
        .leftJoin(profile, eq(profile.userId, foodLog.userId))
        .where(and(inArray(foodLog.userId, slice), between(foodLog.date, from, to), LOGGED_DAY_WHERE))
        .groupBy(foodLog.userId, foodLog.date),
    { reserved: 3 },
  );
}

/** Days with a verified workout (device or JoyoFit; never a rest day, a typed-in row or Strava). */
export async function loadWorkoutDays(db: Database, userIds: readonly string[], from: string, to: string) {
  return readChunked(
    userIds,
    (slice) =>
      db
        .selectDistinct({ userId: exerciseLog.userId, date: exerciseLog.date })
        .from(exerciseLog)
        .where(
          and(
            inArray(exerciseLog.userId, slice),
            between(exerciseLog.date, from, to),
            inArray(exerciseLog.source, VERIFIED_EXERCISE_SOURCES),
          ),
        ),
    { reserved: 2 + VERIFIED_EXERCISE_SOURCES.length },
  );
}

// --- Per-user inputs ---------------------------------------------------------------------------------------------------

export type UserInputs = {
  zone: DayZone;
  maternal: boolean;
  /** Ramadan badge applies: the person turned Ramadan mode on or fasts on a pattern. */
  ramadanEligible: boolean;
  /** Daily protein goal in grams, or null when none applies (Hamil / Menyusui have their own targets). */
  proteinGoalG: number | null;
};

/**
 * Zone, maternal flag and protein goal of each user. The protein goal reads the latest weigh-in only to size the goal
 * (the same sizing the plan uses); the weight itself is never stored, ranked or returned.
 */
export async function loadUserInputs(db: Database, userIds: readonly string[]): Promise<Map<string, UserInputs>> {
  const out = new Map<string, UserInputs>();
  const rows = await readChunked(userIds, (slice) =>
    db
      .select({
        row: profile,
        weightKg: sql<number | null>`(select w.weight_kg from weight_log w where w.user_id = ${profile.userId} order by w.date desc limit 1)`,
      })
      .from(profile)
      .where(inArray(profile.userId, slice)),
  );
  for (const { row, weightKg } of rows) {
    const maternal = maternalFromRow(row).mode !== "none";
    const kg = weightKg ?? row.startWeightKg;
    const goal = row.goal === "gain" ? Math.round(PROTEIN_G_PER_KG.target * Math.min(kg, idealWeightRange(row.heightCm).maxKg)) : proteinTargetG(kg, row.heightCm);
    out.set(row.userId, {
      zone: resolveDayZone({ stored: row.timezone, hasProfile: true, region: DEFAULT_REGION }),
      maternal,
      ramadanEligible: row.ramadanMode === "on" || row.fastingPattern !== "off",
      proteinGoalG: maternal ? null : goal,
    });
  }
  return out;
}

// --- Facts ---------------------------------------------------------------------------------------------------------------

/**
 * The numbers behind every badge for `userIds`, as of `today` (WIB day; history is read back `STREAK_MAX_DAYS`). A user
 * without a profile has no entry.
 */
export async function loadBadgeFacts(db: Database, userIds: readonly string[], today: string): Promise<Map<string, BadgeFacts>> {
  const inputs = await loadUserInputs(db, userIds);
  const ids = userIds.filter((id) => inputs.has(id));
  const from = shiftDate(today, -STREAK_MAX_DAYS);
  const [logged, workouts, waters, scans, corrections, teams, challenges] = await Promise.all([
    loadLoggedDays(db, ids, from, today),
    loadWorkoutDays(db, ids, from, today),
    readChunked(
      ids,
      (slice) =>
        db
          .select({ userId: waterLog.userId, days: sql<number>`count(*)` })
          .from(waterLog)
          .where(and(inArray(waterLog.userId, slice), gte(waterLog.glasses, WATER_GLASSES_TARGET)))
          .groupBy(waterLog.userId),
      { reserved: 1 },
    ),
    readChunked(
      ids,
      (slice) =>
        db
          .select({ userId: foodLog.userId, n: sql<number>`count(*)` })
          .from(foodLog)
          .where(and(inArray(foodLog.userId, slice), eq(foodLog.source, "ai")))
          .groupBy(foodLog.userId),
      { reserved: 1 },
    ),
    readChunked(
      ids,
      (slice) =>
        db
          .select({ userId: scanCorrection.userId, n: sql<number>`count(*)` })
          .from(scanCorrection)
          .where(inArray(scanCorrection.userId, slice))
          .groupBy(scanCorrection.userId),
    ),
    readChunked(
      ids,
      (slice) =>
        db
          .select({ userId: teamMember.userId, since: sql<number>`min(${teamMember.joinedAt})` })
          .from(teamMember)
          .where(inArray(teamMember.userId, slice))
          .groupBy(teamMember.userId),
    ),
    readChunked(
      ids,
      (slice) =>
        db
          .select({ userId: teamChallengeMember.userId, fromDate: teamChallengeMember.fromDate, endDate: teamChallenge.endDate })
          .from(teamChallengeMember)
          .innerJoin(teamChallenge, eq(teamChallenge.id, teamChallengeMember.challengeId))
          .where(and(inArray(teamChallengeMember.userId, slice), sql`${teamChallenge.endDate} < ${today}`)),
      { reserved: 1 },
    ),
  ]);

  const loggedBy = new Map<string, LoggedDay[]>();
  for (const row of logged) (loggedBy.get(row.userId) ?? loggedBy.set(row.userId, []).get(row.userId)!).push(row);
  const workoutBy = new Map<string, string[]>();
  for (const row of workouts) (workoutBy.get(row.userId) ?? workoutBy.set(row.userId, []).get(row.userId)!).push(row.date);
  const waterBy = new Map(waters.map((r) => [r.userId, Number(r.days)]));
  const scanBy = new Map(scans.map((r) => [r.userId, Number(r.n)]));
  const correctionBy = new Map(corrections.flatMap((r) => (r.userId ? [[r.userId, Number(r.n)] as const] : [])));
  const teamSince = new Map(teams.map((r) => [r.userId, new Date(Number(r.since) + 7 * 3_600_000).toISOString().slice(0, 10)]));
  const challengesBy = new Map<string, typeof challenges>();
  for (const row of challenges) (challengesBy.get(row.userId) ?? challengesBy.set(row.userId, []).get(row.userId)!).push(row);

  const out = new Map<string, BadgeFacts>();
  const windows = closedRamadanWindows(today);
  for (const userId of ids) {
    const input = inputs.get(userId)!;
    const days = loggedBy.get(userId) ?? [];
    const dates = days.map((d) => d.date);
    const since = teamSince.get(userId);
    // A challenge is finished when the person stayed to its last day (leaving deletes the row) and logged on at least
    // half of the days they took part in.
    const finished = (challengesBy.get(userId) ?? []).filter((c) => {
      const span = daysBetween(c.fromDate, c.endDate) + 1;
      const own = dates.filter((d) => d >= c.fromDate && d <= c.endDate).length;
      return span > 0 && own * 2 >= span;
    }).length;
    out.set(userId, {
      loggedDays: dates.length,
      longestStreak: longestRun(dates),
      perfectWeeks: perfectWeeks(dates),
      scans: scanBy.get(userId) ?? 0,
      corrections: correctionBy.get(userId) ?? 0,
      proteinDays: input.proteinGoalG === null ? 0 : days.filter((d) => d.protein >= input.proteinGoalG!).length,
      waterDays: waterBy.get(userId) ?? 0,
      workoutDays: new Set(workoutBy.get(userId) ?? []).size,
      challenges: finished,
      teamDays: since === undefined ? 0 : dates.filter((d) => d >= since).length,
      ramadanDays: input.ramadanEligible ? Math.max(0, ...windows.map((w) => ramadanDaysIn(dates, w))) : 0,
    });
  }
  return out;
}

// --- Awards ----------------------------------------------------------------------------------------------------------------

/** Stores awards that are not there yet (one INSERT OR IGNORE per slice of rows); answers how many rows were new. */
export async function storeAwards(db: Database, awards: ReadonlyArray<Award & { userId: string }>, now: Date): Promise<number> {
  if (awards.length === 0) return 0;
  const results = await insertChunked(
    db,
    badgeAward,
    awards.map((a) => ({ userId: a.userId, badgeId: a.badgeId, tier: a.tier, awardedAt: now })),
    (insert) => insert.onConflictDoNothing().returning({ userId: badgeAward.userId }),
  );
  return results.reduce((sum, rows) => sum + rows.length, 0);
}

/**
 * Evaluates the badges of `userIds` against their history and stores what they earned. Safe to run any number of times:
 * an award that exists is left as it is.
 */
export async function awardUsers(
  db: Database,
  userIds: readonly string[],
  today: string,
  now: Date,
): Promise<{ users: number; awarded: number }> {
  const facts = await loadBadgeFacts(db, userIds, today);
  const awards: Array<Award & { userId: string }> = [];
  for (const [userId, f] of facts) for (const award of evaluate(f)) awards.push({ userId, ...award });
  return { users: facts.size, awarded: await storeAwards(db, awards, now) };
}

// --- Write path ----------------------------------------------------------------------------------------------------------------

/** Awards one badge tier at the write that earned it. Does nothing for users outside the allowlist; never throws into the caller. */
export async function awardOnWrite(db: Database, env: BadgesEnv, userId: string, badgeId: string, tier = 1): Promise<void> {
  if (!badgesEnabled(env, userId)) return;
  try {
    await db.insert(badgeAward).values({ userId, badgeId, tier }).onConflictDoNothing();
  } catch (error) {
    console.error("[badges] award failed", badgeId, error);
  }
}

/**
 * After a food write: "Catatan pertama" when a stored row is a logged day (isLoggedFood), "Pemindai pertama" when one came
 * from an AI scan. `rows` are the stored rows of the write; the zone is resolved only for allowlisted users.
 */
export async function awardAfterFood(
  db: Database,
  env: BadgesEnv,
  userId: string,
  zone: () => Promise<DayZone>,
  rows: ReadonlyArray<{ date: string; kcal: number; source: string; createdAt: Date }>,
): Promise<void> {
  if (!badgesEnabled(env, userId) || rows.length === 0) return;
  try {
    const dayZone = await zone();
    if (rows.some((row) => isLoggedFood({ date: row.date, kcal: row.kcal, source: row.source, createdAtMs: row.createdAt.getTime() }, dayZone))) {
      await awardOnWrite(db, env, userId, "catatan-pertama");
    }
    if (rows.some((row) => row.source === "ai")) await awardOnWrite(db, env, userId, "pemindai-pertama");
  } catch (error) {
    console.error("[badges] food award failed", error);
  }
}

/** Badges awarded at the write that earns them: a saved AI scan, a verified workout, a scan correction. */
export const WRITE_BADGE = { scan: "pemindai-pertama", workout: "latihan-pertama", correction: "perbaikan-pertama" } as const;
