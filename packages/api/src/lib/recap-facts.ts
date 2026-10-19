// Facts engine of the weekly reflection ("Refleksi minggu ini"). Pure and deterministic: the numbers of one WIB week
// (the recap, food item names, weigh-ins, waist, JoyoFit watch workouts, load, sleep, steps) become typed facts with a
// code, a variant, the numbers and a priority; a rule-based selection keeps 2-3 wins and up to 3 focus points. Every
// word shown to the person comes from fixed templates keyed by (code, variant) (lib/recap-text.ts), and the AI text
// of Pro accounts is only ever given these selected facts (lib/recap-ai.ts). Nothing here reads a database.
//
// Strava never reaches this module: the loader leaves its rows out (docs/strava.md), so no fact mixes Strava data
// with food or weight. Hamil / Menyusui ("maternal") gets no weight-loss, pace, steps or intensity pressure.
// Thresholds live in `T`; docs/weekly-recap-ai.md lists them.

import { daysBetween } from "./engine";
import { detectFoodPatterns } from "./food-patterns";
import type { FoodItemInput, FoodPatternKind } from "./food-patterns";
import type { WeekRecap } from "./recap";

export type ReflectionMode = "lose" | "maintain" | "gain" | "maternal";

export const FACT_CODES = [
  "LOG_STREAK",
  "LOG_GAPS",
  "WEIGHT_PACE",
  "WEIGH_INS",
  "MEASURE_ANOMALY",
  "INTAKE_AVG_VS_TARGET",
  "INTAKE_SWING",
  "PROTEIN_OK",
  "PROTEIN_LOW",
  "FOOD_PATTERN",
  "ACTIVE_WEEK",
  "RUN_EASY",
  "RUN_INTENSITY",
  "LOAD_SPIKE",
  "SLEEP_OK",
  "SLEEP_SHORT",
  "STEPS_GOOD",
  "LOW_STEPS",
] as const;
export type FactCode = (typeof FACT_CODES)[number];

/** Every variant a code can come out with; the template keys (packages/i18n reflection.json) follow this table. */
export const FACT_VARIANTS: Record<FactCode, readonly string[]> = {
  LOG_STREAK: ["streak", "streak_gain", "logged", "some"],
  LOG_GAPS: ["gaps"],
  WEIGHT_PACE: ["on_pace", "week_down", "behind", "gaining", "flat", "too_fast", "steady", "drifting", "gain_on_pace", "gain_stalled"],
  WEIGH_INS: ["regular", "few", "none"],
  MEASURE_ANOMALY: ["waist", "weight"],
  INTAKE_AVG_VS_TARGET: ["on_target", "over", "under", "under_gain", "under_maternal"],
  INTAKE_SWING: ["steady", "swing"],
  PROTEIN_OK: ["ok"],
  PROTEIN_LOW: ["low"],
  FOOD_PATTERN: ["fried", "double_carb", "sweet"],
  ACTIVE_WEEK: ["active", "maternal"],
  RUN_EASY: ["easy"],
  RUN_INTENSITY: ["hard_run", "hard_other", "hard_check_doctor", "hard_maternal"],
  LOAD_SPIKE: ["spike"],
  SLEEP_OK: ["ok"],
  SLEEP_SHORT: ["short"],
  STEPS_GOOD: ["good"],
  LOW_STEPS: ["low"],
};

export type FactRole = "win" | "focus";
export type FactDomain = "food" | "protein" | "weight" | "move" | "sleep" | "data";
export type FactSeverity = "good" | "info" | "watch" | "alert";
export type FactParams = Record<string, number | string | boolean | null>;

export interface Fact {
  code: FactCode;
  variant: string;
  role: FactRole;
  severity: FactSeverity;
  /** Higher is shown first; ties break on the code. */
  priority: number;
  domain: FactDomain;
  /** The numbers the text may use, already rounded the way they are written. */
  params: FactParams;
}

