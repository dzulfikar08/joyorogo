// Pure calorie engine shared by server and clients. The only runtime dependency
// is @joyorogo/i18n (display labels follow the active language); the web app
// imports it into route modules, so keep it tiny (zod schemas for these shapes
// live in ./schemas).

import {
  clockHourIn,
  dayIn,
  getActiveDayZone,
  getActiveLocale,
  getT,
  relativeDayLabel,
  yesterdayIn,
} from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import type { CalibrationInfo } from "./calibration";
import type { ManualTdeeInfo } from "./manual-tdee";
import type { MaternalInfo } from "./maternal";
import {
  MAX_SURPLUS_KCAL,
  MIN_SURPLUS_KCAL,
  PACE_PCT,
  UNDERWEIGHT_BMI,
  bmiOf,
  clampSurplus,
  daysAtSurplus,
  gainNumbers,
  isGainGap,
  goalOf,
  paceBand,
  pacePctOf,
  rawSurplusKcal,
  suggestedDays,
} from "./gain";
import type { GainBand, GainInfo, Goal } from "./gain";

// One definition of "Hari ini / Kemarin / Sabtu, 10 Okt" for every caller.
export { relativeDayLabel };

export const GENDERS = ["male", "female"] as const;
export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export const MEALS = [
  "sarapan",
  "makan_siang",
  "makan_malam",
  "snack",
  "sahur",
  "berbuka",
] as const;

export type Gender = (typeof GENDERS)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type Meal = (typeof MEALS)[number];

/**
 * A label table whose values follow the app language: each property is a getter
 * reading the active locale, so `LABELS[key]` keeps working at every call site
 * and re-renders after a language switch. Server code must NOT read these (a
 * Worker has no single active language): use `mealLabel(meal, locale)` instead.
 */
export function localizedLabels<K extends string>(
  keys: readonly K[],
  label: (key: K, locale: Locale) => string,
): Record<K, string> {
  const table = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(table, key, {
      enumerable: true,
      get: () => label(key, getActiveLocale()),
    });
  }
  return table;
}

/** "Sarapan" / "Breakfast". Pass `locale` on the server. */
export function mealLabel(meal: Meal, locale: Locale = getActiveLocale()): string {
  return getT(locale)(`meal.label.${meal}`);
}

/** Slot name on the edit chips; snack reads as "Camilan" there. */
export function mealEditLabel(meal: Meal, locale: Locale = getActiveLocale()): string {
  return getT(locale)(`meal.editLabel.${meal}`);
}

export const MEAL_LABELS = localizedLabels(MEALS, mealLabel);

/** Slot names on the edit chips; snack reads as "Camilan" there. */
export const MEAL_EDIT_LABELS = localizedLabels(MEALS, mealEditLabel);

export const ACTIVITY_LABELS = localizedLabels(ACTIVITY_LEVELS, (level, locale) =>
  getT(locale)(`activity.${level}`),
);

/**
 * The standard activity factors: total daily energy as a multiple of the BMR. The person picks the level by their daily
 * life WITHOUT the workouts they log (those are added separately, lib/exercise-credit), so nothing is counted twice.
 * Thermic effect of food is already inside these factors (they come from total expenditure): never add it again.
 */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * Hamil / Menyusui keep the multipliers their AKG-based target has always used (1.25 / 1.35 / 1.45 for the levels that
 * used to be low / mid / high, which migration 0048 renamed to sedentary / light / moderate), so the maternal target
 * does not move numerically with the new levels. active and very_active continue the same 0.1 steps.
 */
export const MATERNAL_ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.25,
  light: 1.35,
  moderate: 1.45,
  active: 1.55,
  very_active: 1.65,
};

/** Share of the TDEE that is the thermic effect of food (Westerterp 2004: about 5 to 15%, 10% used). */
export const TEF_SHARE = 0.1;

/**
 * The daily movement a factor already contains: TDEE - BMR - the TEF share, never below 0. Measured activity only
 * counts for what goes beyond this (lib/exercise-credit).
 */
export function movementInFactorKcal(tdeeKcal: number, bmrKcal: number): number {
  return Math.max(0, tdeeKcal - bmrKcal - TEF_SHARE * tdeeKcal);
}

/** Eat-ring state: yellow from 90% of the budget, red once over it. */
export type EatTone = "ok" | "near" | "over";
export function eatTone(eatenKcal: number, targetKcal: number): EatTone {
  if (targetKcal <= 0) return "ok";
  if (eatenKcal > targetKcal) return "over";
  return eatenKcal >= targetKcal * 0.9 ? "near" : "ok";
}

export const KCAL_PER_KG_FAT = 7700;
const EAT_FLOOR: Record<Gender, number> = { male: 1500, female: 1200 };
/** The lowest daily eat target the plan sets (1500 male, 1200 female); the deficit never cuts below it. */
export const eatFloorKcal = (gender: Gender): number => EAT_FLOOR[gender];
/**
 * Nightly sleep goals a person can pick (hours). NSF 2015: 7-9 h recommended for adults, 6-10 h "may be appropriate";
 * AASM/SRS: at least 7 h. 6 and 6.5 are accepted but sit below the recommended minimum.
 */
export const SLEEP_TARGET_HOURS = [6, 6.5, 7, 7.5, 8, 8.5, 9] as const;
export const DEFAULT_SLEEP_TARGET_HOURS = 8;
/** A night below this is under the recommended minimum for adults whatever the goal. */
export const MIN_RECOMMENDED_SLEEP_HOURS = 7;
export const BURN_BASE_PER_KG = 3.3;
/** Safe daily deficit window: below the floor the date no longer moves the plan, above the cap it is unsafe. */
export const MIN_DEFICIT_KCAL = 250;
export const MAX_DEFICIT_KCAL = 1000;
/** Furthest target date the plan accepts (5 years). */
export const MAX_TARGET_DAYS = 1826;

