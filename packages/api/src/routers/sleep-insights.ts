import { ORPCError } from "@orpc/server";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import { sleepInsightPref, sleepNight } from "@joyorogo/db/schema/sleep-insights";
import { isLocale } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
import { premiumUnlocked } from "../lib/readiness-food";
import { dateSchema } from "../lib/schemas";
import { deleteSleepData, readPref, trimNights } from "../lib/sleep-insights-store";
import { SLEEP_CONSENT_VERSION, SLEEP_MAX_NIGHTS_PER_PUSH, SLEEP_RETENTION_NIGHTS } from "../lib/sleep-insights-types";
import type { SleepInsightsStatus } from "../lib/sleep-insights-types";
import { buildSleepView } from "../lib/sleep-insights-view";
import { paywallConfig } from "../lib/tiers";

const HOUR_S = 3600;

const wakeDateSchema = dateSchema.refine((date) => {
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  const today = jakartaToday();
  return date <= shiftDate(today, 1) && date >= shiftDate(today, -SLEEP_RETENTION_NIGHTS);
}, `Wake date must be a real day between ${SLEEP_RETENTION_NIGHTS} days ago and tomorrow`);

const napSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([s, e]) => s < e, "nap start before end");

const envSchema = z.object({
  tempCMean: z.number().min(-20).max(60),
  tempCMin: z.number().min(-20).max(60),
  tempCMax: z.number().min(-20).max(60),
  rhPctMean: z.number().min(0).max(100),
  rhPctMin: z.number().min(0).max(100),
  rhPctMax: z.number().min(0).max(100),
  samples: z.number().int().min(1).max(5000),
  source: z.enum(["lywsd03mmc"]),
});

/** One night as JoyoFit sends it; a full snapshot of the row. */
export const nightInput = z
  .object({
    wakeDate: wakeDateSchema,
    onsetMs: z.number().int().positive(),
    wakeMs: z.number().int().positive(),
    tzOffsetMin: z.number().int().min(-840).max(840),
    asleepS: z.number().int().min(1).max(20 * HOUR_S),
    awakeS: z.number().int().min(0).max(20 * HOUR_S),
    awakenings: z.number().int().min(0).max(500),
    hasStages: z.boolean(),
    deepS: z.number().int().min(0).max(20 * HOUR_S).nullish(),
    remS: z.number().int().min(0).max(20 * HOUR_S).nullish(),
    lightS: z.number().int().min(0).max(20 * HOUR_S).nullish(),
    watchScore: z.number().int().min(0).max(100).nullish(),
    hrvMs: z.number().min(1).max(500).nullish(),
    rhrBpm: z.number().int().min(25).max(220).nullish(),
    naps: z.array(napSchema).max(4).default([]),
    env: envSchema.nullish(),
  })
  .refine((n) => n.onsetMs < n.wakeMs, "onset before wake")
  .refine((n) => {
    const inBedS = (n.wakeMs - n.onsetMs) / 1000;
    return inBedS >= HOUR_S && inBedS <= 20 * HOUR_S && n.asleepS <= inBedS + 60 && n.awakeS <= inBedS + 60;
  }, "night must last 1 to 20 hours and asleep time must fit in bed");

export const SLEEP_FREE_DAYS_MAX = 127;

