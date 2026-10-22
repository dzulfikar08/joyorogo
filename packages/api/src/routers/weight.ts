import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { profile, weightLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { userZone } from "../lib/user-zone";
import { jakartaToday } from "../lib/engine";
import { isGainGap, paceBandKgPerWeek } from "../lib/gain";
import { maternalFromRow, weightGainChart } from "../lib/maternal";
import { gainedKg } from "../lib/plan";
import { IMPORT_EARLIEST_DAY } from "../lib/history-import";
import { dateSchema } from "../lib/schemas";

/** Most weigh-ins one `importHistory` call takes. */
const IMPORT_MAX = 100;

export const weightRouter = {
  /**
   * Past weigh-ins from another app (JoyoFit's Huawei Health import), each on its own day with `source: "huawei"`. Never
   * writes over a day that already has a weigh-in (the person's own entry or a scale reading wins), so one row per day stays, a second
   * import of the same file adds nothing, and a backdated weight cannot replace a newer one: every reader takes the
   * newest day, and an imported day is only ever a day with no row. Only days before today are taken; the streak counts
   * these rows out (`source = "huawei"`). Answers how many were added and how many days were already there or out of range.
   */
  importHistory: protectedProcedure
    .input(
      z.object({
        entries: z
          .array(
            z.object({
              date: dateSchema,
              weightKg: z.number().min(25).max(400),
              bodyFatPct: z.number().min(2).max(75).nullish(),
              musclePct: z.number().min(5).max(80).nullish(),
              waterPct: z.number().min(20).max(85).nullish(),
              boneKg: z.number().min(0.5).max(8).nullish(),
              visceralFat: z.number().min(1).max(60).nullish(),
              bmrKcal: z.number().min(500).max(5000).nullish(),
              proteinPct: z.number().min(2).max(40).nullish(),
            }),
          )
          .min(1)
          .max(IMPORT_MAX),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const today = jakartaToday(undefined, await userZone(context));
      const past = input.entries.filter((e) => e.date < today && e.date >= IMPORT_EARLIEST_DAY);
      // The last weigh-in of a day wins inside the file, like a scale's own pushes.
      const byDate = new Map(past.map((e) => [e.date, e]));
      let added = 0;
      for (const e of byDate.values()) {
        const { date, weightKg, ...body } = e;
        const given = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null));
        const rows = await context.db
          .insert(weightLog)
          .values({ id: crypto.randomUUID(), userId, date, weightKg, ...given, source: "huawei" })
          .onConflictDoNothing({ target: [weightLog.userId, weightLog.date] })
          .returning({ id: weightLog.id });
        added += rows.length;
      }
      return { added, skipped: input.entries.length - added };
    }),

  checkIn: protectedProcedure
    .input(
      z.object({
        weightKg: z.number().min(25).max(400),
        date: dateSchema.optional(),
        bodyFatPct: z.number().min(2).max(75).nullish(),
        musclePct: z.number().min(5).max(80).nullish(),
        waterPct: z.number().min(20).max(85).nullish(),
        boneKg: z.number().min(0.5).max(8).nullish(),
        visceralFat: z.number().min(1).max(60).nullish(),
        bmrKcal: z.number().min(500).max(5000).nullish(),
        proteinPct: z.number().min(2).max(40).nullish(),
        source: z.enum(["manual", "scale"]).default("manual"),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const { weightKg, date, source, ...body } = input;
      // Only the body fields actually sent are written; a manual re-entry on the same day leaves
      // earlier scale composition (and its source) untouched and only updates the weight.
      const given = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null));
      const hasBody = Object.keys(given).length > 0;
      const [row] = await context.db
        .insert(weightLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: date ?? jakartaToday(undefined, zone),
          weightKg,
          ...given,
          source: hasBody ? source : "manual",
        })
        .onConflictDoUpdate({
          target: [weightLog.userId, weightLog.date],
          set: { weightKg, ...given, ...(hasBody ? { source } : {}) },
        })
        .returning();
      return row;
    }),

  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(365).default(90) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const rows = await context.db
        .select()
        .from(weightLog)
        .where(eq(weightLog.userId, userId))
        .orderBy(desc(weightLog.date))
        .limit(input.limit);
      const entries = rows.toReversed();
      const first = entries[0];
      const latest = entries.at(-1);
      if (!first || !latest) {
        return {
          entries,
          summary: {
            startKg: null,
            latestKg: null,
            deltaKg: null,
            remainingKg: null,
            targetKg: null,
            gain: null,
          },
        };
      }
      const [prof] = await context.db
        .select()
        .from(profile)
        .where(eq(profile.userId, userId))
        .limit(1);
      const startKg = prof?.startWeightKg ?? first.weightKg;
      // Hamil / Menyusui have no weight target, so no "remaining" either.
      const target = prof && prof.maternalMode === "none" ? prof.targetWeightKg : null;
      // Naikin BB: the chart draws an upward target line from where the gain began and the weekly pace band.
      const gain =
        prof && target !== null && prof.goal === "gain" && isGainGap(target - latest.weightKg)
          ? {
              startKg: prof.goalStartKg ?? prof.startWeightKg,
              gainedKg: gainedKg(prof, latest.weightKg),
              toGoKg: Math.round((target - latest.weightKg) * 10) / 10,
              targetDate: prof.targetDate,
              pace: paceBandKgPerWeek(latest.weightKg, prof.heightCm),
            }
          : null;
      return {
        entries,
        summary: {
          startKg,
          latestKg: latest.weightKg,
          deltaKg: Math.round((latest.weightKg - startKg) * 10) / 10,
          remainingKg: target === null ? null : Math.round((latest.weightKg - target) * 10) / 10,
          targetKg: target,
          gain,
        },
      };
    }),

  /**
   * Hamil: the weekly weight-gain chart. IOM 2009 band for the pre-pregnancy BMI
   * against the gain since the pre-pregnancy weight, one point per weigh-in.
   * Null outside pregnancy (or before the pregnancy answers exist).
   */
  pregnancyChart: protectedProcedure.handler(async ({ context }) => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const [prof] = await context.db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
    if (!prof) return null;
    const maternal = maternalFromRow(prof);
    if (maternal.mode !== "pregnant" || !maternal.pregnancyLmp || maternal.prePregnancyWeightKg === null) {
      return null;
    }
    const weighIns = await context.db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(and(eq(weightLog.userId, userId), gte(weightLog.date, maternal.pregnancyLmp)));
    return weightGainChart({
      lmp: maternal.pregnancyLmp,
      prePregnancyWeightKg: maternal.prePregnancyWeightKg,
      heightCm: prof.heightCm,
      twins: maternal.twins,
      weighIns,
      today: jakartaToday(undefined, zone),
    });
  }),
};