export type ProfileInput = {
  birthYear: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  /** Calendar day in the user's zone, YYYY-MM-DD */
  targetDate: string;
  activityLevel: ActivityLevel;
  /**
   * What the plan works toward (lib/gain Goal). Absent means "lose", the plan as it
   * always was: a deficit toward a lower target, holding once the weight is there.
   */
  goal?: Goal;
  /** Nightly sleep goal, one of SLEEP_TARGET_HOURS. Absent or null means DEFAULT_SLEEP_TARGET_HOURS. */
  sleepTargetHours?: number | null;
};

export type TargetNotes =
  | "MAINTENANCE"
  | "BELOW_HEALTHY_RANGE"
  | "PLAN_CLAMPED"
  /** Hamil / Menyusui plan (lib/maternal): no deficit, AKG additions */
  | "MATERNAL"
  /** Naikin BB plan (lib/gain): TDEE plus a surplus */
  | "GAIN";

export type Targets = {
  /** Mifflin-St Jeor BMR (Hamil / Menyusui: of the pre-pregnancy weight) */
  bmr: number;
  /** The person's activity level, and the factor it stands for (maternal plans use MATERNAL_ACTIVITY_FACTOR) */
  level: ActivityLevel;
  factor: number;
  /**
   * TDEE = BMR x factor (rounded to 5 for gain and maternal, whose target is built on it); TEF is inside the factor.
   * With an active calibration it is the calibrated TDEE instead (`calibration.usedKcal`), and `factor` stays the
   * level's. With a typed TDEE (`manualTdee.kcal`) it is that figure.
   */
  tdee: number;
  /**
   * COMPAT, old clients (native builds up to 1932, web tabs opened before the TDEE deploy) still read this: their
   * "adaptive target" sheet and needsBreakdown use `formulaTdee`. It equals `tdee` (the figure the target is built on,
   * calibrated or not) so their sums stay whole.
   */
  formulaTdee: number;
  /** COMPAT, same old clients: their needsBreakdown and snack advice subtract/add `assumedKcal`. Always 0 now. */
  assumedKcal: 0;
  /** Movement the factor already contains (movementInFactorKcal): measured activity only counts beyond it */
  includedKcal: number;
  /**
   * The day's eat budget. computeTargets / computeMaternalTargets return the base (TDEE less the deficit, plus surplus
   * or AKG addition); day.summary adds `exerciseKcal` to it. Sisa = eatKcal - eaten.
   */
  eatKcal: number;
  /** Part of `eatKcal` that came from counted activity above the factor (lib/exercise-credit); 0 in the plan itself */
  exerciseKcal: number;
  /** Daily movement goal for the exercise screens. It is not part of the eat budget. */
  burnKcal: number;
  sleepHours: number;
  /** planned total daily deficit after safety clamps; all of it comes out of food */
  deficitKcal: number;
  /** raw deficit the target date would demand, before clamps */
  rawDeficitKcal: number;
  idealMinKg: number;
  idealMaxKg: number;
  notes: TargetNotes[];
  /** Hamil / Menyusui detail; null for everyone else */
  maternal: MaternalInfo | null;
  /** Naikin BB detail while a surplus is active; null otherwise (also once the target weight is reached) */
  gain: GainInfo | null;
  /**
   * Set when the stored target date cannot be reached at the safe pace (the clamp is
   * what the plan really follows): the realistic date to offer. Null otherwise.
   */
  datePace: DatePace | null;
  /**
   * Automatic calibration (lib/calibration): where it stands and, when active, the measured TDEE this target is built
   * on (`tdee` is then the calibrated figure, `includedKcal` follows it). Set by buildPlan; absent for Hamil / Menyusui
   * and in payloads from before the feature (clients treat missing as "no calibration").
   */
  calibration?: CalibrationInfo | null;
  /**
   * "Pakai TDEE sendiri" (lib/manual-tdee): the typed TDEE (`tdee` is then that figure), the computed one next to it
   * and the calibration's suggestion. Set by buildPlan with `kcal: null` while unused; absent from older payloads.
   */
  manualTdee?: ManualTdeeInfo | null;
};

export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

// Day boundaries are WIB (UTC+7, no DST) unless a zone is passed (docs/marketing/malaysia-plan.md, "Timezone"): 23:30 UTC is
// already tomorrow here, and 16:30 UTC is already tomorrow in Kuala Lumpur (UTC+8). Callers that know the user's zone pass it;
// stored days of existing rows stay WIB-cut.
export function jakartaToday(now: Date = new Date(), zone?: DayZone): string {
  return dayIn(zone, now);
}

export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

// The WIB calendar day before today. Sleep belongs to the morning it ended.
export function wibYesterday(now: Date = new Date(), zone?: DayZone): string {
  return yesterdayIn(zone, now);
}

/** Calendar-day offset of a 'YYYY-MM-DD' string via pure UTC math (no date libs). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Review-screen group header: "Kemarin · Sarapan". */
export function storySlotLabel(
  date: string,
  meal: Meal,
  today: string,
  locale: Locale = getActiveLocale(),
): string {
  return `${relativeDayLabel(date, today, locale)} · ${mealLabel(meal, locale)}`;
}

