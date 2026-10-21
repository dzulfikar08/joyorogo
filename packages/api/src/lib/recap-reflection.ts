// "Refleksi minggu ini": loads one week's data, turns it into facts (lib/recap-facts.ts), words them from the fixed
// templates (lib/recap-text.ts) and, for Pro accounts, has the model rewrite them (lib/recap-ai.ts) once a week. The
// facts are recomputed on every view; only the AI text is stored (week_reflection), keyed by account, week and language.
// Contract and rules: docs/weekly-recap-ai.md.

import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { aiUsage, dailyActivity, exerciseLog, foodLog, sleepLog, waistLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";
import { weekReflection } from "@joyorogo/db/schema/recap";
import type { WeekReflectionRow } from "@joyorogo/db/schema/recap";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";
import { dayOfMs } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";

import type { AiBinding } from "../context";
import { ageFromBirthYear, shiftDate } from "./engine";
import { generateRecapText, recapModel } from "./recap-ai";
import { reflectionFacts, selectionSignature, sleepFactorOfSignature } from "./recap-facts";
import type { FactSelection, ReflectionInput, ReflectionMode, WorkoutInput } from "./recap-facts";
import { loadWeekRecap } from "./recap-store";
import { renderSelection } from "./recap-text";
import type { ReflectionBody } from "./recap-text";
import { sleepFindingsFor } from "./sleep-insights-store";
import { pickNightSleep } from "./sleep-night";
import type { StickersBucket } from "./sticker";
import { dayBounds } from "./tiers";
import type { PaywallEnv } from "./tiers";
import { cloudUnlocked } from "./watch-workout-store";
import { readDoc, watchBlobKey, WatchWorkoutDocError } from "./watch-workout";

export const REFLECTION_LIMITS = {
  /** Model runs per account, week and language, failures included. */
  maxRunsPerWeek: 4,
  /** Rewrite for changed facts at most this often. */
  regenGapMs: 6 * 60 * 60 * 1000,
  /** A failed run is not repeated before this. */
  failedRetryGapMs: 3 * 60 * 60 * 1000,
  /** A run that never finished (worker restarted) is claimable again after this. */
  runningStaleMs: 90_000,
  /** Watch workouts whose heart-rate zones are read from storage, newest first. */
  maxWorkoutBlobs: 10,
  /** A week needs this many judged days before it gets a reflection. */
  minJudgedDays: 2,
} as const;

export type ReflectionEnv = PaywallEnv & {
  AI?: AiBinding;
  AI_RECAP_MODEL?: string;
  STICKERS?: StickersBucket;
};

export interface ReflectionDeps {
  db: Database;
  env: ReflectionEnv;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** `ready`: the AI text is shown. `pending`: Pro, the model can be asked now. `locked`: free account. `unavailable`: template for now (AI off, retry or regeneration gap not over). */
export type AiState = "ready" | "pending" | "locked" | "unavailable";

export interface ReflectionItem {
  code: string;
  variant: string;
  title: string;
}

export interface WeekReflectionView {
  weekStart: string;
  weekEnd: string;
  /** The week is over; false while the reflection is built from the days so far. */
  complete: boolean;
  /** Which text `text` is. */
  source: "ai" | "template";
  ai: AiState;
  text: string;
  wins: ReflectionItem[];
  focus: ReflectionItem[];
  /** Epoch ms the AI text was written; null for the template. */
  generatedAt: number | null;
}

// ---- data ----

async function readWorkouts(
  db: Database,
  bucket: StickersBucket | undefined,
  userId: string,
  from: string,
  to: string,
  zone: DayZone,
): Promise<WorkoutInput[]> {
  const startSec = Math.floor(dayBounds(from, zone).startMs / 1000);
  const endSec = Math.floor(dayBounds(to, zone).endMs / 1000);
  const rows = await db
    .select()
    .from(watchWorkout)
    .where(
      and(
        eq(watchWorkout.userId, userId),
        isNull(watchWorkout.deletedAt),
        gte(watchWorkout.start, startSec),
        sql`${watchWorkout.start} < ${endSec}`,
      ),
    )
    .orderBy(sql`${watchWorkout.start} desc`)
    .limit(REFLECTION_LIMITS.maxWorkoutBlobs);
  return Promise.all(
    rows.map(async (row): Promise<WorkoutInput> => {
      let zones: WorkoutInput["zones"] = null;
      if (row.hasAnalysis && bucket) {
        try {
          const object = await bucket.get(watchBlobKey(userId, row.start));
          const analysis = object ? (await readDoc(new Uint8Array(await object.arrayBuffer()))).analysis : null;
          if (analysis?.hrZones) zones = { maxHr: analysis.hrZones.maxHr, sec: analysis.hrZones.sec, belowSec: analysis.hrZones.belowSec };
        } catch (error) {
          // A stored document this server cannot read still has its list numbers; anything else is a real failure.
          if (!(error instanceof WatchWorkoutDocError)) console.error("[recap] workout read failed", error);
        }
      }
      return {
        start: row.start,
        date: dayOfMs(row.start * 1000, zone),
        kind: row.sportKind,
        durationMin: (row.movingSec > 0 ? row.movingSec : row.elapsedSec) / 60,
        distanceKm: row.distanceM ? row.distanceM / 1000 : null,
        avgHr: row.avgHr,
        maxHr: row.maxHr,
        zones,
      };
    }),
  );
}

/** Exercise of the week without Strava: rows from the app and JoyoFit watch workouts, counted per day by whichever has more. */
function exerciseSummary(
  rows: ReadonlyArray<{ date: string; minutes: number | null }>,
  workouts: readonly WorkoutInput[],
): ReflectionInput["exercise"] {
  const days = new Map<string, { sessions: number; minutes: number }>();
  const add = (date: string, sessions: number, minutes: number) => {
    const day = days.get(date) ?? { sessions: 0, minutes: 0 };
    days.set(date, { sessions: Math.max(day.sessions, sessions), minutes: Math.max(day.minutes, minutes) });
  };
  for (const [date, list] of Map.groupBy(rows, (r) => r.date)) add(date, list.length, list.reduce((s, r) => s + (r.minutes ?? 0), 0));
  for (const [date, list] of Map.groupBy(workouts, (w) => w.date)) add(date, list.length, list.reduce((s, w) => s + w.durationMin, 0));
  let sessions = 0;
  let minutes = 0;
  for (const day of days.values()) {
    sessions += day.sessions;
    minutes += day.minutes;
  }
  return { sessions, minutes: Math.round(minutes), activeDays: days.size };
}

export interface ComputedReflection {
  weekStart: string;
  weekEnd: string;
  complete: boolean;
  mode: ReflectionMode;
  selection: FactSelection;
  body: ReflectionBody;
  signature: string;
  /** The account is Pro (same check as the AI text), read once for the findings and the cache decision. */
  pro: boolean;
}

/** Loads the week and builds the facts, their wording and the fingerprint of what was selected. Null: no profile, or nothing to say yet. */
export async function computeReflection(
  db: Database,
  env: Pick<ReflectionEnv, "STICKERS"> & PaywallEnv,
  userId: string,
  requestedWeek: string | undefined,
  locale: Locale,
  zone: DayZone,
): Promise<ComputedReflection | null> {
  const loaded = await loadWeekRecap(db, userId, requestedWeek, zone, { excludeStrava: true });
  if (!loaded) return null;
  const { recap, plan, prof, today } = loaded;
  if (recap.empty || recap.evaluatedDays < REFLECTION_LIMITS.minJudgedDays) return null;
  const { weekStart, weekEnd } = recap;

  const pro = await cloudUnlocked(db, env, userId);
  // Personal sleep findings are Pro only, and only describe the current week: they are computed as of now. The previous
  // week's stored reflection says which pattern it showed, so the same one is not repeated when another exists.
  const [sleepFindings, previousSleepFactor] =
    pro && weekEnd >= today
      ? await Promise.all([sleepFindingsFor(db, userId, zone), readPreviousSleepFactor(db, userId, weekStart)])
      : [[], null];

  const [food, waist, exerciseRows, scores, sleepRows, activity, workouts] = await Promise.all([
    db
      .select({ date: foodLog.date, meal: foodLog.meal, name: foodLog.name, kcal: foodLog.kcal })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, weekStart), lte(foodLog.date, weekEnd))),
    db
      .select({ date: waistLog.date, waistCm: waistLog.waistCm })
      .from(waistLog)
      .where(and(eq(waistLog.userId, userId), gte(waistLog.date, shiftDate(weekStart, -7)), lte(waistLog.date, weekEnd)))
      .orderBy(asc(waistLog.date)),
    db
      .select({ date: exerciseLog.date, minutes: exerciseLog.durationMin })
      .from(exerciseLog)
      .where(
        and(
          eq(exerciseLog.userId, userId),
          gte(exerciseLog.date, weekStart),
          lte(exerciseLog.date, weekEnd),
          ne(exerciseLog.source, "rest"),
          ne(exerciseLog.source, "strava"),
        ),
      ),
    db
      .select({ date: fitnessScore.date, loadRatio: fitnessScore.loadRatio, sleepHours: fitnessScore.sleepHours })
      .from(fitnessScore)
      .where(and(eq(fitnessScore.userId, userId), gte(fitnessScore.date, weekStart), lte(fitnessScore.date, weekEnd))),
    // A night is keyed by the day it started (routers/sleep.ts), so the night that ended on `date` is `date - 1`.
    db
      .select({ date: sleepLog.date, hours: sleepLog.hours, source: sleepLog.source })
      .from(sleepLog)
      .where(and(eq(sleepLog.userId, userId), gte(sleepLog.date, shiftDate(weekStart, -1)), lte(sleepLog.date, shiftDate(weekEnd, -1)))),
    db
      .select({ date: dailyActivity.date, steps: dailyActivity.steps })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.date, weekStart), lte(dailyActivity.date, weekEnd))),
    readWorkouts(db, env.STICKERS, userId, weekStart, weekEnd, zone),
  ]);

  const scoreByDay = new Map(scores.map((row) => [row.date, row]));
  const nightByDay = new Map(sleepRows.map((row) => [shiftDate(row.date, 1), row]));
  const sleep = [...new Set([...scoreByDay.keys(), ...nightByDay.keys()])]
    .filter((date) => date >= weekStart && date <= weekEnd)
    .toSorted()
    .flatMap((date) => {
      const night = pickNightSleep(nightByDay.get(date), scoreByDay.get(date)?.sleepHours);
      return night ? [{ date, hours: night.hours }] : [];
    });

  const mode: ReflectionMode = plan.maternal
    ? "maternal"
    : plan.targets.gain
      ? "gain"
      : prof.goal === "lose" && plan.weightNowKg > prof.targetWeightKg
        ? "lose"
        : "maintain";

  const input: ReflectionInput = {
    recap,
    mode,
    today,
    person: {
      gender: prof.gender,
      heightCm: prof.heightCm,
      ageYears: ageFromBirthYear(prof.birthYear, today),
      weightKg: plan.weightNowKg,
      targetKg: plan.maternal ? null : prof.targetWeightKg,
      targetDate: plan.maternal ? null : prof.targetDate,
    },
    food,
    weighIns: plan.weighIns.filter((w) => w.date >= weekStart && w.date <= weekEnd),
    weightBefore: plan.weighIns.findLast((w) => w.date < weekStart) ?? null,
    trend: plan.trend ? { weeklyRateKg: plan.trend.weeklyRateKg, projectedDate: plan.trend.projectedDate } : null,
    waist,
    exercise: exerciseSummary(exerciseRows, workouts),
    workouts,
    loadRatios: scores.flatMap((row) => (row.loadRatio !== null && row.loadRatio > 0 ? [row.loadRatio] : [])),
    sleep,
    needSleepHours: plan.targets.sleepHours,
    steps: activity.map((row) => ({ date: row.date, steps: row.steps })),
    sleepFindings,
    previousSleepFactor,
  };

  const selection = reflectionFacts(input);
  if (selection.wins.length === 0 && selection.focus.length === 0) return null;
  return {
    weekStart,
    weekEnd,
    complete: recap.complete,
    mode,
    selection: { wins: selection.wins, focus: selection.focus },
    body: renderSelection(selection, locale, mode),
    signature: selectionSignature(selection),
    pro,
  };
}

