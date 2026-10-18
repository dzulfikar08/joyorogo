// Pure rules for group challenges (tantangan grup), kept free of the DB so the
// router and both clients share one definition of "hit", streaks and ranking.
// Clients import this file for goal labels and share text, so it must not pull
// in server-only modules (type imports are erased and safe).
import type { ChallengeGoal } from "@joyorogo/db/schema/challenge";
import { fmtNumber, getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { daysBetween, shiftDate } from "./engine";

export type { ChallengeGoal };

/** Challenge lengths a host can pick, in days. */
export const CHALLENGE_DURATIONS = [7, 14, 30] as const;
/** A challenge may be scheduled at most this many days ahead. */
export const MAX_START_AHEAD_DAYS = 14;
/** Upcoming + running challenges per group. */
export const MAX_OPEN_CHALLENGES = 3;
export const CHALLENGE_TITLE_MAX = 60;
/**
 * A calorie day counts only when at least this share of the target was eaten.
 * Same cut-off the adaptive TDEE uses (plan.ts, minDayKcal): a day under half
 * the budget is a forgotten log, not a diet.
 */
export const CALORIE_FLOOR_RATIO = 0.5;

/**
 * How a day's number is backed.
 * - device: written by Health Connect, Apple Health or JoyoFit.
 * - photo: food entries that all came from a photo scan (still self-logged).
 * - manual: typed in by the user ("dicatat manual").
 */
export type Basis = "device" | "photo" | "manual";

/** "Terverifikasi perangkat" / "Verified by device": how a hit day was recorded. */
export function basisLabel(basis: Basis, locale: Locale = getActiveLocale()): string {
  return getT(locale, "challenge")(`basis.${basis}`);
}

export type GoalSpec = {
  id: ChallengeGoal;
  /** 'fixed': host sets one threshold. 'personal': each member's own plan target. */
  targetKind: "fixed" | "personal";
  /** Bounds for a fixed target; null for personal goals. */
  range: { min: number; max: number; step: number; default: number; presets: number[] } | null;
  /** Reaching the threshold can only go up during the day, so today may already count. */
  monotonic: boolean;
  /** Needs a device or app the member may not have connected. */
  needsDevice: boolean;
};

/** Words for a goal; `deviceHint` is shown when a member has no data for it. */
export type GoalText = {
  label: string;
  /** One-line picker blurb. */
  blurb: string;
  /** Where the number comes from, shown under the goal. */
  source: string;
  unit: string;
  deviceHint: string | null;
};

export function goalText(goal: ChallengeGoal, locale: Locale = getActiveLocale()): GoalText {
  const t = getT(locale, "challenge");
  return {
    label: t(`goal.${goal}.label`),
    blurb: t(`goal.${goal}.blurb`),
    source: t(`goal.${goal}.source`),
    unit: t(`goal.${goal}.unit`),
    deviceHint: GOALS[goal].needsDevice ? t(`goal.${goal}.deviceHint` as "goal.steps.deviceHint") : null,
  };
}

export const GOALS: Record<ChallengeGoal, GoalSpec> = {
  steps: {
    id: "steps",
    targetKind: "fixed",
    range: { min: 2000, max: 30000, step: 500, default: 8000, presets: [6000, 8000, 10000, 12000] },
    monotonic: true,
    needsDevice: true,
  },
  protein: {
    id: "protein",
    targetKind: "personal",
    range: null,
    monotonic: true,
    needsDevice: false,
  },
  calories: {
    id: "calories",
    targetKind: "personal",
    range: null,
    monotonic: false,
    needsDevice: false,
  },
  workouts: {
    id: "workouts",
    targetKind: "fixed",
    range: { min: 1, max: 3, step: 1, default: 1, presets: [1, 2, 3] },
    monotonic: true,
    needsDevice: false,
  },
  strain: {
    id: "strain",
    targetKind: "fixed",
    range: { min: 1, max: 21, step: 0.5, default: 10, presets: [8, 10, 12, 14] },
    monotonic: true,
    needsDevice: true,
  },
  sleep: {
    id: "sleep",
    targetKind: "fixed",
    range: { min: 50, max: 100, step: 5, default: 85, presets: [75, 85, 90, 100] },
    monotonic: true,
    needsDevice: true,
  },
};

export const GOAL_ORDER: ChallengeGoal[] = [
  "steps",
  "protein",
  "calories",
  "workouts",
  "strain",
  "sleep",
];

/** "Minimal 8.000 langkah per hari" style rule for a threshold. */
export function describeGoal(
  goal: ChallengeGoal,
  target: number | null,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale, "challenge");
  const n = target === null ? "" : fmtNumber(target, 1, locale);
  switch (goal) {
    case "steps":
      return target === null ? t("goal.steps.rule") : t("goal.steps.ruleTarget", { target: n });
    case "protein":
      return t("goal.protein.rule");
    case "calories":
      return t("goal.calories.rule");
    case "workouts":
      return target === null
        ? t("goal.workouts.rule")
        : t("goal.workouts.ruleTarget", { target: n });
    case "strain":
      return target === null ? t("goal.strain.rule") : t("goal.strain.ruleTarget", { target: n });
    case "sleep":
      return target === null ? t("goal.sleep.rule") : t("goal.sleep.ruleTarget", { target: n });
  }
}