export const T = {
  /** Consecutive logged days for the streak win. */
  streakMin: 3,
  /** Logged days (of at least `loggedWinOutOf` judged) for the "logged most days" win. */
  loggedWin: 5,
  loggedWinOutOf: 5,
  /** Judged days before a half-logged week is called out, and the logged share at or below which it is. */
  gapsMinJudged: 4,
  gapsShare: 0.5,
  /** Logged days needed before any intake or protein number is judged. */
  minLoggedForIntake: 3,
  /** avg / target between these is on target (lose, maintain). */
  onTargetLow: 0.85,
  onTargetHigh: 1.05,
  /** avg / target above this is over, below `underLow` is probably under-logged or under-eating. */
  overHigh: 1.1,
  overAlert: 1.4,
  underLow: 0.7,
  /** Naikin BB and Hamil / Menyusui bands. */
  gainOnTargetLow: 0.9,
  gainOnTargetHigh: 1.15,
  maternalOnTargetLow: 0.85,
  maternalOnTargetHigh: 1.15,
  maternalUnder: 0.8,
  /** Swing: logged days needed, and the kcal spread or coefficient of variation from which a week swings. */
  swingMinDays: 4,
  swingSpreadKcal: 1000,
  swingCv: 0.3,
  steadyMinDays: 5,
  steadyCv: 0.12,
  /** A day under this share of its budget is a likely forgotten log and stays out of the swing. */
  swingMinShare: 0.4,
  proteinMinDays: 4,
  proteinLowShare: 0.7,
  proteinVeryLowShare: 0.6,
  proteinOkShare: 0.95,
  /** Weekly pace (kg/week, 28-day slope). */
  paceLoseFlat: 0.1,
  paceBehindShare: 0.6,
  paceTooFastKg: 1,
  paceTooFastShare: 0.01,
  paceWeekDownKg: 0.2,
  paceSteadyKg: 0.25,
  paceGainMinKg: 0.1,
  paceGainMaxKg: 0.75,
  paceGainMaxShare: 0.01,
  weighInsRegular: 4,
  weighInsFew: 3,
  /** A reading this far from the one before it, inside the gap, is a measuring slip rather than a change. */
  waistJumpCm: 5,
  waistGapDays: 7,
  weightJumpKg: 2.5,
  weightGapDays: 2,
  /** Exercise (no Strava): sessions, active days or minutes from which the week is a win. */
  activeSessions: 3,
  activeDays: 3,
  activeMinutes: 150,
  /** Heart-rate zones 4-5. */
  hardZoneMin: 5,
  hardZoneMinMaternal: 3,
  hardZoneShare: 0.4,
  easyMinutes: 20,
  easyMaxShare: 0.2,
  doctorBmi: 30,
  doctorAvgHrPct: 0.85,
  doctorAvgHr: 160,
  loadSpike: 1.5,
  loadAlert: 2.5,
  sleepMinNights: 3,
  sleepShortAvg: 7,
  sleepAlertAvg: 5.5,
  sleepVeryShortAvg: 6.5,
  sleepShortNight: 6,
  sleepOkMinNights: 4,
  stepsMinDays: 3,
  stepsLow: 5000,
  stepsGood: 8000,
  /** A day under this is a watch left at home, not a day of movement. */
  stepsMeasured: 500,
  stepsLowDay: 3000,
  /** How many wins and focus points are shown, and how many of one domain. */
  maxWins: 3,
  maxFocus: 3,
  maxFocusPerDomain: 2,
} as const;

export interface WorkoutInput {
  /** Unix seconds the workout started. */
  start: number;
  date: string;
  /** run | walk | ride | swim | other */
  kind: string;
  durationMin: number;
  distanceKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Seconds in heart-rate zones 1 to 5 and the maximum heart rate they were cut from; null without an analysis. */
  zones: { maxHr: number; sec: readonly number[]; belowSec: number } | null;
}

