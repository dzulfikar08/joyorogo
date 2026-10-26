import { eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { stravaAccount } from "@joyorogo/db/schema/fitness";
import { effectiveTier } from "./tiers";

/**
 * Slots of the Strava application JoyoRogo and JoyoFit share (client 287873). Strava caps how many athletes may
 * authorize one application, and the cap is full long before paying users stop arriving, so Strava is free only while
 * slots are spare (docs/strava.md "Capacity"):
 *
 * - a paying user (Pro: a paid period, a subscription or the `founder` comp, `effectiveTier`) may connect while any
 *   slot is free;
 * - a free user may connect only while more than `reserve` slots are free, so the last `reserve` slots stay for paying
 *   users;
 * - a user who already holds a slot (a row in `strava_account`) never needs a new one: re-authorizing, adding a scope
 *   or linking the other product is always allowed.
 *
 * Idle free users are released to win the reserve back (lib/strava-release.ts).
 */

export type StravaCapacityEnv = {
  /** Athletes the Strava application may hold (Strava's athlete capacity). Default 10. */
  STRAVA_CAPACITY?: string;
  /** Slots kept for paying users; a free user connects only while more than this many are free. Default 3. */
  STRAVA_PAID_RESERVE?: string;
  /** Days without token use after which a free user's grant may be released. Default 14. */
  STRAVA_IDLE_DAYS?: string;
};

export type StravaCapacity = { capacity: number; reserve: number; idleDays: number };

export const DEFAULT_STRAVA_CAPACITY: StravaCapacity = { capacity: 10, reserve: 3, idleDays: 14 };

function whole(raw: string | undefined, fallback: number, min: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/** Unset or garbage falls back to the default; the reserve never exceeds the capacity. */
export function stravaCapacity(env: StravaCapacityEnv): StravaCapacity {
  const capacity = whole(env.STRAVA_CAPACITY, DEFAULT_STRAVA_CAPACITY.capacity, 1);
  const reserve = Math.min(
    whole(env.STRAVA_PAID_RESERVE, DEFAULT_STRAVA_CAPACITY.reserve, 0),
    capacity,
  );
  const idleDays = whole(env.STRAVA_IDLE_DAYS, DEFAULT_STRAVA_CAPACITY.idleDays, 1);
  return { capacity, reserve, idleDays };
}

/** `full`: no slot left. `reserved_for_paid`: slots are left, but only the paying-user reserve. */
export type SlotRefusal = "full" | "reserved_for_paid";

/** Whether a user who needs a NEW slot may take one, with `connected` athletes holding slots now. */
export function slotRefusal(
  paid: boolean,
  connected: number,
  config: StravaCapacity,
): SlotRefusal | null {
  const free = config.capacity - connected;
  if (free <= 0) return "full";
  if (!paid && free <= config.reserve) return "reserved_for_paid";
  return null;
}

/** Athletes holding a slot: one per distinct athlete, however many accounts link the same athlete. */
export async function connectedAthletes(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${stravaAccount.athleteId})` })
    .from(stravaAccount);
  return Number(row?.n ?? 0);
}

/** Pro by the same rule every paid feature uses (`effectiveTier`): a paid period, a subscription, or the comp. */
export async function isPaidUser(db: Database, userId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ tier: user.tier, founderUntil: user.founderUntil })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return effectiveTier(row, now) === "founder";
}

export type SlotCheck = { slotsFull: boolean; slotsReason?: SlotRefusal };

/**
 * May this user start a Strava authorization now? A user with a grant row already holds a slot. Shown before the
 * authorize page (status / authorize URL); the code exchange checks again (`exchangeCode`), because the answer can
 * change while the athlete is on Strava's page.
 */
export async function slotCheck(
  db: Database,
  userId: string,
  config: StravaCapacity,
  now = new Date(),
): Promise<SlotCheck> {
  const [held] = await db
    .select({ userId: stravaAccount.userId })
    .from(stravaAccount)
    .where(eq(stravaAccount.userId, userId))
    .limit(1);
  if (held) return { slotsFull: false };
  const [paid, connected] = await Promise.all([isPaidUser(db, userId, now), connectedAthletes(db)]);
  const refusal = slotRefusal(paid, connected, config);
  return refusal ? { slotsFull: true, slotsReason: refusal } : { slotsFull: false };
}
