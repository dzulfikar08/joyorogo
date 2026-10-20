// Database side of the sleep insights: consent, nights, the cached evaluations and the read that ties them to the
// engine (lib/sleep-insights.ts). Reads are memoised per factor under a signature of the factor's inputs.

import { and, asc, eq, gt, gte, isNull, lt } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { sleepInsightCache, sleepInsightPref, sleepNight } from "@joyorogo/db/schema/sleep-insights";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { effectiveRamadan, jakartaToday, shiftDate } from "./engine";
import {
  FACTORS,
  WINDOW_DAYS,
  buildFactorSamples,
  evaluateFactor,
  gate,
  releaseNew,
  signatureOf,
  visibleFindings,
} from "./sleep-insights";
import type { EngineContext, FactorState, FoodInput, NightInput, WorkoutInput } from "./sleep-insights";
import { SLEEP_RETENTION_NIGHTS } from "./sleep-insights-types";
import type { SleepFactor, SleepFinding } from "./sleep-insights-types";

export interface SleepPref {
  enabled: boolean;
  consentVersion: number;
  freeDaysMask: number;
  dismissed: string[];
}

export const DEFAULT_PREF: SleepPref = { enabled: false, consentVersion: 0, freeDaysMask: 65, dismissed: [] };

export async function readPref(db: Database, userId: string): Promise<SleepPref> {
  const [row] = await db.select().from(sleepInsightPref).where(eq(sleepInsightPref.userId, userId)).limit(1);
  if (!row) return DEFAULT_PREF;
  return {
    enabled: row.enabled,
    consentVersion: row.consentVersion,
    freeDaysMask: row.freeDaysMask,
    dismissed: row.dismissedJson,
  };
}

/** Deletes everything the feature stored about the person's nights (not the pref row itself). */
export function deleteSleepData(db: Database, userId: string) {
  return [
    db.delete(sleepNight).where(eq(sleepNight.userId, userId)),
    db.delete(sleepInsightCache).where(eq(sleepInsightCache.userId, userId)),
  ] as const;
}

/** Drops nights beyond the retention count (the oldest wake dates). */
export async function trimNights(db: Database, userId: string): Promise<void> {
  const keep = await db
    .select({ wakeDate: sleepNight.wakeDate })
    .from(sleepNight)
    .where(eq(sleepNight.userId, userId))
    .orderBy(asc(sleepNight.wakeDate));
  if (keep.length <= SLEEP_RETENTION_NIGHTS) return;
  const cutoff = keep[keep.length - SLEEP_RETENTION_NIGHTS]!.wakeDate;
  await db.delete(sleepNight).where(and(eq(sleepNight.userId, userId), lt(sleepNight.wakeDate, cutoff)));
}

export interface SleepInputs {
  nights: NightInput[];
  foods: FoodInput[];
  workouts: WorkoutInput[];
  ctx: EngineContext;
  today: string;
}

/** Loads the 42-day window: main nights, the food log around them and the watch-workout backup. */
export async function loadInputs(db: Database, userId: string, pref: SleepPref, now: Date): Promise<SleepInputs> {
  const today = jakartaToday(now);
  const from = shiftDate(today, -WINDOW_DAYS);
  const nightRows = await db
    .select()
    .from(sleepNight)
    .where(and(eq(sleepNight.userId, userId), gt(sleepNight.wakeDate, from)))
    .orderBy(asc(sleepNight.wakeDate));
  const nights: NightInput[] = nightRows.map((r) => ({
    wakeDate: r.wakeDate,
    onsetMs: r.onsetMs,
    wakeMs: r.wakeMs,
    tzOffsetMin: r.tzOffsetMin,
    asleepS: r.asleepS,
    awakeS: r.awakeS,
    awakenings: r.awakenings,
    hasStages: r.hasStages,
    deepS: r.deepS,
    remS: r.remS,
    lightS: r.lightS,
    hrvMs: r.hrvMs,
    rhrBpm: r.rhrBpm,
    tempCMean: r.tempCMean,
    rhPctMean: r.rhPctMean,
  }));

  const [prof] = await db
    .select({ birthYear: profile.birthYear, maternalMode: profile.maternalMode, ramadanMode: profile.ramadanMode })
    .from(profile)
    .where(eq(profile.userId, userId))
    .limit(1);

  let foods: FoodInput[] = [];
  let workouts: WorkoutInput[] = [];
  if (nights.length > 0) {
    foods = await db
      .select({
        date: foodLog.date,
        meal: foodLog.meal,
        name: foodLog.name,
        kcal: foodLog.kcal,
        eatenAt: foodLog.eatenAt,
        createdAt: foodLog.createdAt,
      })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, shiftDate(from, -2))))
      .then((rows) => rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })));

    const startSec = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86_400;
    const maxHr = prof?.birthYear ? 220 - (Number(today.slice(0, 4)) - prof.birthYear) : null;
    workouts = await db
      .select({ start: watchWorkout.start, elapsedSec: watchWorkout.elapsedSec, avgHr: watchWorkout.avgHr })
      .from(watchWorkout)
      .where(
        and(
          eq(watchWorkout.userId, userId),
          gte(watchWorkout.start, startSec),
          isNull(watchWorkout.deletedAt),
          eq(watchWorkout.complete, true),
        ),
      )
      .then((rows) =>
        rows.map((r) => ({
          startMs: r.start * 1000,
          endMs: (r.start + r.elapsedSec) * 1000,
          vigorous: r.avgHr && maxHr && maxHr > 100 ? r.avgHr >= 0.8 * maxHr : null,
        })),
      );
  }

  const ramadanPref = prof?.ramadanMode ?? "auto";
  return {
    nights,
    foods,
    workouts,
    today,
    ctx: {
      userId,
      freeDaysMask: pref.freeDaysMask,
      maternal: (prof?.maternalMode ?? "none") !== "none",
      ramadanOn: (date) => effectiveRamadan(ramadanPref, new Date(`${date}T05:00:00Z`)),
    },
  };
}