export interface ReflectionInput {
  recap: WeekRecap;
  mode: ReflectionMode;
  today: string;
  person: {
    gender: string;
    heightCm: number;
    ageYears: number;
    /** Latest weigh-in, else the onboarding weight. */
    weightKg: number;
    targetKg: number | null;
    targetDate: string | null;
  };
  /** Food rows of the week; days that are not judged yet (today) are ignored. */
  food: readonly FoodItemInput[];
  /** Weigh-ins of the week, oldest first, and the last one before it. */
  weighIns: ReadonlyArray<{ date: string; weightKg: number }>;
  weightBefore: { date: string; weightKg: number } | null;
  /** kg/week of the last 28 days (negative = losing) and the date the trend reaches the target; null when unknown. */
  trend: { weeklyRateKg: number | null; projectedDate: string | null } | null;
  /** Waist readings from a week before the week through its end, oldest first. */
  waist: ReadonlyArray<{ date: string; waistCm: number }>;
  /** Exercise of the week without Strava rows. */
  exercise: { sessions: number; minutes: number; activeDays: number };
  /** JoyoFit watch workouts of the week (never Strava). */
  workouts: readonly WorkoutInput[];
  /** JoyoFit's acute:chronic load ratio of the days of the week that have one. */
  loadRatios: readonly number[];
  /** Hours of the nights that ended in the week, one per day. */
  sleep: ReadonlyArray<{ date: string; hours: number }>;
  needSleepHours: number;
  /** Steps per day from the phone / watch health data. */
  steps: ReadonlyArray<{ date: string; steps: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

export function bmiOf(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return m > 0 ? weightKg / (m * m) : 0;
}

/** kg per week the target date asks for; null without a target on the side the goal points to. */
export function neededKgPerWeek(
  mode: ReflectionMode,
  person: ReflectionInput["person"],
  today: string,
): number | null {
  if (mode === "maternal" || mode === "maintain" || person.targetKg === null || person.targetDate === null) return null;
  const gap = mode === "lose" ? person.weightKg - person.targetKg : person.targetKg - person.weightKg;
  if (gap < 0.1) return null;
  const days = Math.max(7, daysBetween(today, person.targetDate));
  return round2(gap / (days / 7));
}

function fact(
  code: FactCode,
  variant: string,
  role: FactRole,
  severity: FactSeverity,
  priority: number,
  domain: FactDomain,
  params: FactParams,
): Fact {
  return { code, variant, role, severity, priority, domain, params };
}

// ---- logging ----

function logFacts(input: ReflectionInput): Fact[] {
  const { recap } = input;
  const out: Fact[] = [];
  const base = { streakDays: recap.streakDays, loggedDays: recap.loggedDays, judgedDays: recap.evaluatedDays };
  if (input.mode !== "maternal" && recap.streakDays >= T.streakMin) {
    const gain = input.mode === "gain";
    out.push(fact("LOG_STREAK", gain ? "streak_gain" : "streak", "win", "good", 78 + Math.min(recap.streakDays, 14), "data", base));
  } else if (recap.loggedDays >= T.loggedWin && recap.evaluatedDays >= T.loggedWinOutOf) {
    out.push(fact("LOG_STREAK", "logged", "win", "good", 70, "data", base));
  } else if (recap.loggedDays >= 2) {
    out.push(fact("LOG_STREAK", "some", "win", "good", 20, "data", base));
  }
  if (recap.evaluatedDays >= T.gapsMinJudged && recap.loggedDays / recap.evaluatedDays <= T.gapsShare) {
    out.push(fact("LOG_GAPS", "gaps", "focus", "info", 42, "data", base));
  }
  return out;
}

// ---- weight ----

function weightFacts(input: ReflectionInput): Fact[] {
  if (input.mode === "maternal") return [];
  const { recap, mode, person } = input;
  const out: Fact[] = [];
  const rate = input.trend?.weeklyRateKg ?? null;
  const needed = neededKgPerWeek(mode, person, input.today);
  const projectedDate = input.trend?.projectedDate ?? null;
  const weekChange = recap.weight?.changeKg ?? null;

  if (rate === null) {
    if (mode === "lose" && weekChange !== null && weekChange <= -T.paceWeekDownKg) {
      out.push(fact("WEIGHT_PACE", "week_down", "win", "good", 60, "weight", { weekChangeKg: round1(Math.abs(weekChange)) }));
    }
  } else {
    const pace = round2(Math.abs(rate));
    const params: FactParams = { kgPerWeek: pace, neededKgPerWeek: needed, projectedDate };
    if (mode === "lose") {
      const tooFast = Math.max(T.paceTooFastKg, person.weightKg * T.paceTooFastShare);
      if (-rate > tooFast) {
        out.push(fact("WEIGHT_PACE", "too_fast", "focus", "watch", 82, "weight", params));
      } else if (rate > T.paceLoseFlat) {
        out.push(fact("WEIGHT_PACE", "gaining", "focus", "info", 70, "weight", params));
      } else if (rate >= -T.paceLoseFlat) {
        out.push(fact("WEIGHT_PACE", "flat", "focus", "info", 68, "weight", params));
      } else if (needed !== null && -rate < needed * T.paceBehindShare) {
        out.push(fact("WEIGHT_PACE", "behind", "focus", "info", 70, "weight", params));
      } else {
        out.push(fact("WEIGHT_PACE", "on_pace", "win", "good", 90, "weight", params));
      }
    } else if (mode === "maintain") {
      if (Math.abs(rate) <= T.paceSteadyKg) out.push(fact("WEIGHT_PACE", "steady", "win", "good", 80, "weight", params));
      else out.push(fact("WEIGHT_PACE", "drifting", "focus", "info", 46, "weight", { ...params, direction: rate > 0 ? "up" : "down" }));
    } else {
      const maxGain = Math.max(T.paceGainMaxKg, person.weightKg * T.paceGainMaxShare);
      if (rate >= T.paceGainMinKg && rate <= maxGain) out.push(fact("WEIGHT_PACE", "gain_on_pace", "win", "good", 90, "weight", params));
      else if (rate < T.paceGainMinKg) out.push(fact("WEIGHT_PACE", "gain_stalled", "focus", "info", 70, "weight", params));
    }
  }

  const count = input.weighIns.length;
  if (count >= T.weighInsRegular) {
    out.push(fact("WEIGH_INS", "regular", "win", "good", 60, "weight", { count }));
  } else if (recap.complete || recap.evaluatedDays >= 5) {
    if (count === 0) out.push(fact("WEIGH_INS", "none", "focus", "info", 38, "data", { count }));
    else if (count < T.weighInsFew) out.push(fact("WEIGH_INS", "few", "focus", "info", 55, "data", { count }));
  }
  return out;
}

/** A waist or weight reading that jumped further than a body can in that time: most likely measured differently. */
function anomalyFacts(input: ReflectionInput): Fact[] {
  if (input.mode === "maternal") return [];
  const { recap } = input;
  const out: Fact[] = [];
  const inWeek = (date: string) => date >= recap.weekStart && date <= recap.weekEnd;

  let waist: { from: number; to: number; days: number } | null = null;
  for (let i = 1; i < input.waist.length; i += 1) {
    const a = input.waist[i - 1]!;
    const b = input.waist[i]!;
    const days = daysBetween(a.date, b.date);
    if (!inWeek(b.date) || days < 1 || days > T.waistGapDays) continue;
    if (Math.abs(b.waistCm - a.waistCm) >= T.waistJumpCm && (!waist || Math.abs(b.waistCm - a.waistCm) > Math.abs(waist.to - waist.from))) {
      waist = { from: a.waistCm, to: b.waistCm, days };
    }
  }
  if (waist) {
    out.push(
      fact("MEASURE_ANOMALY", "waist", "focus", "info", 60, "data", {
        fromCm: round1(waist.from),
        toCm: round1(waist.to),
        deltaCm: round1(Math.abs(waist.to - waist.from)),
        days: waist.days,
      }),
    );
  }

  const series = [...(input.weightBefore ? [input.weightBefore] : []), ...input.weighIns];
  let weight: { from: number; to: number; days: number } | null = null;
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1]!;
    const b = series[i]!;
    const days = daysBetween(a.date, b.date);
    if (!inWeek(b.date) || days < 1 || days > T.weightGapDays) continue;
    if (Math.abs(b.weightKg - a.weightKg) >= T.weightJumpKg && (!weight || Math.abs(b.weightKg - a.weightKg) > Math.abs(weight.to - weight.from))) {
      weight = { from: a.weightKg, to: b.weightKg, days };
    }
  }
  if (weight) {
    out.push(
      fact("MEASURE_ANOMALY", "weight", "focus", "info", 58, "data", {
        fromKg: round1(weight.from),
        toKg: round1(weight.to),
        deltaKg: round1(Math.abs(weight.to - weight.from)),
        days: weight.days,
      }),
    );
  }
  return out;
}

