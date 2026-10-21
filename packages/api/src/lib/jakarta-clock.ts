import { dayZoneOffsetMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The clock a screen renders from, advanced only when the hour of the day zone (WIB unless `zone` says otherwise) changes. WIB and MYT have no DST, so an hour boundary is
 * always aligned to a UTC hour and WIB midnight is one of them: a day rollover, and the greeting changing from pagi to
 * siang, both show up as a new hour. Returning `prev` (same identity) lets a polling tick skip the re-render.
 */
export function advanceClock(prev: Date, now: Date, zone?: DayZone): Date {
  const offset = dayZoneOffsetMs(zone);
  const hour = (d: Date) => Math.floor((d.getTime() + offset) / HOUR_MS);
  return hour(prev) === hour(now) ? prev : now;
}
