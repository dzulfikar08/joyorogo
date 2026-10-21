// "Progres" over a chosen period (Berat range tabs, the share card): weight trend start -> end, days logged, the
// estimated energy deficit and the two series the card draws. Pure: the server (period-store.ts) and the Berat screens
// feed it rows, nothing here reads a clock or a database. Every day is a WIB calendar day ('YYYY-MM-DD').
//
// Honesty rules, in one place:
//  - The weight change is the smoothed trend (emaTrendPoints), never one scale reading against another.
//  - The deficit counts only days that were logged, finished and complete enough; the rest are counted and said, not
//    guessed. Burn is the plan's TDEE plus the day's counted activity (the same number Beranda's Sisa is built on), so
//    it is an estimate of energy balance, not a measurement.
//  - The kg of fat the deficit "implies" (7.700 kcal per kg) is offered only when it does not contradict the trend.

import { KCAL_PER_KG_FAT, daysBetween, emaTrendPoints, rangeStats, shiftDate } from "./engine";
import type { TrendPoint, WeighIn } from "./engine";
import { kcalBars } from "./kcal-bars";
import type { KcalBar } from "./kcal-bars";
import { MIN_COMPLETE_DAY } from "./recap";

/** A weigh-in this close before the period starts may anchor its trend start (otherwise the trend would be stale). */
export const START_ANCHOR_MAX_DAYS = 14;
/** Fewer days than this between two trend points is water noise, not a weekly pace. */
export const RATE_MIN_SPAN_DAYS = 7;
/** A projection needs this many days and weigh-ins inside the period. */
export const PROJECTION_MIN_SPAN_DAYS = 14;
export const PROJECTION_MIN_WEIGH_INS = 3;
/** A trend move smaller than this is "steady". */
const STEADY_KG = 0.1;
/** How far above the trend loss the implied fat loss may sit before it is dropped as contradicting. */
export const IMPLIED_FAT_TOLERANCE_KG = 0.5;
/** Points kept on the trend line a card draws. */
export const TREND_SERIES_MAX_POINTS = 60;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type WeightDirection = "down" | "up" | "steady";

export interface PeriodWeight {
  /** where the trend starts: the last weigh-in just before the period, else the first one inside it */
  startDate: string;
  startKg: number;
  endDate: string;
  endKg: number;
  /** trend change, 1 decimal (negative = lower) */
  changeKg: number;
  /** trend change as a share of the start, 1 decimal */
  changePct: number;
  direction: WeightDirection;
  /** kg per week across the period; null under RATE_MIN_SPAN_DAYS */
  weeklyRateKg: number | null;
  /** weigh-ins dated inside the period */
  weighIns: number;
  /** days between the period's `from` and the first data point, when weight data starts late (0 otherwise) */
  startsLateDays: number;
  /** the latest scale reading in the period, to show next to the trend */
  scaleKg: number;
  scaleDate: string;
  /** distance from the end trend to the goal; null without a goal */
  toGoalKg: number | null;
  goalReached: boolean;
  /** day the goal is reached at this pace; null unless there is enough data and the pace points at the goal */
  projectedDate: string | null;
  /** trend line over the period, oldest first, at most TREND_SERIES_MAX_POINTS */
  series: Array<{ date: string; kg: number }>;
}

export interface PeriodEnergy {
  /** finished, logged days with a burn estimate and a complete-looking log: the days the sums cover */
  countedDays: number;
  /** logged days left out because the log looks partial (well under the day's target) */
  partialDays: number;
  /** logged days left out because there is no burn estimate for them */
  unestimatedDays: number;
  /** today, when it has food but is not over yet */
  openDayLogged: boolean;
  eatenKcal: number;
  burnKcal: number;
  /** burn minus eaten over the counted days; positive = deficit */
  balanceKcal: number;
  avgBalanceKcal: number;
  /** balance / 7.700, shown only when it agrees with the trend (see `impliedFatKg` rules) */
  impliedFatKg: number | null;
}

export interface PeriodIntake {
  bars: KcalBar[];
  weekly: boolean;
  avgKcal: number | null;
  /** the base eat target, drawn as the line the bars are read against */
  targetKcal: number | null;
}

