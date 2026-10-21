import { getT } from "./core";
import { DEFAULT_LOCALE } from "./locale";
import type { Locale } from "./locale";

// Intl-based formatting. Every helper takes an optional trailing `locale`:
// client code omits it and gets the language the app currently renders in;
// server code (a Worker serves all languages at once) MUST pass it explicitly.

let activeLocale: Locale = DEFAULT_LOCALE;

/** Called by each app whenever the UI language changes. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** BCP-47 tag handed to Intl. Separators and date order follow the region. */
const INTL_TAG: Record<Locale, string> = {
  id: "id-ID",
  en: "en-US",
};

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: Locale, min: number, max: number): Intl.NumberFormat {
  const key = `${locale}:${min}:${max}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    numberFormats.set(key, format);
  }
  return format;
}

/** Number with the language's separators, up to `maxDecimals` (default 0) decimals. */
export function fmtNumber(n: number, maxDecimals = 0, locale: Locale = activeLocale): string {
  return numberFormat(locale, 0, maxDecimals).format(n);
}

/** Number rounded to an integer: "1.234" (id) / "1,234" (en). Kcal and grams values. */
export function fmtInt(n: number, locale: Locale = activeLocale): string {
  return numberFormat(locale, 0, 0).format(Math.round(n));
}

/** Exactly `decimals` decimals: "68,5" (id) / "68.5" (en). */
export function fmtDecimal(n: number, decimals = 1, locale: Locale = activeLocale): string {
  return numberFormat(locale, decimals, decimals).format(n);
}

/** kg with exactly one decimal, rounded half-up first. */
export function fmtKg(n: number, locale: Locale = activeLocale): string {
  return fmtDecimal(Math.round(n * 10) / 10, 1, locale);
}

/** Waist-to-height ratio, up to two decimals: "0,53" / "0.53". */
export function fmtRatio(ratio: number, locale: Locale = activeLocale): string {
  return fmtNumber(ratio, 2, locale);
}

/** Percent from a 0-100 value, no decimals: "42%". */
export function fmtPercent(n: number, locale: Locale = activeLocale): string {
  return `${fmtInt(n, locale)}%`;
}

/** "Rp15.000" (id) / "Rp15,000" (en). Rupiah is the only currency; the symbol is brand-fixed. */
export function fmtIdr(n: number, locale: Locale = activeLocale): string {
  return `Rp${fmtInt(n, locale)}`;
}

/** Energy unit shown to people: "kkal" in Indonesian, "kcal" in English. Parsers still accept both. */
export function kcalUnit(locale: Locale = activeLocale): string {
  return locale === "id" ? "kkal" : "kcal";
}

/** "1.234 kkal" (id) / "1,234 kcal" (en). */
export function fmtKcalLabel(n: number, locale: Locale = activeLocale): string {
  return `${fmtInt(n, locale)} ${kcalUnit(locale)}`;
}

/** "120 g". */
export function fmtGramsLabel(n: number, locale: Locale = activeLocale): string {
  return `${fmtInt(n, locale)} g`;
}

/** "24,3 MB". */
export function fmtMegabytes(bytes: number, locale: Locale = activeLocale): string {
  return `${fmtDecimal(bytes / (1024 * 1024), 1, locale)} MB`;
}

// ── Calendar days ('YYYY-MM-DD', WIB calendar day, no time zone shift) ───

export type DateStyle =
  /** "14 Sep" */
  | "short"
  /** "14 Sep 2026" */
  | "medium"
  /** "Sunday, 14 September 2026" */
  | "long"
  /** "Sunday, 14 Sep" */
  | "weekday"
  /** "September 2026" */
  | "month";

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  weekday: { weekday: "long", day: "numeric", month: "short" },
  month: { month: "long", year: "numeric" },
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Formats a 'YYYY-MM-DD' calendar day. */
export function fmtDate(date: string, style: DateStyle, locale: Locale = activeLocale): string {
  const key = `${locale}:${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAG[locale], { ...DATE_OPTIONS[style], timeZone: "UTC" });
    dateFormats.set(key, format);
  }
  return format.format(new Date(`${date}T00:00:00Z`));
}

export const fmtDateShort = (date: string, locale?: Locale) => fmtDate(date, "short", locale);
export const fmtDateMedium = (date: string, locale?: Locale) => fmtDate(date, "medium", locale);
export const fmtDateLong = (date: string, locale?: Locale) => fmtDate(date, "long", locale);

function shift(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** "Hari ini" / "Kemarin" / "Today" / "Yesterday", otherwise "Sabtu, 10 Okt" / "Saturday, 10 Oct". */
export function relativeDayLabel(
  date: string,
  today: string,
  locale: Locale = activeLocale,
): string {
  if (date === today) return getT(locale)("date.today");
  if (date === shift(today, -1)) return getT(locale)("date.yesterday");
  return fmtDate(date, "weekday", locale);
}

/** "5 minutes ago", "baru saja" — feeds. Older than a week falls back to "14 Sep". */
export function timeAgo(at: Date | string, locale: Locale = activeLocale): string {
  const t = getT(locale);
  const seconds = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("time.daysAgo", { count: days });
  return new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short" }).format(
    new Date(at),
  );
}

const CLOCK_FORMATS: Partial<Record<Locale, Intl.DateTimeFormat>> = {};

/** Wall-clock time in WIB from a Date: "13.05" (id) / "01:05 PM" (en). */
export function fmtClock(at: Date, locale: Locale = activeLocale): string {
  let format = CLOCK_FORMATS[locale];
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAG[locale], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    });
    CLOCK_FORMATS[locale] = format;
  }
  return format.format(at);
}
