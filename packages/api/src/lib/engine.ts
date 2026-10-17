// Pure calorie engine shared by server and clients. The only runtime dependency
// is @joyorogo/i18n (display labels follow the active language); the web app
// imports it into route modules, so keep it tiny (zod schemas for these shapes
// live in ./schemas).

import { getActiveLocale, getT, relativeDayLabel } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

// One definition of "Hari ini / Kemarin / Sabtu, 10 Okt" for every caller.
export { relativeDayLabel };

export const GENDERS = ["male", "female"] as const;
export const ACTIVITY_LEVELS = ["low", "mid", "high"] as const;
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

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  low: 1.25,
  mid: 1.35,
  high: 1.45,
};

/** Eat-ring state: yellow from 90% of the budget, red once over it. */
export type EatTone = "ok" | "near" | "over";
export function eatTone(eatenKcal: number, targetKcal: number): EatTone {
  if (targetKcal <= 0) return "ok";
  if (eatenKcal > targetKcal) return "over";
  return eatenKcal >= targetKcal * 0.9 ? "near" : "ok";
}

export const KCAL_PER_KG_FAT = 7700;
const EAT_FLOOR: Record<Gender, number> = { male: 1500, female: 1200 };
export const SLEEP_NEED_HOURS = 8;
export const BURN_BASE_PER_KG = 3.3;

export type ProfileInput = {
  birthYear: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  /** WIB calendar day, YYYY-MM-DD */
  targetDate: string;
  activityLevel: ActivityLevel;
};

export type TargetNotes = "MAINTENANCE" | "BELOW_HEALTHY_RANGE" | "PLAN_CLAMPED" | "ADAPTIVE";

export type Targets = {
  bmr: number;
  /** TDEE the plan uses: measured (ADAPTIVE) when enough data, else formula */
  tdee: number;
  /** Mifflin-St Jeor x activity multiplier */
  formulaTdee: number;
  eatKcal: number;
  burnKcal: number;
  sleepHours: number;
  /** planned total daily deficit after safety clamps */
  deficitKcal: number;
  /** raw deficit the target date would demand, before clamps */
  rawDeficitKcal: number;
  idealMinKg: number;
  idealMaxKg: number;
  notes: TargetNotes[];
};

export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// All day boundaries are WIB (UTC+7, no DST). 23:30 UTC is already tomorrow here.
export function jakartaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

