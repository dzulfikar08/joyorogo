import { ORPCError } from "@orpc/server";
import { and, count, eq, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { leaderboardPref, leaderboardWeek } from "@joyorogo/db/schema/badges";
import { profile } from "@joyorogo/db/schema/fitness";
import { teamMember } from "@joyorogo/db/schema/social";

import { protectedProcedure } from "../index";
import type { Context } from "../context";
import { ALIAS_MAX, ALIAS_MIN, badgesEnabled, boardName, compareScores, normalizeAlias, weekStartOf } from "../lib/badges";
import { currentWeekStart } from "../lib/leaderboard";
import { maternalFromRow } from "../lib/maternal";
import { serverT } from "../lib/messages";

type AuthedContext = Context & { session: NonNullable<Context["session"]> };

/** Rows the global board returns besides the caller's own. */
export const BOARD_SIZE = 50;

export type BoardRow = {
  rank: number;
  /** Alias or public handle; null when the person stays anonymous (the client writes "Anonim #<rank>"). */
  name: string | null;
  anonymous: boolean;
  isMe: boolean;
  daysLogged: number;
  workoutDays: number;
  proteinHitDays: number;
  streak: number;
  /** Monday first: which days of the week were logged days. */
  days: boolean[];
};

function requireEnabled(context: AuthedContext): void {
  if (!badgesEnabled(context.env, context.session.user.id)) {
    throw new ORPCError("FORBIDDEN", { message: serverT(context.locale, "errors")("badges.unavailable") });
  }
}

const weekInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `week` (a Monday, 'YYYY-MM-DD') or the current week; a week that is not a Monday or lies in the future is BAD_REQUEST. */
function resolveWeek(context: AuthedContext, week: string | undefined): string {
  const current = currentWeekStart(new Date());
  if (week === undefined) return current;
  if (Number.isNaN(Date.parse(week)) || weekStartOf(week) !== week || week > current) {
    throw new ORPCError("BAD_REQUEST", { message: serverT(context.locale, "errors")("badges.badWeek") });
  }
  return week;
}

const boardColumns = {
  userId: leaderboardWeek.userId,
  daysLogged: leaderboardWeek.daysLogged,
  workoutDays: leaderboardWeek.workoutDays,
  proteinHitDays: leaderboardWeek.proteinHitDays,
  streakEnd: leaderboardWeek.streakEnd,
  daysMask: leaderboardWeek.daysMask,
  rankGlobal: leaderboardWeek.rankGlobal,
  displayMode: leaderboardPref.displayMode,
  alias: leaderboardPref.alias,
  handle: profile.handle,
};

type RawRow = Awaited<ReturnType<typeof weekRows>>[number];

function toRow(raw: RawRow, rank: number, me: string): BoardRow {
  const { name, anonymous } = boardName({ displayMode: raw.displayMode, handle: raw.handle, alias: raw.alias });
  return {
    rank,
    name,
    anonymous,
    isMe: raw.userId === me,
    daysLogged: raw.daysLogged,
    workoutDays: raw.workoutDays,
    proteinHitDays: raw.proteinHitDays,
    streak: raw.streakEnd,
    days: Array.from({ length: 7 }, (_, i) => (raw.daysMask & (1 << i)) !== 0),
  };
}

/** Snapshot rows joined to the display preferences of opted-in people only; the caller adds the `where` (week first). */
function weekRows(db: Database) {
  return db
    .select(boardColumns)
    .from(leaderboardWeek)
    .innerJoin(leaderboardPref, and(eq(leaderboardPref.userId, leaderboardWeek.userId), eq(leaderboardPref.optIn, true)))
    .leftJoin(profile, eq(profile.userId, leaderboardWeek.userId));
}

async function isMember(db: Database, teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);
  return row !== undefined;
}