/** Consecutive logged days ending today — or yesterday when today is not logged yet. */
export function streakFromDates(dates: string[], today: string): number {
  const logged = new Set(dates);
  let streak = 0;
  let cursor = logged.has(today) ? today : shiftDate(today, -1);
  while (logged.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

export function bmrMifflin(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: Gender,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === "male" ? base + 5 : base - 161;
}

export function idealWeightRange(heightCm: number): { minKg: number; maxKg: number } {
  const h_m = heightCm / 100;
  return { minKg: Math.round(18.5 * h_m * h_m), maxKg: Math.round(24.9 * h_m * h_m) };
}

export function ageFromBirthYear(birthYear: number, today: string): number {
  return Number(today.slice(0, 4)) - birthYear;
}

/** Current WIB clock hour as a decimal (e.g. 13.5 = 13:30), or the hour in `zone`. */
export function jakartaClockHour(now: Date = new Date(), zone?: DayZone): number {
  return clockHourIn(zone, now);
}

/**
 * Carb, fat and fibre targets for a day budget. Fat is the larger of 25 % of kcal and 0.5 g/kg of the person's basis
 * weight; carbs are what the budget has left after the real protein goal and that fat; fibre is 14 g per 1000 kcal
 * (at least 25 g). `basisKg` is the weight protein is scaled by (`macroBasisKg`).
 */
export function macroTargets(
  eatKcal: number,
  proteinG: number,
  basisKg: number,
): {
  carbsG: number;
  fatG: number;
  fiberG: number;
} {
  const fatKcal = Math.max(0.25 * eatKcal, 0.5 * basisKg * 9);
  const fatG = Math.round(fatKcal / 9);
  const carbsG = Math.max(0, Math.round((eatKcal - proteinG * 4 - fatKcal) / 4));
  const fiberG = Math.max(25, Math.round((14 * eatKcal) / 1000));
  return { carbsG, fatG, fiberG };
}

/**
 * Daily protein for a cut: 1.5 g/kg of the lesser of current weight and the
 * top of the healthy range (1.6 g/kg on strength-training days — muscle needs
 * the extra building material when it is being broken down and rebuilt).
 * Scaling by total mass would ask a 120 kg body for 180 g/day — nobody eats
 * that, and fat mass does not need it.
 */
export function proteinTargetG(weightKg: number, heightCm: number, trainingDay = false): number {
  return Math.round(
    (trainingDay ? 1.6 : 1.5) * Math.min(weightKg, idealWeightRange(heightCm).maxKg),
  );
}

export type WeighIn = { date: string; weightKg: number };
export type TrendPoint = WeighIn & { trendKg: number };
export type WeightTrend = {
  /** smoothed weight on the latest weigh-in — the number to believe */
  weightKg: number;
  /** kg/week over the last 28 days, negative = losing; null until 10 days of span */
  weeklyRateKg: number | null;
  /** Day the trend reaches target at the current rate; null when not heading there */
  projectedDate: string | null;
  points: TrendPoint[];
};

/** Hacker's-Diet smoothing: each day absorbs 10% of the gap to the scale reading. */
const TREND_ALPHA = 0.1;
export const ADAPTIVE_WINDOW_DAYS = 28;
const ADAPTIVE_MIN_LOGGED_DAYS = 14;
export const ADAPTIVE_MIN_WEIGH_INS = 6;
const RATE_MIN_SPAN_DAYS = 10;
const PROJECTION_MAX_DAYS = 730;

/** Least-squares slope in kg/day; null when the dates cannot define a line. */
function slopePerDay(weighIns: WeighIn[]): number | null {
  const first = weighIns[0];
  if (!first || weighIns.length < 3) return null;
  const xs = weighIns.map((w) => daysBetween(first.date, w.date));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = weighIns.reduce((a, w) => a + w.weightKg, 0) / weighIns.length;
  let sxx = 0;
  let sxy = 0;
  weighIns.forEach((w, i) => {
    const dx = (xs[i] ?? 0) - meanX;
    sxx += dx * dx;
    sxy += dx * (w.weightKg - meanY);
  });
  return sxx === 0 ? null : sxy / sxx;
}

/**
 * Smoothed weight, weekly rate, and target projection from weigh-ins sorted
 * ascending (all on/before `date`). Null until there are two weigh-ins.
 */
export function weightTrend(
  weighIns: WeighIn[],
  targetKg: number,
  date: string,
): WeightTrend | null {
  if (weighIns.length < 2) return null;
  const points: TrendPoint[] = [];
  for (const w of weighIns) {
    const prev = points.at(-1);
    const gapDays = prev ? Math.max(1, daysBetween(prev.date, w.date)) : 0;
    const trendKg = prev
      ? prev.trendKg + (1 - (1 - TREND_ALPHA) ** gapDays) * (w.weightKg - prev.trendKg)
      : w.weightKg;
    points.push({ ...w, trendKg });
  }
  const latest = points.at(-1)!;

  const windowStart = shiftDate(date, -ADAPTIVE_WINDOW_DAYS);
  const recent = weighIns.filter((w) => w.date >= windowStart);
  const span = recent.length > 0 ? daysBetween(recent[0]!.date, recent.at(-1)!.date) : 0;
  const slope = span >= RATE_MIN_SPAN_DAYS ? slopePerDay(recent) : null;
  const weeklyRateKg = slope === null ? null : Math.round(slope * 7 * 100) / 100;

  let projectedDate: string | null = null;
  // Heading toward the target, down for a cut and up for a gain.
  if (slope !== null && slope !== 0 && (targetKg - latest.trendKg) * slope > 0) {
    const days = Math.ceil((targetKg - latest.trendKg) / slope);
    if (days <= PROJECTION_MAX_DAYS) projectedDate = shiftDate(date, days);
  }

  const chartStart = shiftDate(date, -30);
  return {
    weightKg: Math.round(latest.trendKg * 10) / 10,
    weeklyRateKg,
    projectedDate,
    points: points
      .filter((p) => p.date >= chartStart)
      .map((p) => ({ ...p, trendKg: Math.round(p.trendKg * 100) / 100 })),
  };
}

export type DayKcal = { date: string; kcal: number };

/** Window (days) of the client-side EMA trend line drawn on charts. */
export const EMA_TREND_DAYS = 7;

/**
 * 7-day EMA over weigh-ins sorted ascending — same gap-aware smoothing as
 * weightTrend (each day absorbs a fraction of the gap to the scale reading)
 * with alpha 2/(N+1) for a 7-day window. Shared by web and native charts,
 * which need the line over any range while day.summary only ships 30 days.
 */
export function emaTrendPoints(weighIns: WeighIn[]): TrendPoint[] {
  const alphaPerDay = 2 / (EMA_TREND_DAYS + 1);
  const points: TrendPoint[] = [];
  for (const w of weighIns) {
    const prev = points.at(-1);
    if (!prev) {
      points.push({ ...w, trendKg: w.weightKg });
      continue;
    }
    const gapDays = Math.max(1, daysBetween(prev.date, w.date));
    points.push({
      ...w,
      trendKg: prev.trendKg + (1 - (1 - alphaPerDay) ** gapDays) * (w.weightKg - prev.trendKg),
    });
  }
  return points.map((p) => ({ ...p, trendKg: Math.round(p.trendKg * 100) / 100 }));
}

export type RangeStats = {
  /** smoothed weight at the last weigh-in of the range */
  trendKg: number;
  /** trend change across the range; null with fewer than 2 weigh-ins */
  changeKg: number | null;
  /** kg/week across the range; null when the two ends cannot define a pace */
  weeklyRateKg: number | null;
  /** Day the target is reached at this pace; null when not projectable */
  projectedDate: string | null;
};

/** Rate below this is water noise, not a pace (matches the server's flat rule). */
const RANGE_RATE_MIN_KG_WEEK = 0.05;
const RANGE_PROJECTION_MAX_DAYS = 730;

/** Change, weekly pace, and target projection over a chart's EMA points. */
export function rangeStats(points: TrendPoint[], targetKg: number | null): RangeStats {
  const last = points.at(-1);
  if (!last) return { trendKg: 0, changeKg: null, weeklyRateKg: null, projectedDate: null };
  const first = points[0]!;
  const days = daysBetween(first.date, last.date);
  const changeKg = points.length > 1 ? Math.round((last.trendKg - first.trendKg) * 10) / 10 : null;
  const perDay = days > 0 && changeKg !== null ? changeKg / days : null;
  const weeklyRateKg = perDay === null ? null : Math.round(perDay * 700) / 100;

  let projectedDate: string | null = null;
  if (
    targetKg !== null &&
    weeklyRateKg !== null &&
    Math.abs(weeklyRateKg) >= RANGE_RATE_MIN_KG_WEEK &&
    (last.trendKg - targetKg) * -weeklyRateKg > 0
  ) {
    // weeklyRateKg is per week — convert to days before shifting the date.
    const daysToTarget = Math.ceil(((targetKg - last.trendKg) / weeklyRateKg) * 7);
    if (daysToTarget <= RANGE_PROJECTION_MAX_DAYS)
      projectedDate = shiftDate(last.date, daysToTarget);
  }
  return { trendKg: last.trendKg, changeKg, weeklyRateKg, projectedDate };
}

/**
 * Measured daily-life TDEE from energy balance over the 28 complete days
 * before `date` (MacroFactor-style): average logged intake, minus average
 * logged exercise, plus the energy the weight slope says left the body.
 * Days logged below `minDayKcal` are treated as unlogged, not as fasting.
 * Null until there is enough data to beat the formula. lib/calibration holds the gate, the weekly anchor and the +-15%
 * guard before any of it reaches the plan (the tdeeKcal option of computeTargets); with the calibration off it only
 * drives the level recommendation (lib/activity-guide).
 */
export function adaptiveTdee(input: {
  date: string;
  weighIns: WeighIn[];
  intake: DayKcal[];
  exercise: DayKcal[];
  minDayKcal: number;
}): number | null {
  const start = shiftDate(input.date, -ADAPTIVE_WINDOW_DAYS);
  const inWindow = (d: string) => d >= start && d < input.date;
  const logged = input.intake.filter((d) => inWindow(d.date) && d.kcal >= input.minDayKcal);
  const weights = input.weighIns.filter((w) => inWindow(w.date));
  if (logged.length < ADAPTIVE_MIN_LOGGED_DAYS || weights.length < ADAPTIVE_MIN_WEIGH_INS) {
    return null;
  }
  if (daysBetween(weights[0]!.date, weights.at(-1)!.date) < ADAPTIVE_MIN_LOGGED_DAYS) return null;
  const slope = slopePerDay(weights);
  if (slope === null) return null;
  const avgIntake = logged.reduce((a, d) => a + d.kcal, 0) / logged.length;
  const avgExercise =
    input.exercise.filter((d) => inWindow(d.date)).reduce((a, d) => a + d.kcal, 0) /
    ADAPTIVE_WINDOW_DAYS;
  return Math.round(avgIntake - avgExercise - slope * KCAL_PER_KG_FAT);
}

/**
 * Ramadan day check via the Umm al-Qura Hijri calendar (Workers/Node both ship
 * full ICU). Returns false on any Intl failure so manual mode still works.
 */
export function isRamadanDate(now: Date = new Date(), zone?: DayZone): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: zone ?? getActiveDayZone(),
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).formatToParts(now);
    const month = parts.find((p) => p.type === "month")?.value;
    return month === "9";
  } catch {
    return false;
  }
}

