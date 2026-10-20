import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Meal } from "./engine";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WIB_OFFSET = 7 * HOUR;

export const EATEN_AT_MAX_AGE_DAYS = 45;
export const EATEN_AT_MAX_FUTURE_MS = DAY;

/** Hour of the WIB day before which a time still belongs to the previous diary day (late-night eating). */
const LATE_NIGHT_END_HOUR = 4;

const MEAL_HOUR_WIB: Record<string, [number, number]> = {
  sarapan: [7, 0],
  makan_siang: [12, 30],
  makan_malam: [19, 0],
  snack: [16, 0],
};

const wibParts = (ms: number) => {
  const shifted = new Date(ms + WIB_OFFSET);
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
};

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Why an eaten-at time is not acceptable for a diary day, or null when it is.
 * Window: at most 1 day ahead of `now`, at most 45 days back; its WIB day is the
 * item's `date`, or the day after it only between 00:00 and 03:59 WIB.
 */
export function eatenAtProblem(eatenAt: number, date: string, now: Date = new Date()): string | null {
  if (!Number.isInteger(eatenAt)) return "not_integer";
  if (eatenAt > now.getTime() + EATEN_AT_MAX_FUTURE_MS) return "too_far_ahead";
  if (eatenAt < now.getTime() - EATEN_AT_MAX_AGE_DAYS * DAY) return "too_old";
  const { day, hour } = wibParts(eatenAt);
  if (day === date) return null;
  if (day === shiftDay(date, 1) && hour < LATE_NIGHT_END_HOUR) return null;
  return "wrong_day";
}

/** Suggested eaten-at (unix ms) for a diary day: `now` for today, else the usual time of the meal in WIB. */
export function defaultEatenAt(date: string, meal: Meal | string, now: Date = new Date()): number {
  if (wibParts(now.getTime()).day === date) return now.getTime();
  const [hour, minute] = MEAL_HOUR_WIB[meal] ?? [12, 0];
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - WIB_OFFSET;
}

/** Optional "jam makan" (unix ms); its fit with the diary day is checked by assertEatenAt. */
export const eatenAtSchema = z.number().int().min(0);

/** Rejects an eaten-at that does not fit the diary day. Absent = nothing to check. */
export function assertEatenAt(eatenAt: number | undefined, date: string): void {
  if (eatenAt === undefined) return;
  const problem = eatenAtProblem(eatenAt, date);
  if (problem) throw new ORPCError("BAD_REQUEST", { message: `invalid_eaten_at:${problem}` });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'HH:MM' of an eaten-at on the WIB clock. */
export function eatenAtClock(eatenAt: number): string {
  const shifted = new Date(eatenAt + WIB_OFFSET);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Eaten-at (unix ms) of a WIB 'HH:MM' on the diary day `date`; null when the clock text is malformed. */
export function eatenAtFromClock(date: string, clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - WIB_OFFSET;
}
