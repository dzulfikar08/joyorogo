import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { appleSubscription, googlePurchase, polarSubscription } from "@joyorogo/db/schema/billing";
import { household, householdEvent, householdInvite, householdMember } from "@joyorogo/db/schema/household";

import { protectedProcedure, publicProcedure } from "../index";
import { newInviteCode, normalizeInviteCode } from "../lib/group";
import { previewAllowed } from "../lib/group-preview";
import {
  HOUSEHOLD_INVITE_TTL_MS,
  HOUSEHOLD_MAX_SEATS,
  churnAllows,
  hashInviteCode,
  householdOf,
  householdPaid,
  joinsInWindow,
  keluargaEnabled,
  pendingInviteWhere,
} from "../lib/household";
import type { KeluargaEnv } from "../lib/household";
import { serverT } from "../lib/messages";
import { notifyInBackground } from "../lib/notify";

/**
 * Joyo Keluarga seats (docs/pricing/joyo-keluarga.md section 2). The owner (the payer) invites with single-use codes
 * that expire after 7 days; a member leaves or is removed at once. Nothing here reads or exposes a member's diary,
 * email or usage: only names, photos, dates and seat counts. Everything answers NOT_FOUND while KELUARGA_ENABLED is off.
 */

const codeSchema = z.object({ code: z.string().min(4).max(20) });

function errT(context: { locale: Parameters<typeof serverT>[0] }) {
  return serverT(context.locale, "keluarga");
}

function requireEnabled(context: { env: KeluargaEnv; locale: Parameters<typeof serverT>[0] }) {
  if (!keluargaEnabled(context.env)) {
    throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.unavailable") });
  }
}

/** First word of a display name: all an invite preview shows of the owner. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

async function seatsTaken(db: Database, householdId: string, now: Date) {
  const [[members], [pending]] = await db.batch([
    db.select({ total: count() }).from(householdMember).where(eq(householdMember.householdId, householdId)),
    db.select({ total: count() }).from(householdInvite).where(pendingInviteWhere(householdId, now)),
  ]);
  return { members: members?.total ?? 0, pending: pending?.total ?? 0 };
}

async function findInvite(db: Database, rawCode: string) {
  const code = normalizeInviteCode(rawCode);
  if (code.length === 0) return null;
  const codeHash = await hashInviteCode(code);
  const [row] = await db
    .select({
      codeHash: householdInvite.codeHash,
      householdId: householdInvite.householdId,
      expiresAt: householdInvite.expiresAt,
      usedBy: householdInvite.usedBy,
      usedAt: householdInvite.usedAt,
      revokedAt: householdInvite.revokedAt,
      ownerId: household.ownerId,
      ownerName: user.name,
      paidUntil: household.paidUntil,
    })
    .from(householdInvite)
    .innerJoin(household, eq(household.id, householdInvite.householdId))
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(eq(householdInvite.codeHash, codeHash))
    .limit(1);
  return row ?? null;
}

type InviteState = "ok" | "expired" | "used" | "revoked" | "unpaid";

function inviteState(
  invite: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; paidUntil: Date | null },
  now: Date,
): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (invite.expiresAt.getTime() < now.getTime()) return "expired";
  if (!householdPaid(invite.paidUntil, now)) return "unpaid";
  return "ok";
}

/**
 * What the invite screen tells someone who already pays Pro themselves, from data we already hold: whether their own
 * period renews by itself, and where to cancel it if Keluarga is enough (section 2, "A member who already pays Pro").
 */
async function ownProOf(db: Database, userId: string, now: Date) {
  const [[me], polar, apple, google] = await db.batch([
    db.select({ until: user.founderUntil }).from(user).where(eq(user.id, userId)).limit(1),
    db
      .select({ state: polarSubscription.state, cancelAtPeriodEnd: polarSubscription.cancelAtPeriodEnd })
      .from(polarSubscription)
      .where(and(eq(polarSubscription.userId, userId), inArray(polarSubscription.state, ["active", "past_due"])))
      .limit(1),
    db
      .select({ state: appleSubscription.state })
      .from(appleSubscription)
      .where(and(eq(appleSubscription.userId, userId), inArray(appleSubscription.state, ["active", "grace", "retry"])))
      .limit(1),
    db
      .select({ state: googlePurchase.state })
      .from(googlePurchase)
      .where(and(eq(googlePurchase.userId, userId), inArray(googlePurchase.state, ["active", "grace"])))
      .limit(1),
  ]);
  const until = me?.until && me.until.getTime() > now.getTime() ? me.until : null;
  const renews: "polar" | "apple" | "google_play" | null =
    polar.some((p) => !p.cancelAtPeriodEnd) ? "polar" : apple.length > 0 ? "apple" : google.length > 0 ? "google_play" : null;
  if (!until && !renews) return null;
  return { until, renews };
}

