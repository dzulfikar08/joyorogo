// Sleep insights engine (docs/sleep-insights-design.md): pure functions, no database. It lines a person's nights up with
// what the food log and the watch-workout backup say about the day and decides, with a statistical gate, which patterns
// may be worded as findings. All thresholds live here as constants.
//
// Personal factors (fixed outcome each, so there is no hunting through every pair):
//   caffeine   -> total sleep   (decayed caffeine of the 24 h before onset, exposed at 25 mg or more)
//   dinner     -> awake minutes (last dinner item under 3 h before onset)
//   workout    -> awake minutes (a vigorous workout of 20 min or more ended within 3 h before onset)
//   regularity -> total sleep   (bedtime 60 min or more away from the person's own median bedtime)
//   temperature, humidity -> awake minutes (bedroom sensor: the person's own hottest / most humid third of nights vs the rest)
// Alcohol is only ever a general tip (owner decision), so it has no personal factor here.

import { isAlcoholicDrink, caffeineMgFor } from "./intake";
import type { SleepCardNight, SleepConfidence, SleepFactor, SleepFinding, SleepOutcome } from "./sleep-insights-types";

// ---- constants -------------------------------------------------------------------------------------------------

/** Bump when the engine's behaviour changes: it is part of every cache signature. */
export const SLEEP_ENGINE_REV = 1;
export const WINDOW_DAYS = 42;
/** Main nights in the window before any personal comparison (the same 14 as JoyoFit's HRV baseline). */
export const MIN_WINDOW_NIGHTS = 14;
/** Exposed and unexposed nights a factor needs on each side. */
export const MIN_PER_GROUP = 5;
/** Nights from which a finding may be worded "cenderung" (below that: "mungkin"). */
export const LEANING_NIGHTS = 28;
/** Effect size as a share of the person's own night-to-night SD. */
export const MIN_EFFECT_SD = 0.5;
export const LOOSE_EFFECT_SD = 0.35;
/** Adjusted p (permutation + Benjamini-Hochberg) a finding needs to appear / may keep appearing. */
export const P_MAYBE = 0.1;
export const P_LEANING = 0.05;
export const P_KEEP_MAYBE = 0.15;
export const P_KEEP_LEANING = 0.1;
export const PERMUTATIONS = 2000;
export const CAFFEINE_HALF_LIFE_H = 5;
export const CAFFEINE_EXPOSED_MG = 25;
export const CAFFEINE_LOOKBACK_H = 24;
export const ALCOHOL_LOOKBACK_H = 8;
export const DINNER_GAP_H = 3;
export const WORKOUT_GAP_H = 3;
export const WORKOUT_MIN_MIN = 20;
export const IRREGULAR_MIN = 60;
export const MAX_CARDS = 3;
/** Low-prior factors never rise above "mungkin". */
export const LOW_PRIOR: readonly SleepFactor[] = ["dinner", "workout"];
export const FACTORS: readonly SleepFactor[] = ["caffeine", "dinner", "workout", "regularity", "temperature", "humidity"];
/** Share of the person's nights (the hottest / most humid) counted as exposed to the room. */
export const ROOM_EXPOSED_SHARE = 1 / 3;

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;

// ---- inputs ----------------------------------------------------------------------------------------------------

export interface NightInput {
  wakeDate: string;
  onsetMs: number;
  wakeMs: number;
  tzOffsetMin: number;
  asleepS: number;
  awakeS: number;
  awakenings: number;
  hasStages: boolean;
  deepS: number | null;
  remS: number | null;
  lightS: number | null;
  hrvMs: number | null;
  rhrBpm: number | null;
  /** Bedroom sensor means over the sleep window; null without a sensor. */
  tempCMean: number | null;
  rhPctMean: number | null;
}

export interface FoodInput {
  /** WIB day the item is logged on. */
  date: string;
  meal: string;
  name: string;
  kcal: number;
  /** unix ms, set by the "jam makan" picker; null when unknown. */
  eatenAt: number | null;
  /** unix ms the row was written. */
  createdAt: number;
}

export interface WorkoutInput {
  startMs: number;
  endMs: number;
  /** Average HR at 80 % of the age-based max HR (220 - age) or more; null when the workout has no HR or the age is unknown. */
  vigorous: boolean | null;
}

