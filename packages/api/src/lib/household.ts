import { and, eq, gte, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { household, householdEvent, householdInvite, householdMember } from "@joyorogo/db/schema/household";

/**
 * Joyo Keluarga: one payer, Joyo Pro for up to HOUSEHOLD_MAX_SEATS accounts in one household
 * (docs/pricing/joyo-keluarga.md). This file holds the entitlement rule every Pro gate reads (`proUntil`), the seat
 * and churn limits, and the price rule (2x the current Pro ladder step).
 */

/** Seats in one household, the payer included (owner decision 2026-11-17). */
export const HOUSEHOLD_MAX_SEATS = 5;
/** An invite works once and only for this long. */
export const HOUSEHOLD_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Joins a household may admit in a rolling window beyond the first fill (guard against selling seats). */
export const HOUSEHOLD_CHURN_JOINS = 8;
export const HOUSEHOLD_CHURN_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Keluarga costs this many times the Pro step (owner decision 2026-11-17). */
export const KELUARGA_PRICE_MULTIPLIER = 2;

export type KeluargaEnv = {
  /** "1"/"on"/"true" sells Joyo Keluarga and opens its screens. Default off: nothing about it is visible. */
  KELUARGA_ENABLED?: string;
};

export function keluargaEnabled(env: KeluargaEnv): boolean {
  const value = env.KELUARGA_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "on" || value === "true";
}

/**
 * Both expressions name the outer table as `"user"` on purpose: drizzle writes a bare `"id"` in a one-table select,
 * and inside the subquery a bare `"id"` would resolve to `household.id`. So they are raw SQL, and work in drizzle
 * selects and in hand-written SQL alike, as long as the user table is not aliased.
 */
const HOUSEHOLD_UNTIL_RAW_SQL = `select h.paid_until from household_member hm join household h on h.id = hm.household_id where hm.user_id = "user"."id"`;

/** `proUntil` for raw SQL that names the user table `"user"`: an epoch-ms integer or null. */
export const PRO_UNTIL_RAW_SQL = `nullif(max(coalesce("user"."founder_until", 0), coalesce((${HOUSEHOLD_UNTIL_RAW_SQL}), 0)), 0)`;

/**
 * The paid period of the household the outer query's user is in; null when none or unpaid. One lookup on
 * `household_member_user_uidx`, then the household primary key.
 */
export const householdUntil = sql<Date | null>`(${sql.raw(HOUSEHOLD_UNTIL_RAW_SQL)})`.mapWith(user.founderUntil);

/**
 * Later of the person's own paid period (`user.founder_until`) and their household's; null when neither. Every Pro
 * gate selects this as `founderUntil` (`{ tier: user.tier, founderUntil: proUntil }`), so `effectiveTier`,
 * `premiumUnlocked` and friends need no change. Credit and refund paths keep reading the raw column: household time
 * is never copied into `founder_until`. `household-sites.test.ts` fails when a gate reads the raw column.
 */
export const proUntil = sql<Date | null>`${sql.raw(PRO_UNTIL_RAW_SQL)}`.mapWith(user.founderUntil);

/** The household price for one Pro price: always 2x (a locked Pro price gives a locked Keluarga price). */
export function keluargaAmountIdr(proAmountIdr: number): number {
  return proAmountIdr * KELUARGA_PRICE_MULTIPLIER;
}

/**
 * A ledger row's Pro-equivalent amount for the shared price lock: a Keluarga order counts as the Pro step it was 2x
 * of, so whoever paid either plan keeps the lowest Pro step they ever paid (owner decision 4).
 */
export function proEquivalentIdr(row: { amountIdr: number; product: string | null }): number {
  return row.product === "keluarga" ? row.amountIdr / KELUARGA_PRICE_MULTIPLIER : row.amountIdr;
}

/** SHA-256 hex of a normalised invite code. Only this is stored. */
export async function hashInviteCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type HouseholdRole = "owner" | "member";

export type HouseholdCoverage = {
  householdId: string;
  role: HouseholdRole;
  ownerId: string;
  ownerName: string;
  /** The household's paid period end; null = never paid or lapsed long ago. */
  paidUntil: Date | null;
};

/** The household this account is in (as owner or member), or null. */
export async function householdOf(db: Database, userId: string): Promise<HouseholdCoverage | null> {
  const [row] = await db
    .select({
      householdId: householdMember.householdId,
      role: householdMember.role,
      ownerId: household.ownerId,
      ownerName: user.name,
      paidUntil: household.paidUntil,
    })
    .from(householdMember)
    .innerJoin(household, eq(household.id, householdMember.householdId))
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(eq(householdMember.userId, userId))
    .limit(1);
  return row ?? null;
}

/** True while the period runs. */
export function householdPaid(paidUntil: Date | null, now = new Date()): boolean {
  return paidUntil !== null && paidUntil.getTime() > now.getTime();
}

/** A pending invite holds a seat: unused, not revoked, not expired. */
export function pendingInviteWhere(householdId: string, now: Date) {
  return and(
    eq(householdInvite.householdId, householdId),
    sql`${householdInvite.usedAt} is null`,
    sql`${householdInvite.revokedAt} is null`,
    gte(householdInvite.expiresAt, now),
  );
}

/**
 * Whether one more person may join: member joins in the last 12 months must stay below the first fill (seats minus the
 * owner) plus HOUSEHOLD_CHURN_JOINS.
 */
export function churnAllows(joinsInWindow: number): boolean {
  return joinsInWindow < HOUSEHOLD_MAX_SEATS - 1 + HOUSEHOLD_CHURN_JOINS;
}

export async function joinsInWindow(db: Database, householdId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(householdEvent)
    .where(
      and(
        eq(householdEvent.householdId, householdId),
        eq(householdEvent.kind, "join"),
        gte(householdEvent.at, new Date(now.getTime() - HOUSEHOLD_CHURN_WINDOW_MS)),
      ),
    );
  return row?.total ?? 0;
}

/**
 * The household this account owns, created (with the owner's member row) when missing. Used by billing before it
 * credits a Keluarga order. A payer who is a member of someone else's household is moved out first: the web checkout
 * refuses that case, so this only matters for store purchases that arrive anyway (the store has already charged).
 */
export async function ensureOwnedHousehold(db: Database, ownerId: string): Promise<{ id: string; paidUntil: Date | null }> {
  const [owned] = await db
    .select({ id: household.id, paidUntil: household.paidUntil })
    .from(household)
    .where(eq(household.ownerId, ownerId))
    .limit(1);
  if (owned) return owned;
  const current = await householdOf(db, ownerId);
  const id = crypto.randomUUID();
  if (current) {
    await db.batch([
      db.delete(householdMember).where(eq(householdMember.userId, ownerId)),
      db.insert(householdEvent).values({ householdId: current.householdId, userId: ownerId, kind: "leave" }),
    ]);
  }
  await db.batch([
    db.insert(household).values({ id, ownerId }).onConflictDoNothing(),
    db.insert(householdMember).values({ householdId: id, userId: ownerId, role: "owner" }).onConflictDoNothing(),
  ]);
  const [row] = await db
    .select({ id: household.id, paidUntil: household.paidUntil })
    .from(household)
    .where(eq(household.ownerId, ownerId))
    .limit(1);
  return row!;
}

/**
 * Account deletion: the owner's household goes (cascade takes members and invites), so every member loses household
 * Pro at once; there is no heir. Returns the member ids that lost their seat, for the notice. A member's own row goes
 * with the user row (cascade).
 */
export async function deleteUserHousehold(db: Database, userId: string): Promise<string[]> {
  const [owned] = await db.select({ id: household.id }).from(household).where(eq(household.ownerId, userId)).limit(1);
  const current = owned ? null : await householdOf(db, userId);
  if (current) {
    await db.batch([
      db.delete(householdMember).where(eq(householdMember.userId, userId)),
      db.insert(householdEvent).values({ householdId: current.householdId, userId, kind: "leave" }),
    ]);
    return [];
  }
  if (!owned) return [];
  const members = await db
    .select({ userId: householdMember.userId })
    .from(householdMember)
    .where(and(eq(householdMember.householdId, owned.id), eq(householdMember.role, "member")));
  await db.delete(household).where(eq(household.id, owned.id));
  return members.map((m) => m.userId);
}