export const leaderboardRouter = {
  /** The caller's leaderboard settings. `eligible` false = in Hamil / Menyusui mode, where the board is not offered. */
  prefs: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const enabled = badgesEnabled(context.env, userId);
    const [[pref], [row]] = await Promise.all([
      context.db.select().from(leaderboardPref).where(eq(leaderboardPref.userId, userId)).limit(1),
      context.db.select().from(profile).where(eq(profile.userId, userId)).limit(1),
    ]);
    return {
      enabled,
      eligible: row !== undefined && maternalFromRow(row).mode === "none",
      optIn: pref?.optIn ?? false,
      displayMode: pref?.displayMode ?? ("anonim" as const),
      alias: pref?.alias ?? null,
      aliasMin: ALIAS_MIN,
      aliasMax: ALIAS_MAX,
    };
  }),

  /**
   * Joins or leaves the board and sets the name. Leaving deletes the person's snapshot rows of every week. `alias` is
   * 3-20 characters of a-z, 0-9, `_`, `.`, `-` (lower-cased), unique among everyone; null clears it.
   */
  setPrefs: protectedProcedure
    .input(
      z.object({
        optIn: z.boolean(),
        displayMode: z.enum(["username", "anonim"]),
        alias: z.string().max(64).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const t = serverT(context.locale, "errors");
      const userId = context.session.user.id;
      const [row] = await context.db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
      if (input.optIn && (!row || maternalFromRow(row).mode !== "none")) {
        throw new ORPCError("FORBIDDEN", { message: t("badges.leaderboardMaternal") });
      }
      const alias = input.alias === undefined || input.alias === null || input.alias.trim() === "" ? null : normalizeAlias(input.alias);
      if (input.alias && input.alias.trim() !== "" && alias === null) {
        throw new ORPCError("BAD_REQUEST", { message: t("badges.aliasInvalid", { min: ALIAS_MIN, max: ALIAS_MAX }) });
      }
      if (alias !== null) {
        const [taken] = await context.db
          .select({ userId: leaderboardPref.userId })
          .from(leaderboardPref)
          .where(and(eq(leaderboardPref.alias, alias), ne(leaderboardPref.userId, userId)))
          .limit(1);
        if (taken) throw new ORPCError("CONFLICT", { message: t("badges.aliasTaken") });
      }
      try {
        await context.db
          .insert(leaderboardPref)
          .values({ userId, optIn: input.optIn, displayMode: input.displayMode, alias })
          .onConflictDoUpdate({
            target: leaderboardPref.userId,
            set: { optIn: input.optIn, displayMode: input.displayMode, alias, updatedAt: new Date() },
          });
      } catch (error) {
        // Two people claiming the same alias at once: the unique index decides.
        if (/UNIQUE/i.test(String(error)) || /UNIQUE/i.test(String((error as { cause?: unknown }).cause))) {
          throw new ORPCError("CONFLICT", { message: t("badges.aliasTaken") });
        }
        throw error;
      }
      if (!input.optIn) await context.db.delete(leaderboardWeek).where(eq(leaderboardWeek.userId, userId));
      return { optIn: input.optIn, displayMode: input.displayMode, alias };
    }),

  /**
   * One week's board: the top 50 (global) or everyone opted in from the team (`scope: "team"`, the caller must be a member),
   * and the caller's own row. `week` is a Monday ('YYYY-MM-DD'), default this week. `closed` = the week is over and final.
   * Rows hold days logged, workout days, protein days and the streak, never weight or body data; `rows` is empty when
   * nobody joined yet.
   */
  board: protectedProcedure
    .input(z.object({ scope: z.enum(["global", "team"]), teamId: z.string().min(1).max(64).optional(), week: weekInput.optional() }))
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const t = serverT(context.locale, "errors");
      const userId = context.session.user.id;
      const weekStart = resolveWeek(context, input.week);
      const closed = weekStart < currentWeekStart(new Date());

      if (input.scope === "team") {
        if (!input.teamId) throw new ORPCError("BAD_REQUEST", { message: t("badges.teamRequired") });
        if (!(await isMember(context.db, input.teamId, userId))) {
          throw new ORPCError("FORBIDDEN", { message: t("badges.notTeamMember") });
        }
        const rows = await weekRows(context.db).where(
          and(
            eq(leaderboardWeek.weekStart, weekStart),
            inArray(leaderboardWeek.userId, context.db.select({ id: teamMember.userId }).from(teamMember).where(eq(teamMember.teamId, input.teamId))),
          ),
        );
        const ranked = rows
          .map((row) => ({ row, key: { ...row, streakEnd: row.streakEnd, proteinHitDays: row.proteinHitDays, alias: row.alias ?? "" } }))
          .sort((a, b) => compareScores(a.key, b.key))
          .map((entry, index) => toRow(entry.row, index + 1, userId));
        return { week: weekStart, closed, total: ranked.length, rows: ranked.slice(0, BOARD_SIZE), me: ranked.find((r) => r.isMe) ?? null };
      }

      const [top, [totalRow], [mine]] = await Promise.all([
        weekRows(context.db).where(and(eq(leaderboardWeek.weekStart, weekStart), lte(leaderboardWeek.rankGlobal, BOARD_SIZE))).orderBy(leaderboardWeek.rankGlobal),
        context.db.select({ total: count() }).from(leaderboardWeek).where(eq(leaderboardWeek.weekStart, weekStart)),
        weekRows(context.db).where(and(eq(leaderboardWeek.weekStart, weekStart), eq(leaderboardWeek.userId, userId))).limit(1),
      ]);
      const rows = top.map((row) => toRow(row, row.rankGlobal ?? 0, userId));
      return {
        week: weekStart,
        closed,
        total: totalRow?.total ?? 0,
        rows,
        me: mine ? toRow(mine, mine.rankGlobal ?? 0, userId) : null,
      };
    }),

  /** The caller's rank on the global board of a week; `rank` null when they are not on it (not joined, or no logged day that week). */
  myRank: protectedProcedure.input(z.object({ week: weekInput.optional() }).optional()).handler(async ({ context, input }) => {
    requireEnabled(context);
    const userId = context.session.user.id;
    const weekStart = resolveWeek(context, input?.week);
    const [[mine], [totalRow]] = await Promise.all([
      weekRows(context.db).where(and(eq(leaderboardWeek.weekStart, weekStart), eq(leaderboardWeek.userId, userId))).limit(1),
      context.db.select({ total: count() }).from(leaderboardWeek).where(eq(leaderboardWeek.weekStart, weekStart)),
    ]);
    return { week: weekStart, rank: mine?.rankGlobal ?? null, total: totalRow?.total ?? 0, me: mine ? toRow(mine, mine.rankGlobal ?? 0, userId) : null };
  }),
};