export interface EngineContext {
  userId: string;
  /** Bit i = weekday i (0 = Sunday) is a free day. */
  freeDaysMask: number;
  /** Hamil / Menyusui: no personal caffeine card. */
  maternal: boolean;
  /** Ramadan on that date: dinner and caffeine factors pause. */
  ramadanOn: (date: string) => boolean;
  /** The person's day-zone offset in minutes: where a logged item's clock time and day are read. */
  dayOffsetMin: number;
}

// ---- time helpers ----------------------------------------------------------------------------------------------

/** Jakarta offset, the default of foodTime for callers without a zone. */
const WIB_OFFSET_MIN = 420;

/** 'YYYY-MM-DD' of a UTC instant shifted by an offset in minutes. */
export function localDate(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * MIN).toISOString().slice(0, 10);
}

/** Minutes after local midnight. */
export function localMinutes(ms: number, offsetMin: number): number {
  return (((Math.floor(ms / MIN) + offsetMin) % 1440) + 1440) % 1440;
}

/** Weekday 0 (Sunday) .. 6 of a 'YYYY-MM-DD'. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Bedtime on a line that does not wrap at midnight: minutes after 18:00 local. */
export function bedtimeLine(onsetMs: number, offsetMin: number): number {
  return (localMinutes(onsetMs, offsetMin) - 18 * 60 + 1440) % 1440;
}

/** The night is a "free" night when the day it ended on is a free day (Friday night -> Saturday). */
export function isFreeNight(wakeDate: string, mask: number): boolean {
  return ((mask >> weekdayOf(wakeDate)) & 1) === 1;
}

// A logged item's clock time is only trusted when it fits its meal (a breakfast logged at 21:00 or a back-filled day
// does not): the "jam makan" picker always wins.
const MEAL_HOURS: Record<string, [number, number] | undefined> = {
  sarapan: [4, 12],
  makan_siang: [10, 17],
  makan_malam: [16, 24],
};

export interface FoodTime {
  ms: number;
  known: boolean;
}

export function foodTime(item: FoodInput, offsetMin: number = WIB_OFFSET_MIN): FoodTime {
  if (item.eatenAt != null) return { ms: item.eatenAt, known: true };
  const day = localDate(item.createdAt, offsetMin);
  const hour = localMinutes(item.createdAt, offsetMin) / 60;
  const range = MEAL_HOURS[item.meal];
  const fits = day === item.date && (!range || (hour >= range[0] && hour < range[1]));
  return { ms: item.createdAt, known: fits };
}

// ---- statistics ------------------------------------------------------------------------------------------------

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation; 0 under two values. */
export function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** FNV-1a 32-bit. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sample {
  date: string;
  exposed: boolean;
  /** The factor's fixed outcome: minutes. */
  value: number;
  /** 1 = free night, 0 = work night. */
  stratum: 0 | 1;
}

function meanDiff(samples: Sample[], exposed: boolean[]): number {
  let se = 0;
  let ne = 0;
  let so = 0;
  let no = 0;
  for (let i = 0; i < samples.length; i++) {
    if (exposed[i]) {
      se += samples[i]!.value;
      ne++;
    } else {
      so += samples[i]!.value;
      no++;
    }
  }
  return se / ne - so / no;
}

/**
 * Two-sided permutation p of the exposed-minus-other mean difference, shuffling the exposure labels only within
 * work/free strata (alcohol-like habits cluster on weekends; an unstratified test would read social jetlag as the habit).
 * Equivalent to "the (1 - p) permutation interval excludes 0".
 */
export function stratifiedPermutationP(samples: Sample[], seed: number, iterations = PERMUTATIONS): number {
  const observed = Math.abs(meanDiff(samples, samples.map((s) => s.exposed)));
  const rand = mulberry32(seed);
  const strata = [0, 1].map((k) => samples.map((s, i) => (s.stratum === k ? i : -1)).filter((i) => i >= 0));
  const labels = samples.map((s) => s.exposed);
  let extreme = 0;
  for (let it = 0; it < iterations; it++) {
    const shuffled = labels.slice();
    for (const idx of strata) {
      // Fisher-Yates over this stratum's labels.
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const a = idx[i]!;
        const b = idx[j]!;
        const tmp = shuffled[a]!;
        shuffled[a] = shuffled[b]!;
        shuffled[b] = tmp;
      }
    }
    if (Math.abs(meanDiff(samples, shuffled)) >= observed - 1e-9) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

/** Benjamini-Hochberg adjusted p-values, in input order. */
export function benjaminiHochberg(p: number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [v, i] = order[k]!;
    running = Math.min(running, (v * m) / (k + 1));
    adjusted[i] = running;
  }
  return adjusted;
}

