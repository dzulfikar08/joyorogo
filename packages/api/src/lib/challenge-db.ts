// DB side of group challenges: reads the member-days a goal is judged on from
// the tables JoyoRogo already fills, and the cleanup when someone leaves a team.
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { teamChallenge, teamChallengeMember } from "@joyorogo/db/schema/challenge";
import type { ChallengeGoal } from "@joyorogo/db/schema/challenge";
import { dailyActivity, exerciseLog, foodLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";

import { fitnessFacts, foodFacts, stepsFacts, workoutFacts } from "./challenge";
import type { DayFacts } from "./challenge";

/** userId -> date -> facts for one challenge span. */
export type FactsByUser = Map<string, Map<string, DayFacts>>;

/** exercise_log sources written by a device, as opposed to typed in. Strava is excluded from challenges entirely (Strava API policy: owner-only display). */
const VERIFIED_EXERCISE_SOURCES = ["health_connect", "apple_health"];

function put(out: FactsByUser, userId: string, date: string, facts: DayFacts | undefined) {
  if (!facts) return;
  const byDate = out.get(userId) ?? new Map<string, DayFacts>();
  byDate.set(date, facts);
  out.set(userId, byDate);
}

/**
 * Loads the per-day facts `goal` is judged on for `userIds` between `from` and
 * `to` (WIB days, inclusive). One query per call; days without data are simply
 * absent from the result. `target` is only read by workouts, where it decides
 * whether the verified sessions alone reach the goal.
 */
export async function loadFacts(
  db: Database,
  goal: ChallengeGoal,
  userIds: string[],
  from: string,
  to: string,
  target: number | null,
): Promise<FactsByUser> {
  const out: FactsByUser = new Map();
  if (userIds.length === 0 || from > to) return out;

  if (goal === "steps") {
    const rows = await db
      .select({ userId: dailyActivity.userId, date: dailyActivity.date, steps: dailyActivity.steps })
      .from(dailyActivity)
      .where(
        and(
          inArray(dailyActivity.userId, userIds),
          gte(dailyActivity.date, from),
          lte(dailyActivity.date, to),
        ),
      );
    for (const row of rows) put(out, row.userId, row.date, stepsFacts(row));
    return out;
  }

  if (goal === "protein" || goal === "calories") {
    const rows = await db
      .select({
        userId: foodLog.userId,
        date: foodLog.date,
        kcal: sql<number | null>`sum(${foodLog.kcal})`,
        protein: sql<number | null>`sum(${foodLog.protein})`,
        meals: sql<number>`count(*)`,
        aiMeals: sql<number>`coalesce(sum(case when ${foodLog.source} = 'ai' then 1 else 0 end), 0)`,
      })
      .from(foodLog)
      .where(and(inArray(foodLog.userId, userIds), gte(foodLog.date, from), lte(foodLog.date, to)))
      .groupBy(foodLog.userId, foodLog.date);
    for (const row of rows) put(out, row.userId, row.date, foodFacts(goal, row));
    return out;
  }

  if (goal === "workouts") {
    const rows = await db
      .select({
        userId: exerciseLog.userId,
        date: exerciseLog.date,
        total: sql<number>`count(*)`,
        verified: sql<number>`coalesce(sum(case when ${inArray(exerciseLog.source, VERIFIED_EXERCISE_SOURCES)} then 1 else 0 end), 0)`,
      })
      .from(exerciseLog)
      .where(
        and(
          inArray(exerciseLog.userId, userIds),
          gte(exerciseLog.date, from),
          lte(exerciseLog.date, to),
          ne(exerciseLog.source, "rest"),
          ne(exerciseLog.source, "strava"),
        ),
      )
      .groupBy(exerciseLog.userId, exerciseLog.date);
    for (const row of rows) put(out, row.userId, row.date, workoutFacts(row, target ?? 1));
    return out;
  }

  const rows = await db
    .select({
      userId: fitnessScore.userId,
      date: fitnessScore.date,
      strain: fitnessScore.strain,
      sleepPct: fitnessScore.sleepPct,
    })
    .from(fitnessScore)
    .where(
      and(inArray(fitnessScore.userId, userIds), gte(fitnessScore.date, from), lte(fitnessScore.date, to)),
    );
  for (const row of rows) {
    put(out, row.userId, row.date, fitnessFacts(goal === "strain" ? row.strain : row.sleepPct));
  }
  return out;
}

/** Drops a user from every challenge of one team (leaving or removed from the team). */
export async function leaveTeamChallenges(db: Database, teamId: string, userId: string) {
  await db.delete(teamChallengeMember).where(
    and(
      eq(teamChallengeMember.userId, userId),
      inArray(
        teamChallengeMember.challengeId,
        db.select({ id: teamChallenge.id }).from(teamChallenge).where(eq(teamChallenge.teamId, teamId)),
      ),
    ),
  );
}
