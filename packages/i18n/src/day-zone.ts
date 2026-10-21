// Calendar days. A day is 'YYYY-MM-DD' in the user's zone, and every stored date in the database was
// cut with Asia/Jakarta (WIB, UTC+7). Malaysia and Singapore are UTC+8, so a Malaysian midnight is 23:00 WIB: until the
// whole stack (server routes, cron, clients) takes the zone from one place, the product keeps WIB for
// everyone. These helpers are that one place; `jakartaToday` and friends in @joyorogo/api/lib/engine call
// them. Neither zone observes daylight saving, so a fixed offset is exact.

export const DAY_ZONES = ["Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Singapore"] as const;
export type DayZone = (typeof DAY_ZONES)[number];

export const DEFAULT_DAY_ZONE: DayZone = "Asia/Jakarta";

const OFFSET_HOURS: Record<DayZone, number> = {
  "Asia/Jakarta": 7,
  "Asia/Kuala_Lumpur": 8,
  "Asia/Singapore": 8,
};

export function isDayZone(value: unknown): value is DayZone {
  return typeof value === "string" && (DAY_ZONES as readonly string[]).includes(value);
}

/**
 * IANA zone of a device (`Intl.DateTimeFormat().resolvedOptions().timeZone`) to a zone the product
 * supports, or null (the caller keeps its default). Sarawak and Sabah (`Asia/Kuching`) are UTC+8 like
 * the peninsula, so they are the same calendar as Kuala Lumpur.
 */
export function matchDayZone(zone: string | null | undefined): DayZone | null {
  if (isDayZone(zone)) return zone;
  if (zone === "Asia/Kuching") return "Asia/Kuala_Lumpur";
  return null;
}

export function dayZoneOffsetMs(zone: DayZone = DEFAULT_DAY_ZONE): number {
  return OFFSET_HOURS[zone] * 3_600_000;
}

/** The calendar day 'YYYY-MM-DD' it is in `zone` at `now`. 16:30 UTC is already tomorrow in Kuala Lumpur, still today in Jakarta. */
export function dayIn(zone: DayZone = DEFAULT_DAY_ZONE, now: Date = new Date()): string {
  return new Date(now.getTime() + dayZoneOffsetMs(zone)).toISOString().slice(0, 10);
}

/** The calendar day before today in `zone`. */
export function yesterdayIn(zone: DayZone = DEFAULT_DAY_ZONE, now: Date = new Date()): string {
  const d = new Date(now.getTime() + dayZoneOffsetMs(zone));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Wall-clock hour in `zone` as a decimal (13.5 = 13:30). */
export function clockHourIn(zone: DayZone = DEFAULT_DAY_ZONE, now: Date = new Date()): number {
  const d = new Date(now.getTime() + dayZoneOffsetMs(zone));
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