// ---- per-factor samples ----------------------------------------------------------------------------------------

export interface FactorSamples {
  factor: SleepFactor;
  /** False when the factor cannot be judged at all for this person (maternal, no workout backup...). */
  available: boolean;
  samples: Sample[];
  /** temperature / humidity: the cut-off of the person's own exposed third; null for the other factors. */
  threshold: number | null;
}

interface PreparedNight {
  night: NightInput;
  stratum: 0 | 1;
  awakeMin: number;
  asleepMin: number;
  items: { item: FoodInput; time: FoodTime }[];
  /** items of the 24 h before onset (known time) or of the two local days around it (unknown time) */
  complete: boolean;
}

function prepareNights(nights: NightInput[], foods: FoodInput[], mask: number, offsetMin: number): PreparedNight[] {
  const timed = foods.map((item) => ({ item, time: foodTime(item, offsetMin) }));
  return nights.map((night) => {
    const from = night.onsetMs - CAFFEINE_LOOKBACK_H * HOUR;
    const onsetDay = localDate(night.onsetMs, night.tzOffsetMin);
    const prevDay = addDays(onsetDay, -1);
    const items = timed.filter(({ item, time }) =>
      time.known ? time.ms >= from && time.ms <= night.onsetMs : item.date === onsetDay || item.date === prevDay,
    );
    const meals = new Set(items.map(({ item }) => item.meal));
    const kcal = items.reduce((sum, { item }) => sum + item.kcal, 0);
    return {
      night,
      stratum: isFreeNight(night.wakeDate, mask) ? 1 : 0,
      awakeMin: night.awakeS / 60,
      asleepMin: night.asleepS / 60,
      items,
      complete: meals.size >= 2 || kcal >= 800,
    };
  });
}

export function caffeineLoadMg(night: PreparedNight): { mg: number; unknownTime: boolean } {
  let mg = 0;
  let unknownTime = false;
  for (const { item, time } of night.items) {
    const per = caffeineMgFor(item.name);
    if (per === null) continue;
    if (!time.known) {
      unknownTime = true;
      continue;
    }
    const hoursBefore = (night.night.onsetMs - time.ms) / HOUR;
    mg += per * 0.5 ** (hoursBefore / CAFFEINE_HALF_LIFE_H);
  }
  return { mg, unknownTime };
}

/** Samples of every personal factor over `nights` (main nights of the window, oldest to newest). */
export function buildFactorSamples(
  nights: NightInput[],
  foods: FoodInput[],
  workouts: WorkoutInput[],
  ctx: EngineContext,
): FactorSamples[] {
  const prepared = prepareNights(nights, foods, ctx.freeDaysMask, ctx.dayOffsetMin);
  const out: FactorSamples[] = [];

  // caffeine -> asleep
  {
    const samples: Sample[] = [];
    for (const n of prepared) {
      if (ctx.ramadanOn(n.night.wakeDate) || !n.complete) continue;
      const { mg, unknownTime } = caffeineLoadMg(n);
      if (unknownTime) continue;
      samples.push({ date: n.night.wakeDate, exposed: mg >= CAFFEINE_EXPOSED_MG, value: n.asleepMin, stratum: n.stratum });
    }
    out.push({ factor: "caffeine", available: !ctx.maternal, samples, threshold: null });
  }

  // dinner -> awake
  {
    const samples: Sample[] = [];
    for (const n of prepared) {
      if (ctx.ramadanOn(n.night.wakeDate) || !n.complete) continue;
      const dinners = n.items.filter(({ item }) => item.meal === "makan_malam");
      const known = dinners.filter(({ time }) => time.known && n.night.onsetMs - time.ms >= 0);
      // No dinner item at all is "not logged", not "no dinner"; an unknown-time dinner cannot be placed.
      if (known.length === 0) continue;
      if (dinners.some(({ time }) => !time.known)) continue;
      const last = Math.max(...known.map(({ time }) => time.ms));
      samples.push({
        date: n.night.wakeDate,
        exposed: n.night.onsetMs - last < DINNER_GAP_H * HOUR,
        value: n.awakeMin,
        stratum: n.stratum,
      });
    }
    out.push({ factor: "dinner", available: true, samples, threshold: null });
  }

  // workout -> awake (vigorous only; see WorkoutInput.vigorous)
  {
    const samples: Sample[] = [];
    for (const n of prepared) {
      const late = workouts.filter(
        (w) =>
          w.endMs <= n.night.onsetMs &&
          n.night.onsetMs - w.endMs <= WORKOUT_GAP_H * HOUR &&
          w.endMs - w.startMs >= WORKOUT_MIN_MIN * MIN,
      );
      const exposed = late.some((w) => w.vigorous === true);
      // A late workout of unknown or lighter intensity is neither exposure nor "no workout": the night is left out.
      if (!exposed && late.length > 0) continue;
      samples.push({ date: n.night.wakeDate, exposed, value: n.awakeMin, stratum: n.stratum });
    }
    // No watch-workout backup (free or never backed up): nothing says a night had no workout.
    out.push({ factor: "workout", available: workouts.length > 0, samples, threshold: null });
  }

  // regularity -> asleep
  {
    const lines = nights.map((n) => bedtimeLine(n.onsetMs, n.tzOffsetMin));
    const med = median(lines);
    const samples: Sample[] = prepared.map((n, i) => ({
      date: n.night.wakeDate,
      exposed: Math.abs(lines[i]! - med) >= IRREGULAR_MIN,
      value: n.asleepMin,
      stratum: n.stratum,
    }));
    out.push({ factor: "regularity", available: nights.length > 0, samples, threshold: null });
  }

  // temperature / humidity -> awake: exposed = the person's own hottest / most humid third of nights (no universal band)
  for (const [factor, pick] of [
    ["temperature", (n: NightInput) => n.tempCMean],
    ["humidity", (n: NightInput) => n.rhPctMean],
  ] as const) {
    const withEnv = prepared.filter((n) => pick(n.night) !== null);
    const sorted = withEnv.map((n) => pick(n.night)!).sort((a, b) => a - b);
    const cut = sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - ROOM_EXPOSED_SHARE)))]!;
    const samples: Sample[] = withEnv.map((n) => ({
      date: n.night.wakeDate,
      exposed: pick(n.night)! >= cut!,
      value: n.awakeMin,
      stratum: n.stratum,
    }));
    out.push({ factor, available: withEnv.length > 0, samples, threshold: cut });
  }
  return out;
}

