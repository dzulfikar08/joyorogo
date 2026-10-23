import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { dayZoneOffsetMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import type { Meal } from "./engine";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const EATEN_AT_MAX_AGE_DAYS = 45;
/** A meal cannot have been eaten later than this past the server clock (clock skew and minute rounding). */
export const EATEN_AT_MAX_FUTURE_MS = 10 * 60_000;

/** Hour of the local day before which a time still belongs to the previous diary day (late-night eating). */
const LATE_NIGHT_END_HOUR = 4;

const MEAL_HOUR: Record<string, [number, number]> = {
  sarapan: [7, 0],
  makan_siang: [12, 30],
  makan_malam: [19, 0],
  snack: [16, 0],
};

const zoneParts = (ms: number, zone?: DayZone) => {
  const shifted = new Date(ms + dayZoneOffsetMs(zone));
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
};

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Why an eaten-at time is not acceptable for a diary day, or null when it is.
 * Window: at most 10 minutes ahead of `now`, at most 45 days back; its day in the person's zone is the
 * item's `date`, or the day after it only between 00:00 and 03:59 there.
 */
export function eatenAtProblem(eatenAt: number, date: string, now: Date = new Date(), zone?: DayZone): string | null {
  if (!Number.isInteger(eatenAt)) return "not_integer";
  if (eatenAt > now.getTime() + EATEN_AT_MAX_FUTURE_MS) return "too_far_ahead";
  if (eatenAt < now.getTime() - EATEN_AT_MAX_AGE_DAYS * DAY) return "too_old";
  return eatenAtFitsDay(eatenAt, date, zone) ? null : "wrong_day";
}

/** True when a time belongs to the diary day `date` (same calendar day in the zone, or 00:00-03:59 after it). */
export function eatenAtFitsDay(eatenAt: number, date: string, zone?: DayZone): boolean {
  const { day, hour } = zoneParts(eatenAt, zone);
  return day === date || (day === shiftDay(date, 1) && hour < LATE_NIGHT_END_HOUR);
}

/** The diary day (`YYYY-MM-DD`) an eaten-at falls on in the zone's calendar. */
export function eatenAtDay(eatenAt: number, zone?: DayZone): string {
  return zoneParts(eatenAt, zone).day;
}

/** Suggested eaten-at (unix ms) for a diary day: `now` for today, else the usual time of the meal in the zone. */
export function defaultEatenAt(date: string, meal: Meal | string, now: Date = new Date(), zone?: DayZone): number {
  if (zoneParts(now.getTime(), zone).day === date) return now.getTime();
  return slotTime(date, meal, zone);
}

/** The meal's usual local time on `date` (unix ms). */
function slotTime(date: string, meal: Meal | string, zone?: DayZone): number {
  const [hour, minute] = MEAL_HOUR[meal] ?? [12, 0];
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - dayZoneOffsetMs(zone);
}

/** Usual start and end of each meal slot (minutes of the local day; `end` past 1440 wraps), used to notice a slot logged at the wrong time. Snacks fit anywhere. */
const MEAL_FIT: Record<string, [number, number]> = {
  sarapan: [4 * 60, 11 * 60],
  makan_siang: [10 * 60, 16 * 60 + 30],
  makan_malam: [16 * 60, 28 * 60],
};

/** Does a local minute-of-day suit the meal slot? Unknown slots and snacks always do. */
export function mealFitsClock(meal: Meal | string, minuteOfDay: number): boolean {
  const range = MEAL_FIT[meal];
  if (!range) return true;
  return (minuteOfDay >= range[0] && minuteOfDay < range[1]) || minuteOfDay + 1440 < range[1];
}

/** The slot's usual local time on `date` (unix ms); null for slots without one (snack) or when it is still ahead of `now`. */
export function usualEatenAt(date: string, meal: Meal | string, now: Date = new Date(), zone?: DayZone): number | null {
  if (!MEAL_FIT[meal]) return null;
  const ms = slotTime(date, meal, zone);
  return ms <= now.getTime() ? ms : null;
}

/**
 * The "Jam makan sebenarnya?" nudge: logging for today with a slot that does not suit the clock right now
 * (Sarapan at 21:00) and that slot's usual time already behind us. Returns that usual time, else null.
 */
export function eatenAtNudge(date: string, meal: Meal | string, now: Date = new Date(), zone?: DayZone): number | null {
  if (zoneParts(now.getTime(), zone).day !== date) return null;
  const shifted = new Date(now.getTime() + dayZoneOffsetMs(zone));
  const minute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (mealFitsClock(meal, minute)) return null;
  return usualEatenAt(date, meal, now, zone);
}

export type EatenAtPreset = "pagi" | "siang" | "malam";

const PRESET_MEAL: Record<EatenAtPreset, string> = { pagi: "sarapan", siang: "makan_siang", malam: "makan_malam" };

/** "Tadi pagi / siang / malam": the usual time of that part of `date`, only those already behind `now`, earliest first. */
export function eatenAtPresets(date: string, now: Date = new Date(), zone?: DayZone): Array<{ key: EatenAtPreset; eatenAt: number }> {
  const out: Array<{ key: EatenAtPreset; eatenAt: number }> = [];
  for (const key of ["pagi", "siang", "malam"] as const) {
    const eatenAt = usualEatenAt(date, PRESET_MEAL[key], now, zone);
    if (eatenAt !== null && eatenAtProblem(eatenAt, date, now, zone) === null) out.push({ key, eatenAt });
  }
  return out;
}

/** Optional "jam makan" (unix ms); its fit with the diary day is checked by assertEatenAt. */
export const eatenAtSchema = z.number().int().min(0);

/** Rejects an eaten-at that does not fit the diary day. Absent = nothing to check. */
export function assertEatenAt(eatenAt: number | undefined, date: string, zone?: DayZone): void {
  if (eatenAt === undefined) return;
  const problem = eatenAtProblem(eatenAt, date, new Date(), zone);
  if (problem) throw new ORPCError("BAD_REQUEST", { message: `invalid_eaten_at:${problem}` });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'HH:MM' of an eaten-at on the zone's clock. */
export function eatenAtClock(eatenAt: number, zone?: DayZone): string {
  const shifted = new Date(eatenAt + dayZoneOffsetMs(zone));
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Eaten-at (unix ms) of a local 'HH:MM' on the diary day `date`; null when the clock text is malformed. */
export function eatenAtFromClock(date: string, clock: string, zone?: DayZone): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - dayZoneOffsetMs(zone);
}