// ---- food ----

function intakeFacts(input: ReflectionInput): Fact[] {
  const { recap, mode } = input;
  if (recap.avgKcal === null || recap.loggedDays < T.minLoggedForIntake || recap.targetKcal <= 0) return [];
  const out: Fact[] = [];
  const ratio = recap.avgKcal / recap.targetKcal;
  const diff = recap.avgKcal - recap.targetKcal;
  const params: FactParams = {
    avgKcal: recap.avgKcal,
    targetKcal: recap.targetKcal,
    diffKcal: Math.abs(diff),
    diffPct: Math.abs(Math.round((ratio - 1) * 100)),
    loggedDays: recap.loggedDays,
    daysOnTarget: recap.daysOnTarget,
  };
  if (mode === "gain") {
    if (ratio >= T.gainOnTargetLow && ratio <= T.gainOnTargetHigh) out.push(fact("INTAKE_AVG_VS_TARGET", "on_target", "win", "good", 85, "food", params));
    else if (ratio < T.gainOnTargetLow) out.push(fact("INTAKE_AVG_VS_TARGET", "under_gain", "focus", "info", 76, "food", params));
  } else if (mode === "maternal") {
    if (ratio >= T.maternalOnTargetLow && ratio <= T.maternalOnTargetHigh) out.push(fact("INTAKE_AVG_VS_TARGET", "on_target", "win", "good", 85, "food", params));
    else if (ratio < T.maternalUnder) out.push(fact("INTAKE_AVG_VS_TARGET", "under_maternal", "focus", "watch", 86, "food", params));
  } else if (ratio >= T.onTargetLow && ratio <= T.onTargetHigh) {
    out.push(fact("INTAKE_AVG_VS_TARGET", "on_target", "win", "good", 85, "food", params));
  } else if (ratio > T.overHigh) {
    out.push(fact("INTAKE_AVG_VS_TARGET", "over", "focus", ratio > T.overAlert ? "watch" : "info", ratio > T.overAlert ? 84 : 80, "food", params));
  } else if (ratio < T.underLow) {
    out.push(fact("INTAKE_AVG_VS_TARGET", "under", "focus", "info", 66, "food", params));
  }
  return out;
}