export interface PeriodProgress {
  from: string;
  to: string;
  /** calendar days from `from` to `to` */
  calendarDays: number;
  /** days that are over (today only once it has food): the "of Y" of days logged */
  judgedDays: number;
  loggedDays: number;
  streakDays: number;
  /** Naikin BB: balance reads as a surplus, and no fat is implied */
  gain: boolean;
  weight: PeriodWeight | null;
  energy: PeriodEnergy | null;
  intake: PeriodIntake;
}

export interface PeriodInput {
  from: string;
  to: string;
  today: string;
  /** weigh-ins sorted ascending, any that exist up to `to` (the trend needs the history before `from`) */
  weighIns: WeighIn[];
  /** one row per day that has food; kcal is the day's total */
  food: Array<{ date: string; kcal: number }>;
  /** estimated burn (TDEE + counted activity) per day; a missing day has no estimate */
  burn: Record<string, number | undefined>;
  /** the base eat target; null when the plan has none */
  targetKcal: number | null;
  goalKg: number | null;
  streakDays: number;
  gain: boolean;
}

/** Keeps the first and last point and spreads the rest evenly. */
function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!);
  return out;
}

/** Weigh-ins sorted by date, one per day (a later duplicate wins), nothing after `to`. */
function cleanWeighIns(weighIns: readonly WeighIn[], to: string): WeighIn[] {
  const byDate = new Map<string, WeighIn>();
  for (const w of weighIns) if (w.date <= to && Number.isFinite(w.weightKg)) byDate.set(w.date, w);
  return [...byDate.values()].toSorted((a, b) => a.date.localeCompare(b.date));
}

/**
 * Trend start -> end across [from, to]. Null when there is no way to state a change: no weigh-in inside the period, or
 * only one point to compare. The start is the trend on the last weigh-in up to START_ANCHOR_MAX_DAYS before `from`
 * (so a 30-day card starts where the 30 days started), else the first weigh-in inside the period.
 */
export function periodWeight(
  weighIns: readonly WeighIn[],
  from: string,
  to: string,
  goalKg: number | null,
): PeriodWeight | null {
  const clean = cleanWeighIns(weighIns, to);
  const trend = emaTrendPoints(clean);
  const inside = trend.filter((p) => p.date >= from);
  const end = inside.at(-1);
  if (!end) return null;
  const anchorFloor = shiftDate(from, -START_ANCHOR_MAX_DAYS);
  const before = trend.filter((p) => p.date < from && p.date >= anchorFloor).at(-1);
  const start: TrendPoint = before ?? inside[0]!;
  if (start.date === end.date) return null;

  const points = before ? [before, ...inside] : inside;
  const changeKg = round1(end.trendKg - start.trendKg);
  const spanDays = daysBetween(start.date, end.date);
  const weeklyRateKg = spanDays >= RATE_MIN_SPAN_DAYS ? round2(((end.trendKg - start.trendKg) / spanDays) * 7) : null;
  const direction: WeightDirection = Math.abs(changeKg) < STEADY_KG ? "steady" : changeKg < 0 ? "down" : "up";
  const goalReached =
    goalKg !== null && (start.trendKg >= goalKg ? end.trendKg <= goalKg : end.trendKg >= goalKg);
  const enough = spanDays >= PROJECTION_MIN_SPAN_DAYS && inside.length >= PROJECTION_MIN_WEIGH_INS;
  const projectedDate =
    enough && goalKg !== null && !goalReached ? rangeStats([start, end], goalKg).projectedDate : null;
  const scale = clean.filter((w) => w.date >= from).at(-1)!;

  return {
    startDate: start.date,
    startKg: round1(start.trendKg),
    endDate: end.date,
    endKg: round1(end.trendKg),
    changeKg,
    changePct: round1(((end.trendKg - start.trendKg) / start.trendKg) * 100),
    direction,
    weeklyRateKg,
    weighIns: inside.length,
    startsLateDays: Math.max(0, daysBetween(from, start.date)),
    scaleKg: scale.weightKg,
    scaleDate: scale.date,
    toGoalKg: goalKg === null ? null : round1(Math.abs(end.trendKg - goalKg)),
    goalReached,
    projectedDate,
    series: downsample(
      points.map((p) => ({ date: p.date, kg: round2(p.trendKg) })),
      TREND_SERIES_MAX_POINTS,
    ),
  };
}

