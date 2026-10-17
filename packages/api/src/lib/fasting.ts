// Pure intermittent-fasting (IF) engine — no runtime dependencies, like
// engine.ts. All clock math is WIB (UTC+7, no DST): minutes-of-day means
// minutes since WIB midnight, so the server, web, and native clients agree
// without dragging in a date library. The eating window may cross midnight
// (e.g. 22:00 → 06:00); `endMin` above 1440 encodes that.

import { fmtInt, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { localizedLabels } from "./engine";
import type { Meal } from "./engine";

export type FastingPattern = "16:8" | "18:6" | "20:4" | "omad";

export const FASTING_PATTERNS: readonly FastingPattern[] = ["16:8", "18:6", "20:4", "omad"];

export const FASTING_LABELS: Record<FastingPattern, string> = {
  "16:8": "16:8",
  "18:6": "18:6",
  "20:4": "20:4",
  omad: "OMAD",
};

/** Eating-window length in hours: 16:8 → 8 … OMAD → ~1. */
export function windowHoursFor(pattern: FastingPattern): number {
  switch (pattern) {
    case "16:8":
      return 8;
    case "18:6":
      return 6;
    case "20:4":
      return 4;
    case "omad":
      return 1;
  }
}

export function isFastingPattern(value: string | null | undefined): value is FastingPattern {
  return (FASTING_PATTERNS as readonly string[]).includes(value ?? "");
}

// --- WIB clock helpers -------------------------------------------------------

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;

/** 'HH:MM' → minutes since midnight; null when malformed or out of range. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes-since-midnight → 'HH:MM', wrapping around midnight. */
export function fmtHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since WIB midnight for a timestamp. */
export function wibMinutes(now: Date): number {
  return Math.floor(((now.getTime() + WIB_OFFSET_MS) % 86_400_000) / 60_000);
}

/** WIB calendar day 'YYYY-MM-DD' for a timestamp (matches engine.jakartaToday). */
export function wibDateKey(now: Date): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

// --- Window math ---------------------------------------------------------------

export type WindowTimes = { startMin: number; endMin: number };

/** [open, close); endMin > 1440 when the window crosses midnight. */
export function windowTimes(windowStart: string, hours: number): WindowTimes {
  const startMin = parseHHMM(windowStart) ?? 12 * 60;
  return { startMin, endMin: startMin + Math.round(hours * 60) };
}

export function insideWindow(minOfDay: number, window: WindowTimes): boolean {
  const { startMin, endMin } = window;
  if (endMin <= 1440) return minOfDay >= startMin && minOfDay < endMin;
  return minOfDay >= startMin || minOfDay < endMin - DAY_MINUTES;
}

/** Whole minutes until `targetMin` next occurs, counting around midnight. */
export function minutesUntil(targetMin: number, nowMin: number): number {
  const raw = targetMin - nowMin;
  const mod = ((raw % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  // Exact match means "now"; anything else counts forward, tomorrow included.
  return raw === 0 || mod === 0 ? 0 : mod;
}

/**
 * The shared "not running" shape: IF off (or no profile), or Ramadan owning
 * the day. One constructor keeps router outputs and UI fallbacks consistent.
 */
export function inactiveFastingDay(ramadan = false): FastingDay {
  return { ...EMPTY_DAY, ramadan };
}

/** '1 j 25 m', '45 mnt', '<1 mnt' — casual countdown text. */
export function fmtCountdown(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes));
  if (m < 1) return "<1 mnt";
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} j` : `${h} j ${rest} mnt`;
}

/** Existing meal slot that matches a wall-clock time, so logging keeps working. */
export function slotForTime(minOfDay: number): Meal {
  const h = minOfDay / 60;
  if (h >= 5 && h < 10.5) return "sarapan";
  if (h >= 10.5 && h < 15) return "makan_siang";
  if (h >= 15 && h < 21) return "makan_malam";
  return "snack";
}

/**
 * Fraction (0–1) of the current fast that has elapsed, for progress bars on
 * Beranda. Measures from the last window close to the next open, so the bar
 * tracks the fasting phase exactly like the countdown does. Returns null for
 * malformed times (callers gate on the fasting state before asking).
 */
export function fastingElapsedFraction(
  windowOpen: string,
  windowClose: string,
  minutesToOpen: number,
): number | null {
  const openMin = parseHHMM(windowOpen);
  const closeMin = parseHHMM(windowClose);
  if (openMin === null || closeMin === null) return null;
  const total = minutesUntil(openMin, closeMin);
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, (total - minutesToOpen) / total));
}

// --- Meal schedule -------------------------------------------------------------

export type MealKind = "buka" | "camilan" | "terakhir";

export const MEAL_KIND_LABELS = localizedLabels(
  ["buka", "camilan", "terakhir"] as const satisfies readonly MealKind[],
  (kind, locale) => getT(locale, "push")(`fasting.mealKind.${kind}`),
);

export type PlannedMeal = { kind: MealKind; atMin: number; share: number; meal: Meal };

/**
 * Meal times inside the window. 16:8 from 12:00 → buka 12:00 (~45%), camilan
 * 15:30 (~15%), makan terakhir 19:30 (~40%). Shorter windows carry fewer
 * meals (two at 6 h / 4 h), OMAD exactly one at the open. The camilan slot
 * snaps to a 15-minute grid (0.45 × 8 h = 3 h 36 m → 15:30 from a 12:00 open).
 */
export function buildSchedule(pattern: FastingPattern, windowStart: string): PlannedMeal[] {
  const { startMin, endMin } = windowTimes(windowStart, windowHoursFor(pattern));
  const hours = windowHoursFor(pattern);
  if (hours <= 1.5) {
    return [{ kind: "buka", atMin: startMin, share: 1, meal: slotForTime(startMin) }];
  }
  const camilanMin = startMin + Math.round(hours * 60 * 0.45 * (1 / 15)) * 15;
  const last: PlannedMeal = {
    kind: "terakhir",
    atMin: endMin - 30,
    share: 0.4,
    meal: slotForTime(endMin - 30),
  };
  if (hours < 8) {
    return [{ kind: "buka", atMin: startMin, share: 0.6, meal: slotForTime(startMin) }, last];
  }
  return [
    { kind: "buka", atMin: startMin, share: 0.45, meal: slotForTime(startMin) },
    { kind: "camilan", atMin: camilanMin, share: 0.15, meal: slotForTime(camilanMin) },
    last,
  ];
}

// --- Today's state -------------------------------------------------------------

export type DayLog = { kcal: number; meal: Meal; min: number };

export type ScheduleEntry = {
  meal: Meal;
  kind: MealKind;
  /** 'HH:MM' WIB. */
  time: string;
  atMin: number;
  kcal: number;
  /** Already behind us — shown dimmed / ticked in the UI. */
  past: boolean;
};

export type NextEvent = {
  kind: "open" | "close" | "meal";
  label: string;
  /** 'HH:MM' of the event (wrapped). */
  time: string;
  minutesAway: number;
};

export type OutsideLog = { meal: Meal; kcal: number; time: string };

export type FastingDay = {
  active: boolean;
  /** Ramadan, when in effect, owns the schedule and this feature steps aside. */
  ramadan: boolean;
  pattern: FastingPattern | null;
  windowOpen: string | null;
  windowClose: string | null;
  /** 'puasa' | 'jendela makan' — null when inactive. */
  state: "puasa" | "jendela_makan" | null;
  nextEvent: NextEvent | null;
  schedule: ScheduleEntry[];
  lastMeal: { time: string; meal: Meal; kcal: number } | null;
  /** Day budget still unspent: max(0, eatKcal − eaten). */
  remainingKcal: number;
  outsideWindow: OutsideLog[];
  outsideWindowKcal: number;
};

const EMPTY_DAY: FastingDay = {
  active: false,
  ramadan: false,
  pattern: null,
  windowOpen: null,
  windowClose: null,
  state: null,
  nextEvent: null,
  schedule: [],
  lastMeal: null,
  remainingKcal: 0,
  outsideWindow: [],
  outsideWindowKcal: 0,
};

/**
 * One IF day: schedule rebalanced by what's already eaten, current state,
 * countdown target, out-of-window flags. `logs` must be the WIB day's
 * food_log rows with their WIB minute-of-day (`wibMinutes(createdAt)`).
 */
export function fastingDay(input: {
  pattern: FastingPattern;
  windowStart: string;
  eatKcal: number;
  logs: DayLog[];
  nowMin: number;
  ramadan?: boolean;
}): FastingDay {
  if (input.ramadan) {
    return { ...EMPTY_DAY, ramadan: true };
  }
  const window = windowTimes(input.windowStart, windowHoursFor(input.pattern));
  const plan = buildSchedule(input.pattern, input.windowStart);
  const eaten = input.logs.reduce((sum, log) => sum + log.kcal, 0);
  const remaining = Math.max(0, input.eatKcal - eaten);

  const outsideWindow: OutsideLog[] = [];
  let lastLog: DayLog | null = null;
  for (const log of input.logs) {
    if (!insideWindow(log.min, window)) {
      outsideWindow.push({ meal: log.meal, kcal: log.kcal, time: fmtHHMM(log.min) });
    }
    if (!lastLog || log.min > lastLog.min) lastLog = log;
  }

  // Future meals split whatever is left of the budget by their share; past
  // meals keep their guide amount so the plan stays readable.
  const upcomingShares = plan.reduce(
    (sum, m) => sum + (minutesToEntry(m.atMin, input.nowMin, window) === null ? 0 : m.share),
    0,
  );
  const schedule: ScheduleEntry[] = plan.map((m) => {
    const away = minutesToEntry(m.atMin, input.nowMin, window);
    const kcal =
      away === null
        ? Math.round(m.share * input.eatKcal)
        : Math.round((m.share / (upcomingShares || 1)) * remaining);
    return {
      meal: m.meal,
      kind: m.kind,
      time: fmtHHMM(m.atMin),
      atMin: m.atMin % DAY_MINUTES,
      kcal,
      past: away === null,
    };
  });

  const nextEvent = pickNextEvent(plan, window, input.nowMin);
  const lastMeal =
    lastLog && lastLog.kcal > 0
      ? { time: fmtHHMM(lastLog.min), meal: lastLog.meal, kcal: lastLog.kcal }
      : null;

  return {
    active: true,
    ramadan: false,
    pattern: input.pattern,
    windowOpen: fmtHHMM(window.startMin),
    windowClose: fmtHHMM(window.endMin),
    state: insideWindow(input.nowMin, window) ? "jendela_makan" : "puasa",
    nextEvent,
    schedule,
    lastMeal,
    remainingKcal: Math.round(remaining),
    outsideWindow,
    outsideWindowKcal: Math.round(outsideWindow.reduce((sum, log) => sum + log.kcal, 0)),
  };
}

/**
 * Minutes until a schedule entry's next occurrence, or null when the entry
 * is already behind us today. Circular distance alone can't tell "3 hours
 * ago" from "21 hours ahead", so entries are ordered along the day: evening
 * slots first, then (for windows crossing midnight) the early-morning slots.
 */
function minutesToEntry(atMin: number, nowMin: number, window: WindowTimes): number | null {
  const earlyMorning = window.endMin > DAY_MINUTES && atMin < window.endMin - DAY_MINUTES;
  const past = earlyMorning ? nowMin >= atMin && nowMin < window.startMin : nowMin >= atMin;
  if (past) return null;
  const raw = atMin - nowMin;
  const mod = ((raw % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return mod === 0 && raw === 0 ? 0 : mod;
}

function pickNextEvent(plan: PlannedMeal[], window: WindowTimes, nowMin: number): NextEvent | null {
  const candidates: NextEvent[] = [];
  for (const m of plan) {
    const away = minutesToEntry(m.atMin, nowMin, window);
    if (away !== null) {
      candidates.push({
        kind: "meal",
        label: MEAL_KIND_LABELS[m.kind],
        time: fmtHHMM(m.atMin),
        minutesAway: away,
      });
    }
  }
  const closeAway = minutesUntil(window.endMin, nowMin);
  if (closeAway > 0) {
    candidates.push({
      kind: "close",
      label: "Jendela makan tutup",
      time: fmtHHMM(window.endMin),
      minutesAway: closeAway,
    });
  }
  const openAway = minutesUntil(window.startMin, nowMin);
  if (openAway > 0) {
    candidates.push({
      kind: "open",
      label: "Jendela makan buka",
      time: fmtHHMM(window.startMin),
      minutesAway: openAway,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.minutesAway !== b.minutesAway) return a.minutesAway - b.minutesAway;
    // Ties: the more specific event first.
    const rank = { meal: 0, close: 1, open: 2 } as const;
    return rank[a.kind] - rank[b.kind];
  });
  return candidates[0] ?? null;
}

// --- Weekly adherence ------------------------------------------------------------

export type AdherenceDay = {
  date: string;
  /** null = nothing logged that day */ kept: boolean | null;
};

/**
 * A day "keeps" the schedule when food was logged and none of it fell
 * outside the window. Days without logs are null and don't count either way.
 */
export function adherenceWeek(
  days: Array<{ date: string; logs: DayLog[] }>,
  windowStart: string,
  pattern: FastingPattern,
): AdherenceDay[] {
  const window = windowTimes(windowStart, windowHoursFor(pattern));
  return days.map(({ date, logs }) => ({
    date,
    kept: logs.length === 0 ? null : logs.every((log) => insideWindow(log.min, window)),
  }));
}

export function countKept(days: AdherenceDay[]): number {
  return days.filter((d) => d.kept === true).length;
}

// --- Reminders ---------------------------------------------------------------------

export type ReminderDraft = { key: string; title: string; body: string; atMin: number };

/**
 * Every reminder of one WIB day: window open, each meal after the first
 * (the open reminder already covers it), and the 30-minutes warning before
 * the window closes. When the last meal coincides with the warning (6 h
 * windows), the warning is dropped — one nudge is enough.
 */
export function dayReminders(input: {
  pattern: FastingPattern;
  windowStart: string;
  dateKey: string;
  remainingKcal: number;
  /** Language of the notification copy (the recipient's); default Indonesian. */
  locale?: Locale;
}): ReminderDraft[] {
  const locale = input.locale ?? "id";
  const t = getT(locale, "push");
  const plan = buildSchedule(input.pattern, input.windowStart);
  const window = windowTimes(input.windowStart, windowHoursFor(input.pattern));
  const kcal = fmtInt(input.remainingKcal, locale);
  const drafts: ReminderDraft[] = [
    {
      key: `${input.dateKey}:open`,
      title: t("fasting.open.title"),
      body: t("fasting.open.body", { kcal }),
      atMin: window.startMin,
    },
  ];
  // The last meal sits at close−30 by design — exactly where the "30 menit
  // lagi" warning lands. Merge the two nudges into one notification instead
  // of buzzing twice (OMAD keeps both: its meal is at the open).
  const closingMin = window.endMin - 30;
  plan.slice(1).forEach((m, i) => {
    const isLastMeal = m.atMin === closingMin;
    const meal = t(`fasting.mealKind.${m.kind}`);
    drafts.push({
      key: `${input.dateKey}:m${i + 1}`,
      title: t("fasting.meal.title", { meal: meal.toLowerCase() }),
      body: isLastMeal
        ? t("fasting.lastMeal.body", { kcal })
        : t("fasting.meal.body", { Meal: meal, time: fmtHHMM(m.atMin), kcal }),
      atMin: m.atMin % DAY_MINUTES,
    });
  });
  if (!drafts.some((d) => d.atMin === closingMin % DAY_MINUTES)) {
    drafts.push({
      key: `${input.dateKey}:close30`,
      title: t("fasting.close30.title"),
      body: t("fasting.close30.body", { kcal }),
      atMin: closingMin % DAY_MINUTES,
    });
  }
  drafts[0]!.atMin %= DAY_MINUTES;
  return drafts;
}

/**
 * The subset of `dayReminders` that falls inside the elapsed cron tick
 * `(nowMin − tick, nowMin]`. The server dedupes by `key` via lastSentKey.
 */
export function dueReminders(input: {
  pattern: FastingPattern;
  windowStart: string;
  dateKey: string;
  remainingKcal: number;
  nowMin: number;
  tickMinutes?: number;
  locale?: Locale;
}): ReminderDraft[] {
  const tick = input.tickMinutes ?? 5;
  return dayReminders(input).filter((draft) => {
    const ago = input.nowMin - draft.atMin;
    return ago >= 0 && ago < tick;
  });
}