function swingFacts(input: ReflectionInput): Fact[] {
  const days = input.recap.days.filter((d) => d.status !== "pending" && d.eatenKcal > 0 && d.eatenKcal >= d.targetKcal * T.swingMinShare);
  if (days.length < T.swingMinDays) return [];
  const kcal = days.map((d) => d.eatenKcal);
  const avg = mean(kcal);
  const sd = Math.sqrt(mean(kcal.map((v) => (v - avg) ** 2)));
  const cv = avg > 0 ? sd / avg : 0;
  const min = Math.min(...kcal);
  const max = Math.max(...kcal);
  const params: FactParams = { minKcal: min, maxKcal: max, spreadKcal: max - min, days: days.length };
  if (max - min >= T.swingSpreadKcal || cv >= T.swingCv) return [fact("INTAKE_SWING", "swing", "focus", "info", 50, "food", params)];
  if (days.length >= T.steadyMinDays && cv <= T.steadyCv) return [fact("INTAKE_SWING", "steady", "win", "good", 50, "food", params)];
  return [];
}

function proteinFacts(input: ReflectionInput): Fact[] {
  const { protein } = input.recap;
  if (!protein || protein.days < T.proteinMinDays || protein.targetG <= 0) return [];
  const share = protein.avgG / protein.targetG;
  const params: FactParams = {
    avgG: protein.avgG,
    targetG: protein.targetG,
    pct: Math.round(share * 100),
    shortG: Math.max(0, protein.targetG - protein.avgG),
  };
  // Protein is its own domain and ranks above the calorie average: a person who asks about macros hears about it first.
  if (share < T.proteinLowShare) {
    return [fact("PROTEIN_LOW", "low", "focus", "watch", share < T.proteinVeryLowShare ? 88 : 83, "protein", params)];
  }
  if (share >= T.proteinOkShare) return [fact("PROTEIN_OK", "ok", "win", "good", 70, "protein", params)];
  return [];
}

/** Which patterns a mode is told about: Naikin BB does not need "less starch", Hamil / Menyusui no starch advice. */
const PATTERNS_BY_MODE: Record<ReflectionMode, readonly FoodPatternKind[]> = {
  lose: ["fried", "double_carb", "sweet"],
  maintain: ["fried", "double_carb", "sweet"],
  gain: ["fried"],
  maternal: ["fried", "sweet"],
};

function patternFacts(input: ReflectionInput): Fact[] {
  if (input.recap.loggedDays < T.minLoggedForIntake) return [];
  const judged = new Set(input.recap.days.filter((d) => d.status !== "pending").map((d) => d.date));
  const allowed = PATTERNS_BY_MODE[input.mode];
  return detectFoodPatterns(input.food.filter((item) => judged.has(item.date)))
    .filter((hit) => allowed.includes(hit.pattern))
    .map((hit) =>
      fact("FOOD_PATTERN", hit.pattern, "focus", "info", hit.pattern === "fried" ? 66 : hit.pattern === "double_carb" ? 64 : 62, "food", {
        count: hit.count,
        days: hit.days,
        kcalSharePct: hit.kcalSharePct,
        examples: hit.examples.join(", "),
      }),
    );
}