export interface SleepState {
  inputs: SleepInputs;
  states: Partial<Record<SleepFactor, FactorState>>;
}

function parseState(json: string): FactorState | null {
  try {
    const parsed = JSON.parse(json) as { state?: FactorState };
    return parsed.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Evaluates every factor (cached per factor by input signature), runs the gate with hysteresis and the one-new-a-day
 * release, and persists what changed. The returned states are what the view and the reflection read.
 */
export async function computeState(db: Database, userId: string, pref: SleepPref, now: Date): Promise<SleepState> {
  const inputs = await loadInputs(db, userId, pref, now);
  const through = inputs.nights.length ? inputs.nights[inputs.nights.length - 1]!.wakeDate : inputs.today;
  const seedKey = `${userId}|${through}`;

  const cacheRows = await db.select().from(sleepInsightCache).where(eq(sleepInsightCache.userId, userId));
  const cached = new Map(cacheRows.map((r) => [r.factor, r]));

  const factorSamples = buildFactorSamples(inputs.nights, inputs.foods, inputs.workouts, inputs.ctx);
  const signatures = new Map<SleepFactor, string>();
  const evals = factorSamples.map((f) => {
    // The window moves daily and the seed follows `through`, so the signature includes it via seedKey.
    const signature = signatureOf(f, seedKey);
    signatures.set(f.factor, signature);
    const row = cached.get(f.factor);
    const prev = row ? parseState(row.resultJson) : null;
    if (row && row.signature === signature && prev) return prev.eval;
    return evaluateFactor(f, seedKey, through);
  });

  const previous: Partial<Record<SleepFactor, "none" | "maybe" | "leaning">> = {};
  for (const f of FACTORS) {
    const row = cached.get(f);
    previous[f] = (row && parseState(row.resultJson)?.status) || "none";
  }
  const statuses = gate(evals, previous, inputs.nights.length);

  const states: Partial<Record<SleepFactor, FactorState>> = {};
  factorSamples.forEach((f, i) => {
    const row = cached.get(f.factor);
    const prev = row ? parseState(row.resultJson) : null;
    states[f.factor] = {
      eval: evals[i] ?? null,
      status: statuses[f.factor] ?? "none",
      firstShownDay: prev?.firstShownDay ?? null,
    };
  });
  releaseNew(states, inputs.today);

  const writes = factorSamples.flatMap((f) => {
    const state = states[f.factor]!;
    const json = JSON.stringify({ state });
    const row = cached.get(f.factor);
    if (row && row.resultJson === json && row.signature === signatures.get(f.factor)) return [];
    return [
      db
        .insert(sleepInsightCache)
        .values({ userId, factor: f.factor, signature: signatures.get(f.factor)!, resultJson: json, computedAt: now.getTime() })
        .onConflictDoUpdate({
          target: [sleepInsightCache.userId, sleepInsightCache.factor],
          set: { signature: signatures.get(f.factor)!, resultJson: json, computedAt: now.getTime() },
        }),
    ];
  });
  if (writes.length > 0) await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
  return { inputs, states };
}

/**
 * Findings a person may see, for the weekly reflection and the cards: empty when the switch is off. Hidden
 * (dismissed) findings are left out. Callers check Pro themselves.
 */
export async function sleepFindingsFor(db: Database, userId: string, now: Date = new Date()): Promise<SleepFinding[]> {
  const pref = await readPref(db, userId);
  if (!pref.enabled) return [];
  const { states } = await computeState(db, userId, pref, now);
  return visibleFindings(states).filter((f) => !pref.dismissed.includes(`personal:${f.factor}`));
}