function notice(
  context: Parameters<typeof notifyInBackground>[0],
  userId: string,
  kind: "member_join" | "member_leave" | "removed",
  params: Record<string, string>,
  dedupeKey: string,
) {
  const key = { member_join: "memberJoin", member_leave: "memberLeave", removed: "removed" }[kind];
  notifyInBackground(context, userId, {
    category: "group",
    kind: `household_${kind}`,
    title: { key: `notify.household.${key}.title`, params },
    body: { key: `notify.household.${key}.body`, params },
    link: { t: "langganan" },
    dedupeKey,
  });
}

export const householdRouter = {
  /**
   * The caller's household. The owner sees members (name, photo, joined date) and pending invites; a member sees the
   * owner's name and the period end. `enabled` false = the plan is off and clients hide every Keluarga surface.
   */
  get: protectedProcedure.handler(async ({ context }) => {
    const enabled = keluargaEnabled(context.env);
    const userId = context.session.user.id;
    const now = new Date();
    const mine = enabled ? await householdOf(context.db, userId) : null;
    if (!mine) return { enabled, seats: HOUSEHOLD_MAX_SEATS, household: null };
    const paidUntil = mine.paidUntil?.getTime() ?? null;
    if (mine.role === "member") {
      return {
        enabled,
        seats: HOUSEHOLD_MAX_SEATS,
        household: {
          role: "member" as const,
          ownerName: mine.ownerName,
          paidUntil,
          paid: householdPaid(mine.paidUntil, now),
          members: [],
          invites: [],
        },
      };
    }
    const [members, invites] = await context.db.batch([
      context.db
        .select({
          userId: householdMember.userId,
          role: householdMember.role,
          joinedAt: householdMember.joinedAt,
          name: user.name,
          image: user.image,
        })
        .from(householdMember)
        .innerJoin(user, eq(user.id, householdMember.userId))
        .where(eq(householdMember.householdId, mine.householdId))
        .orderBy(asc(householdMember.joinedAt)),
      context.db
        .select({ id: householdInvite.codeHash, expiresAt: householdInvite.expiresAt, createdAt: householdInvite.createdAt })
        .from(householdInvite)
        .where(pendingInviteWhere(mine.householdId, now))
        .orderBy(desc(householdInvite.createdAt)),
    ]);
    return {
      enabled,
      seats: HOUSEHOLD_MAX_SEATS,
      household: {
        role: "owner" as const,
        ownerName: mine.ownerName,
        paidUntil,
        paid: householdPaid(mine.paidUntil, now),
        members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.getTime() })),
        invites: invites.map((i) => ({ id: i.id, expiresAt: i.expiresAt.getTime() })),
      },
    };
  }),

  /** A new single-use invite code. Owner only, while the household is paid and a seat is free. */
  createInvite: protectedProcedure.handler(async ({ context }) => {
    requireEnabled(context);
    const userId = context.session.user.id;
    const now = new Date();
    const mine = await householdOf(context.db, userId);
    if (!mine || mine.role !== "owner") {
      throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
    }
    if (!householdPaid(mine.paidUntil, now)) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.unpaid") });
    }
    const taken = await seatsTaken(context.db, mine.householdId, now);
    if (taken.members + taken.pending >= HOUSEHOLD_MAX_SEATS) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.full", { max: HOUSEHOLD_MAX_SEATS }) });
    }
    if (!churnAllows(await joinsInWindow(context.db, mine.householdId, now))) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.churn") });
    }
    const code = newInviteCode();
    const expiresAt = new Date(now.getTime() + HOUSEHOLD_INVITE_TTL_MS);
    await context.db.insert(householdInvite).values({
      codeHash: await hashInviteCode(code),
      householdId: mine.householdId,
      createdBy: userId,
      createdAt: now,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.getTime() };
  }),

  cancelInvite: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const mine = await householdOf(context.db, context.session.user.id);
      if (!mine || mine.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
      }
      await context.db
        .update(householdInvite)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(householdInvite.codeHash, input.id),
            eq(householdInvite.householdId, mine.householdId),
            isNull(householdInvite.usedAt),
            isNull(householdInvite.revokedAt),
          ),
        );
      return { ok: true };
    }),

  /**
   * Invite preview. Public (the link is opened before signing in) and rate limited per client like group.preview. It
   * shows only the owner's first name and the seats used; a signed-in viewer also gets where they stand and their own
   * Pro (to warn about a renewal they may want to cancel).
   */
  preview: publicProcedure.input(codeSchema).handler(async ({ context, input }) => {
    requireEnabled(context);
    if (!(await previewAllowed(context.env.INVITE_PREVIEW_LIMITER, context.clientIp))) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: errT(context)("server.error.tooManyAttempts") });
    }
    const invite = await findInvite(context.db, input.code);
    if (!invite) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.invalidCode") });
    const now = new Date();
    const taken = await seatsTaken(context.db, invite.householdId, now);
    const viewerId = context.session?.user.id ?? null;
    let viewer: {
      membership: "this" | "other" | null;
      ownPro: Awaited<ReturnType<typeof ownProOf>>;
    } | null = null;
    if (viewerId) {
      const current = await householdOf(context.db, viewerId);
      viewer = {
        membership: current ? (current.householdId === invite.householdId ? "this" : "other") : null,
        ownPro: await ownProOf(context.db, viewerId, now),
      };
    }
    return {
      ownerFirstName: firstName(invite.ownerName),
      seatsUsed: taken.members,
      seats: HOUSEHOLD_MAX_SEATS,
      state: inviteState(invite, now),
      expiresAt: invite.expiresAt.getTime(),
      viewer,
    };
  }),

  /** Joins the household with a pending code. One household per account; the owner's own codes do nothing. */
  accept: protectedProcedure.input(codeSchema).handler(async ({ context, input }) => {
    requireEnabled(context);
    const userId = context.session.user.id;
    const now = new Date();
    const invite = await findInvite(context.db, input.code);
    if (!invite) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.invalidCode") });
    const current = await householdOf(context.db, userId);
    if (current?.householdId === invite.householdId) return { ok: true, already: true };
    if (current) throw new ORPCError("CONFLICT", { message: errT(context)("server.error.otherHousehold") });
    const state = inviteState(invite, now);
    if (state !== "ok") {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)(`server.error.invite_${state}`) });
    }
    const taken = await seatsTaken(context.db, invite.householdId, now);
    // This invite is pending, so it already holds one of the seats counted in taken.pending.
    if (taken.members >= HOUSEHOLD_MAX_SEATS) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.full", { max: HOUSEHOLD_MAX_SEATS }) });
    }
    if (!churnAllows(await joinsInWindow(context.db, invite.householdId, now))) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.churn") });
    }
    // Claim the code first: only one person can flip used_at from null.
    const claimed = await context.db
      .update(householdInvite)
      .set({ usedBy: userId, usedAt: now })
      .where(
        and(
          eq(householdInvite.codeHash, invite.codeHash),
          isNull(householdInvite.usedAt),
          isNull(householdInvite.revokedAt),
        ),
      )
      .returning({ codeHash: householdInvite.codeHash });
    if (claimed.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.invite_used") });
    }
    try {
      await context.db.batch([
        context.db.insert(householdMember).values({ householdId: invite.householdId, userId, role: "member", joinedAt: now }),
        context.db.insert(householdEvent).values({ householdId: invite.householdId, userId, kind: "join", at: now }),
      ]);
    } catch (error) {
      // unique(user_id): they joined another household between the check and here. Give the code back.
      await context.db
        .update(householdInvite)
        .set({ usedBy: null, usedAt: null })
        .where(eq(householdInvite.codeHash, invite.codeHash));
      console.error("[household] accept failed", error);
      throw new ORPCError("CONFLICT", { message: errT(context)("server.error.otherHousehold") });
    }
    notice(context, invite.ownerId, "member_join", { name: context.session.user.name }, `household_join:${invite.householdId}:${userId}:${now.getTime()}`);
    return { ok: true, already: false };
  }),

  /** A member leaves at once. The owner cannot leave (they pay; store subscriptions cannot move accounts). */
  leave: protectedProcedure.handler(async ({ context }) => {
    requireEnabled(context);
    const userId = context.session.user.id;
    const mine = await householdOf(context.db, userId);
    if (!mine) return { ok: true };
    if (mine.role === "owner") {
      throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.ownerCannotLeave") });
    }
    const now = new Date();
    await context.db.batch([
      context.db
        .delete(householdMember)
        .where(and(eq(householdMember.householdId, mine.householdId), eq(householdMember.userId, userId))),
      context.db.insert(householdEvent).values({ householdId: mine.householdId, userId, kind: "leave", at: now }),
    ]);
    notice(context, mine.ownerId, "member_leave", { name: context.session.user.name }, `household_leave:${mine.householdId}:${userId}:${now.getTime()}`);
    return { ok: true };
  }),

  /** The owner removes a member; their household Pro ends at once and they get a notice. */
  removeMember: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const ownerId = context.session.user.id;
      const mine = await householdOf(context.db, ownerId);
      if (!mine || mine.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
      }
      if (input.userId === ownerId) {
        throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.ownerCannotLeave") });
      }
      const [target] = await context.db
        .select({ userId: householdMember.userId })
        .from(householdMember)
        .where(
          and(
            eq(householdMember.householdId, mine.householdId),
            eq(householdMember.userId, input.userId),
            eq(householdMember.role, "member"),
          ),
        )
        .limit(1);
      if (!target) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.notMember") });
      const now = new Date();
      await context.db.batch([
        context.db
          .delete(householdMember)
          .where(and(eq(householdMember.householdId, mine.householdId), eq(householdMember.userId, input.userId))),
        context.db.insert(householdEvent).values({ householdId: mine.householdId, userId: input.userId, kind: "removed", at: now }),
      ]);
      notice(context, input.userId, "removed", { owner: mine.ownerName }, `household_removed:${mine.householdId}:${input.userId}:${now.getTime()}`);
      return { ok: true };
    }),
};