// ---- movement ----

function workoutFacts(input: ReflectionInput): Fact[] {
  const { mode } = input;
  const out: Fact[] = [];
  const { exercise } = input;
  if (exercise.sessions >= T.activeSessions || exercise.activeDays >= T.activeDays || exercise.minutes >= T.activeMinutes) {
    out.push(
      fact("ACTIVE_WEEK", mode === "maternal" ? "maternal" : "active", "win", "good", 65, "move", {
        sessions: exercise.sessions,
        activeDays: exercise.activeDays,
        minutes: exercise.minutes,
      }),
    );
  }

  const maternal = mode === "maternal";
  const zoneMin = maternal ? T.hardZoneMinMaternal : T.hardZoneMin;
  let worst: { workout: WorkoutInput; z45Min: number; totalSec: number; share: number } | null = null;
  let flagged = 0;
  let zonedMin = 0;
  let hardMin = 0;
  for (const workout of input.workouts) {
    if (!workout.zones) continue;
    const sec = workout.zones.sec;
    const totalSec = sec.reduce((sum, s) => sum + s, 0) + workout.zones.belowSec;
    const z45Sec = (sec[3] ?? 0) + (sec[4] ?? 0);
    zonedMin += totalSec / 60;
    hardMin += z45Sec / 60;
    if (totalSec <= 0) continue;
    const share = z45Sec / totalSec;
    if (z45Sec / 60 >= zoneMin && share >= T.hardZoneShare) {
      flagged += 1;
      if (!worst || z45Sec > worst.z45Min * 60) worst = { workout, z45Min: z45Sec / 60, totalSec, share };
    }
  }
  const easyMin = zonedMin - hardMin;

  if (worst) {
    const { workout } = worst;
    const zoneMax = workout.zones!.maxHr;
    const avgHrPct = workout.avgHr !== null && zoneMax > 0 ? workout.avgHr / zoneMax : null;
    const bmi = bmiOf(input.person.weightKg, input.person.heightCm);
    const highHr = workout.avgHr !== null && ((avgHrPct ?? 0) >= T.doctorAvgHrPct || workout.avgHr >= T.doctorAvgHr);
    const doctor = !maternal && bmi >= T.doctorBmi && highHr;
    const variant = maternal ? "hard_maternal" : doctor ? "hard_check_doctor" : workout.kind === "run" ? "hard_run" : "hard_other";
    out.push(
      fact("RUN_INTENSITY", variant, "focus", doctor || maternal ? "alert" : "watch", doctor ? 95 : maternal ? 92 : 85, "move", {
        kind: workout.kind,
        workouts: flagged,
        z45Min: round1(worst.z45Min),
        zoneFrom: 4,
        zoneTo: 5,
        z45SharePct: Math.round(worst.share * 100),
        durationMin: round1(workout.durationMin),
        distanceKm: workout.distanceKm !== null ? round2(workout.distanceKm) : null,
        avgHrBpm: workout.avgHr,
        maxHrBpm: workout.maxHr,
      }),
    );
  } else if (!maternal && zonedMin >= T.easyMinutes && hardMin / zonedMin < T.easyMaxShare) {
    out.push(fact("RUN_EASY", "easy", "win", "good", 62, "move", { workouts: input.workouts.filter((w) => w.zones).length, easyMin: Math.round(easyMin), easySharePct: Math.round((1 - hardMin / zonedMin) * 100) }));
  }

  const peak = input.loadRatios.length > 0 ? Math.max(...input.loadRatios) : null;
  if (peak !== null && peak >= T.loadSpike) {
    // One movement point per list: when a hard session is flagged too, its text carries the load as well.
    const run = out.find((f) => f.code === "RUN_INTENSITY");
    if (run) run.params = { ...run.params, loadRatio: round1(peak) };
    out.push(fact("LOAD_SPIKE", "spike", "focus", peak >= T.loadAlert ? "alert" : "watch", peak >= T.loadAlert ? 90 : 75, "move", { loadRatio: round1(peak), spikeAt: T.loadSpike }));
  }
  return out;
}

// ---- sleep and steps ----