/** The `SLEEP_FACTOR` variant the stored reflection of the week before `weekStart` showed (any language); null when none or no row. */
export async function readPreviousSleepFactor(db: Database, userId: string, weekStart: string): Promise<string | null> {
  const rows = await db
    .select({ signature: weekReflection.signature })
    .from(weekReflection)
    .where(and(eq(weekReflection.userId, userId), eq(weekReflection.weekStart, shiftDate(weekStart, -7))));
  for (const row of rows) {
    const factor = sleepFactorOfSignature(row.signature);
    if (factor !== null) return factor;
  }
  return null;
}

// ---- cache decision ----

export interface AiDecision {
  state: AiState;
  /** The stored AI text to show; null for every state but `ready`. */
  text: string | null;
  /** The model may be asked now. */
  canRun: boolean;
}

/**
 * What the stored row, the account and the current facts say about the AI text. Free accounts are locked. A stored text
 * is used only while its facts are the current ones; changed facts rewrite it at most every `regenGapMs` and
 * `maxRunsPerWeek` times, a failed run waits `failedRetryGapMs`.
 */
export function decideAi(input: { pro: boolean; hasAi: boolean; row: WeekReflectionRow | null; signature: string; now: number }): AiDecision {
  const { row, now } = input;
  const none = (state: AiState, canRun = false): AiDecision => ({ state, text: null, canRun });
  if (!input.pro) return none("locked");
  if (row?.status === "ok" && row.aiText && row.signature === input.signature) return { state: "ready", text: row.aiText, canRun: false };
  if (!input.hasAi) return none("unavailable");
  if (row?.status === "running") {
    if (now - row.generatedAt < REFLECTION_LIMITS.runningStaleMs) return none("pending");
    // A run that never finished: claimable again while the week's run cap allows, else the template stays.
    return row.generations < REFLECTION_LIMITS.maxRunsPerWeek ? none("pending", true) : none("unavailable");
  }
  if (!row) return none("pending", true);
  if (row.generations >= REFLECTION_LIMITS.maxRunsPerWeek) return none("unavailable");
  const gap = row.status === "failed" ? REFLECTION_LIMITS.failedRetryGapMs : REFLECTION_LIMITS.regenGapMs;
  return now - row.generatedAt < gap ? none("unavailable") : none("pending", true);
}