/** Default title when the host leaves the name empty. */
export function defaultChallengeTitle(
  goal: ChallengeGoal,
  target: number | null,
  durationDays: number,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale, "challenge");
  const n = target === null ? "" : fmtNumber(target, 1, locale);
  const head =
    goal === "steps" && target !== null
      ? t("title.stepsTarget", { target: n })
      : goal === "protein"
        ? t("title.protein")
        : goal === "calories"
          ? t("title.calories")
          : goal === "workouts"
            ? t("title.workouts")
            : goal === "strain" && target !== null
              ? t("title.strainTarget", { target: n })
              : goal === "sleep" && target !== null
                ? t("title.sleepTarget", { target: n })
                : t(`goal.${goal}.label`);
  return t("title.withDays", { head, days: durationDays });
}

export type ChallengeInput = {
  goal: ChallengeGoal;
  target: number | null;
  durationDays: number;
  startDate: string;
};

/** Error message for an invalid host input, in `locale`; null when valid. */
export function validateChallengeInput(
  input: ChallengeInput,
  today: string,
  locale: Locale = getActiveLocale(),
): string | null {
  const t = getT(locale, "challenge");
  const spec = GOALS[input.goal];
  if (!(CHALLENGE_DURATIONS as readonly number[]).includes(input.durationDays)) {
    return t("validate.duration");
  }
  if (input.startDate < today || input.startDate > shiftDate(today, MAX_START_AHEAD_DAYS)) {
    return t("validate.startAhead", { days: MAX_START_AHEAD_DAYS });
  }
  if (spec.targetKind === "personal") {
    return input.target === null ? null : t("validate.personal");
  }
  const range = spec.range;
  if (!range || input.target === null) return t("validate.targetRequired");
  if (input.target < range.min || input.target > range.max) {
    return t("validate.range", {
      goal: t(`goal.${input.goal}.lower`),
      min: fmtNumber(range.min, 1, locale),
      max: fmtNumber(range.max, 1, locale),
    });
  }
  // Multiples of the step keep steps/sleep/strain thresholds tidy.
  const offset = (input.target - range.min) / range.step;
  if (Math.abs(offset - Math.round(offset)) > 1e-9) {
    return t("validate.step", { step: fmtNumber(range.step, 1, locale) });
  }
  return null;
}

export function challengeEndDate(startDate: string, durationDays: number): string {
  return shiftDate(startDate, durationDays - 1);
}

export type ChallengeStatus = "upcoming" | "active" | "ended";

export function challengeStatus(startDate: string, endDate: string, today: string): ChallengeStatus {
  if (today < startDate) return "upcoming";
  if (today > endDate) return "ended";
  return "active";
}

/**
 * First day counted for a member who joins on `joinDay`: the challenge start
 * or the join day, whichever is later. The join day itself counts in full.
 */
