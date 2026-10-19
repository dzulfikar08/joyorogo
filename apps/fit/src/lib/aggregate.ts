// Pure aggregation behind the dashboards: windows of days and workouts in, numbers and chart rows out. No React, no I/O.

import { daysBetween, shiftDate } from "@joyorogo/api/lib/engine";
import type { RecoveryDayView } from "@joyorogo/api/lib/fit-data";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

export const SPORT_KINDS = ["run", "walk", "ride", "swim", "other"] as const;
export type SportKind = (typeof SPORT_KINDS)[number];

export function sportKindOf(kind: string): SportKind {
  return (SPORT_KINDS as readonly string[]).includes(kind) ? (kind as SportKind) : "other";
}

export type Metric =
  | "sleepHours"
  | "sleepPct"
  | "recoveryPct"
  | "strain"
  | "hrvMs"
  | "restingHrBpm"
  | "vo2maxMlKgMin"
  | "loadRatio";

export interface DayPoint extends Record<Metric, number | null> {
  date: string;
}

/** One row per calendar day of the window, with nulls where the day has no data, so two windows line up index by index. */
export function dayPoints(from: string, to: string, days: readonly RecoveryDayView[]): DayPoint[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const count = daysBetween(from, to) + 1;
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDate(from, i);
    const day = byDate.get(date);
    return {
      date,
      sleepHours: day?.sleepHours ?? null,
      sleepPct: day?.sleepPct ?? null,
      recoveryPct: day?.recoveryPct ?? null,
      strain: day?.strain ?? null,
      hrvMs: day?.hrvMs ?? null,
      restingHrBpm: day?.restingHrBpm ?? null,
      vo2maxMlKgMin: day?.vo2maxMlKgMin ?? null,
      loadRatio: day?.loadRatio ?? null,
    };
  });
}

const present = (values: readonly (number | null | undefined)[]): number[] =>
  values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function mean(values: readonly (number | null | undefined)[]): number | null {
  const xs = present(values);
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The newest value that exists (the series is oldest first). */
export function latest(values: readonly (number | null | undefined)[]): number | null {
  return present(values).at(-1) ?? null;
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const xs = present(values).toSorted((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? (xs[mid] as number) : ((xs[mid - 1] as number) + (xs[mid] as number)) / 2;
}

export function stdDev(values: readonly (number | null | undefined)[]): number | null {
  const xs = present(values);
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length);
}

export interface WorkoutTotals {
  count: number;
  movingSec: number;
  elapsedSec: number;
  distanceM: number;
  elevGainM: number;
  calories: number;
}

export function totals(items: readonly FitWebWorkout[]): WorkoutTotals {
  const sum = {
    count: items.length,
    movingSec: 0,
    elapsedSec: 0,
    distanceM: 0,
    elevGainM: 0,
    calories: 0,
  };
  for (const item of items) {
    sum.movingSec += item.movingSec;
    sum.elapsedSec += item.elapsedSec;
    sum.distanceM += item.distanceM ?? 0;
    sum.elevGainM += item.elevGainM ?? 0;
    sum.calories += item.calories;
  }
  return sum;
}

/** Change from `previous` to `current`: absolute and, when `previous` is not zero, relative. Null when either is missing. */
export function change(
  current: number | null,
  previous: number | null,
): { abs: number; pct: number | null } | null {
  if (current === null || previous === null) return null;
  return {
    abs: current - previous,
    pct: previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100,
  };
}

/** The window of the same length that ends the day before `from`. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  return { from: shiftDate(from, -length), to: shiftDate(from, -1) };
}

/** Monday of the week a 'YYYY-MM-DD' day belongs to (weeks run Monday to Sunday, as in Indonesia). */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

export type VolumeMetric = "time" | "distance";
export type VolumeRow = { weekStart: string } & Record<SportKind, number>;

/** Hours or kilometres per sport kind for every week touched by the window (empty weeks included, so the axis is continuous). */
export function weeklyVolume(
  items: readonly FitWebWorkout[],
  from: string,
  to: string,
  metric: VolumeMetric,
): VolumeRow[] {
  const rows = new Map<string, VolumeRow>();
  for (let week = weekStart(from); week <= to; week = shiftDate(week, 7)) {
    rows.set(week, { weekStart: week, run: 0, walk: 0, ride: 0, swim: 0, other: 0 });
  }
  for (const item of items) {
    const row = rows.get(weekStart(item.date));
    if (!row) continue;
    row[sportKindOf(item.sportKind)] +=
      metric === "time" ? item.movingSec / 3600 : (item.distanceM ?? 0) / 1000;
  }
  return [...rows.values()];
}

export interface SleepStats {
  nights: number;
  avgHours: number | null;
  bestHours: number | null;
  worstHours: number | null;
  /** Spread of the nights' length, minutes. Smaller is steadier. */
  spreadMin: number | null;
  /** The sleep JoyoFit estimates this person needs, hours (the median of hours / share of need over the nights). */
  needHours: number | null;
  /** Hours short of the need, summed over the nights below it. */
  debtHours: number | null;
  nightsMet: number | null;
}

export function sleepStats(
  days: readonly Pick<RecoveryDayView, "sleepHours" | "sleepPct">[],
): SleepStats {
  const hours = present(days.map((d) => d.sleepHours));
  const need = median(
    days.map((d) =>
      d.sleepHours && d.sleepPct && d.sleepPct > 0 ? d.sleepHours / (d.sleepPct / 100) : null,
    ),
  );
  const spread = stdDev(hours);
  return {
    nights: hours.length,
    avgHours: mean(hours),
    bestHours: hours.length ? Math.max(...hours) : null,
    worstHours: hours.length ? Math.min(...hours) : null,
    spreadMin: spread === null ? null : spread * 60,
    needHours: need,
    debtHours: need === null ? null : hours.reduce((sum, h) => sum + Math.max(0, need - h), 0),
    nightsMet: need === null ? null : hours.filter((h) => h >= need - 0.05).length,
  };
}

export type Consistency = "steady" | "ok" | "irregular";

/** Bands on the spread of nightly sleep length: up to 30 min steady, up to 60 min fine, more is irregular. */
export function consistencyOf(spreadMin: number): Consistency {
  if (spreadMin <= 30) return "steady";
  if (spreadMin <= 60) return "ok";
  return "irregular";
}

/** Average hours of sleep by weekday of the morning the night ended on, Monday first; null for a weekday with no night. */
export function weekdayAverages(
  days: readonly Pick<RecoveryDayView, "date" | "sleepHours">[],
): (number | null)[] {
  const buckets: number[][] = Array.from({ length: 7 }, () => []);
  for (const day of days) {
    if (day.sleepHours === null) continue;
    const weekday = (new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    buckets[weekday]?.push(day.sleepHours);
  }
  return buckets.map((hours) => mean(hours));
}