function sleepFacts(input: ReflectionInput): Fact[] {
  const nights = input.sleep.filter((n) => n.hours > 0);
  if (nights.length < T.sleepMinNights) return [];
  const hours = nights.map((n) => n.hours);
  const avg = mean(hours);
  const params: FactParams = {
    avgHours: round1(avg),
    minHours: round1(Math.min(...hours)),
    maxHours: round1(Math.max(...hours)),
    nights: nights.length,
    shortNights: hours.filter((h) => h < T.sleepShortNight).length,
    needHours: input.needSleepHours,
  };
  if (avg < T.sleepShortAvg) {
    const priority = avg < T.sleepAlertAvg ? 84 : avg < T.sleepVeryShortAvg ? 79 : 74;
    return [fact("SLEEP_SHORT", "short", "focus", avg < T.sleepVeryShortAvg ? "watch" : "info", priority, "sleep", params)];
  }
  if (nights.length >= T.sleepOkMinNights) return [fact("SLEEP_OK", "ok", "win", "good", 66, "sleep", params)];
  return [];
}

function stepsFacts(input: ReflectionInput): Fact[] {
  if (input.mode === "maternal") return [];
  const measured = input.steps.filter((s) => s.steps >= T.stepsMeasured);
  if (measured.length < T.stepsMinDays) return [];
  const avg = Math.round(mean(measured.map((s) => s.steps)));
  const params: FactParams = {
    avgSteps: avg,
    days: measured.length,
    thinDays: input.steps.length - measured.length,
    lowDays: measured.filter((s) => s.steps < T.stepsLowDay).length,
  };
  if (avg < T.stepsLow) return [fact("LOW_STEPS", "low", "focus", "info", 45, "move", params)];
  if (avg >= T.stepsGood) return [fact("STEPS_GOOD", "good", "win", "good", 55, "move", params)];
  return [];
}

// ---- build + select ----

/** Every fact the week supports, before selection. */
export function buildFacts(input: ReflectionInput): Fact[] {
  return [
    ...logFacts(input),
    ...weightFacts(input),
    ...anomalyFacts(input),
    ...intakeFacts(input),
    ...swingFacts(input),
    ...proteinFacts(input),
    ...patternFacts(input),
    ...workoutFacts(input),
    ...sleepFacts(input),
    ...stepsFacts(input),
  ];
}

export interface FactSelection {
  wins: Fact[];
  focus: Fact[];
}

const byPriority = (a: Fact, b: Fact) => b.priority - a.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.variant < b.variant ? -1 : 1);

/**
 * 2-3 wins (as many as exist, at most three) and up to three focus points, safest first. The best point of each domain
 * (food, protein, weight, movement, sleep, data) is taken before a second one of any domain, so the list is not three versions
 * of the same thing; no domain gets more than `maxFocusPerDomain`.
 */
export function selectFacts(facts: readonly Fact[]): FactSelection {
  const wins = facts.filter((f) => f.role === "win").toSorted(byPriority).slice(0, T.maxWins);
  const candidates = facts.filter((f) => f.role === "focus").toSorted(byPriority);
  const picked = new Set<Fact>();
  const perDomain = new Map<FactDomain, number>();
  for (const pass of [1, T.maxFocusPerDomain]) {
    for (const f of candidates) {
      if (picked.size >= T.maxFocus) break;
      const used = perDomain.get(f.domain) ?? 0;
      if (picked.has(f) || used >= pass) continue;
      picked.add(f);
      perDomain.set(f.domain, used + 1);
    }
  }
  return { wins, focus: [...picked].toSorted(byPriority) };
}

export function reflectionFacts(input: ReflectionInput): FactSelection & { all: Fact[] } {
  const all = buildFacts(input);
  return { ...selectFacts(all), all };
}

/** Rounds to half a power of ten of its size (450 -> 450, 460 -> 450, 1950 -> 2000, 5.9 -> 6): a few percent keeps the fingerprint. */
function quantize(value: number | string | boolean | null): string {
  if (typeof value !== "number" || value === 0) return String(value);
  const step = 10 ** Math.floor(Math.log10(Math.abs(value))) / 2;
  return String(Math.round(Math.round(value / step) * step * 1000) / 1000);
}

/** FNV-1a (32 bit) of the selected facts with their numbers quantized; what "the facts changed materially" compares. */
export function selectionSignature(selection: FactSelection): string {
  const text = [...selection.wins, ...selection.focus]
    .map((f) => `${f.role}:${f.code}:${f.variant}:${Object.keys(f.params).toSorted().map((k) => `${k}=${quantize(f.params[k]!)}`).join(",")}`)
    .join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