export function memberFromDate(startDate: string, joinDay: string): string {
  return joinDay > startDate ? joinDay : startDate;
}

// --- Daily evaluation --------------------------------------------------------

/** Normalised numbers for one member-day; `value: null` means no data synced or logged. */
export type DayFacts = { value: number | null; basis: Basis | null; mealsLogged?: number };

export type DayStatus = "hit" | "miss" | "pending";
export type DayResult = {
  date: string;
  status: DayStatus;
  value: number | null;
  /** Backing of the value; null when there is none. */
  basis: Basis | null;
};

/**
 * Judges one day. Today is never a miss while it can still be won: a goal
 * that only goes up (steps, protein, ...) hits the moment it is reached and is
 * 'pending' otherwise; calories (an upper bound) stay 'pending' until the day
 * is over, unless already exceeded, which is final.
 */
export function evaluateDay(args: {
  goal: ChallengeGoal;
  target: number;
  facts: DayFacts | undefined;
  date: string;
  today: string;
}): DayResult {
  const { goal, target, facts, date, today } = args;
  const isToday = date === today;
  const value = facts?.value ?? null;
  const basis = facts?.basis ?? null;
  const open: DayStatus = isToday ? "pending" : "miss";
  const result = (status: DayStatus): DayResult => ({ date, status, value, basis });

  if (goal === "calories") {
    if (value === null || (facts?.mealsLogged ?? 0) === 0) return result(open);
    if (value > target) return result("miss");
    if (value < target * CALORIE_FLOOR_RATIO) return result(open);
    return result(isToday ? "pending" : "hit");
  }
  if (value === null) return result(open);
  return result(value >= target ? "hit" : open);
}

export type Progress = {
  /** One entry per judged day (fromDate through min(endDate, today)). */
  days: DayResult[];
  hitDays: number;
  /** Days judged and failed (today pending is not counted). */
  missDays: number;
  /** Days in this member's span, whole challenge from fromDate on. */
  totalDays: number;
  /** Consecutive hit days ending at the latest judged day; a pending today does not break it. */
  streak: number;
  bestStreak: number;
  /** Hit days by backing, so a board can say how many are verified. */
  hitsByBasis: Record<Basis, number>;
};

export function buildProgress(args: {
  goal: ChallengeGoal;
  target: number;
  fromDate: string;
  endDate: string;
  today: string;
  factsByDate: ReadonlyMap<string, DayFacts>;
}): Progress {
  const { goal, target, fromDate, endDate, today, factsByDate } = args;
  const last = today < endDate ? today : endDate;
  const days: DayResult[] = [];
  for (let date = fromDate; date <= last; date = shiftDate(date, 1)) {
    days.push(evaluateDay({ goal, target, facts: factsByDate.get(date), date, today }));
  }

  const hitsByBasis: Record<Basis, number> = { device: 0, photo: 0, manual: 0 };
  let hitDays = 0;
  let missDays = 0;
  let run = 0;
  let bestStreak = 0;
  for (const day of days) {
    if (day.status === "hit") {
      hitDays += 1;
      run += 1;
      bestStreak = Math.max(bestStreak, run);
      hitsByBasis[day.basis ?? "manual"] += 1;
    } else if (day.status === "miss") {
      missDays += 1;
      run = 0;
    }
    // pending (today) neither extends nor breaks the run
  }
  // `run` already reflects the trailing hits because pending is skipped.
  return {
    days,
    hitDays,
    missDays,
    totalDays: fromDate > endDate ? 0 : daysBetween(fromDate, endDate) + 1,
    streak: run,
    bestStreak,
    hitsByBasis,
  };
}

// --- Ranking -----------------------------------------------------------------

export type RankKey = { hitDays: number; bestStreak: number; streak: number };

/** Higher hit count first, then current streak, then best streak. */
export function compareRank(a: RankKey, b: RankKey): number {
  return b.hitDays - a.hitDays || b.streak - a.streak || b.bestStreak - a.bestStreak;
}