// The WIB calendar day before today. Sleep belongs to the morning it ended.
export function wibYesterday(now: Date = new Date()): string {
  const d = new Date(now.getTime() + WIB_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

/** Current WIB clock hour as a decimal (e.g. 13.5 = 13:30). */
export function jakartaClockHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).format(now);
  const [h, m] = parts.split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

export function macroTargets(
  eatKcal: number,
  weightKg: number,
): {
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
} {
  const proteinG = Math.round(1.5 * weightKg);
  const fatKcal = 0.25 * eatKcal;
  const fatFromProteinFloor = Math.max(fatKcal, 0.5 * weightKg * 9);
  const fatG = Math.round(fatFromProteinFloor / 9);
  const carbsG = Math.max(0, Math.round((eatKcal - proteinG * 4 - fatFromProteinFloor) / 4));
  const fiberG = Math.max(25, Math.round((14 * eatKcal) / 1000));
  return { proteinG, carbsG, fatG, fiberG };
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
  /** WIB day the trend reaches target at the current rate; null when not heading there */
  projectedDate: string | null;
  points: TrendPoint[];
};

/** Hacker's-Diet smoothing: each day absorbs 10% of the gap to the scale reading. */
const TREND_ALPHA = 0.1;
export const ADAPTIVE_WINDOW_DAYS = 28;
const ADAPTIVE_MIN_LOGGED_DAYS = 14;
const ADAPTIVE_MIN_WEIGH_INS = 6;
const ADAPTIVE_MAX_SHIFT = 0.15;
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
  if (slope !== null && slope < 0 && latest.trendKg > targetKg) {
    const days = Math.ceil((latest.trendKg - targetKg) / -slope);
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
  /** WIB day the target is reached at this pace; null when not projectable */
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
 * Null until there is enough data to beat the formula.
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
export function isRamadanDate(now: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: "Asia/Jakarta",
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
export function effectiveRamadan(pref: RamadanPref | undefined, now: Date = new Date()): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return isRamadanDate(now);
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

/** Meal slot that matches the current WIB time. */
export function suggestMealNow(now: Date = new Date(), ramadan = false): Meal {
  const hour = jakartaClockHour(now);
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
export function suggestMealForDish(now: Date, ramadan: boolean, heavy: boolean): Meal {
  const meal = suggestMealNow(now, ramadan);
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
  /** WIB today, override for tests; defaults to jakartaToday() */
  today?: string;
  /** latest known weight; defaults to profile start weight */
  weightNow?: number;
  /** measured TDEE from adaptiveTdee(); clamped to ±15% of the formula */
  adaptiveTdee?: number;
};

/**
 * The one source of the 3 daily numbers. Exercise is excluded from the TDEE
 * multiplier and counted through the Burn target instead, so logged workouts
 * never double-dip against the eat budget.
 */
export function computeTargets(profile: ProfileInput, options: ComputeOptions = {}): Targets {
  const today = options.today ?? jakartaToday();
  const weightNow = options.weightNow ?? profile.weightKg;
  const age = ageFromBirthYear(profile.birthYear, today);

  const bmr = bmrMifflin(weightNow, profile.heightCm, age, profile.gender);
  const formulaTdee = bmr * ACTIVITY_MULTIPLIER[profile.activityLevel];
  // Measured TDEE may only move the plan within ±15% of the textbook value:
  // under-logged weeks must not crash the budget, nor binge weeks inflate it.
  const tdee =
    options.adaptiveTdee === undefined
      ? formulaTdee
      : Math.min(
          formulaTdee * (1 + ADAPTIVE_MAX_SHIFT),
          Math.max(formulaTdee * (1 - ADAPTIVE_MAX_SHIFT), options.adaptiveTdee),
        );

  const ideal = idealWeightRange(profile.heightCm);
  const notes: TargetNotes[] = [];
  if (profile.targetWeightKg < ideal.minKg) {
    notes.push("BELOW_HEALTHY_RANGE");
  }

  // weightNow <= target: nothing to lose, hold weight instead
  const maintenance = weightNow <= profile.targetWeightKg;
  const rawDeficit = maintenance
    ? 0
    : ((weightNow - profile.targetWeightKg) * KCAL_PER_KG_FAT) /
      Math.max(1, daysBetween(today, profile.targetDate));

  const totalDeficit = maintenance ? 0 : Math.min(1000, Math.max(250, rawDeficit));
  if (!maintenance && rawDeficit > 1000) {
    notes.push("PLAN_CLAMPED");
  }

  const burn = Math.min(400, Math.max(200, round5(BURN_BASE_PER_KG * weightNow)));
  const dietDeficit = Math.max(totalDeficit - burn, 0);
  const floor = EAT_FLOOR[profile.gender];
  const eat = Math.max(round5(tdee - dietDeficit), floor);
  if (eat === floor && round5(tdee - dietDeficit) < floor && !notes.includes("PLAN_CLAMPED")) {
    notes.push("PLAN_CLAMPED");
  }

  if (maintenance) {
    notes.push("MAINTENANCE");
  }
  if (options.adaptiveTdee !== undefined) {
    notes.push("ADAPTIVE");
  }

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    formulaTdee: Math.round(formulaTdee),
    eatKcal: eat,
    burnKcal: burn,
    sleepHours: SLEEP_NEED_HOURS,
    deficitKcal: Math.round(totalDeficit),
    rawDeficitKcal: Math.round(rawDeficit),
    idealMinKg: ideal.minKg,
    idealMaxKg: ideal.maxKg,
    notes,
  };
}

export type ExerciseLogLike = { kcal: number; source?: string | null };

export type BurnResult = {
  /** resting BMR at the current weight */
  bmrKcal: number;
  /** BMR x activity multiplier x elapsed WIB day fraction */
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
  /** WIB day fraction 0..1 override; defaults to the live clock — pass 1 for past days */
  dayFraction?: number;
  /** plan TDEE (Targets.tdee) so an adaptive plan prorates the measured value */
  tdeeKcal?: number;
  /** injectable clock so tests are deterministic */
  now?: Date;
};

/**
 * Burn so far today: prorated TDEE floor (BMR x daily-life multiplier) plus
 * logged exercise. Rest rows (source 'rest') never count — they mark planned
 * days off, not movement.
 */
export function computeBurn(input: BurnInput): BurnResult {
  const today = jakartaToday(input.now);
  const weightNow = input.weightNowKg ?? input.profile.weightKg;
  const age = ageFromBirthYear(input.profile.birthYear, today);
  const bmr = bmrMifflin(weightNow, input.profile.heightCm, age, input.profile.gender);
  const fraction =
    input.dayFraction ?? Math.min(1, Math.max(0, jakartaClockHour(input.now ?? new Date()) / 24));
  const activityKcal =
    (input.tdeeKcal ?? bmr * ACTIVITY_MULTIPLIER[input.profile.activityLevel]) * fraction;
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

export type DeficitResult = BurnResult & {
  eatenKcal: number;
  /** positive = burned more than eaten (deficit); negative = surplus */
  deficitKcal: number;
  /** eat budget minus net intake — how many kcal of room the day has left */
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