async function readRow(db: Database, userId: string, weekStart: string, locale: Locale): Promise<WeekReflectionRow | null> {
  const [row] = await db
    .select()
    .from(weekReflection)
    .where(and(eq(weekReflection.userId, userId), eq(weekReflection.weekStart, weekStart), eq(weekReflection.locale, locale)))
    .limit(1);
  return row ?? null;
}

function toView(computed: ComputedReflection, decision: AiDecision, generatedAt: number | null): WeekReflectionView {
  const item = (v: { code: string; variant: string; title: string }): ReflectionItem => ({ code: v.code, variant: v.variant, title: v.title });
  return {
    weekStart: computed.weekStart,
    weekEnd: computed.weekEnd,
    complete: computed.complete,
    source: decision.text !== null ? "ai" : "template",
    ai: decision.state,
    text: decision.text ?? computed.body.templateText,
    wins: computed.body.wins.map(item),
    focus: computed.body.focus.map(item),
    generatedAt: decision.text !== null ? generatedAt : null,
  };
}

// ---- views ----

/** The reflection of a week as the clients show it; reads the cache, never calls the model. Null: nothing to show. */
export async function getWeekReflection(
  deps: ReflectionDeps,
  userId: string,
  requestedWeek: string | undefined,
  locale: Locale,
  zone: DayZone,
  now = Date.now(),
): Promise<WeekReflectionView | null> {
  const computed = await computeReflection(deps.db, deps.env, userId, requestedWeek, locale, zone);
  if (!computed) return null;
  const { pro } = computed;
  const row = pro ? await readRow(deps.db, userId, computed.weekStart, locale) : null;
  const decision = decideAi({ pro, hasAi: deps.env.AI !== undefined, row, signature: computed.signature, now });
  return toView(computed, decision, row?.generatedAt ?? null);
}