// ---- evaluation + gate -----------------------------------------------------------------------------------------

export interface FactorEval {
  factor: SleepFactor;
  outcome: SleepOutcome;
  n: number;
  exposed: number;
  other: number;
  /** exposed mean minus other mean, minutes */
  diff: number;
  /** night-to-night SD of the outcome over the eligible nights */
  sd: number;
  /** raw permutation p; null when the size gate failed (no test run) */
  p: number | null;
  /** exposed-minus-other sign agrees in both halves of the window (each half needs both groups) */
  halvesAgree: boolean;
  threshold: number | null;
  nights: SleepCardNight[];
  through: string;
}

export const OUTCOME_OF: Record<SleepFactor, SleepOutcome> = {
  caffeine: "asleep",
  dinner: "awake",
  workout: "awake",
  regularity: "asleep",
  temperature: "awake",
  humidity: "awake",
};

function halvesAgree(samples: Sample[]): boolean {
  const sorted = [...samples].sort((a, b) => (a.date < b.date ? -1 : 1));
  const mid = sorted.length >> 1;
  const diffs: number[] = [];
  for (const half of [sorted.slice(0, mid), sorted.slice(mid)]) {
    const e = half.filter((s) => s.exposed).map((s) => s.value);
    const o = half.filter((s) => !s.exposed).map((s) => s.value);
    if (e.length === 0 || o.length === 0) return false;
    diffs.push(mean(e) - mean(o));
  }
  return diffs[0]! !== 0 && diffs[1]! !== 0 && Math.sign(diffs[0]!) === Math.sign(diffs[1]!);
}

/** Runs the size gate and, when it passes, the permutation test. `seedKey` makes a read repeatable. */
export function evaluateFactor(f: FactorSamples, seedKey: string, through: string): FactorEval | null {
  if (!f.available) return null;
  const exposed = f.samples.filter((s) => s.exposed);
  const other = f.samples.filter((s) => !s.exposed);
  const base = {
    factor: f.factor,
    outcome: OUTCOME_OF[f.factor],
    n: f.samples.length,
    exposed: exposed.length,
    other: other.length,
    nights: [...f.samples]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((s) => ({ date: s.date, exposed: s.exposed })),
    threshold: f.threshold,
    through,
  };
  if (exposed.length < MIN_PER_GROUP || other.length < MIN_PER_GROUP) {
    return { ...base, diff: 0, sd: 0, p: null, halvesAgree: false };
  }
  const diff = mean(exposed.map((s) => s.value)) - mean(other.map((s) => s.value));
  const spread = sd(f.samples.map((s) => s.value));
  // An effect under the loose bar can never pass the gate, so skip the test.
  if (spread === 0 || Math.abs(diff) < LOOSE_EFFECT_SD * spread) {
    return { ...base, diff, sd: spread, p: null, halvesAgree: false };
  }
  const p = stratifiedPermutationP(f.samples, hash32(`${seedKey}|${f.factor}`));
  return { ...base, diff, sd: spread, p, halvesAgree: halvesAgree(f.samples) };
}

