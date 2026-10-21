import { daysBetween, shiftDate } from "./engine";

/** One day of `day.kcalSeries`: kcal is null when nothing was logged. */
export interface KcalDay {
  date: string;
  kcal: number | null;
}

/** One bar on the weight chart: a single day, or a 7-day bucket on long ranges. */
export interface KcalBar {
  /** first and last date the bar covers (equal for a daily bar) */
  from: string;
  to: string;
  /** days in the bar that count (today with nothing logged yet is skipped) */
  days: number;
  trackedDays: number;
  untrackedDays: number;
  /** average kcal over tracked days; null when none was tracked */
  avgKcal: number | null;
}

/** Up to this many days a bar is one day; longer ranges get one bar per week. */
export const DAILY_BAR_MAX_DAYS = 45;

/**
 * Days of the series that belong in [from, to]. `openDay` (default `to`: the chart's today) with nothing logged is
 * left out: the day is not over, so it is neither tracked nor skipped yet. A finished period passes `null`.
 */
function daysInRange(
  series: KcalDay[],
  from: string,
  to: string,
  openDay: string | null = to,
): KcalDay[] {
  return series.filter(
    (d) => d.date >= from && d.date <= to && !(d.date === openDay && d.kcal === null),
  );
}

function summarize(days: KcalDay[]) {
  const tracked = days.filter((d) => d.kcal !== null);
  const sum = tracked.reduce((acc, d) => acc + (d.kcal ?? 0), 0);
  return {
    days: days.length,
    trackedDays: tracked.length,
    untrackedDays: days.length - tracked.length,
    avgKcal: tracked.length > 0 ? Math.round(sum / tracked.length) : null,
  };
}

/** Whole-range numbers for the line under the chart. */
export function kcalSummary(series: KcalDay[], from: string, today: string) {
  const { days, trackedDays, avgKcal } = summarize(daysInRange(series, from, today));
  return { days, trackedDays, avgKcal };
}

/** Bars for [from, today]: daily up to DAILY_BAR_MAX_DAYS, otherwise per 7-day week. */
export function kcalBars(
  series: KcalDay[],
  from: string,
  today: string,
  openDay: string | null = today,
): { weekly: boolean; bars: KcalBar[] } {
  const days = daysInRange(series, from, today, openDay);
  const weekly = daysBetween(from, today) + 1 > DAILY_BAR_MAX_DAYS;
  if (!weekly) {
    return {
      weekly,
      bars: days.map((d) => ({ from: d.date, to: d.date, ...summarize([d]) })),
    };
  }
  const buckets = new Map<number, KcalDay[]>();
  for (const d of days) {
    const idx = Math.floor(daysBetween(from, d.date) / 7);
    buckets.set(idx, [...(buckets.get(idx) ?? []), d]);
  }
  const bars = [...buckets.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([idx, group]) => ({
      from: shiftDate(from, idx * 7),
      to: group.at(-1)!.date,
      ...summarize(group),
    }));
  return { weekly, bars };
}