/**
 * Claims a model run in the row: inserts it, or takes over the stored one when the rules of `decideAi` allow another run.
 * The rules are part of the statement, so two requests that read the same row cannot both start a run. Returns the
 * run count of the row after the claim, or null when the claim was refused.
 */
export async function claimRun(
  db: Database,
  claim: { userId: string; weekStart: string; locale: string; model: string; signature: string; now: number },
): Promise<number | null> {
  const { userId, weekStart, locale, model, signature, now } = claim;
  const rows = await db
    .insert(weekReflection)
    .values({ userId, weekStart, locale, aiText: null, aiModel: model, status: "running", signature, generations: 1, generatedAt: now })
    .onConflictDoUpdate({
      target: [weekReflection.userId, weekReflection.weekStart, weekReflection.locale],
      set: { status: "running", aiModel: model, signature, generations: sql`${weekReflection.generations} + 1`, generatedAt: now },
      // Under the run cap, and a stale unfinished run, a failed run past its retry gap, or changed facts past the regeneration gap.
      setWhere: sql`${weekReflection.generations} < ${REFLECTION_LIMITS.maxRunsPerWeek} and (
        (${weekReflection.status} = 'running' and ${weekReflection.generatedAt} <= ${now - REFLECTION_LIMITS.runningStaleMs})
        or (${weekReflection.status} = 'failed' and ${weekReflection.generatedAt} <= ${now - REFLECTION_LIMITS.failedRetryGapMs})
        or (${weekReflection.status} = 'ok' and ${weekReflection.signature} != ${signature} and ${weekReflection.generatedAt} <= ${now - REFLECTION_LIMITS.regenGapMs})
      )`,
    })
    .returning({ generations: weekReflection.generations });
  return rows[0]?.generations ?? null;
}

