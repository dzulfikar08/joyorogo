import { ORPCError } from "@orpc/server";
import {
  and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, max, min, ne, sql,
} from "drizzle-orm";
import { z } from "zod";

import { session, user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";
import type { Locale, TFunction } from "@joyorogo/i18n";
import {
  aiUsage,
  dailyActivity,
  exerciseLog,
  foodLog,
  profile,
  sleepLog,
  varScan,
  waistLog,
  waterLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { pushSubscription } from "@joyorogo/db/schema/plans";
import { team, teamMember, teamNudge } from "@joyorogo/db/schema/social";

import { protectedProcedure, publicProcedure } from "../index";
import {
  computeBurn,
  jakartaToday,
  shiftDate,
  streakFromDates,
} from "../lib/engine";
import {
  newInviteCode,
  normalizeInviteCode,
  rateLimited,
  varVerdict,
} from "../lib/group";
import { leaveTeamChallenges } from "../lib/challenge-db";
import { serverT, userLocale } from "../lib/messages";
import { loadPublicGroupPreview, previewAllowed } from "../lib/group-preview";
import { requireAiQuota } from "../lib/quota";
import { buildPlan } from "../lib/plan";
import { dateSchema } from "../lib/schemas";
import {
  base64ToBytes,
  bytesToBase64,
  newScanId,
  varPhotoKey,
} from "../lib/sticker";
import { restoreVarVerdict, retryVarScan, varRetriesLeft } from "../lib/varretry";
import { analyzeVarPhotos } from "../lib/varscan";
import type { VarVerdict } from "../lib/varscan";
import { sendPush } from "../lib/webpush";

const MAX_MEMBERS = 20;
const MAX_GROUPS = 5;
const MAX_NOTES_PER_DAY = 20;
const POKE_WINDOW_MS = 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 7;
const STREAK_LOOKBACK_DAYS = 45;
const TREND_HISTORY_DAYS = 60;
/** One glass in the water tracker, in ml. */
const GLASS_ML = 250;

const nameSchema = z.string().trim().min(1).max(40);
const messageSchema = z.string().trim().min(1).max(140);

async function memberRow(db: Database, groupId: string, userId: string) {
  const [row] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, groupId), eq(teamMember.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Translator for the caller's language (API errors). */
function errT(context: { locale: Locale }) {
  return serverT(context.locale, "grup");
}

/** Loads the caller's membership; NOT_FOUND when they are not in the group. */
async function requireMember(db: Database, groupId: string, userId: string, locale: Locale) {
  const row = await memberRow(db, groupId, userId);
  if (!row) throw new ORPCError("NOT_FOUND", { message: serverT(locale, "grup")("server.error.notFound") });
  return row;
}

/**
 * Fire-and-forget Web Push; dead endpoints (404/410) are deleted on the spot.
 * The text is written in the RECIPIENT's language, not the sender's.
 */
function pushNudge(
  context: {
    db: Database;
    env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
    waitUntil: (promise: Promise<unknown>) => void;
  },
  toUserId: string,
  payload: (t: TFunction<"grup">) => { title: string; body: string },
) {
  context.waitUntil(
    (async () => {
      const subs = await context.db
        .select()
        .from(pushSubscription)
        .where(eq(pushSubscription.userId, toUserId));
      if (subs.length === 0) return;
      const message = payload(serverT(await userLocale(context.db, toUserId), "grup"));
      await Promise.all(
        subs.map(async (sub) => {
          const result = await sendPush(context.env, sub, message);
          if (result.status === 404 || result.status === 410) {
            await context.db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
          }
        }),
      );
    })().catch(() => {}),
  );
}

export const groupRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: team.id,
        name: team.name,
        inviteCode: team.inviteCode,
        role: teamMember.role,
      })
      .from(teamMember)
      .innerJoin(team, eq(teamMember.teamId, team.id))
      .where(eq(teamMember.userId, context.session.user.id));
    const counts = await context.db
      .select({ teamId: teamMember.teamId, total: count() })
      .from(teamMember)
      .where(inArray(teamMember.teamId, rows.map((row) => row.id)))
      .groupBy(teamMember.teamId);
    const countByTeam = new Map(counts.map((c) => [c.teamId, c.total]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      memberCount: countByTeam.get(row.id) ?? 0,
      inviteCode: row.inviteCode,
    }));
  }),

  create: protectedProcedure
    .input(z.object({ name: nameSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [mine] = await context.db
        .select({ total: count() })
        .from(teamMember)
        .where(eq(teamMember.userId, userId));
      if ((mine?.total ?? 0) >= MAX_GROUPS) {
        throw new ORPCError("BAD_REQUEST", {
          message: errT(context)("server.error.tooManyGroups", { max: MAX_GROUPS }),
        });
      }
      const teamId = crypto.randomUUID();
      await context.db.batch([
        context.db.insert(team).values({
          id: teamId,
          name: input.name,
          inviteCode: newInviteCode(),
          ownerId: userId,
        }),
        context.db.insert(teamMember).values({ teamId, userId, role: "owner" }),
      ]);
      const [row] = await context.db.select().from(team).where(eq(team.id, teamId)).limit(1);
      return row;
    }),

  /**
   * Invite preview. Public on purpose (a friend taps the link before they have
   * an account) and therefore rate limited per client; only name and member
   * count are exposed, see loadPublicGroupPreview.
   */
  preview: publicProcedure
    .input(z.object({ code: z.string().min(4).max(20) }))
    .handler(async ({ context, input }) => {
      if (!(await previewAllowed(context.env.INVITE_PREVIEW_LIMITER, context.clientIp))) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: errT(context)("server.error.tooManyAttempts"),
        });
      }
      const found = await loadPublicGroupPreview(context.db, input.code);
      if (!found) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.invalidCode") });
      const viewerId = context.session?.user.id;
      const existing = viewerId ? await memberRow(context.db, found.id, viewerId) : null;
      return {
        name: found.name,
        memberCount: found.memberCount,
        alreadyMember: existing !== null,
      };
    }),

  join: protectedProcedure
    .input(z.object({ code: z.string().min(4).max(20) }))
    .handler(async ({ context, input }) => {
      const code = normalizeInviteCode(input.code);
      const [row] = await context.db
        .select({ id: team.id })
        .from(team)
        .where(eq(team.inviteCode, code))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.invalidCode") });
      const existing = await memberRow(context.db, row.id, context.session.user.id);
      if (existing) return { groupId: row.id };
      const [members] = await context.db
        .select({ total: count() })
        .from(teamMember)
        .where(eq(teamMember.teamId, row.id));
      if ((members?.total ?? 0) >= MAX_MEMBERS) {
        throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.full") });
      }
      await context.db
        .insert(teamMember)
        .values({ teamId: row.id, userId: context.session.user.id });
      return { groupId: row.id };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      const userId = context.session.user.id;
      const me = await requireMember(db, input.groupId, userId, context.locale);
      await leaveTeamChallenges(db, input.groupId, userId);
      const [team_] = await db
        .select({ ownerId: team.ownerId })
        .from(team)
        .where(eq(team.id, input.groupId))
        .limit(1);
      if (!team_) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.notFound") });

      const rest = await db
        .select({ userId: teamMember.userId, joinedAt: teamMember.joinedAt })
        .from(teamMember)
        .where(and(eq(teamMember.teamId, input.groupId), ne(teamMember.userId, userId)))
        .orderBy(asc(teamMember.joinedAt));

      if (me.role === "owner") {
        if (rest.length === 0) {
          // Last member: the group goes with them.
          await db.delete(team).where(eq(team.id, input.groupId));
        } else {
          const heir = rest[0]!;
          await db.batch([
            db.update(team).set({ ownerId: heir.userId }).where(eq(team.id, input.groupId)),
            db.delete(teamMember).where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, userId))),
            db
              .update(teamMember)
              .set({ role: "owner" })
              .where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, heir.userId))),
          ]);
        }
      } else {
        await db
          .delete(teamMember)
          .where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, userId)));
      }
      return { ok: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ groupId: z.string(), userId: z.string() }))
    .handler(async ({ context, input }) => {
      const me = await requireMember(context.db, input.groupId, context.session.user.id, context.locale);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
      }
      if (input.userId === context.session.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.useLeave") });
      }
      await leaveTeamChallenges(context.db, input.groupId, input.userId);
      await context.db
        .delete(teamMember)
        .where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, input.userId)));
      return { ok: true };
    }),

  rotateInvite: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .handler(async ({ context, input }) => {
      const me = await requireMember(context.db, input.groupId, context.session.user.id, context.locale);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
      }
      const inviteCode = newInviteCode();
      await context.db
        .update(team)
        .set({ inviteCode })
        .where(eq(team.id, input.groupId));
      return { inviteCode };
    }),

  rename: protectedProcedure
    .input(z.object({ groupId: z.string(), name: nameSchema }))
    .handler(async ({ context, input }) => {
      const me = await requireMember(context.db, input.groupId, context.session.user.id, context.locale);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: errT(context)("server.error.ownerOnly") });
      }
      await context.db
        .update(team)
        .set({ name: input.name })
        .where(eq(team.id, input.groupId));
      return { ok: true };
    }),

  setShareFood: protectedProcedure
    .input(z.object({ groupId: z.string(), shareFood: z.boolean() }))
    .handler(async ({ context, input }) => {
      await requireMember(context.db, input.groupId, context.session.user.id, context.locale);
      await context.db
        .update(teamMember)
        .set({ shareFood: input.shareFood })
        .where(
          and(
            eq(teamMember.teamId, input.groupId),
            eq(teamMember.userId, context.session.user.id),
          ),
        );
      return { ok: true };
    }),

  detail: protectedProcedure
    .input(z.object({ groupId: z.string(), date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      const today = jakartaToday();
      const date = input.date ?? today;
      await requireMember(db, input.groupId, context.session.user.id, context.locale);

      const [group] = await db
        .select({ id: team.id, name: team.name, inviteCode: team.inviteCode })
        .from(team)
        .where(eq(team.id, input.groupId))
        .limit(1);
      if (!group) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.notFound") });

      const members = await db
        .select({
          userId: teamMember.userId,
          name: user.name,
          image: user.image,
          role: teamMember.role,
          joinedAt: teamMember.joinedAt,
          shareFood: teamMember.shareFood,
          shareVar: teamMember.shareVar,
        })
        .from(teamMember)
        .innerJoin(user, eq(teamMember.userId, user.id))
        .where(eq(teamMember.teamId, input.groupId))
        .orderBy(asc(teamMember.joinedAt));
      const ids = members.map((m) => m.userId);

      const streakStart = shiftDate(today, -STREAK_LOOKBACK_DAYS);
      const windowStart = shiftDate(date, -28);
      const [
        profiles,
        latestWeights,
        weekBaseline,
        intakeDay,
        intakeWindow,
        exerciseDay,
        exerciseWindow,
        weighIns,
        activityRows,
        sleepRows,
        waterRows,
        foodDates,
        lastActive,
        varRows,
      ] = await db.batch([
        db.select().from(profile).where(inArray(profile.userId, ids)),
        // Latest weigh-in ever (per member) via the group-by-max pattern.
        db
          .select({ userId: weightLog.userId, weightKg: weightLog.weightKg, date: max(weightLog.date) })
          .from(weightLog)
          .where(and(inArray(weightLog.userId, ids), lte(weightLog.date, date)))
          .groupBy(weightLog.userId),
        // Earliest weigh-in of the trailing 7 days, for the 7-day delta.
        db
          .select({ userId: weightLog.userId, weightKg: weightLog.weightKg, date: min(weightLog.date) })
          .from(weightLog)
          .where(
            and(
              inArray(weightLog.userId, ids),
              gte(weightLog.date, shiftDate(date, -7)),
              lte(weightLog.date, date),
            ),
          )
          .groupBy(weightLog.userId),
        db
          .select({
            userId: foodLog.userId,
            kcal: sql<number | null>`sum(${foodLog.kcal})`,
            meals: sql<number>`count(*)`,
          })
          .from(foodLog)
          .where(and(inArray(foodLog.userId, ids), eq(foodLog.date, date)))
          .groupBy(foodLog.userId),
        db
          .select({
            userId: foodLog.userId,
            date: foodLog.date,
            kcal: sql<number>`sum(${foodLog.kcal})`,
          })
          .from(foodLog)
          .where(
            and(
              inArray(foodLog.userId, ids),
              gte(foodLog.date, windowStart),
              lt(foodLog.date, date),
            ),
          )
          .groupBy(foodLog.userId, foodLog.date),
        db
          .select({ userId: exerciseLog.userId, kcal: exerciseLog.kcal, source: exerciseLog.source })
          .from(exerciseLog)
          .where(
            and(
              inArray(exerciseLog.userId, ids),
              eq(exerciseLog.date, date),
              // Strava API policy: Strava data is shown only to its owner.
              ne(exerciseLog.source, "strava"),
            ),
          ),
        db
          .select({
            userId: exerciseLog.userId,
            date: exerciseLog.date,
            kcal: sql<number>`sum(${exerciseLog.kcal})`,
          })
          .from(exerciseLog)
          .where(
            and(
              inArray(exerciseLog.userId, ids),
              gte(exerciseLog.date, windowStart),
              lt(exerciseLog.date, date),
              ne(exerciseLog.source, "rest"),
              ne(exerciseLog.source, "strava"),
            ),
          )
          .groupBy(exerciseLog.userId, exerciseLog.date),
        db
          .select({ userId: weightLog.userId, date: weightLog.date, weightKg: weightLog.weightKg })
          .from(weightLog)
          .where(
            and(
              inArray(weightLog.userId, ids),
              gte(weightLog.date, shiftDate(date, -TREND_HISTORY_DAYS)),
              lte(weightLog.date, date),
            ),
          )
          .orderBy(asc(weightLog.date)),
        db
          .select({ userId: dailyActivity.userId, exerciseMinutes: dailyActivity.exerciseMinutes })
          .from(dailyActivity)
          .where(and(inArray(dailyActivity.userId, ids), eq(dailyActivity.date, date))),
        db
          .select({ userId: sleepLog.userId, hours: sleepLog.hours })
          .from(sleepLog)
          .where(and(inArray(sleepLog.userId, ids), eq(sleepLog.date, shiftDate(date, -1)))),
        db
          .select({ userId: waterLog.userId, glasses: waterLog.glasses })
          .from(waterLog)
          .where(and(inArray(waterLog.userId, ids), eq(waterLog.date, date))),
        db
          .selectDistinct({ userId: foodLog.userId, date: foodLog.date })
          .from(foodLog)
          .where(and(inArray(foodLog.userId, ids), gte(foodLog.date, streakStart))),
        db
          .select({ userId: session.userId, at: max(session.updatedAt) })
          .from(session)
          .where(inArray(session.userId, ids))
          .groupBy(session.userId),
        // Latest VAR perut scan per member. Bare columns ride the max() row
        // (SQLite group-by-max, same trick as food.recent). Only rows of
        // members who share their verdict with this team are exposed here;
        // a member always sees their own through varHistory instead.
        db
          .select({
            userId: teamMember.userId,
            verdict: varScan.verdict,
            date: varScan.date,
            at: max(varScan.createdAt),
          })
          .from(varScan)
          .innerJoin(
            teamMember,
            and(eq(teamMember.userId, varScan.userId), eq(teamMember.teamId, input.groupId)),
          )
          .where(and(inArray(varScan.userId, ids), eq(teamMember.shareVar, true)))
          .groupBy(varScan.userId),
      ]);

      const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
      const intakeDayByUser = new Map(intakeDay.map((r) => [r.userId, r]));
      const activityByUser = new Map(activityRows.map((r) => [r.userId, r]));
      const sleepByUser = new Map(sleepRows.map((r) => [r.userId, r]));
      const waterByUser = new Map(waterRows.map((r) => [r.userId, r]));
      const latestByUser = new Map(latestWeights.map((r) => [r.userId, r]));
      const baselineByUser = new Map(weekBaseline.map((r) => [r.userId, r]));
      const lastActiveByUser = new Map(lastActive.map((r) => [r.userId, r.at]));
      const varStatusByUser = new Map(
        varRows.map((r) => [r.userId, { verdict: r.verdict as VarVerdict, date: r.date }]),
      );
      const foodDatesByUser = new Map<string, string[]>();
      for (const row of foodDates) {
        const list = foodDatesByUser.get(row.userId) ?? [];
        list.push(row.date);
        foodDatesByUser.set(row.userId, list);
      }
      const weighInsByUser = new Map<string, { date: string; weightKg: number }[]>();
      for (const row of weighIns) {
        const list = weighInsByUser.get(row.userId) ?? [];
        list.push({ date: row.date, weightKg: row.weightKg });
        weighInsByUser.set(row.userId, list);
      }

      return {
        group,
        members: members.map((m) => {
          const prof = profileByUser.get(m.userId);
          const latest = latestByUser.get(m.userId);
          const baseline = baselineByUser.get(m.userId);
          const dayIntake = intakeDayByUser.get(m.userId);
          const eatenKcal = Math.round(dayIntake?.kcal ?? 0);

          let eatTargetKcal: number | null = null;
          let burnTargetKcal: number | null = null;
          let burnedKcal = 0;
          if (prof) {
            const plan = buildPlan(
              prof,
              {
                latestWeightKg: latest?.weightKg ?? null,
                weighIns: weighInsByUser.get(m.userId) ?? [],
                intake: intakeWindow
                  .filter((r) => r.userId === m.userId)
                  .map((r) => ({ date: r.date, kcal: r.kcal })),
                exercise: exerciseWindow
                  .filter((r) => r.userId === m.userId)
                  .map((r) => ({ date: r.date, kcal: r.kcal })),
              },
              date,
            );
            const burn = computeBurn({
              profile: plan.profileInput,
              weightNowKg: plan.weightNowKg,
              exerciseLogs: exerciseDay.filter((r) => r.userId === m.userId),
              tdeeKcal: plan.targets.tdee,
              // past days are complete; today prorates by the live WIB clock
              ...(date === today ? {} : { dayFraction: 1 }),
            });
            eatTargetKcal = Math.round(plan.targets.eatKcal);
            burnTargetKcal = Math.round(plan.targets.tdee);
            burnedKcal = Math.round(burn.exerciseKcal);
          }

          const weightNow = latest?.weightKg ?? null;
          const weightDeltaKg7d =
            weightNow !== null && baseline && baseline.date !== latest?.date
              ? Math.round((weightNow - baseline.weightKg) * 10) / 10
              : null;

          return {
            userId: m.userId,
            name: m.name,
            image: m.image,
            role: m.role,
            joinedAt: m.joinedAt,
            shareFood: m.shareFood,
            shareVar: m.shareVar,
            // Verdict+tanggal VAR perut terakhir; foto tidak pernah ikut.
            varStatus: varStatusByUser.get(m.userId) ?? null,
            lastActiveAt: lastActiveByUser.get(m.userId) ?? null,
            today: {
              eatenKcal,
              eatTargetKcal,
              burnedKcal,
              burnTargetKcal,
              mealsLogged: dayIntake?.meals ?? 0,
              exerciseMinutes: activityByUser.get(m.userId)?.exerciseMinutes ?? null,
              sleepMinutes: Math.round((sleepByUser.get(m.userId)?.hours ?? 0) * 60) || null,
              waterMl: (waterByUser.get(m.userId)?.glasses ?? 0) * GLASS_ML || null,
              weightKg: weightNow,
              weightDeltaKg7d,
            },
            streakDays: streakFromDates(foodDatesByUser.get(m.userId) ?? [], today),
          };
        }),
      };
    }),

  activity: protectedProcedure
    .input(z.object({ groupId: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      await requireMember(db, input.groupId, context.session.user.id, context.locale);

      const memberRows = await db
        .select({ userId: teamMember.userId, shareFood: teamMember.shareFood })
        .from(teamMember)
        .where(eq(teamMember.teamId, input.groupId));
      const ids = memberRows.map((m) => m.userId);
      const shareByUser = new Map(memberRows.map((m) => [m.userId, m.shareFood]));
      const names = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, ids));
      const nameByUser = new Map(names.map((n) => [n.id, n.name]));

      const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000);
      const weekStart = shiftDate(jakartaToday(), -(ACTIVITY_WINDOW_DAYS - 1));
      const [foods, exercises, weights] = await db.batch([
        db
          .select({
            userId: foodLog.userId,
            name: foodLog.name,
            meal: foodLog.meal,
            kcal: foodLog.kcal,
            at: foodLog.createdAt,
          })
          .from(foodLog)
          .where(and(inArray(foodLog.userId, ids), gte(foodLog.date, weekStart)))
          .orderBy(desc(foodLog.createdAt))
          .limit(input.limit),
        db
          .select({
            userId: exerciseLog.userId,
            name: exerciseLog.name,
            minutes: exerciseLog.durationMin,
            kcal: exerciseLog.kcal,
            at: exerciseLog.createdAt,
          })
          .from(exerciseLog)
          .where(
            and(
              inArray(exerciseLog.userId, ids),
              gte(exerciseLog.date, weekStart),
              gte(exerciseLog.createdAt, since),
              // Strava API policy: never in the group feed.
              ne(exerciseLog.source, "strava"),
            ),
          )
          .orderBy(desc(exerciseLog.createdAt))
          .limit(input.limit),
        db
          .select({ userId: weightLog.userId, kg: weightLog.weightKg, at: weightLog.createdAt })
          .from(weightLog)
          .where(
            and(
              inArray(weightLog.userId, ids),
              gte(weightLog.date, weekStart),
              gte(weightLog.createdAt, since),
            ),
          )
          .orderBy(desc(weightLog.createdAt))
          .limit(input.limit),
      ]);

      type Event =
        | { type: "food"; userId: string; name: string | null; meal: string; kcal: number; at: Date }
        | { type: "exercise"; userId: string; name: string | null; minutes: number | null; kcal: number; at: Date }
        | { type: "weight"; userId: string; kg: number; at: Date };
      const events: Event[] = [
        ...foods.map((f): Event => ({
          type: "food",
          userId: f.userId,
          name: shareByUser.get(f.userId) ? f.name : null,
          meal: f.meal,
          kcal: f.kcal,
          at: f.at,
        })),
        ...exercises.map((e): Event => ({
          type: "exercise",
          userId: e.userId,
          name: e.name,
          minutes: e.minutes,
          kcal: e.kcal,
          at: e.at,
        })),
        ...weights.map((w): Event => ({ type: "weight", userId: w.userId, kg: w.kg, at: w.at })),
      ];
      events.sort((a, b) => b.at.getTime() - a.at.getTime());

      return events.slice(0, input.limit).map((e) => ({ ...e, userName: nameByUser.get(e.userId) ?? null }));
    }),

  nudge: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        toUserId: z.string(),
        kind: z.enum(["poke", "note"]),
        message: messageSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const db = context.db;
      const fromUserId = context.session.user.id;
      if (input.toUserId === fromUserId) {
        throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.pokeSelf") });
      }
      await requireMember(db, input.groupId, fromUserId, context.locale);
      const target = await memberRow(db, input.groupId, input.toUserId);
      if (!target) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.notInGroup") });

      const now = Date.now();
      if (input.kind === "poke") {
        const [last] = await db
          .select({ at: teamNudge.createdAt })
          .from(teamNudge)
          .where(
            and(
              eq(teamNudge.fromUserId, fromUserId),
              eq(teamNudge.toUserId, input.toUserId),
              eq(teamNudge.kind, "poke"),
            ),
          )
          .orderBy(desc(teamNudge.createdAt))
          .limit(1);
        if (rateLimited(last?.at?.getTime() ?? null, now, POKE_WINDOW_MS)) {
          throw new ORPCError("BAD_REQUEST", {
            message: errT(context)("server.error.pokeLimit"),
          });
        }
      } else {
        if (input.message === undefined) {
          throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.noteEmpty") });
        }
        const dayStart = new Date(`${jakartaToday()}T00:00:00+07:00`).getTime();
        const [sent] = await db
          .select({ total: count() })
          .from(teamNudge)
          .where(
            and(
              eq(teamNudge.fromUserId, fromUserId),
              eq(teamNudge.kind, "note"),
              gte(teamNudge.createdAt, new Date(dayStart)),
            ),
          );
        if ((sent?.total ?? 0) >= MAX_NOTES_PER_DAY) {
          throw new ORPCError("BAD_REQUEST", { message: errT(context)("server.error.noteQuota") });
        }
      }

      await db.insert(teamNudge).values({
        id: crypto.randomUUID(),
        teamId: input.groupId,
        fromUserId,
        toUserId: input.toUserId,
        kind: input.kind,
        message: input.message ?? null,
      });

      const [sender] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, fromUserId))
        .limit(1);
      const senderName = sender?.name;
      pushNudge(context, input.toUserId, (t) => {
        const name = senderName ?? t("server.push.friend");
        return {
          title: input.kind === "poke" ? t("server.push.pokeTitle", { name }) : t("server.push.noteTitle", { name }),
          body: input.message ?? t("server.push.defaultBody"),
        };
      });
      return { ok: true };
    }),

  inbox: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          id: teamNudge.id,
          kind: teamNudge.kind,
          message: teamNudge.message,
          createdAt: teamNudge.createdAt,
          readAt: teamNudge.readAt,
          groupId: teamNudge.teamId,
          groupName: team.name,
          senderId: teamNudge.fromUserId,
          senderName: user.name,
          senderImage: user.image,
          senderJoinedAt: teamMember.joinedAt,
        })
        .from(teamNudge)
        .innerJoin(user, eq(teamNudge.fromUserId, user.id))
        .innerJoin(team, eq(teamNudge.teamId, team.id))
        .leftJoin(
          teamMember,
          and(eq(teamMember.teamId, teamNudge.teamId), eq(teamMember.userId, teamNudge.fromUserId)),
        )
        .where(eq(teamNudge.toUserId, context.session.user.id))
        .orderBy(desc(teamNudge.createdAt))
        .limit(input.limit);
      return rows.map(({ senderJoinedAt, ...row }) => ({
        ...row,
        senderInGroup: senderJoinedAt !== null,
      }));
    }),

  unreadCount: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .select({ total: count() })
      .from(teamNudge)
      .where(and(eq(teamNudge.toUserId, context.session.user.id), isNull(teamNudge.readAt)));
    return { count: row?.total ?? 0 };
  }),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).optional() }))
    .handler(async ({ context, input }) => {
      const filters = input.ids?.length
        ? and(eq(teamNudge.toUserId, context.session.user.id), inArray(teamNudge.id, input.ids))
        : eq(teamNudge.toUserId, context.session.user.id);
      await context.db
        .update(teamNudge)
        .set({ readAt: new Date() })
        .where(filters);
      return { ok: true };
    }),

  varScan: protectedProcedure
    .input(z.object({ groupId: z.string(), userId: z.string(), date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      const date = input.date ?? jakartaToday();
      await requireMember(db, input.groupId, context.session.user.id, context.locale);
      const target = await memberRow(db, input.groupId, input.userId);
      if (!target) throw new ORPCError("NOT_FOUND", { message: errT(context)("server.error.notInGroup") });

      const [targetUser] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);

      // The friend's latest VAR perut verdict — only when they share it with
      // this team. The photo never leaves their own /var-photo route.
      const [targetVar] = target.shareVar
        ? await db
            .select({ verdict: varScan.verdict, date: varScan.date })
            .from(varScan)
            .where(eq(varScan.userId, input.userId))
            .orderBy(desc(varScan.createdAt))
            .limit(1)
        : [];

      const rows = await db
        .select({
          userId: foodLog.userId,
          meal: foodLog.meal,
          kcal: sql<number | null>`sum(${foodLog.kcal})`,
        })
        .from(foodLog)
        .where(and(eq(foodLog.userId, input.userId), eq(foodLog.date, date)))
        .groupBy(foodLog.userId);

      const eatenKcal = Math.round(rows[0]?.kcal ?? 0);
      const mealsLogged = rows.length > 0 ? 1 : 0;

      // Target from the same plan math as the member's own Beranda.
      let eatTargetKcal: number | null = null;
      const [prof] = await db
        .select()
        .from(profile)
        .where(eq(profile.userId, input.userId))
        .limit(1);
      if (prof) {
        const latest = await db
          .select({ weightKg: weightLog.weightKg })
          .from(weightLog)
          .where(and(eq(weightLog.userId, input.userId), lte(weightLog.date, date)))
          .orderBy(desc(weightLog.date))
          .limit(1);
        const plan = buildPlan(
          prof,
          { latestWeightKg: latest[0]?.weightKg ?? null, weighIns: [], intake: [], exercise: [] },
          date,
        );
        eatTargetKcal = Math.round(plan.targets.eatKcal);
      }

      const foods = target.shareFood
        ? (
            await db
              .select({
                name: foodLog.name,
                kcal: foodLog.kcal,
                meal: foodLog.meal,
                scanId: foodLog.scanId,
              })
              .from(foodLog)
              .where(and(eq(foodLog.userId, input.userId), eq(foodLog.date, date)))
              .orderBy(asc(foodLog.createdAt))
          ).map((f) => ({
            name: f.name,
            kcal: f.kcal,
            meal: f.meal,
            // Dish stickers are public capability URLs; originals stay private.
            photoUrl: f.scanId ? `/sticker/${f.scanId}` : null,
          }))
        : [];

      return {
        userId: input.userId,
        name: targetUser?.name ?? null,
        image: targetUser?.image ?? null,
        eatenKcal,
        eatTargetKcal,
        verdict: varVerdict(eatenKcal, eatTargetKcal, mealsLogged),
        hidden: !target.shareFood,
        foods,
        varStatus: targetVar ?? null,
      };
    }),

  // --- VAR perut (diri sendiri): foto perut, AI bandingkan dengan scan lalu --

  /** Own scans oldest first, plus the share toggle state and the latest waist tape entry. */
  varHistory: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .handler(async ({ context, input }) => {
      const db = context.db;
      const userId = context.session.user.id;
      await requireMember(db, input.groupId, userId, context.locale);
      const [rows, [membership], waistRows] = await Promise.all([
        db
          .select()
          .from(varScan)
          .where(eq(varScan.userId, userId))
          .orderBy(asc(varScan.createdAt))
          .limit(60),
        db
          .select({ shareVar: teamMember.shareVar })
          .from(teamMember)
          .where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, userId)))
          .limit(1),
        db
          .select({ date: waistLog.date, waistCm: waistLog.waistCm })
          .from(waistLog)
          .where(eq(waistLog.userId, userId))
          .orderBy(desc(waistLog.date))
          .limit(60),
      ]);
      const firstWaist = waistRows.at(-1);
      const latestWaist = waistRows[0];
      return {
        scans: rows.map((row, index) => ({
          id: row.id,
          date: row.date,
          verdict: row.verdict,
          confidence: row.confidence,
          note: row.note,
          waistCm: row.waistCm,
          photoUrl: `/var-photo/${row.photoId}`,
          createdAt: row.createdAt,
          // Only a scan with an earlier one to compare against can be recounted.
          retriesLeft: index > 0 ? varRetriesLeft(row.retries) : 0,
        })),
        shareVar: membership?.shareVar ?? false,
        latestWaist:
          latestWaist !== undefined
            ? {
                ...latestWaist,
                deltaCm:
                  firstWaist !== undefined && firstWaist !== latestWaist
                    ? Math.round((latestWaist.waistCm - firstWaist.waistCm) * 10) / 10
                    : null,
              }
            : null,
      };
    }),

  /**
   * Captures a new belly scan: stores the photo privately, compares it with
   * the previous scan through the vision model, and stores the verdict.
   * A first scan is a free baseline (no comparison possible, no AI call).
   * Photos only persist for successful scans — a failed scan keeps nothing.
   */
  varAnalyze: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        // Clients send ≤1024 px JPEGs (~0.2–0.5 MB base64); 8 MB caps abuse.
        imageBase64: z.base64().min(50).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const db = context.db;
      const userId = context.session.user.id;
      const tVar = serverT(context.locale, "varperut");
      await requireMember(db, input.groupId, userId, context.locale);
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: serverT(context.locale, "errors")("ai.storageUnavailable"),
        });
      }
      const date = jakartaToday();

      // Objective signal first: the tape entry of the same WIB day rides
      // along in the DB row and in the AI prompt (meteran, bukan tebakan).
      const [waistToday] = await db
        .select({ waistCm: waistLog.waistCm })
        .from(waistLog)
        .where(and(eq(waistLog.userId, userId), eq(waistLog.date, date)))
        .limit(1);

      const [previous] = await db
        .select()
        .from(varScan)
        .where(eq(varScan.userId, userId))
        .orderBy(desc(varScan.createdAt))
        .limit(1);
      const previousPhoto =
        previous !== undefined ? await bucket.get(varPhotoKey(userId, previous.photoId)) : null;

      const startedAt = Date.now();
      let verdict: VarVerdict = "pertama";
      let confidence = 1;
      let note = tVar("errors.firstScanNote");
      let quotaReached = false;
      if (previous && previousPhoto) {
        // Quota only for scans that actually call the model.
        const { ai, quotaReached: reached } = await requireAiQuota(
          db,
          context.env,
          userId,
          context.locale,
        );
        quotaReached = reached;
        const previousLabel = `scan ${previous.date}`;
        let analysis;
        try {
          analysis = await analyzeVarPhotos(ai, {
            previous: {
              imageBase64: bytesToBase64(await previousPhoto.arrayBuffer()),
              label: previousLabel,
            },
            current: {
              imageBase64: input.imageBase64,
              mimeType: input.mimeType,
              label: `hari ini (${date})`,
            },
            // The tape measure is the objective signal; the photo is the feel.
            waistCm: waistToday?.waistCm ?? previous.waistCm,
            model: context.env.AI_VISION_MODEL || undefined,
            locale: context.locale,
          });
        } catch (error) {
          throw new ORPCError("UNPROCESSABLE_CONTENT", {
            message: error instanceof Error ? error.message : tVar("errors.analyzeFailed"),
          });
        }
        verdict = analysis.verdict;
        confidence = analysis.confidence;
        note = analysis.reason;
        await context.db.insert(aiUsage).values({
          id: crypto.randomUUID(),
          userId,
          model: analysis.model,
          scanType: "user",
          latencyMs: Date.now() - startedAt,
          usageJson: JSON.stringify({ kind: "var", ...analysis.usage }),
        });
      }

      // Store only successful scans: the photo key is unguessable and the
      // serving route checks the session, so nothing leaks on failure.
      const photoId = newScanId();
      try {
        await bucket.put(varPhotoKey(userId, photoId), base64ToBytes(input.imageBase64), {
          httpMetadata: { contentType: input.mimeType },
        });
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: tVar("errors.saveFailed"),
        });
      }
      const [row] = await db
        .insert(varScan)
        .values({
          id: crypto.randomUUID(),
          userId,
          date,
          photoId,
          verdict,
          confidence,
          note,
          waistCm: waistToday?.waistCm ?? null,
        })
        .returning();
      return { scan: row, previousDate: previous?.date ?? null, quotaReached };
    }),

  /** Deletes one own scan together with its private photo. */
  varDelete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .delete(varScan)
        .where(and(eq(varScan.id, input.id), eq(varScan.userId, context.session.user.id)))
        .returning({ photoId: varScan.photoId });
      if (row) {
        try {
          await context.env.STICKERS?.delete(varPhotoKey(context.session.user.id, row.photoId));
        } catch {
          // orphaned objects are harmless; never block the delete
        }
      }
      return { ok: true };
    }),

  /**
   * "Hitung ulang": re-runs the comparison on the SAME stored photos and
   * overwrites this scan's verdict. Free (no daily scan), capped per scan and
   * enforced in SQL (lib/varretry.ts). Teammates see the new verdict through
   * the same row, so a shared scan updates with no extra write.
   */
  varRetry: protectedProcedure
    .input(z.object({ id: z.string(), hint: z.string().trim().min(1).max(200).optional() }))
    .handler(async ({ context, input }) => {
      const ai = context.env.AI;
      const bucket = context.env.STICKERS;
      if (!ai) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: serverT(context.locale, "errors")("ai.unavailable"),
        });
      }
      if (!bucket) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: serverT(context.locale, "errors")("ai.storageUnavailable"),
        });
      }
      return retryVarScan(
        { db: context.db, bucket, ai, model: context.env.AI_VISION_MODEL },
        { userId: context.session.user.id, id: input.id, hint: input.hint, locale: context.locale },
      );
    }),

  /** Undo for varRetry: puts the previous verdict back (the used retry stays spent). */
  varRestore: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        verdict: z.enum(["pertama", "turun", "sama", "naik", "beda"]),
        confidence: z.number().min(0).max(1).nullable(),
        note: z.string().max(300).nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      await restoreVarVerdict(context.db, context.session.user.id, input.id, {
        verdict: input.verdict,
        confidence: input.confidence,
        note: input.note,
      }, context.locale);
      return { ok: true };
    }),

  /** Per-team opt-in: share VAR verdicts (never photos) with this group. */
  varSetShare: protectedProcedure
    .input(z.object({ groupId: z.string(), shareVar: z.boolean() }))
    .handler(async ({ context, input }) => {
      await requireMember(context.db, input.groupId, context.session.user.id, context.locale);
      await context.db
        .update(teamMember)
        .set({ shareVar: input.shareVar })
        .where(
          and(
            eq(teamMember.teamId, input.groupId),
            eq(teamMember.userId, context.session.user.id),
          ),
        );
      return { ok: true };
    }),
};

