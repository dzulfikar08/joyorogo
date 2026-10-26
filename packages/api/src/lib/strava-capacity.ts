import { eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { stravaAccount } from "@joyorogo/db/schema/fitness";

/**
 * Slots of the Strava application JoyoRogo and JoyoFit share (client 287873). Strava caps how many athletes may
 * authorize one application; when every slot is taken nobody new can connect, whatever their plan (Strava API Policy
 * 5.8: no end-user charge for Strava functionality, so nothing here looks at plans). A user who already holds a slot
 * (a row in `strava_account`) never needs a new one: re-authorizing, adding a scope or linking the other product is
 * always allowed. Slots are freed by hand (lib/strava-release.ts, docs/strava.md "Capacity").
 */

export type StravaCapacityEnv = {
  /** Athletes the Strava application may hold (Strava's athlete capacity). Default 10. */
  STRAVA_CAPACITY?: string;
};

export const DEFAULT_STRAVA_CAPACITY = 10;

/** `STRAVA_CAPACITY`: unset or garbage = 10. */
export function stravaCapacity(env: StravaCapacityEnv): number {
  const n = Number(env.STRAVA_CAPACITY?.trim() || Number.NaN);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_STRAVA_CAPACITY;
}

/** Athletes holding a slot: one per distinct athlete, however many accounts link the same athlete. */
export async function connectedAthletes(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${stravaAccount.athleteId})` })
    .from(stravaAccount);
  return Number(row?.n ?? 0);
}

/**
 * True when this user would need a new slot and none is left. Shown before the authorize page (status / authorize
 * URL); the code exchange checks again (`exchangeCode`), because the answer can change while the athlete is on
 * Strava's page.
 */
export async function slotsFull(db: Database, userId: string, capacity: number): Promise<boolean> {
  const [held] = await db
    .select({ userId: stravaAccount.userId })
    .from(stravaAccount)
    .where(eq(stravaAccount.userId, userId))
    .limit(1);
  return !held && (await connectedAthletes(db)) >= capacity;
}
