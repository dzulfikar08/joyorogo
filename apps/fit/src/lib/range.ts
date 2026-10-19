import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";

export const RANGES = [7, 30, 90, 365] as const;
export type RangeDays = (typeof RANGES)[number];

export function isRange(value: unknown): value is RangeDays {
  return (RANGES as readonly unknown[]).includes(value);
}

/** The window of `days` days that ends today (WIB), both ends inclusive. */
export function windowOf(days: RangeDays, today = jakartaToday()): { from: string; to: string } {
  return { from: shiftDate(today, -(days - 1)), to: today };
}