export type RamadanPref = "auto" | "on" | "off";

/** Effective Ramadan state for a profile preference + date. */
export function effectiveRamadan(
  pref: RamadanPref | undefined,
  now: Date = new Date(),
  zone?: DayZone,
): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return isRamadanDate(now, zone);
}

/** Meal slots shown during Ramadan — the eating window, sahur → snack → berbuka. */
export const RAMADAN_SLOTS: Meal[] = ["berbuka", "snack", "sahur"];
export const NORMAL_SLOTS: Meal[] = ["sarapan", "makan_siang", "makan_malam", "snack"];

export function slotsFor(ramadan: boolean): Meal[] {
  return ramadan ? RAMADAN_SLOTS : NORMAL_SLOTS;
}

/**
 * Eat-budget share per slot during Ramadan. The fasting-day window is
 * berbuka → sahur; siang/sarapan/malam carry no budget (kept for legacy logs).
 */
export function ramadanSplit(): Record<Meal, number> {
  return {
    sahur: 0.4,
    berbuka: 0.45,
    snack: 0.15,
    sarapan: 0,
    makan_siang: 0,
    makan_malam: 0,
  };
}

/** Meal slot that matches the current clock time in `zone` (default: active zone, Jakarta on the server). */
export function suggestMealNow(now: Date = new Date(), ramadan = false, zone?: DayZone): Meal {
  const hour = jakartaClockHour(now, zone);
  if (ramadan) {
    // Pre-dawn → sahur; sunset → berbuka; late night → post-tarawih snack;
    // fasting hours point at the upcoming main meal.
    if (hour >= 3 && hour < 5) return "sahur";
    if (hour >= 17.5 && hour < 21.5) return "berbuka";
    if (hour >= 21.5 || hour < 3) return "snack";
    return "berbuka";
  }
  if (hour >= 5 && hour < 10.5) return "sarapan";
  if (hour >= 10.5 && hour < 15) return "makan_siang";
  if (hour >= 17.5 && hour < 21.5) return "makan_malam";
  return "snack";
}