/** Every date in [from, to], inclusive. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/**
 * Whether the implied fat loss may be shown next to the trend: never when the trend went up, and never when it is more
 * than IMPLIED_FAT_TOLERANCE_KG above the trend's own loss (unlogged days and a rough burn estimate make deficits
 * overshoot; the scale is the authority).
 */
function agreesWithTrend(impliedKg: number, weight: PeriodWeight | null): boolean {
  if (weight === null) return true;
  if (weight.direction === "up") return false;
  const lostKg = Math.max(0, -weight.changeKg);
  return impliedKg <= lostKg + IMPLIED_FAT_TOLERANCE_KG;
}

export function buildPeriodProgress(input: PeriodInput): PeriodProgress {
  const { from, to, today } = input;
  const foodByDate = new Map(input.food.map((row) => [row.date, row.kcal]));
  const weight = periodWeight(input.weighIns, from, to, input.goalKg);

  let judgedDays = 0;
  let loggedDays = 0;
  let countedDays = 0;
  let partialDays = 0;
  let unestimatedDays = 0;
  let eatenKcal = 0;
  let burnKcal = 0;
  let openDayLogged = false;
  for (const date of datesBetween(from, to)) {
    if (date > today) break;
    const kcal = foodByDate.get(date);
    const logged = kcal !== undefined;
    if (date === today) {
      // Today is not over: it counts as a logged day once it has food, never as a missed one, and never in the sums.
      if (logged) {
        judgedDays += 1;
        loggedDays += 1;
        openDayLogged = true;
      }
      continue;
    }
    judgedDays += 1;
    if (!logged) continue;
    loggedDays += 1;
    const burn = input.burn[date];
    if (burn === undefined || !Number.isFinite(burn) || burn <= 0) {
      unestimatedDays += 1;
      continue;
    }
    if (kcal < (input.targetKcal ?? burn) * MIN_COMPLETE_DAY) {
      partialDays += 1;
      continue;
    }
    countedDays += 1;
    eatenKcal += kcal;
    burnKcal += burn;
  }

  const balanceKcal = Math.round(burnKcal - eatenKcal);
  const impliedKg = balanceKcal > 0 ? round1(balanceKcal / KCAL_PER_KG_FAT) : 0;
  const energy: PeriodEnergy | null =
    countedDays === 0
      ? null
      : {
          countedDays,
          partialDays,
          unestimatedDays,
          openDayLogged,
          eatenKcal: Math.round(eatenKcal),
          burnKcal: Math.round(burnKcal),
          balanceKcal,
          avgBalanceKcal: Math.round(balanceKcal / countedDays),
          impliedFatKg:
            !input.gain && impliedKg >= 0.1 && agreesWithTrend(impliedKg, weight) ? impliedKg : null,
        };

  // Bars share the Berat chart's bucketing (daily up to 45 days, weekly beyond); a finished period keeps its last day.
  const series = datesBetween(from, to).map((date) => ({ date, kcal: foodByDate.get(date) ?? null }));
  const { bars, weekly } = kcalBars(series, from, to > today ? today : to, to >= today ? today : null);
  const tracked = bars.filter((b) => b.avgKcal !== null);
  const trackedDays = tracked.reduce((n, b) => n + b.trackedDays, 0);
  const avgKcal =
    trackedDays === 0
      ? null
      : Math.round(tracked.reduce((n, b) => n + (b.avgKcal ?? 0) * b.trackedDays, 0) / trackedDays);

  return {
    from,
    to,
    calendarDays: daysBetween(from, to) + 1,
    judgedDays,
    loggedDays,
    streakDays: input.streakDays,
    gain: input.gain,
    weight,
    energy,
    intake: { bars, weekly, avgKcal, targetKcal: input.targetKcal },
  };
}