export const sleepInsightsRouter = {
  status: protectedProcedure.handler(async ({ context }): Promise<SleepInsightsStatus> => {
    return statusOf(context.db, context.session.user.id);
  }),

  /** Enabling stores consent for the current text version; disabling deletes every stored night, the cache and the dismissals. */
  setConsent: protectedProcedure
    .input(z.object({ enabled: z.boolean(), version: z.number().int() }))
    .handler(async ({ context, input }): Promise<SleepInsightsStatus> => {
      const userId = context.session.user.id;
      if (input.enabled) {
        if (input.version !== SLEEP_CONSENT_VERSION) {
          throw new ORPCError("BAD_REQUEST", { message: "consent_version_mismatch" });
        }
        await context.db
          .insert(sleepInsightPref)
          .values({ userId, enabled: true, consentVersion: input.version, consentedAt: Date.now() })
          .onConflictDoUpdate({
            target: sleepInsightPref.userId,
            set: { enabled: true, consentVersion: input.version, consentedAt: Date.now() },
          });
      } else {
        await context.db.batch([
          ...deleteSleepData(context.db, userId),
          context.db
            .insert(sleepInsightPref)
            .values({ userId, enabled: false })
            .onConflictDoUpdate({ target: sleepInsightPref.userId, set: { enabled: false, consentedAt: null, dismissedJson: [] } }),
        ]);
      }
      return statusOf(context.db, userId);
    }),

  setFreeDays: protectedProcedure
    .input(z.object({ mask: z.number().int().min(0).max(SLEEP_FREE_DAYS_MAX) }))
    .handler(async ({ context, input }): Promise<SleepInsightsStatus> => {
      const userId = context.session.user.id;
      await context.db
        .insert(sleepInsightPref)
        .values({ userId, freeDaysMask: input.mask })
        .onConflictDoUpdate({ target: sleepInsightPref.userId, set: { freeDaysMask: input.mask } });
      return statusOf(context.db, userId);
    }),

  /**
   * JoyoFit pushes its last nights. Refused without consent, so a buggy client cannot upload. Each night is a full
   * snapshot replacing the row; a batch repeating a date: the last wins. Nights beyond 90 are trimmed.
   */
  upsertNights: protectedProcedure
    .input(z.object({ nights: z.array(nightInput).min(1).max(SLEEP_MAX_NIGHTS_PER_PUSH) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const pref = await readPref(context.db, userId);
      if (!pref.enabled) throw new ORPCError("FORBIDDEN", { message: "consent_required" });
      const byDate = new Map(input.nights.map((n) => [n.wakeDate, n]));
      const now = Date.now();
      const statements = [...byDate.values()].map((n) => {
        const staged = n.hasStages;
        const values = {
          userId,
          wakeDate: n.wakeDate,
          onsetMs: n.onsetMs,
          wakeMs: n.wakeMs,
          tzOffsetMin: n.tzOffsetMin,
          asleepS: n.asleepS,
          awakeS: n.awakeS,
          awakenings: n.awakenings,
          hasStages: staged,
          deepS: staged ? (n.deepS ?? null) : null,
          remS: staged ? (n.remS ?? null) : null,
          lightS: staged ? (n.lightS ?? null) : null,
          watchScore: n.watchScore ?? null,
          hrvMs: n.hrvMs ?? null,
          rhrBpm: n.rhrBpm ?? null,
          napsJson: n.naps,
          tempCMean: n.env?.tempCMean ?? null,
          tempCMin: n.env?.tempCMin ?? null,
          tempCMax: n.env?.tempCMax ?? null,
          rhPctMean: n.env?.rhPctMean ?? null,
          rhPctMin: n.env?.rhPctMin ?? null,
          rhPctMax: n.env?.rhPctMax ?? null,
          envSamples: n.env?.samples ?? null,
          envSource: n.env?.source ?? null,
          updatedAt: now,
        };
        const { userId: _u, wakeDate: _w, ...set } = values;
        return context.db
          .insert(sleepNight)
          .values(values)
          .onConflictDoUpdate({ target: [sleepNight.userId, sleepNight.wakeDate], set });
      });
      await context.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
      await trimNights(context.db, userId);
      return { saved: statements.length };
    }),

  get: protectedProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await context.db
        .select({ tier: user.tier, founderUntil: user.founderUntil })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const pref = await readPref(context.db, userId);
      return buildSleepView(context.db, userId, pref, {
        locale: input?.locale && isLocale(input.locale) ? input.locale : context.locale,
        pro: premiumUnlocked(row, paywallConfig(context.env)),
      });
    }),

  /** Hides a card (`personal:<factor>` or `general:<topic>`) until the switch is turned off. */
  dismiss: protectedProcedure
    .input(z.object({ id: z.string().regex(/^(personal|general):[a-z0-9]{1,24}$/) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const pref = await readPref(context.db, userId);
      if (!pref.dismissed.includes(input.id)) {
        const next = [...pref.dismissed, input.id].slice(-30);
        await context.db
          .insert(sleepInsightPref)
          .values({ userId, dismissedJson: next })
          .onConflictDoUpdate({ target: sleepInsightPref.userId, set: { dismissedJson: next } });
      }
      return { ok: true as const };
    }),
};

async function statusOf(db: Parameters<typeof readPref>[0], userId: string): Promise<SleepInsightsStatus> {
  const pref = await readPref(db, userId);
  const [stats] = await db
    .select({ nights: count(), latest: sql<string | null>`max(${sleepNight.wakeDate})` })
    .from(sleepNight)
    .where(eq(sleepNight.userId, userId));
  return {
    enabled: pref.enabled,
    consentVersion: pref.consentVersion,
    currentVersion: SLEEP_CONSENT_VERSION,
    nights: stats?.nights ?? 0,
    latestWakeDate: stats?.latest ?? null,
    freeDaysMask: pref.freeDaysMask,
  };
}
