// Calendar days. A day is 'YYYY-MM-DD' in the user's zone (profile.timezone, defaulting from the region at
// onboarding: ID Asia/Jakarta, MY Asia/Kuala_Lumpur, SG Asia/Singapore). Every day stored before the zones existed
// was cut with Asia/Jakarta (WIB, UTC+7), which is also what a profile without a timezone keeps. Malaysia and
// Singapore are UTC+8, so a Malaysian midnight is 23:00 WIB.
//
// Two ways to say which zone:
// - Server (a Worker serves many users at once): always pass the zone explicitly, from `userZone` in
//   @joyorogo/api/lib/user-zone. A call that omits it gets Asia/Jakarta, never another user's zone: the active zone
//   below is set only by the apps.
// - Apps (web, native: one user per process): `setActiveDayZone` once at start-up and after the profile loads;
//   every helper that is not given a zone then uses it, like `setActiveRegion` and the active locale.
// Neither zone observes daylight saving, so a fixed offset is exact.

import type { Region } from "./region";

export const DAY_ZONES = ["Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Singapore"] as const;
export type DayZone = (typeof DAY_ZONES)[number];

export const DEFAULT_DAY_ZONE: DayZone = "Asia/Jakarta";

let activeZone: DayZone = DEFAULT_DAY_ZONE;

/** Apps only (never the server): the zone every zone-less helper below uses. */
export function setActiveDayZone(zone: DayZone): void {
  activeZone = zone;
}

export function getActiveDayZone(): DayZone {
  return activeZone;
}

/** The zone a new profile starts with: where its market lives. */
export function zoneForRegion(region: Region): DayZone {
  return REGION_ZONES[region];
}

const REGION_ZONES: Record<Region, DayZone> = {
  ID: "Asia/Jakarta",
  MY: "Asia/Kuala_Lumpur",
  SG: "Asia/Singapore",
};

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

export function dayZoneOffsetMs(zone: DayZone = activeZone): number {
  return OFFSET_HOURS[zone] * 3_600_000;
}

/** The calendar day 'YYYY-MM-DD' it is in `zone` at `now`. 16:30 UTC is already tomorrow in Kuala Lumpur, still today in Jakarta. */
export function dayIn(zone: DayZone = activeZone, now: Date = new Date()): string {
  return new Date(now.getTime() + dayZoneOffsetMs(zone)).toISOString().slice(0, 10);
}

/** The calendar day before today in `zone`. */
export function yesterdayIn(zone: DayZone = activeZone, now: Date = new Date()): string {
  const d = new Date(now.getTime() + dayZoneOffsetMs(zone));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Wall-clock hour in `zone` as a decimal (13.5 = 13:30). */
export function clockHourIn(zone: DayZone = activeZone, now: Date = new Date()): number {
  const d = new Date(now.getTime() + dayZoneOffsetMs(zone));
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** The calendar day 'YYYY-MM-DD' of an instant (epoch ms) in `zone`. */
export function dayOfMs(ms: number, zone: DayZone = activeZone): string {
  return new Date(ms + dayZoneOffsetMs(zone)).toISOString().slice(0, 10);
}

/** Epoch-ms window [startMs, endMs) of one calendar day 'YYYY-MM-DD' in `zone`. */
export function dayBoundsIn(day: string, zone: DayZone = activeZone): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${day}T00:00:00Z`) - dayZoneOffsetMs(zone);
  return { startMs, endMs: startMs + 86_400_000 };
}

/** Epoch ms of a wall-clock time ('YYYY-MM-DD', hour, minute) in `zone`. */
export function instantIn(day: string, hour: number, minute: number, zone: DayZone = activeZone): number {
  return dayBoundsIn(day, zone).startMs + (hour * 60 + minute) * 60_000;
}

/** ISO 8601 with the zone's offset: "2026-10-21T23:30:00+08:00". */
export function isoInZone(ms: number, zone: DayZone = activeZone): string {
  const offsetHours = dayZoneOffsetMs(zone) / 3_600_000;
  return `${new Date(ms + dayZoneOffsetMs(zone)).toISOString().slice(0, 19)}+${String(offsetHours).padStart(2, "0")}:00`;
}

/** Day of the week (0 = Sunday) of an instant in `zone`. */
export function weekdayOfMs(ms: number, zone: DayZone = activeZone): number {
  return new Date(ms + dayZoneOffsetMs(zone)).getUTCDay();
}

/** The zone of the device the app runs on, when it is one we serve; null otherwise. */
export function deviceDayZone(): DayZone | null {
  try {
    return matchDayZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/**
 * The zone a person's days are cut in. A device in a zone we serve wins (the day follows where the person is);
 * else what the profile stores; else Jakarta for a profile that predates zones (all its days were cut in WIB, and
 * an Indonesian person never moves because their UI is Malay), else the region's zone for someone not onboarded.
 */
export function resolveDayZone(input: {
  device?: string | null;
  stored?: string | null;
  hasProfile: boolean;
  region: Region;
}): DayZone {
  return (
    matchDayZone(input.device) ??
    matchDayZone(input.stored) ??
    (input.hasProfile ? DEFAULT_DAY_ZONE : zoneForRegion(input.region))
  );
}
