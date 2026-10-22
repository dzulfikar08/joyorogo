import { shiftDate } from "@joyorogo/api/lib/engine";

/**
 * The ranges the metric screens (Berat, Air, Rekap) share: whole days, counted back from the window's last day. A year is
 * 52 weeks, so its weekly bars divide it exactly.
 */
export const RANGE_DAYS = { w: 7, m: 30, q: 90, y: 364 } as const;
export type RangeKey = keyof typeof RANGE_DAYS;

export type DayWindow = { from: string; to: string };

/**
 * The window of `days` days that ends `offset` windows before today: offset 0 ends today, 1 is the window just before it,
 * and so on. Windows never overlap and always have exactly `days` days.
 */
export function windowAt(days: number, offset: number, today: string): DayWindow {
  const to = shiftDate(today, -offset * days);
  return { from: shiftDate(to, -(days - 1)), to };
}

/** Whether a window earlier than `offset` still reaches data: `earliest` is the first day with any (null: no limit). */
export function canStepBack(
  days: number,
  offset: number,
  today: string,
  earliest: string | null,
): boolean {
  if (earliest === null) return true;
  return windowAt(days, offset + 1, today).to >= earliest;
}

/** Today's window is the newest there is. */
export function canStepForward(offset: number): boolean {
  return offset > 0;
}

/** The window's days, oldest first. */
export function daysOf(window: DayWindow): string[] {
  const out: string[] = [];
  for (let d = window.from; d <= window.to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/** Consecutive groups of `size` items, oldest first; the last group is shorter when the list does not divide. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