/**
 * Slot for a scan/log that holds a heavy main dish (nasi, mie, lauk). The plain
 * time suggestion falls back to snack in the 15:00-17:30 gap and late at night,
 * which is wrong for a real meal: those hours become makan malam. Ramadan
 * keeps its own eating-window slots.
 */
export function suggestMealForDish(
  now: Date,
  ramadan: boolean,
  heavy: boolean,
  zone?: DayZone,
): Meal {
  const meal = suggestMealNow(now, ramadan, zone);
  return heavy && !ramadan && meal === "snack" ? "makan_malam" : meal;
}

/**
 * Calories → walking equivalents (brisk 5 km/h). Weight-adjusted using the
 * standard MET model (~0.055 × kg kcal/min); steps assume ~115 steps/min.
 */
export function movementFor(
  kcal: number,
  weightKg = 70,
): { steps: number; km: number; minutes: number } {
  const kcalPerMin = 0.055 * weightKg;
  const minutes = kcal / kcalPerMin;
  const km = minutes / 12;
  const steps = minutes * 115;
  return {
    steps: Math.round(steps / 50) * 50,
    km: Math.round(km * 10) / 10,
    minutes: Math.round(minutes / 5) * 5,
  };
}

export type ComputeOptions = {
  /** Today, override for tests; defaults to jakartaToday(undefined, zone) */
  today?: string;
  /** The user's day zone; used when `today` is omitted */
  zone?: DayZone;
  /** latest known weight; defaults to profile start weight */
  weightNow?: number;
  /** Replaces the profile level's factor. Used to show the target a level (or the pre-factor model) would give. */
  activityFactor?: number;
  /** Replaces BMR x factor: the calibrated TDEE (lib/calibration, already inside its +-15% guard). */
  tdeeKcal?: number;
};

/**
 * The one source of the 3 daily numbers. TDEE = BMR x the activity factor of the chosen level (daily life without the
 * logged workouts; TEF is inside the factor), or the calibrated TDEE (`tdeeKcal`, lib/calibration) when the weight
 * trend has earned one. Either way a logged workout never double-dips: it is added on top by lib/exercise-credit, and
 * only the measured activity beyond the movement the TDEE already holds (`includedKcal`, derived from it).
 */
