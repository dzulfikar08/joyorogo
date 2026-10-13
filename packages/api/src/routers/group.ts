import { ORPCError } from "@orpc/server";
import {
  and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, max, min, ne, sql,
} from "drizzle-orm";
import { z } from "zod";

import { session, user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";
import {
  dailyActivity,
  exerciseLog,
  foodLog,
  profile,
  sleepLog,
  waterLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { pushSubscription } from "@joyorogo/db/schema/plans";
import { team, teamMember, teamNudge } from "@joyorogo/db/schema/social";

import { protectedProcedure } from "../index";
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
import { buildPlan } from "../lib/plan";
import { dateSchema } from "../lib/schemas";
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

/** Loads the caller's membership; NOT_FOUND when they are not in the group. */
async function requireMember(db: Database, groupId: string, userId: string) {
  const row = await memberRow(db, groupId, userId);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Tim tidak ditemukan." });
  return row;
}

/** Fire-and-forget Web Push; dead endpoints (404/410) are deleted on the spot. */
function pushNudge(
  context: {
    db: Database;
    env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
    waitUntil: (promise: Promise<unknown>) => void;
  },
  toUserId: string,
  payload: { title: string; body: string },
) {
  context.waitUntil(
    (async () => {
      const subs = await context.db
        .select()
        .from(pushSubscription)
        .where(eq(pushSubscription.userId, toUserId));
      await Promise.all(
        subs.map(async (sub) => {
          const result = await sendPush(context.env, sub, payload);
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
          message: `Maksimal ${MAX_GROUPS} tim per akun.`,
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

  preview: protectedProcedure
    .input(z.object({ code: z.string().min(4).max(20) }))
    .handler(async ({ context, input }) => {
      const code = normalizeInviteCode(input.code);
      const [row] = await context.db
        .select({ id: team.id, name: team.name })
        .from(team)
        .where(eq(team.inviteCode, code))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Kode undangan tidak valid." });
      const [members] = await context.db
        .select({ total: count() })
        .from(teamMember)
        .where(eq(teamMember.teamId, row.id));
      const existing = await memberRow(context.db, row.id, context.session.user.id);
      return { name: row.name, memberCount: members?.total ?? 0, alreadyMember: existing !== null };
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
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Kode undangan tidak valid." });
      const existing = await memberRow(context.db, row.id, context.session.user.id);
      if (existing) return { groupId: row.id };
      const [members] = await context.db
        .select({ total: count() })
        .from(teamMember)
        .where(eq(teamMember.teamId, row.id));
      if ((members?.total ?? 0) >= MAX_MEMBERS) {
        throw new ORPCError("BAD_REQUEST", { message: "Tim ini sudah penuh." });
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
      const me = await requireMember(db, input.groupId, userId);
      const [team_] = await db
        .select({ ownerId: team.ownerId })
        .from(team)
        .where(eq(team.id, input.groupId))
        .limit(1);
      if (!team_) throw new ORPCError("NOT_FOUND", { message: "Tim tidak ditemukan." });

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
      const me = await requireMember(context.db, input.groupId, context.session.user.id);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: "Hanya pemilik tim." });
      }
      if (input.userId === context.session.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: "Gunakan keluar tim." });
      }
      await context.db
        .delete(teamMember)
        .where(and(eq(teamMember.teamId, input.groupId), eq(teamMember.userId, input.userId)));
      return { ok: true };
    }),

  rotateInvite: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .handler(async ({ context, input }) => {
      const me = await requireMember(context.db, input.groupId, context.session.user.id);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: "Hanya pemilik tim." });
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
      const me = await requireMember(context.db, input.groupId, context.session.user.id);
      if (me.role !== "owner") {
        throw new ORPCError("FORBIDDEN", { message: "Hanya pemilik tim." });
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
      await requireMember(context.db, input.groupId, context.session.user.id);
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
      await requireMember(db, input.groupId, context.session.user.id);

      const [group] = await db
        .select({ id: team.id, name: team.name, inviteCode: team.inviteCode })
        .from(team)
        .where(eq(team.id, input.groupId))
        .limit(1);
      if (!group) throw new ORPCError("NOT_FOUND", { message: "Tim tidak ditemukan." });

      const members = await db
        .select({
          userId: teamMember.userId,
          name: user.name,
          image: user.image,
          role: teamMember.role,
          joinedAt: teamMember.joinedAt,
          shareFood: teamMember.shareFood,
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
          .where(and(inArray(exerciseLog.userId, ids), eq(exerciseLog.date, date))),
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
      ]);

      const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
      const intakeDayByUser = new Map(intakeDay.map((r) => [r.userId, r]));
      const activityByUser = new Map(activityRows.map((r) => [r.userId, r]));
      const sleepByUser = new Map(sleepRows.map((r) => [r.userId, r]));
      const waterByUser = new Map(waterRows.map((r) => [r.userId, r]));
      const latestByUser = new Map(latestWeights.map((r) => [r.userId, r]));
      const baselineByUser = new Map(weekBaseline.map((r) => [r.userId, r]));
      const lastActiveByUser = new Map(lastActive.map((r) => [r.userId, r.at]));
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
      await requireMember(db, input.groupId, context.session.user.id);

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
        throw new ORPCError("BAD_REQUEST", { message: "Tidak bisa mencolek diri sendiri." });
      }
      await requireMember(db, input.groupId, fromUserId);
      const target = await memberRow(db, input.groupId, input.toUserId);
      if (!target) throw new ORPCError("NOT_FOUND", { message: "Teman tidak ada di tim ini." });

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
            message: "Colek lagi satu jam lagi, ya.",
          });
        }
      } else {
        if (input.message === undefined) {
          throw new ORPCError("BAD_REQUEST", { message: "Catatan tidak boleh kosong." });
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
          throw new ORPCError("BAD_REQUEST", { message: "Kuota catatan hari ini habis." });
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
      const senderName = sender?.name ?? "Teman";
      const title =
        input.kind === "poke"
          ? `👉 ${senderName} mencolekmu`
          : `📝 Catatan dari ${senderName}`;
      const body = input.message ?? "Semangat catat kalorinya hari ini!";
      pushNudge(context, input.toUserId, { title, body });
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
        })
        .from(teamNudge)
        .innerJoin(user, eq(teamNudge.fromUserId, user.id))
        .innerJoin(team, eq(teamNudge.teamId, team.id))
        .where(eq(teamNudge.toUserId, context.session.user.id))
        .orderBy(desc(teamNudge.createdAt))
        .limit(input.limit);
      return rows;
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
      await requireMember(db, input.groupId, context.session.user.id);
      const target = await memberRow(db, input.groupId, input.userId);
      if (!target) throw new ORPCError("NOT_FOUND", { message: "Teman tidak ada di tim ini." });

      const [targetUser] = await db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);

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
      };
    }),
};

