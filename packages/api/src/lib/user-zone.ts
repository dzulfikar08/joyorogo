import { eq, inArray } from "drizzle-orm";

import { profile } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";
import { DEFAULT_REGION, resolveDayZone } from "@joyorogo/i18n";
import type { DayZone, Region } from "@joyorogo/i18n";

/**
 * The zone a person's calendar days are cut in (profile.timezone). A profile without one predates zones and keeps
 * Asia/Jakarta, which is what all its stored days were cut with; someone not onboarded yet gets their region's zone.
 * Every server path that decides "today", a quota window, a streak day or when a mail goes out takes the zone from
 * here: the Worker serves everyone, so a zone is never ambient (see packages/i18n/src/day-zone.ts).
 * Admin and internal reports keep WIB on purpose (`wibDayBounds`, `jakartaToday()` without a zone).
 */
export async function zoneOfUser(db: Database, userId: string, region: Region = DEFAULT_REGION): Promise<DayZone> {
  const [row] = await db
    .select({ timezone: profile.timezone })
    .from(profile)
    .where(eq(profile.userId, userId))
    .limit(1);
  return resolveDayZone({ stored: row?.timezone, hasProfile: row !== undefined, region });
}

/** Zones of many users in one query (cron jobs); a user without a profile row is absent, so callers use `zones.get(id) ?? DEFAULT_DAY_ZONE`. */
export async function zonesOfUsers(db: Database, userIds: readonly string[]): Promise<Map<string, DayZone>> {
  const zones = new Map<string, DayZone>();
  const CHUNK = 90;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const rows = await db
      .select({ userId: profile.userId, timezone: profile.timezone })
      .from(profile)
      .where(inArray(profile.userId, userIds.slice(i, i + CHUNK)));
    for (const row of rows) zones.set(row.userId, resolveDayZone({ stored: row.timezone, hasProfile: true, region: DEFAULT_REGION }));
  }
  return zones;
}

type ZoneContext = { db: Database; region?: Region; session: { user: { id: string } } };

const requestZones = new WeakMap<object, Promise<DayZone>>();

/**
 * The signed-in caller's zone, read once per request (handlers pass the same `context` to every helper, so the
 * second call is free). Use it for `jakartaToday(undefined, zone)` and every day window of the request.
 */
export function userZone(context: ZoneContext): Promise<DayZone> {
  const cached = requestZones.get(context);
  if (cached) return cached;
  const pending = zoneOfUser(context.db, context.session.user.id, context.region);
  requestZones.set(context, pending);
  // A failed read must not stick for the rest of the request.
  pending.catch(() => requestZones.delete(context));
  return pending;
}