export function computeTargets(profile: ProfileInput, options: ComputeOptions = {}): Targets {
  const today = options.today ?? jakartaToday(undefined, options.zone);
  const weightNow = options.weightNow ?? profile.weightKg;
  const age = ageFromBirthYear(profile.birthYear, today);

  const bmr = bmrMifflin(weightNow, profile.heightCm, age, profile.gender);
  const factor = options.activityFactor ?? ACTIVITY_FACTOR[profile.activityLevel];
  const tdee = options.tdeeKcal ?? bmr * factor;

  const ideal = idealWeightRange(profile.heightCm);
  const notes: TargetNotes[] = [];

  // Naikin BB: TDEE plus a surplus toward a higher target. Only while the weight is
  // still below the target; once it is there the plan holds ("MAINTENANCE").
  const goal = profile.goal ?? "lose";
  const gapKg = profile.targetWeightKg - weightNow;
  const gaining = goal === "gain" && isGainGap(gapKg);
  const gainNums = gaining
    ? gainNumbers({
        weightNowKg: weightNow,
        targetKg: profile.targetWeightKg,
        heightCm: profile.heightCm,
        days: daysBetween(today, profile.targetDate),
        idealMaxKg: ideal.maxKg,
      })
    : null;

  if (!gaining && profile.targetWeightKg < ideal.minKg) {
    notes.push("BELOW_HEALTHY_RANGE");
  }

  // Nothing to lose (weight at or below the target, or the goal is to hold): hold weight instead
  const losing = goal === "lose" && weightNow > profile.targetWeightKg;
  const maintenance = !losing && !gaining;
  const rawDeficit = losing
    ? ((weightNow - profile.targetWeightKg) * KCAL_PER_KG_FAT) /
      Math.max(1, daysBetween(today, profile.targetDate))
    : 0;

  const totalDeficit = losing
    ? Math.min(MAX_DEFICIT_KCAL, Math.max(MIN_DEFICIT_KCAL, rawDeficit))
    : 0;
  if (losing && rawDeficit > MAX_DEFICIT_KCAL) {
    notes.push("PLAN_CLAMPED");
  }

  const burn = Math.min(400, Math.max(200, round5(BURN_BASE_PER_KG * weightNow)));
  const floor = EAT_FLOOR[profile.gender];
  // Gain rounds the TDEE to 5 first, so TDEE + surplus is exactly the target on screen.
  const baseKcal = gainNums ? round5(tdee) : tdee;
  const eat = gainNums
    ? baseKcal + gainNums.surplusKcal
    : Math.max(round5(tdee - totalDeficit), floor);
  if (
    !gainNums &&
    eat === floor &&
    round5(tdee - totalDeficit) < floor &&
    !notes.includes("PLAN_CLAMPED")
  ) {
    notes.push("PLAN_CLAMPED");
  }

  if (maintenance) {
    notes.push("MAINTENANCE");
  }
  if (gainNums) {
    notes.push("GAIN");
  }

  return {
    bmr: Math.round(bmr),
    level: profile.activityLevel,
    factor,
    tdee: Math.round(baseKcal),
    formulaTdee: Math.round(baseKcal),
    assumedKcal: 0,
    includedKcal: Math.round(movementInFactorKcal(tdee, bmr)),
    eatKcal: eat,
    exerciseKcal: 0,
    burnKcal: burn,
    sleepHours: profile.sleepTargetHours ?? DEFAULT_SLEEP_TARGET_HOURS,
    deficitKcal: Math.round(totalDeficit),
    rawDeficitKcal: Math.round(rawDeficit),
    idealMinKg: ideal.minKg,
    idealMaxKg: ideal.maxKg,
    notes,
    maternal: null,
    gain: gainNums ? { ...gainNums, reachDate: shiftDate(today, gainNums.daysToTarget) } : null,
    datePace: storedDatePace({
      weightNowKg: weightNow,
      targetWeightKg: profile.targetWeightKg,
      targetDate: profile.targetDate,
      today,
      goal,
      heightCm: profile.heightCm,
    }),
  };
}

export type ExerciseLogLike = { kcal: number; source?: string | null };

export type BurnResult = {
  /** resting BMR at the current weight */
  bmrKcal: number;
  /** BMR x activity factor x elapsed day fraction */
  activityKcal: number;
  /** today's logged exercise kcal; rest rows excluded */
  exerciseKcal: number;
  burnKcal: number;
};

export type BurnInput = {
  profile: ProfileInput;
  /** latest known weight; defaults to profile start weight */
  weightNowKg?: number;
  /** today's exercise rows */
  exerciseLogs: ExerciseLogLike[];
  /** Day fraction 0..1 override; defaults to the live clock — pass 1 for past days */
  dayFraction?: number;
  /** plan TDEE (Targets.tdee) so an adaptive plan prorates the measured value */
  tdeeKcal?: number;
  /** injectable clock so tests are deterministic */
  now?: Date;
  /** the user's day zone: the clock fraction and today are read in it */
  zone?: DayZone;
};

/**
 * Burn so far today: prorated TDEE floor (BMR x daily-life factor) plus
 * logged exercise. Rest rows (source 'rest') never count — they mark planned
 * days off, not movement.
 */
export function computeBurn(input: BurnInput): BurnResult {
  const today = jakartaToday(input.now, input.zone);
  const weightNow = input.weightNowKg ?? input.profile.weightKg;
  const age = ageFromBirthYear(input.profile.birthYear, today);
  const bmr = bmrMifflin(weightNow, input.profile.heightCm, age, input.profile.gender);
  const fraction =
    input.dayFraction ??
    Math.min(1, Math.max(0, jakartaClockHour(input.now ?? new Date(), input.zone) / 24));
  const activityKcal =
    (input.tdeeKcal ?? bmr * ACTIVITY_FACTOR[input.profile.activityLevel]) * fraction;
  const exerciseKcal = input.exerciseLogs
    .filter((log) => log.source !== "rest")
    .reduce((total, log) => total + log.kcal, 0);
  return {
    bmrKcal: bmr,
    activityKcal,
    exerciseKcal,
    burnKcal: activityKcal + exerciseKcal,
  };
}

