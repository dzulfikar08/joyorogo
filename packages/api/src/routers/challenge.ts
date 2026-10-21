import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import {
  CHALLENGE_GOALS,
  teamChallenge,
  teamChallengeMember,
} from "@joyorogo/db/schema/challenge";
import { team, teamMember } from "@joyorogo/db/schema/social";

import { protectedProcedure } from "../index";
import {
  CHALLENGE_TITLE_MAX,
  GOALS,
  goalText,
  MAX_OPEN_CHALLENGES,
  assignRanks,
  buildProgress,
  challengeEndDate,
  challengeStatus,
  compareRank,
  defaultChallengeTitle,
  describeGoal,
  memberFromDate,
  validateChallengeInput,
} from "../lib/challenge";
import type { ChallengeShare, DayFacts, DayResult } from "../lib/challenge";
import { canHostChallenge } from "../lib/challenge-host";
import { loadFacts } from "../lib/challenge-db";
import { daysBetween, jakartaToday, shiftDate } from "../lib/engine";
import { readCalibrationPrefs } from "../lib/calibration-store";
import { buildPlan, planQueries, proteinGoalG } from "../lib/plan";
import { dateSchema } from "../lib/schemas";
import { userZone } from "../lib/user-zone";
import { paywallConfig } from "../lib/tiers";
import { serverT } from "../lib/messages";
import { enqueueMany, notifyInBackground } from "../lib/notify";
import type { Locale } from "@joyorogo/i18n";

/** Ended challenges stay listed (for the result card) this many days. */
const ENDED_VISIBLE_DAYS = 30;
const MAX_ENDED_LISTED = 10;

async function requireTeamMember(db: Database, teamId: string, userId: string, locale: Locale) {
  const [row] = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: serverT(locale, "challenge")("server.error.teamNotFound"),
    });
  }
  return row;
}

type ChallengeRow = typeof teamChallenge.$inferSelect;

async function requireChallenge(db: Database, challengeId: string, userId: string, locale: Locale) {
  const [row] = await db
    .select({ challenge: teamChallenge, groupName: team.name, role: teamMember.role })
    .from(teamChallenge)
    .innerJoin(team, eq(team.id, teamChallenge.teamId))
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, teamChallenge.teamId), eq(teamMember.userId, userId)),
    )
    .where(eq(teamChallenge.id, challengeId))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: serverT(locale, "challenge")("server.error.notFound"),
    });
  }
  return row;
}

/** Fields every client needs to render a challenge header. */
function describeChallenge(c: ChallengeRow, today: string, locale: Locale) {
  const status = challengeStatus(c.startDate, c.endDate, today);
  return {
    id: c.id,
    groupId: c.teamId,
    title: c.title,
    goal: c.goal,
    goalLabel: goalText(c.goal, locale).label,
    rule: describeGoal(c.goal, c.target, locale),
    source: goalText(c.goal, locale).source,
    unit: goalText(c.goal, locale).unit,
    target: c.target,
    durationDays: c.durationDays,
    startDate: c.startDate,
    endDate: c.endDate,
    status,
    // 1-based day of the challenge; 0 before it starts, durationDays once ended.
    dayNumber:
      status === "upcoming"
        ? 0
        : status === "ended"
          ? c.durationDays
          : daysBetween(c.startDate, today) + 1,
    // Days after today; 0 on the last day. An upcoming challenge reports its full length.
    daysLeft:
      status === "ended"
        ? 0
        : status === "upcoming"
          ? c.durationDays
          : daysBetween(today, c.endDate),
    startsInDays: status === "upcoming" ? daysBetween(today, c.startDate) : 0,
  };
}

/**
 * Snapshot of a member's own daily targets, taken when they join: the same
 * eat-kcal budget the diary shows and the baseline (non-training-day) protein
 * target. Null when they have no profile yet, which blocks joining a goal that
 * is judged against a personal target.
 */
