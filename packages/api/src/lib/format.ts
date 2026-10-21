import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { shiftDate } from "./engine";

/**
 * Day keys and rupiah text, parsed and formatted by hand. Shared by the
 * web (Intl everywhere) and native (Hermes): `new Date("2026-10-14")` and
 * `toLocaleDateString("id-ID", …)` are unreliable on Android — dates come back
 * as "Invalid Date" or in the wrong locale, so day keys never touch the
 * string date constructor or Intl here.
 */

// --- Day keys ('YYYY-MM-DD') -------------------------------------------

export type DateKeyParts = { year: number; month: number; day: number };

/** Strict manual parse of a day key; null for anything else. */
export function parseDateKey(key: string): DateKeyParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** UTC-midnight Date for a day key, or null when the key is malformed. */
export function dateKeyToUtcDate(key: string): Date | null {
  const parts = parseDateKey(key);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null;
}

/** Monday-first weekday index of a day key: 0 = Senin … 6 = Minggu. */
export function weekdayIndex(key: string): number {
  const date = dateKeyToUtcDate(key);
  return date ? (date.getUTCDay() + 6) % 7 : 0;
}

/** Days in a month (month 1-12), leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Short month and weekday names per language; hand-rolled so Hermes never needs Intl for them. */
const SHORT_NAMES: Record<
  Locale,
  {
    months: readonly string[];
    weekdays: readonly string[];
    format: (p: ShortDay) => string;
    range: (a: DayMonth, b: DayMonth, sameMonth: boolean) => string;
  }
> = {
  id: {
    months: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
    // Indexed by Date#getUTCDay (0 = Minggu).
    weekdays: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
    format: ({ weekday, day, month }) => `${weekday}, ${day} ${month}`,
    range: (a, b, sameMonth) =>
      sameMonth ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month}–${b.day} ${b.month}`,
  },
  en: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    format: ({ weekday, day, month }) => `${weekday}, ${month} ${day}`,
    range: (a, b, sameMonth) =>
      sameMonth ? `${a.month} ${a.day}–${b.day}` : `${a.month} ${a.day}–${b.month} ${b.day}`,
  },
  ms: {
    months: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
    weekdays: ["Aha", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"],
    format: ({ weekday, day, month }) => `${weekday}, ${day} ${month}`,
    range: (a, b, sameMonth) =>
      sameMonth ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month}–${b.day} ${b.month}`,
  },
};

type ShortDay = { weekday: string; day: number; month: string };
type DayMonth = { day: number; month: string };

/** 'Sen, 6 Okt' / 'Mon, Oct 6' — compact label of a day key, no Intl. */
export function shortDayLabel(key: string, locale: Locale = getActiveLocale()): string {
  const parts = parseDateKey(key);
  if (!parts) return key;
  const names = SHORT_NAMES[locale];
  const date = dateKeyToUtcDate(key)!;
  return names.format({
    weekday: names.weekdays[date.getUTCDay()]!,
    day: parts.day,
    month: names.months[parts.month - 1]!,
  });
}

/** '12–18 Okt' / 'Oct 12–18'; the month is repeated only when the range crosses one. */
export function shortDateRange(
  startKey: string,
  endKey: string,
  locale: Locale = getActiveLocale(),
): string {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return `${startKey}–${endKey}`;
  const names = SHORT_NAMES[locale];
  const startMonth = names.months[start.month - 1]!;
  const endMonth = names.months[end.month - 1]!;
  return names.range(
    { day: start.day, month: startMonth },
    { day: end.day, month: endMonth },
    start.month === end.month,
  );
}

/** 'Hari ini', 'Kemarin', otherwise 'Sen, 6 Okt' — for date-pick buttons. */
export function recentDayLabel(date: string, today: string, locale: Locale = getActiveLocale()): string {
  if (date === today) return getT(locale)("date.today");
  if (date === shiftDate(today, -1)) return getT(locale)("date.yesterday");
  return shortDayLabel(date, locale);
}

/** 'Okt 2026' / 'Oct 2026' — month caption for a 'YYYY-MM' key. */
export function monthLabel(monthKey: string, locale: Locale = getActiveLocale()): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isInteger(year) || month < 1 || month > 12) return monthKey;
  return `${SHORT_NAMES[locale].months[month - 1]} ${year}`;
}

// --- Rupiah input -----------------------------------------------------------

const IDR_MAX_DIGITS = 9;

const onlyDigits = (text: string): string => text.replace(/\D/g, "");

/** '15000' -> 'Rp15.000' (id-ID dot grouping), '' stays ''. */
export function formatIdrInput(digits: string): string {
  const clean = onlyDigits(digits).slice(0, IDR_MAX_DIGITS);
  if (clean === "") return "";
  let out = "Rp";
  for (let i = 0; i < clean.length; i++) {
    out += clean[i];
    const remaining = clean.length - 1 - i;
    if (remaining > 0 && remaining % 3 === 0) out += ".";
  }
  return out;
}

/** 'Rp15.000' -> 15000; empty or non-numeric -> null. */
export function parseIdrInput(text: string): number | null {
  const clean = onlyDigits(text);
  if (clean === "") return null;
  const n = Number(clean);
  return Number.isInteger(n) ? n : null;
}

/**
 * Next digits after one IDR keystroke. `next`/`caret` describe the input after
 * the raw edit, `prev` the formatted text before it. Non-digits are stripped;
 * when a deletion only removed a separator, the digit before the caret goes
 * too — otherwise the separator would immediately reappear.
 */
export function idrKeystroke(next: string, prev: string, caret: number): string {
  const nextDigits = onlyDigits(next).slice(0, IDR_MAX_DIGITS);
  const removedSeparator =
    next.length < prev.length && nextDigits.length === onlyDigits(prev).length;
  if (!removedSeparator || nextDigits === "") return nextDigits;
  const digitsBeforeCaret = onlyDigits(next.slice(0, Math.max(0, caret))).length;
  if (digitsBeforeCaret === 0) return nextDigits;
  return nextDigits.slice(0, digitsBeforeCaret - 1) + nextDigits.slice(digitsBeforeCaret);
}

/** Index in `formatted` just after the digit that sat at raw caret `caret`. */
export function idrCaret(formatted: string, raw: string, caret: number): number {
  const digitsBefore = onlyDigits(raw.slice(0, Math.max(0, caret))).length;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (!/\d/.test(formatted[i]!)) continue;
    if (seen === digitsBefore) return i;
    seen += 1;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}