export class ReflectionLockedError extends Error {
  constructor() {
    super("reflection-locked");
  }
}

/**
 * Writes (or rewrites) the AI text when the cache says it is due; otherwise returns the current view untouched, so a client
 * that asks twice costs one model run. The run is claimed in the row first, so two devices cannot both start one. Every
 * model call leaves an `ai_usage` row ('recap'); a text that fails validation twice leaves the template in place.
 */
export async function generateWeekReflection(
  deps: ReflectionDeps,
  userId: string,
  requestedWeek: string | undefined,
  locale: Locale,
  zone: DayZone,
  now = Date.now(),
): Promise<WeekReflectionView | null> {
  const computed = await computeReflection(deps.db, deps.env, userId, requestedWeek, locale, zone);
  if (!computed) return null;
  if (!computed.pro) throw new ReflectionLockedError();
  const { db, env } = deps;
  const row = await readRow(db, userId, computed.weekStart, locale);
  const decision = decideAi({ pro: true, hasAi: env.AI !== undefined, row, signature: computed.signature, now });
  if (!decision.canRun || !env.AI) return toView(computed, decision, row?.generatedAt ?? null);

  const model = recapModel(env);
  const claimed = await claimRun(db, { userId, weekStart: computed.weekStart, locale, model, signature: computed.signature, now });
  if (claimed === null) {
    // Another request got there first or the rules changed under us: show what the row says now.
    const current = await readRow(db, userId, computed.weekStart, locale);
    return toView(computed, decideAi({ pro: true, hasAi: true, row: current, signature: computed.signature, now }), current?.generatedAt ?? null);
  }

  const run = await generateRecapText(env.AI, { model, locale, mode: computed.mode, selection: computed.selection, body: computed.body });
  const finishedAt = Date.now();
  const status = run.text === null ? "failed" : "ok";
  await db
    .update(weekReflection)
    .set({ aiText: run.text, status, signature: computed.signature, generatedAt: finishedAt })
    .where(and(eq(weekReflection.userId, userId), eq(weekReflection.weekStart, computed.weekStart), eq(weekReflection.locale, locale)));
  // Every call that reached the model is counted, answer or not. Only counts, outcomes and token usage are kept.
  deps.waitUntil(
    db
      .insert(aiUsage)
      .values(
        run.attempts.map((attempt, index) => ({
          id: crypto.randomUUID(),
          userId,
          model,
          scanType: "recap" as const,
          latencyMs: attempt.latencyMs,
          usageJson: JSON.stringify({
            kind: "recap",
            week: computed.weekStart,
            attempt: index + 1,
            outcome: attempt.outcome,
            ...(attempt.reason ? { reason: attempt.reason } : {}),
            ...(attempt.usage ? { usage: attempt.usage } : {}),
          }),
        })),
      )
      .then(
        () => undefined,
        (error: unknown) => console.error("[recap] ledger insert failed", error),
      ),
  );
  const after = decideAi({
    pro: true,
    hasAi: true,
    row: { userId, weekStart: computed.weekStart, locale, aiText: run.text, aiModel: model, status, signature: computed.signature, generations: claimed, generatedAt: finishedAt },
    signature: computed.signature,
    now: finishedAt,
  });
  return toView(computed, after, finishedAt);
}