export type GateStatus = "none" | SleepConfidence;

/**
 * The gate. A finding appears at the strict bar and leaves at a looser one (`previous` is the status shown before), so a
 * card never flickers. Benjamini-Hochberg runs over every factor that got a test.
 */
export function gate(
  evals: (FactorEval | null)[],
  previous: Partial<Record<SleepFactor, GateStatus>>,
  windowNights: number,
): Partial<Record<SleepFactor, GateStatus>> {
  const status: Partial<Record<SleepFactor, GateStatus>> = {};
  const tested = evals.filter((e): e is FactorEval => e !== null && e.p !== null);
  const adj = benjaminiHochberg(tested.map((e) => e.p!));
  const adjOf = new Map(tested.map((e, i) => [e.factor, adj[i]!]));
  for (const e of evals) {
    if (!e) continue;
    status[e.factor] = "none";
    const q = adjOf.get(e.factor);
    if (q === undefined || windowNights < MIN_WINDOW_NIGHTS) continue;
    const was = previous[e.factor] ?? "none";
    const effect = Math.abs(e.diff) / e.sd;
    const strictMaybe = q <= P_MAYBE && effect >= MIN_EFFECT_SD;
    const keepMaybe = was !== "none" && q <= P_KEEP_MAYBE && effect >= LOOSE_EFFECT_SD;
    const maybe = strictMaybe || keepMaybe;
    if (!maybe) continue;
    const leaningSize = e.n >= LEANING_NIGHTS && e.halvesAgree && !LOW_PRIOR.includes(e.factor);
    const strictLeaning = leaningSize && q <= P_LEANING && effect >= MIN_EFFECT_SD;
    const keepLeaning = leaningSize && was === "leaning" && q <= P_KEEP_LEANING && effect >= LOOSE_EFFECT_SD;
    status[e.factor] = strictLeaning || keepLeaning ? "leaning" : "maybe";
  }
  return status;
}

export function toFinding(e: FactorEval, confidence: SleepConfidence): SleepFinding {
  return {
    factor: e.factor,
    confidence,
    outcome: e.outcome,
    exposed: e.exposed,
    other: e.other,
    diff: e.diff,
    threshold: e.threshold === null ? null : Math.round(e.threshold),
    nights: e.nights,
    through: e.through,
  };
}

// ---- progress, regularity, general facts ----------------------------------------------------------------------

export interface Need {
  factor: SleepFactor;
  side: "exposed" | "other";
  need: number;
  have: number;
}

/** What a factor still lacks before it can be compared; null when it can be (or cannot ever be judged). */
export function needOf(e: FactorEval | null): Need | null {
  if (!e) return null;
  if (e.exposed < MIN_PER_GROUP) return { factor: e.factor, side: "exposed", need: MIN_PER_GROUP - e.exposed, have: e.exposed };
  if (e.other < MIN_PER_GROUP) return { factor: e.factor, side: "other", need: MIN_PER_GROUP - e.other, have: e.other };
  return null;
}

/** Spread of the bedtimes over the last 7 nights; needs 5 of them. */
export function weekRegularity(nights: NightInput[]): { nights: number; sdMin: number } | null {
  const last = nights.slice(-7);
  if (last.length < 5) return null;
  return { nights: last.length, sdMin: Math.round(sd(last.map((n) => bedtimeLine(n.onsetMs, n.tzOffsetMin)))) };
}

/** Free-day minus work-day mid-sleep (minutes, positive = later on free days); 4 work + 2 free nights in 28 days. */
export function socialJetlag(nights: NightInput[], mask: number, through: string): number | null {
  const from = addDays(through, -28);
  const work: number[] = [];
  const free: number[] = [];
  for (const n of nights) {
    if (n.wakeDate <= from) continue;
    const mid = bedtimeLine(n.onsetMs, n.tzOffsetMin) + (n.wakeMs - n.onsetMs) / MIN / 2;
    (isFreeNight(n.wakeDate, mask) ? free : work).push(mid);
  }
  if (work.length < 4 || free.length < 2) return null;
  return Math.round(mean(free) - mean(work));
}

