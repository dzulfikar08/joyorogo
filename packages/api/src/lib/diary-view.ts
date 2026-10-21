import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { shiftDate } from "./engine";
import { daysInMonth, parseDateKey, weekdayIndex } from "./format";
import { gainDayHit } from "./gain";

/**
 * Makan view switcher shared by web and native: the view keys, their labels,
 * and the day-key math the calendar and sticker views run on. Pure string
 * math (no Date parsing, no Intl) so Hermes behaves like the browser.
 */

const MAKAN_VIEW_VALUES = ["daftar", "kalender", "stiker", "tempat"] as const;

export type MakanView = (typeof MAKAN_VIEW_VALUES)[number];

/** The views in switcher order; each `label` reads the active language when accessed. */
export const MAKAN_VIEWS: ReadonlyArray<{ value: MakanView; readonly label: string }> =
  MAKAN_VIEW_VALUES.map((value) => ({
    value,
    get label() {
      return getT(getActiveLocale(), "makan")(`viewSwitcher.view.${value}`);
    },
  }));

export const DEFAULT_MAKAN_VIEW: MakanView = "daftar";

/** The view for a stored/URL value; undefined when it is not one of ours. */
export function parseMakanView(value: unknown): MakanView | undefined {
  return MAKAN_VIEW_VALUES.find((view) => view === value);
}

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/** 'Oktober 2026' / 'October 2026' for a 'YYYY-MM' key. */
export function monthLongLabel(monthKey: string, locale: Locale = getActiveLocale()): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isInteger(year) || month < 1 || month > 12) return monthKey;
  return `${getT(locale, "makan")(`calendar.monthLong.${MONTH_KEYS[month - 1]!}`)} ${year}`;
}

/** Month key `delta` months away from a 'YYYY-MM' key. */
export function shiftMonth(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** First and last day key of a month, e.g. ['2026-10-01', '2026-10-31']. */
export function monthRange(monthKey: string): [string, string] {
  const parts = parseDateKey(`${monthKey}-01`);
  const last = parts ? daysInMonth(parts.year, parts.month) : 31;
  return [`${monthKey}-01`, `${monthKey}-${String(last).padStart(2, "0")}`];
}

/** Monday-to-Sunday week holding `dateKey`. */
export function weekRange(dateKey: string): [string, string] {
  const monday = shiftDate(dateKey, -weekdayIndex(dateKey));
  return [monday, shiftDate(monday, 6)];
}

/**
 * Ring fill (0-1) for a day's kcal against the budget. Without a budget the
 * ring is just full: there is nothing to measure against.
 */
export function dayKcalFill(kcal: number, targetKcal: number | null): number {
  if (kcal <= 0) return 0;
  if (targetKcal === null || targetKcal <= 0) return 1;
  return Math.min(1, kcal / targetKcal);
}

export type MonthCell = { key: string; day: number } | null;

/**
 * Monday-first weeks of a 'YYYY-MM' month, padded with nulls to full rows of
 * seven. Explicit rows (not percentage widths) keep the 7th column on the
 * same line on Android.
 */
export function monthWeeks(monthKey: string): MonthCell[][] {
  const [first, last] = monthRange(monthKey);
  const total = Number(last.slice(8, 10));
  const cells: MonthCell[] = Array.from({ length: weekdayIndex(first) }, () => null);
  for (let day = 1; day <= total; day++) {
    cells.push({ key: `${monthKey}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** How a person's target reads on a day: a ceiling to stay under, a floor to reach, or nothing to judge against. */
export type DayMode = "lose" | "gain" | "neutral";

/** Where a logged day landed against the kcal target: "within" it, "over" it, or "under" a gain target. */
export type DayStatus = "within" | "over" | "under";

/**
 * Calendar status of a logged day. A losing plan treats the target as a ceiling,
 * a gain plan as a floor (same rule as the gain streak), Hamil/Menyusui and a
 * missing target judge nothing (null).
 */
export function dayTargetStatus(
  kcal: number,
  targetKcal: number | null,
  mode: DayMode,
): DayStatus | null {
  if (mode === "neutral" || targetKcal === null || targetKcal <= 0 || kcal <= 0) return null;
  if (mode === "gain") return gainDayHit(kcal, targetKcal) ? "within" : "under";
  return kcal > targetKcal ? "over" : "within";
}

export type MonthSummary = {
  logged: number;
  within: number;
  over: number;
  under: number;
  /** Mean kcal over the logged days, rounded; null with nothing logged. */
  avgKcal: number | null;
};

/** The month header of the nutrition calendar: days logged, days by status, average intake. */
export function monthSummary(
  days: ReadonlyArray<{ kcal: number }>,
  targetKcal: number | null,
  mode: DayMode,
): MonthSummary {
  const summary: MonthSummary = { logged: 0, within: 0, over: 0, under: 0, avgKcal: null };
  let total = 0;
  for (const day of days) {
    summary.logged += 1;
    total += day.kcal;
    const status = dayTargetStatus(day.kcal, targetKcal, mode);
    if (status !== null) summary[status] += 1;
  }
  if (summary.logged > 0) summary.avgKcal = Math.round(total / summary.logged);
  return summary;
}
