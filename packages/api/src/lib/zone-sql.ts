import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { DAY_ZONES, DEFAULT_DAY_ZONE, dayZoneOffsetMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

/**
 * One zone per distinct UTC offset. A person's day, clock and weekday depend only on the offset (no DST), so a cron
 * job that works in local time runs once per group and picks that group's people with `profileInZone`.
 */
export const ZONE_GROUPS: readonly DayZone[] = DAY_ZONES.filter(
  (zone, i) => DAY_ZONES.findIndex((other) => dayZoneOffsetMs(other) === dayZoneOffsetMs(zone)) === i,
);

const sameOffset = (zone: DayZone): DayZone[] => DAY_ZONES.filter((other) => dayZoneOffsetMs(other) === dayZoneOffsetMs(zone));

/**
 * SQL predicate: this profile's days are cut at the offset of `zone`. A profile without a stored zone predates them
 * and stays on the default zone's group.
 */
export function profileInZone(zone: DayZone, column: SQL = sql`profile.timezone`): SQL {
  const own = sameOffset(zone);
  const list = (zones: DayZone[]) => sql.join(zones.map((z) => sql`${z}`), sql`, `);
  if (own.includes(DEFAULT_DAY_ZONE)) {
    const others = DAY_ZONES.filter((z) => !own.includes(z));
    return others.length === 0 ? sql`1 = 1` : sql`(${column} IS NULL OR ${column} NOT IN (${list(others)}))`;
  }
  return sql`${column} IN (${list(own)})`;
}