/** Competition ranking (1, 1, 3): equal keys share a place. Input order is preserved. */
export function assignRanks<T extends RankKey>(sorted: T[]): number[] {
  const ranks: number[] = [];
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    ranks.push(prev && compareRank(prev, item) === 0 ? (ranks[i - 1] ?? i + 1) : i + 1);
  });
  return ranks;
}

// --- Normalising raw rows into DayFacts --------------------------------------

/** Health Connect / Apple Health rows are device-written. */
export function stepsFacts(row: { steps: number } | undefined): DayFacts | undefined {
  return row ? { value: row.steps, basis: "device" } : undefined;
}

/** Food: photo basis only when every entry that day came from a scan. */
export function foodFacts(
  goal: "protein" | "calories",
  row: { kcal: number | null; protein: number | null; meals: number; aiMeals: number } | undefined,
): DayFacts | undefined {
  if (!row || row.meals === 0) return undefined;
  const value = goal === "protein" ? (row.protein ?? 0) : (row.kcal ?? 0);
  return {
    value,
    basis: row.aiMeals >= row.meals ? "photo" : "manual",
    mealsLogged: row.meals,
  };
}

/**
 * Workouts: `verified` counts sessions that came from Health Connect, Apple
 * Health or a JoyoFit workout (Strava never reaches a challenge). The day is
 * device-backed only when the verified sessions alone reach the target;
 * otherwise it is manual.
 */
export function workoutFacts(
  row: { total: number; verified: number } | undefined,
  target: number,
): DayFacts | undefined {
  if (!row || row.total === 0) return undefined;
  return { value: row.total, basis: row.verified >= target ? "device" : "manual" };
}

/** JoyoFit scores are pushed by the app from the watch: always device-backed. */
export function fitnessFacts(value: number | null | undefined): DayFacts | undefined {
  return value === null || value === undefined ? undefined : { value, basis: "device" };
}

// --- Share text --------------------------------------------------------------

export type ChallengeShare = {
  title: string;
  goal: ChallengeGoal;
  target: number | null;
  durationDays: number;
  status: ChallengeStatus;
  hitDays: number;
  /** Days judged so far for the sharer; the denominator of "x dari y hari". */
  judgedDays: number;
  streak: number;
  bestStreak: number;
  rank: number | null;
  participants: number;
  /** Hit days by backing, so the card and caption can say how solid the numbers are. */
  hitsByBasis: Record<Basis, number>;
};

/**
 * One honest line about how the hit days were recorded; null with no hits.
 * Anything typed in by hand always shows up, even as a minority.
 */
export function verificationLabel(
  hits: Record<Basis, number>,
  locale: Locale = getActiveLocale(),
): string | null {
  const total = hits.device + hits.photo + hits.manual;
  if (total === 0) return null;
  if (hits.device === total) return basisLabel("device", locale);
  if (hits.photo === total) return basisLabel("photo", locale);
  if (hits.manual === total) return basisLabel("manual", locale);
  return getT(locale, "challenge")(hits.manual > 0 ? "basis.mixedManual" : "basis.mixedAuto");
}

/** Caption for Threads/IG/WhatsApp. Honest about progress: no rounding up. */
export function challengeShareText(
  share: ChallengeShare,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale, "challenge");
  const when =
    share.status === "ended"
      ? t("share.ended", { days: share.durationDays })
      : share.status === "upcoming"
        ? t("share.upcoming", { days: share.durationDays })
        : t("share.active", { days: share.durationDays });
  const label = verificationLabel(share.hitsByBasis, locale);
  const sentences = [
    `${when}: ${share.title}.`,
    share.status === "upcoming"
      ? null
      : t("share.score", { hit: share.hitDays, judged: share.judgedDays }),
    share.rank !== null && share.participants > 1
      ? t("share.rank", { rank: share.rank, total: share.participants })
      : null,
    share.bestStreak >= 2 ? t("share.streak", { days: share.bestStreak }) : null,
    share.status !== "upcoming" && label
      ? t("share.data", { label: label.toLocaleLowerCase(locale) })
      : null,
    t("share.invite"),
  ];
  return sentences.filter(Boolean).join(" ");
}