/**
 * Live burn-minus-eaten figure. No screen shows it any more (the home model is
 * remaining = target - eaten), but day.summary still returns it: app builds
 * from before that change read `deficit.deficitKcal` (and the native recap
 * share dereferences it). Drop it once those builds are gone.
 */
export type DeficitResult = BurnResult & {
  eatenKcal: number;
  /** positive = burned more than eaten; negative = ate more */
  deficitKcal: number;
  /** eat budget minus net intake */
  targetGap: number;
};

export function computeDeficit(
  eatenKcal: number,
  burn: BurnResult,
  targetKcal: number,
): DeficitResult {
  const net = eatenKcal - burn.burnKcal;
  return {
    ...burn,
    eatenKcal,
    deficitKcal: Math.round(burn.burnKcal - eatenKcal),
    targetGap: Math.round(targetKcal - net),
  };
}

export type TargetDateCheck =
  /** not a real YYYY-MM-DD day */
  | { status: "invalid" }
  /** today or earlier */
  | { status: "past" }
  /** further than MAX_TARGET_DAYS */
  | { status: "tooFar"; days: number }
  /** weight already at/below the goal (or the goal is to hold): the date does not move the plan */
  | { status: "maintenance"; days: number }
  | {
      /** ok: inside the safe window; fast: needs more than the cap; slow: less than the floor */
      status: "ok" | "fast" | "slow";
      days: number;
      lossKg: number;
      /** what the date asks for, before the clamp */
      rawDeficitKcal: number;
      /** what the plan will use (clamped) */
      deficitKcal: number;
      /** days the clamped deficit needs; the date to offer when status is "fast" */
      feasibleDays: number;
    }
  | {
      /**
       * The same verdicts for a higher target (lib/gain). gainOk: inside the surplus window
       * and not past 1% of body weight a week; gainFast: past either; gainSlow: under the
       * surplus floor, so the plan holds the floor and finishes earlier than the date.
       */
      status: "gainOk" | "gainFast" | "gainSlow";
      days: number;
      gainKg: number;
      /** what the date asks for, before the clamp */
      rawSurplusKcal: number;
      /** what the plan will use (clamped) */
      surplusKcal: number;
      /** kg/week the date asks for */
      weeklyKg: number;
      /** the same, as percent of the current body weight per week */
      pacePct: number;
      /** lean / brisk (above 0.5%/week, beginner pace) / fast, of the pace the date asks for */
      band: GainBand;
      /**
       * Days to offer: for gainFast the later date at a lean pace (top of the lean band,
       * never past the surplus cap); otherwise the days the applied surplus needs.
       */
      feasibleDays: number;
    };

/**
 * One verdict for a candidate target date, shared by the server (which rejects
 * past dates) and both clients (which warn about an unsafe pace). Future only:
 * today already leaves no time. `goal` is the plan's direction; absent, it is
 * derived from the weight and the target (a higher target is a gain).
 */
export function checkTargetDate(input: {
  weightNowKg: number;
  targetWeightKg: number;
  targetDate: string;
  today?: string;
  /** the user's day zone; used when `today` is omitted */
  zone?: DayZone;
  goal?: Goal;
  /** lets the gain verdict know an underweight body (no "brisk" band); omitted = not underweight */
  heightCm?: number;
}): TargetDateCheck {
  const today = input.today ?? jakartaToday(undefined, input.zone);
  const { targetDate } = input;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
    Number.isNaN(Date.parse(`${targetDate}T00:00:00Z`)) ||
    shiftDate(targetDate, 0) !== targetDate
  ) {
    return { status: "invalid" };
  }
  const days = daysBetween(today, targetDate);
  if (days < 1) return { status: "past" };
  if (days > MAX_TARGET_DAYS) return { status: "tooFar", days };
  const goal = input.goal ?? goalOf(input.weightNowKg, input.targetWeightKg);
  const gapKg = input.targetWeightKg - input.weightNowKg;
  if (goal === "gain" && isGainGap(gapKg)) {
    const gainKg = Math.round(gapKg * 100) / 100;
    const underweight =
      input.heightCm !== undefined && bmiOf(input.weightNowKg, input.heightCm) < UNDERWEIGHT_BMI;
    const raw = rawSurplusKcal(gainKg, days);
    const surplusKcal = clampSurplus(raw);
    const pacePct = pacePctOf(gainKg, days, input.weightNowKg);
    const tooFast = raw > MAX_SURPLUS_KCAL || pacePct > PACE_PCT.ceiling;
    const status = tooFast ? "gainFast" : raw < MIN_SURPLUS_KCAL ? "gainSlow" : "gainOk";
    return {
      status,
      days,
      gainKg,
      rawSurplusKcal: Math.round(raw),
      surplusKcal,
      weeklyKg: Math.round((gainKg / (days / 7)) * 100) / 100,
      pacePct: Math.round(pacePct * 100) / 100,
      band: paceBand(pacePct, underweight),
      feasibleDays: tooFast
        ? suggestedDays(gainKg, input.weightNowKg, underweight)
        : daysAtSurplus(gainKg, surplusKcal),
    };
  }
  if (goal !== "lose" || input.weightNowKg <= input.targetWeightKg)
    return { status: "maintenance", days };
  const lossKg = input.weightNowKg - input.targetWeightKg;
  const rawDeficitKcal = Math.round((lossKg * KCAL_PER_KG_FAT) / days);
  const deficitKcal = Math.min(MAX_DEFICIT_KCAL, Math.max(MIN_DEFICIT_KCAL, rawDeficitKcal));
  return {
    status:
      rawDeficitKcal > MAX_DEFICIT_KCAL
        ? "fast"
        : rawDeficitKcal < MIN_DEFICIT_KCAL
          ? "slow"
          : "ok",
    days,
    lossKg,
    rawDeficitKcal,
    deficitKcal,
    feasibleDays: Math.ceil((lossKg * KCAL_PER_KG_FAT) / deficitKcal),
  };
}

