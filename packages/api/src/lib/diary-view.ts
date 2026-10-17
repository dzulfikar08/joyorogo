import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { shiftDate } from "./engine";
import { daysInMonth, parseDateKey, weekdayIndex } from "./format";

/**
 * Makan view switcher shared by web and native: the view keys, their labels,
 * and the WIB day-key math the calendar and sticker views run on. Pure string
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