export interface LastCaffeine {
  /** local clock 'HH:MM' of the latest known-time caffeinated item in the last 7 days */
  clock: string;
  /** hours between that item and the person's usual bedtime of that day */
  hoursBeforeBed: number;
}

/** The latest caffeinated item of the last 7 days that still sat within 8 h of the usual bedtime. */
export function lastCaffeineBeforeBed(
  foods: FoodInput[],
  nights: NightInput[],
  nowMs: number,
  dayOffsetMin: number = WIB_OFFSET_MIN,
): LastCaffeine | null {
  const recent = nights.slice(-7);
  if (recent.length < 3) return null;
  const offset = recent[recent.length - 1]!.tzOffsetMin;
  const usualBed = median(recent.map((n) => localMinutes(n.onsetMs, n.tzOffsetMin)));
  let best: { ms: number } | null = null;
  for (const item of foods) {
    if (caffeineMgFor(item.name) === null) continue;
    const t = foodTime(item, dayOffsetMin);
    if (!t.known || t.ms > nowMs || nowMs - t.ms > 7 * DAY) continue;
    if (!best || t.ms > best.ms) best = { ms: t.ms };
  }
  if (!best) return null;
  const clockMin = localMinutes(best.ms, offset);
  let gap = usualBed - clockMin;
  if (gap < 0) gap += 1440;
  const hours = gap / 60;
  if (hours > 8) return null;
  const hh = String(Math.floor(clockMin / 60)).padStart(2, "0");
  const mm = String(clockMin % 60).padStart(2, "0");
  return { clock: `${hh}:${mm}`, hoursBeforeBed: Math.max(1, Math.round(hours)) };
}

/** Any alcoholic drink with a known time in the last 7 days (a general tip, never a personal card). */
export function hasRecentAlcohol(foods: FoodInput[], nowMs: number, dayOffsetMin: number = WIB_OFFSET_MIN): boolean {
  return foods.some((item) => {
    if (!isAlcoholicDrink(item.name)) return false;
    const t = foodTime(item, dayOffsetMin);
    return t.known && t.ms <= nowMs && nowMs - t.ms <= 7 * DAY;
  });
}

/** Cheap fingerprint of a factor's inputs: a cached evaluation is reused only while this is equal. */
export function signatureOf(f: FactorSamples, seedKey: string): string {
  const body = f.samples.map((s) => `${s.date}:${s.exposed ? 1 : 0}:${Math.round(s.value * 10)}:${s.stratum}`).join(",");
  return hash32(`${SLEEP_ENGINE_REV}|${seedKey}|${f.factor}|${f.available ? 1 : 0}|${f.threshold ?? ""}|${body}`).toString(36);
}

// ---- release ---------------------------------------------------------------------------------------------------

/** What the cache keeps per factor: the raw evaluation, the gate's last status and when a finding first showed. */
export interface FactorState {
  eval: FactorEval | null;
  status: GateStatus;
  /** WIB day a finding first became visible; null while hidden or not a finding. */
  firstShownDay: string | null;
}

/**
 * At most one NEW personal finding becomes visible per day: of the findings that passed the gate and were never shown,
 * the strongest (effect over SD) is released when nothing was released today; the others wait for later days. A factor
 * that fell out of the gate is forgotten, so it can come back as new.
 */
export function releaseNew(states: Partial<Record<SleepFactor, FactorState>>, today: string): void {
  const all = FACTORS.flatMap((f) => (states[f] ? [states[f]!] : []));
  for (const s of all) if (s.status === "none") s.firstShownDay = null;
  if (all.some((s) => s.firstShownDay === today)) return;
  const waiting = all.filter((s) => s.status !== "none" && s.firstShownDay === null && s.eval);
  if (waiting.length === 0) return;
  waiting.sort((a, b) => Math.abs(b.eval!.diff) / b.eval!.sd - Math.abs(a.eval!.diff) / a.eval!.sd);
  waiting[0]!.firstShownDay = today;
}

/** The findings a person may see: gate passed and released. */
export function visibleFindings(states: Partial<Record<SleepFactor, FactorState>>): SleepFinding[] {
  return FACTORS.flatMap((f) => {
    const s = states[f];
    if (!s || !s.eval || s.status === "none" || s.firstShownDay === null) return [];
    return [toFinding(s.eval, s.status)];
  });
}
