import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { badgeAward } from "@joyorogo/db/schema/badges";
import { profile } from "@joyorogo/db/schema/fitness";

import { protectedProcedure, publicProcedure } from "../index";
import { BADGES, badgesEnabled } from "../lib/badges";
import type { BadgesEnv } from "../lib/badges";
import { serverT } from "../lib/messages";

export type BadgeView = {
  /** Image: /badge/<id>.webp (web), assets/badge/<id>.webp (native). Names and descriptions: i18n namespace `badges`, keys `<id>.name` / `<id>.desc`. */
  id: string;
  /** Threshold of each tier (1 entry = a one-time badge); tier n is earned at `tiers[n - 1]`. */
  tiers: number[];
  /** Highest tier earned, 0 = locked. */
  tier: number;
  /** When the highest earned tier was awarded (ms), null while locked. */
  awardedAt: number | null;
};

/** The catalogue with what `userId` earned. Earned-only for another person's page (`onlyEarned`). */
export async function badgeViews(db: Database, userId: string, onlyEarned: boolean): Promise<BadgeView[]> {
  const rows = await db
    .select({ badgeId: badgeAward.badgeId, tier: badgeAward.tier, awardedAt: badgeAward.awardedAt })
    .from(badgeAward)
    .where(eq(badgeAward.userId, userId))
    .orderBy(asc(badgeAward.awardedAt));
  const views = BADGES.map((def): BadgeView => {
    const own = rows.filter((r) => r.badgeId === def.id);
    const top = own.reduce<(typeof own)[number] | null>((best, r) => (best === null || r.tier > best.tier ? r : best), null);
    return { id: def.id, tiers: [...def.tiers], tier: top?.tier ?? 0, awardedAt: top ? top.awardedAt.getTime() : null };
  });
  return onlyEarned ? views.filter((v) => v.tier > 0) : views;
}

/** Badges for the public profile page: earned ones only, and none unless the feature is on for that person. */
export async function publicBadges(db: Database, env: BadgesEnv, userId: string): Promise<BadgeView[]> {
  return badgesEnabled(env, userId) ? badgeViews(db, userId, true) : [];
}

export const badgeRouter = {
  /**
   * The signed-in person's shelf: every badge of the catalogue, earned or locked. `enabled` false = the feature is not
   * offered to this account (BADGES_USER_IDS); clients then hide the shelf.
   */
  mine: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    if (!badgesEnabled(context.env, userId)) return { enabled: false, badges: [] as BadgeView[] };
    return { enabled: true, badges: await badgeViews(context.db, userId, false) };
  }),

  /** Earned badges of `/u/<handle>`; NOT_FOUND unless that profile is public (or it is the caller's own). */
  forUser: publicProcedure.input(z.object({ handle: z.string().trim().toLowerCase() })).handler(async ({ context, input }) => {
    const [row] = await context.db
      .select({ userId: profile.userId, publicProfile: profile.publicProfile })
      .from(profile)
      .where(eq(profile.handle, input.handle))
      .limit(1);
    const isSelf = row !== undefined && row.userId === context.session?.user.id;
    if (!row || (!row.publicProfile && !isSelf)) {
      throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("badges.profileNotFound") });
    }
    return { badges: await publicBadges(context.db, context.env, row.userId) };
  }),
};