/**
 * The day's one calorie model: remaining = budget - eaten, where the budget is the base eat target plus the counted
 * activity above the factor (lib/exercise-credit, added by day.summary into `Targets.eatKcal`).
 */
export function remainingKcal(
  targetKcal: number,
  eatenKcal: number,
): { kcal: number; over: boolean } {
  const left = Math.round(targetKcal - eatenKcal);
  return { kcal: Math.abs(left), over: left < 0 };
}

export type NeedsBreakdown = {
  bmrKcal: number;
  level: ActivityLevel;
  /** the activity factor: TDEE = BMR x factor */
  factor: number;
  /** daily-life movement on top of rest, TEF included: tdee - bmr */
  activityKcal: number;
  tdeeKcal: number;
  /** the movement the factor already contains; measured activity counts only beyond it */
  includedKcal: number;
  /** what the plan takes off the TDEE through food; 0 when holding weight */
  cutKcal: number;
  /** Hamil / Menyusui: the AKG 2019 addition on top of the TDEE; 0 otherwise */
  addKcal: number;
  /** Naikin BB: the daily surplus on top of the TDEE; 0 otherwise */
  surplusKcal: number;
  /** the plan's target before counted exercise */
  targetKcal: number;
  /** counted activity above the factor added on top for today (Targets.exerciseKcal); 0 when the setting is off or nothing went beyond it */
  exerciseKcal: number;
  /** the day's budget: targetKcal + exerciseKcal */
  budgetKcal: number;
  /** whole planned daily deficit; all of it is the food cut */
  deficitKcal: number;
  maintenance: boolean;
  /** where the automatic calibration stands, and the figures behind a calibrated TDEE; null without one */
  calibration: CalibrationInfo | null;
};

/** BMR x factor -> TDEE -> minus deficit -> target, from numbers computeTargets already made. */
export function needsBreakdown(targets: Targets): NeedsBreakdown {
  const base = targets.eatKcal - targets.exerciseKcal;
  const cut = targets.tdee - base;
  return {
    bmrKcal: targets.bmr,
    level: targets.level,
    factor: targets.factor,
    activityKcal: targets.tdee - targets.bmr,
    tdeeKcal: targets.tdee,
    includedKcal: targets.includedKcal,
    // under 5 kcal is round5 noise, not a cut
    cutKcal: cut < 5 ? 0 : cut,
    addKcal: targets.maternal?.addKcal ?? 0,
    surplusKcal: targets.gain?.surplusKcal ?? 0,
    targetKcal: base,
    exerciseKcal: targets.exerciseKcal,
    budgetKcal: targets.eatKcal,
    deficitKcal: targets.deficitKcal,
    maintenance: targets.notes.includes("MAINTENANCE"),
    calibration: targets.calibration ?? null,
  };
}

/** The stored date is out of reach at the safe pace; `reachDate` is where the safe pace actually lands. */
export type DatePace = {
  /** fast: the date asks for more than the safe pace; passed: the date is today or earlier */
  reason: "fast" | "passed";
  direction: "lose" | "gain";
  targetWeightKg: number;
  /** kg still to lose / gain */
  kg: number;
  /** days from today at the safe pace, capped at MAX_TARGET_DAYS so the date stays savable */
  feasibleDays: number;
  reachDate: string;
};

/**
 * Verdict on a STORED target date, as the notice Beranda and Profil show: "fast" (the date
 * asks for more than the safe pace) or "passed" (the date is today or earlier while there is
 * still weight to move). Both carry the later date the safe pace reaches; otherwise null.
 */
export function storedDatePace(input: Parameters<typeof checkTargetDate>[0]): DatePace | null {
  const today = input.today ?? jakartaToday(undefined, input.zone);
  const check = checkTargetDate({ ...input, today });
  if (check.status === "past") {
    // Same maths as a one-day-out date: the days the safe pace needs from today.
    const next = checkTargetDate({ ...input, today, targetDate: shiftDate(today, 1) });
    return datePaceOf(next, { targetWeightKg: input.targetWeightKg, today, reason: "passed" });
  }
  return datePaceOf(check, { targetWeightKg: input.targetWeightKg, today, reason: "fast" });
}

/** home:explain.clamped.<key> that matches the notice. */
export function datePaceExplainKey(pace: DatePace): "lose" | "gain" | "passedLose" | "passedGain" {
  if (pace.reason === "passed") return pace.direction === "gain" ? "passedGain" : "passedLose";
  return pace.direction;
}

function datePaceOf(
  check: TargetDateCheck,
  input: { targetWeightKg: number; today: string; reason: DatePace["reason"] },
): DatePace | null {
  if (!("feasibleDays" in check)) return null;
  if (input.reason === "fast" && check.status !== "fast" && check.status !== "gainFast")
    return null;
  const feasibleDays = Math.min(check.feasibleDays, MAX_TARGET_DAYS);
  const kg = "gainKg" in check ? check.gainKg : check.lossKg;
  return {
    reason: input.reason,
    direction: "gainKg" in check ? "gain" : "lose",
    targetWeightKg: input.targetWeightKg,
    kg: Math.round(kg * 100) / 100,
    feasibleDays,
    reachDate: shiftDate(input.today, feasibleDays),
  };
}