async function personalTargets(db: Database, userId: string, date: string) {
  const [[prof], [latest], weighIns, intake, exercise, prefRows] = await db.batch([
    ...planQueries(db, userId, date),
  ]);
  if (!prof) return null;
  const plan = buildPlan(
    prof,
    { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
    date,
  );
  return {
    eatKcal: Math.round(plan.targets.eatKcal),
    proteinG: proteinGoalG(plan, prof.heightCm),
  };
}

/** The target stored for a member row of `goal`; null when it cannot be derived. */
async function memberTarget(db: Database, goal: ChallengeRow["goal"], userId: string, date: string) {
  const spec = GOALS[goal];
  if (spec.targetKind === "fixed") return { ok: true as const, target: null };
  const targets = await personalTargets(db, userId, date);
  if (!targets) return { ok: false as const };
  return { ok: true as const, target: goal === "protein" ? targets.proteinG : targets.eatKcal };
}

type Member = { userId: string; fromDate: string; target: number | null };

/** Progress for each member against the challenge's rule, one facts query for all. */
async function loadBoard(db: Database, c: ChallengeRow, members: Member[], today: string) {
  const from = members.reduce((min, m) => (m.fromDate < min ? m.fromDate : min), c.endDate);
  const to = today < c.endDate ? today : c.endDate;
  const facts = await loadFacts(
    db,
    c.goal,
    members.map((m) => m.userId),
    from,
    to,
    c.target,
  );
  return members.map((m) => {
    const target = c.target ?? m.target;
    const factsByDate = facts.get(m.userId) ?? new Map<string, DayFacts>();
    const progress =
      target === null
        ? null
        : buildProgress({
            goal: c.goal,
            target,
            fromDate: m.fromDate,
            endDate: c.endDate,
            today,
            factsByDate,
          });
    return { member: m, target, progress, hasData: factsByDate.size > 0 };
  });
}

const challengeId = z.object({ challengeId: z.string().min(1) });

export const challengeRouter = {
  /** Challenges of one group, newest first; open ones plus recently ended. */
  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      const userId = context.session.user.id;
      const today = jakartaToday(undefined, await userZone(context));
      await requireTeamMember(db, input.groupId, userId, context.locale);

      const [userRow] = await db
        .select({ tier: user.tier, founderUntil: user.founderUntil })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const canHost = canHostChallenge(userRow, paywallConfig(context.env));

      const rows = await db
        .select({ challenge: teamChallenge, creatorName: user.name })
        .from(teamChallenge)
        .leftJoin(user, eq(user.id, teamChallenge.createdBy))
        .where(
          and(
            eq(teamChallenge.teamId, input.groupId),
            gte(teamChallenge.endDate, shiftDate(today, -ENDED_VISIBLE_DAYS)),
          ),
        )
        .orderBy(desc(teamChallenge.startDate), desc(teamChallenge.createdAt));
      const open = rows.filter((r) => r.challenge.endDate >= today);
      const ended = rows.filter((r) => r.challenge.endDate < today).slice(0, MAX_ENDED_LISTED);
      const shown = [...open, ...ended];
      if (shown.length === 0) return { canHost, maxOpen: MAX_OPEN_CHALLENGES, challenges: [] };

      const ids = shown.map((r) => r.challenge.id);
      const [counts, mine] = await Promise.all([
        db
          .select({ challengeId: teamChallengeMember.challengeId, total: count() })
          .from(teamChallengeMember)
          .where(inArray(teamChallengeMember.challengeId, ids))
          .groupBy(teamChallengeMember.challengeId),
        db
          .select()
          .from(teamChallengeMember)
          .where(
            and(
              inArray(teamChallengeMember.challengeId, ids),
              eq(teamChallengeMember.userId, userId),
            ),
          ),
      ]);
      const participants = new Map(counts.map((r) => [r.challengeId, r.total]));
      const myRow = new Map(mine.map((r) => [r.challengeId, r]));

      const challenges = await Promise.all(
        shown.map(async ({ challenge, creatorName }) => {
          const me = myRow.get(challenge.id);
          const [board] = me
            ? await loadBoard(
                db,
                challenge,
                [{ userId, fromDate: me.fromDate, target: me.target }],
                today,
              )
            : [];
          return {
            ...describeChallenge(challenge, today, context.locale),
            creatorName,
            participants: participants.get(challenge.id) ?? 0,
            joined: me !== undefined,
            hitDays: board?.progress?.hitDays ?? 0,
            judgedDays: board?.progress?.days.filter((d) => d.status !== "pending").length ?? 0,
            streak: board?.progress?.streak ?? 0,
          };
        }),
      );
      return { canHost, maxOpen: MAX_OPEN_CHALLENGES, challenges };
    }),

  /** Leaderboard, per-member daily progress and the viewer's share payload. */
  detail: protectedProcedure.input(challengeId).handler(async ({ context, input }) => {
    const db = context.db;
    const userId = context.session.user.id;
    const today = jakartaToday(undefined, await userZone(context));
    const { challenge: c, groupName, role } = await requireChallenge(
      db,
      input.challengeId,
      userId,
      context.locale,
    );
    const base = describeChallenge(c, today, context.locale);

    const rows = await db
      .select({
        userId: teamChallengeMember.userId,
        fromDate: teamChallengeMember.fromDate,
        target: teamChallengeMember.target,
        name: user.name,
        image: user.image,
      })
      .from(teamChallengeMember)
      .innerJoin(user, eq(user.id, teamChallengeMember.userId))
      .where(eq(teamChallengeMember.challengeId, c.id));
    const board = await loadBoard(db, c, rows, today);

    const food = c.goal === "protein" || c.goal === "calories";
    const entries = board.flatMap((b) => {
      const row = rows.find((r) => r.userId === b.member.userId);
      if (!row || !b.progress) return [];
      const isMe = row.userId === userId;
      // Diary numbers stay private to their owner; others see hit/miss and backing only.
      const days: DayResult[] = b.progress.days.map((d) =>
        food && !isMe ? { ...d, value: null } : d,
      );
      const judged = b.progress.days.filter((d) => d.status !== "pending").length;
      const today_ = days.find((d) => d.date === today);
      return [
        {
          userId: row.userId,
          name: row.name,
          image: row.image,
          isMe,
          fromDate: b.member.fromDate,
          target: isMe ? b.target : null,
          hitDays: b.progress.hitDays,
          missDays: b.progress.missDays,
          totalDays: b.progress.totalDays,
          judgedDays: judged,
          streak: b.progress.streak,
          bestStreak: b.progress.bestStreak,
          hitsByBasis: b.progress.hitsByBasis,
          todayStatus: today_?.status ?? null,
          todayValue: today_?.value ?? null,
          days,
          hasData: b.hasData,
        },
      ];
    });
    entries.sort(
      (a, b) =>
        compareRank(a, b) || Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, "id"),
    );
    const ranks = assignRanks(entries);
    const leaderboard = entries.map((e, i) => ({ ...e, rank: ranks[i] ?? i + 1 }));

    const me = leaderboard.find((e) => e.isMe) ?? null;
    const [creator] = c.createdBy
      ? await db.select({ name: user.name }).from(user).where(eq(user.id, c.createdBy)).limit(1)
      : [];
    const share: ChallengeShare | null = me
      ? {
          title: c.title,
          goal: c.goal,
          target: c.target ?? me.target,
          durationDays: c.durationDays,
          status: base.status,
          hitDays: me.hitDays,
          judgedDays: me.judgedDays,
          streak: me.streak,
          bestStreak: me.bestStreak,
          rank: me.rank,
          participants: leaderboard.length,
          hitsByBasis: me.hitsByBasis,
        }
      : null;

    return {
      today,
      challenge: {
        ...base,
        groupName,
        creatorName: creator?.name ?? null,
        // The host or the group owner may delete it.
        canDelete: c.createdBy === userId || role === "owner",
      },
      me: me
        ? {
            joined: true as const,
            fromDate: me.fromDate,
            target: me.target,
            // Device goals with no synced day yet: the client explains how to connect.
            deviceHint: !me.hasData ? goalText(c.goal, context.locale).deviceHint : null,
          }
        : {
            joined: false as const,
            fromDate: null,
            target: null,
            deviceHint: null,
          },
      canJoin: me === null && base.status !== "ended",
      leaderboard,
      share,
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        title: z.string().trim().max(CHALLENGE_TITLE_MAX).optional(),
        goal: z.enum(CHALLENGE_GOALS),
        target: z.number().finite().nullable().default(null),
        durationDays: z.number().int(),
        startDate: dateSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const db = context.db;
      const userId = context.session.user.id;
      const today = jakartaToday(undefined, await userZone(context));
      const t = serverT(context.locale, "challenge");

      // Founder gate first, on the server: the client's upsell is only a courtesy.
      const [userRow] = await db
        .select({ tier: user.tier, founderUntil: user.founderUntil })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!canHostChallenge(userRow, paywallConfig(context.env))) {
        throw new ORPCError("FORBIDDEN", {
          message: t("server.error.founderOnly"),
          data: { paywall: true, tier: "free", reason: "challenge" },
        });
      }
      await requireTeamMember(db, input.groupId, userId, context.locale);

      const startDate = input.startDate ?? today;
      const invalid = validateChallengeInput(
        {
          goal: input.goal,
          target: input.target,
          durationDays: input.durationDays,
          startDate,
        },
        today,
        context.locale,
      );
      if (invalid) throw new ORPCError("BAD_REQUEST", { message: invalid });

      const [open] = await db
        .select({ total: count() })
        .from(teamChallenge)
        .where(and(eq(teamChallenge.teamId, input.groupId), gte(teamChallenge.endDate, today)));
      if ((open?.total ?? 0) >= MAX_OPEN_CHALLENGES) {
        throw new ORPCError("BAD_REQUEST", {
          message: t("server.error.maxOpen", { max: MAX_OPEN_CHALLENGES }),
        });
      }

      const fromDate = memberFromDate(startDate, today);
      const mine = await memberTarget(db, input.goal, userId, today);
      if (!mine.ok) throw new ORPCError("BAD_REQUEST", { message: t("server.error.needsProfile") });

      const id = crypto.randomUUID();
      const target = GOALS[input.goal].targetKind === "fixed" ? input.target : null;
      await db.batch([
        db.insert(teamChallenge).values({
          id,
          teamId: input.groupId,
          createdBy: userId,
          title:
            input.title ||
            defaultChallengeTitle(input.goal, target, input.durationDays, context.locale),
          goal: input.goal,
          target,
          durationDays: input.durationDays,
          startDate,
          endDate: challengeEndDate(startDate, input.durationDays),
        }),
        db
          .insert(teamChallengeMember)
          .values({ challengeId: id, userId, fromDate, target: mine.target }),
      ]);
      const title =
        input.title || defaultChallengeTitle(input.goal, target, input.durationDays, context.locale);
      const [group, others] = await Promise.all([
        db.select({ name: team.name }).from(team).where(eq(team.id, input.groupId)).limit(1),
        db
          .select({ userId: teamMember.userId })
          .from(teamMember)
          .where(and(eq(teamMember.teamId, input.groupId), ne(teamMember.userId, userId))),
      ]);
      context.waitUntil(
        enqueueMany(
          { db, env: context.env },
          others.map((member) => member.userId),
          () => ({
            category: "group",
            kind: "challenge_new",
            title: { key: "notify.group.challengeNew.title", params: { group: group[0]?.name ?? "" } },
            body: { text: title },
            link: { t: "challenge", groupId: input.groupId, challengeId: id },
            dedupeKey: `challenge_new:${id}`,
          }),
        ).catch((error: unknown) => console.error("[push] challenge fan-out failed", error)),
      );
      return { id };
    }),

  /** Free users and Founders alike: anyone in the group may take part. */
  join: protectedProcedure.input(challengeId).handler(async ({ context, input }) => {
    const db = context.db;
    const userId = context.session.user.id;
    const today = jakartaToday(undefined, await userZone(context));
    const t = serverT(context.locale, "challenge");
    const { challenge: c } = await requireChallenge(db, input.challengeId, userId, context.locale);
    if (c.endDate < today) {
      throw new ORPCError("BAD_REQUEST", { message: t("server.error.ended") });
    }
    const [existing] = await db
      .select({ userId: teamChallengeMember.userId })
      .from(teamChallengeMember)
      .where(and(eq(teamChallengeMember.challengeId, c.id), eq(teamChallengeMember.userId, userId)))
      .limit(1);
    if (existing) return { ok: true };

    const mine = await memberTarget(db, c.goal, userId, today);
    if (!mine.ok) throw new ORPCError("BAD_REQUEST", { message: t("server.error.needsProfile") });
    await db
      .insert(teamChallengeMember)
      .values({
        challengeId: c.id,
        userId,
        fromDate: memberFromDate(c.startDate, today),
        target: mine.target,
      })
      .onConflictDoNothing();
    if (c.createdBy && c.createdBy !== userId) {
      notifyInBackground(context, c.createdBy, {
        category: "group",
        kind: "challenge_join",
        title: { key: "notify.group.challengeJoin.title", params: { name: context.session.user.name } },
        body: { text: c.title },
        link: { t: "challenge", groupId: c.teamId, challengeId: c.id },
        dedupeKey: `challenge_join:${c.id}:${userId}`,
      });
    }
    return { ok: true };
  }),

  leave: protectedProcedure.input(challengeId).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    await requireChallenge(context.db, input.challengeId, userId, context.locale);
    await context.db
      .delete(teamChallengeMember)
      .where(
        and(
          eq(teamChallengeMember.challengeId, input.challengeId),
          eq(teamChallengeMember.userId, userId),
        ),
      );
    return { ok: true };
  }),

  /** The host or the group owner removes a challenge for everyone. */
  remove: protectedProcedure.input(challengeId).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const t = serverT(context.locale, "challenge");
    const { challenge: c, role } = await requireChallenge(
      context.db,
      input.challengeId,
      userId,
      context.locale,
    );
    if (c.createdBy !== userId && role !== "owner") {
      throw new ORPCError("FORBIDDEN", {
        message: t("server.error.deleteForbidden"),
      });
    }
    await context.db.delete(teamChallenge).where(eq(teamChallenge.id, c.id));
    return { ok: true };
  }),
};
