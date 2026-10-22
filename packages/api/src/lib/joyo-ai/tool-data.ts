// The data seam of Joyo AI: ONE read path shared by the BYOK client (the phone, through the oRPC client) and the hosted engine
// (the server, through `call(procedure, input, { context })`), so both engines answer from the same existing procedures with
// the same numbers. Pure: no db, no react, no expo. `createToolData` copies NAMED fields only, so maternal/cycle fields,
// the name, email, photo and scan ids and places that these procedures carry can never reach a tool result or the digest.

import type { AppRouterClient } from "../../routers";
import { daysBetween, macroTargets, shiftDate } from "../engine";
import { flat } from "./digest";
import { lookupFood, normalize } from "./foods";
import type { Nutrient, Remaining } from "./foods";
import type { Engine } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// The wrapped procedures (types follow the router: a rename breaks the build)

export type DaySummaryOut = Awaited<ReturnType<AppRouterClient["day"]["summary"]>>;
export type FoodByDateOut = Awaited<ReturnType<AppRouterClient["food"]["listByDate"]>>;
export type KcalSeriesOut = Awaited<ReturnType<AppRouterClient["day"]["kcalSeries"]>>;
export type DiaryRangeOut = Awaited<ReturnType<AppRouterClient["ai"]["diaryRange"]>>;
export type WaterSeriesOut = Awaited<ReturnType<AppRouterClient["water"]["series"]>>;
export type WeightHistoryOut = Awaited<ReturnType<AppRouterClient["weight"]["history"]>>;
export type MyProfileOut = Awaited<ReturnType<AppRouterClient["profile"]["myProfile"]>>;
export type FastingTodayOut = Awaited<ReturnType<AppRouterClient["fasting"]["today"]>>;
export type ScanAllowanceOut = Awaited<ReturnType<AppRouterClient["profile"]["scanAllowance"]>>;
export type RecentFoodsOut = Awaited<ReturnType<AppRouterClient["food"]["recent"]>>;

export interface RogoRpc {
  daySummary(date: string): Promise<DaySummaryOut>;
  foodByDate(date: string): Promise<FoodByDateOut>;
  kcalSeries(from: string, to: string): Promise<KcalSeriesOut>;
  /** ai.diaryRange; absent, or rejecting with NOT_FOUND (an older server), means the BYOK fallback below. */
  diaryRange?(from: string, to: string): Promise<DiaryRangeOut>;
  waterSeries(from: string, to: string): Promise<WaterSeriesOut>;
  weightHistory(limit: number): Promise<WeightHistoryOut>;
  myProfile(): Promise<MyProfileOut>;
  fastingToday(date: string): Promise<FastingTodayOut>;
  scanAllowance?(): Promise<ScanAllowanceOut>;
  /** food.recent: the last 10 distinct foods with their latest grams, the source of `usualGrams`. */
  recentFoods?(): Promise<RecentFoodsOut>;
}

/** For native/web: the existing procedures through the typed client. */
export function rpcFromClient(client: AppRouterClient): RogoRpc {
  return {
    daySummary: (date) => client.day.summary({ date }),
    foodByDate: (date) => client.food.listByDate({ date }),
    kcalSeries: (from, to) => client.day.kcalSeries({ from, to }),
    diaryRange: (from, to) => client.ai.diaryRange({ from, to }),
    waterSeries: (from, to) => client.water.series({ from, to }),
    weightHistory: (limit) => client.weight.history({ limit }),
    myProfile: () => client.profile.myProfile(),
    fastingToday: (date) => client.fasting.today({ date }),
    scanAllowance: () => client.profile.scanAllowance(),
    recentFoods: () => client.food.recent(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the tools and the digest read (named fields only)

export const MEAL_ORDER = ["sarapan", "sahur", "makan_siang", "berbuka", "makan_malam", "snack"] as const;

export interface DayItem {
  meal: string;
  name: string;
  grams: number | null;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** Logged from a photo scan. */
  scanned: boolean;
}

/** A macro total over the logged rows that HAVE the value; `g` is null when no row has it, never 0. */
export interface MacroSum {
  g: number | null;
  /** Rows with no value for this macro (quick-log, imports): the sum is then a lower bound. */
  missingRows: number;
}

export interface DayTargets {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

export interface FastingState {
  pattern: string;
  state: "puasa" | "jendela_makan" | null;
  windowOpen: string | null;
  windowClose: string | null;
}

export interface DayData {
  date: string;
  items: DayItem[];
  totals: { kcal: number; protein: MacroSum; carbs: MacroSum; fat: MacroSum; fiber: MacroSum; rows: number };
  /** The app's own targets: the eat budget includes counted exercise (day.summary), the macros use the diary's own formula. */
  targets: DayTargets | null;
  /** Target minus eaten (known rows); null where there is no target or no row has the macro. */
  remaining: Remaining | null;
  /** Macros whose `remaining` is only an upper bound because some logged rows lack the value. */
  remainingPartial: Nutrient[];
  water: { glasses: number; goal: number } | null;
  fasting: FastingState | null;
}

export interface RangeDay {
  date: string;
  /** null = nothing logged that day (not "0 kcal"). */
  kcal: number | null;
  /** Known sums; null when the source has no value for the day (a day older than the fallback window, or no row has it). */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** Macros that some logged rows lack, so the day's sum is a lower bound. */
  partial: Nutrient[];
  water: number | null;
  logged: boolean;
}

export interface RangeData {
  days: RangeDay[];
  /** Plain notes for the model (e.g. "protein only for the last 14 days"). */
  notes: string[];
}

export interface WeighIn {
  date: string;
  kg: number;
}

export interface WeightData {
  /** Oldest first. */
  entries: WeighIn[];
  targetKg: number | null;
}

export interface ProfileData {
  ageYears: number | null;
  sex: "male" | "female" | null;
  heightCm: number | null;
  goal: "lose" | "maintain" | "gain" | null;
  activityLevel: string | null;
  tdeeKcal: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  latestWeightKg: number | null;
  scanAllowance: { used: number; quota: number | null; left: number | null } | null;
}

export interface ToolData {
  /**
   * Who reads this data. `byok` (the person's own provider key) never carries anything that came from Health Connect or Apple Health
   * (see `HEALTH_STORE_SOURCES`); `hosted` (our server, Workers AI) keeps everything.
   */
  readonly engine: Engine;
  /** Today as `YYYY-MM-DD` (the device's day). */
  today(): string;
  day(date: string): Promise<DayData>;
  range(from: string, to: string): Promise<RangeData>;
  /** Weigh-ins from `from` to today, oldest first. */
  weights(from: string): Promise<WeightData>;
  profile(): Promise<ProfileData>;
  /** The person's own usual grams of a food (latest logged), when they have logged it; null otherwise. */
  usualGrams?(name: string): Promise<number | null>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sanitising helpers

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const NAME_MAX = 80;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/** `ORPCError` NOT_FOUND (or an HTTP 404): the procedure does not exist on this server. */
function isNotFound(error: unknown): boolean {
  const e = rec(error);
  return e.code === "NOT_FOUND" || e.status === 404;
}

/** The diary's own macro reference weight (`day.ts` DIARY_MACRO_REFERENCE_KG; Makan and the web card use the same number). */
const MACRO_REFERENCE_KG = 70;

function dayItem(raw: unknown): DayItem {
  const r = rec(raw);
  return {
    meal: flat(typeof r.meal === "string" ? r.meal : "", 20),
    name: flat(typeof r.name === "string" ? r.name : "", NAME_MAX),
    grams: num(r.grams),
    kcal: num(r.kcal) ?? 0,
    protein: num(r.protein),
    carbs: num(r.carbs),
    fat: num(r.fat),
    fiber: num(r.fiber),
    scanned: r.source === "ai",
  };
}

function macroSum(items: readonly DayItem[], key: "protein" | "carbs" | "fat" | "fiber"): MacroSum {
  let sum = 0;
  let known = 0;
  for (const item of items) {
    const v = item[key];
    if (v !== null) {
      sum += v;
      known += 1;
    }
  }
  return { g: known === 0 ? null : round1(sum), missingRows: items.length - known };
}

const dayDates = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
};

/** Days of a range for which the fallback path reads the diary itself (one request each). */
export const FALLBACK_MACRO_DAYS = 14;

const NUTRIENT_KEYS = ["protein", "carbs", "fat", "fiber"] as const;

function partialOf(missing: Record<(typeof NUTRIENT_KEYS)[number], number>): Nutrient[] {
  return NUTRIENT_KEYS.filter((k) => missing[k] > 0);
}

/** Where a row can come from when a health store (Android Health Connect, iOS HealthKit) wrote it: never sent to an own-key provider. */
export const HEALTH_STORE_SOURCES: readonly string[] = ["health_connect", "apple_health"];

/**
 * The model-facing sentence every own-key tool result and the system prompt carry: activity, steps, workouts, sleep, heart rate
 * and weigh-ins that a health store wrote are not shared, and the kcal budget is the base budget without the activity credit.
 */
export const BYOK_HEALTH_NOTE =
  "Data from Health Connect / Apple Health (steps, workouts and active energy, sleep, heart rate, imported weight) is not shared with own-key AI and is NOT zero: it is unknown. The kcal budget here is the base budget without any credit for counted exercise, so do not say or assume the person did or did not exercise."; // i18n-ok: model-facing text

export function createToolData(rpc: RogoRpc, opts: { today: () => string; engine: Engine }): ToolData {
  const byok = opts.engine === "byok";
  const today = opts.today;
  let diaryUnsupported = rpc.diaryRange === undefined;
  let recentIndex: Promise<Map<string, number>> | null = null;
  let profileCache: Promise<ProfileData> | null = null;

  // Whether the plan is a maternal one is read ONLY to withhold the weight-loss/gain framing (goal, target weight and date);
  // nothing about it is ever returned, so it cannot reach a result or the digest.
  let maternalCache: Promise<boolean> | null = null;
  function isMaternalPlan(): Promise<boolean> {
    maternalCache ??= rpc.myProfile().then((out) => {
      const mode = rec(rec(out).profile).maternalMode;
      return mode !== undefined && mode !== "none";
    });
    return maternalCache;
  }

  async function day(date: string): Promise<DayData> {
    const [summary, listed, water, fasting] = await Promise.all([
      rpc.daySummary(date),
      rpc.foodByDate(date),
      rpc.waterSeries(date, date).catch(() => null),
      rpc.fastingToday(date).catch(() => null),
    ]);
    const items = (Array.isArray(listed.items) ? listed.items : []).map(dayItem);
    const totals = {
      kcal: Math.round(items.reduce((sum, i) => sum + i.kcal, 0)),
      protein: macroSum(items, "protein"),
      carbs: macroSum(items, "carbs"),
      fat: macroSum(items, "fat"),
      fiber: macroSum(items, "fiber"),
      rows: items.length,
    };

    const s = rec(summary);
    const t = rec(s.targets);
    const exerciseKcal = num(t.exerciseKcal);
    // The eat budget is the base plus the counted exercise, and the credit comes from Health Connect / Apple Health readings and
    // workouts, which an own-key provider never gets: its budget is the base alone. Without `exerciseKcal` the base cannot be
    // told apart from the budget, so there is no target rather than one that may carry the credit.
    const eatKcal = byok ? (num(t.eatKcal) === null || exerciseKcal === null ? null : num(t.eatKcal)! - exerciseKcal) : num(t.eatKcal);
    const proteinTarget = num(rec(s.protein).targetG);
    let targets: DayTargets | null = null;
    if (eatKcal !== null) {
      const macros = macroTargets(eatKcal, MACRO_REFERENCE_KG);
      targets = { kcal: Math.round(eatKcal), protein: proteinTarget, carbs: macros.carbsG, fat: macros.fatG, fiber: macros.fiberG };
    }

    let remaining: Remaining | null = null;
    const remainingPartial: Nutrient[] = [];
    if (targets) {
      const left = (target: number | null, sum: MacroSum, key: Nutrient): number | null => {
        if (target === null || sum.g === null) return null;
        if (sum.missingRows > 0) remainingPartial.push(key);
        return round1(target - sum.g);
      };
      remaining = {
        kcal: targets.kcal === null ? null : Math.round(targets.kcal - totals.kcal),
        protein: left(targets.protein, totals.protein, "protein"),
        carbs: left(targets.carbs, totals.carbs, "carbs"),
        fat: left(targets.fat, totals.fat, "fat"),
        fiber: left(targets.fiber, totals.fiber, "fiber"),
      };
    }

    const waterRow = water ? rec(Array.isArray(water.days) ? water.days[0] : null) : null;
    const f = rec(fasting);
    const fastingState: FastingState | null =
      f.active === true && typeof f.pattern === "string" && f.ramadan !== true
        ? {
            pattern: flat(f.pattern, 8),
            state: f.state === "puasa" || f.state === "jendela_makan" ? f.state : null,
            windowOpen: typeof f.windowOpen === "string" ? flat(f.windowOpen, 5) : null,
            windowClose: typeof f.windowClose === "string" ? flat(f.windowClose, 5) : null,
          }
        : null;

    return {
      date,
      items,
      totals,
      targets,
      remaining,
      remainingPartial,
      water: waterRow && water && num(water.goal) !== null ? { glasses: num(waterRow.glasses) ?? 0, goal: num(water.goal) as number } : null,
      fasting: fastingState,
    };
  }

  /** diaryRange rows by date, or null when this server has no `ai.diaryRange`. */
  async function diaryByDate(from: string, to: string): Promise<Map<string, Record<string, unknown>> | null> {
    if (diaryUnsupported || !rpc.diaryRange) return null;
    try {
      const out = await rpc.diaryRange(from, to);
      return new Map((Array.isArray(out.days) ? out.days : []).map((d) => [String(rec(d).date), rec(d)]));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      diaryUnsupported = true;
      return null;
    }
  }

  async function range(from: string, to: string): Promise<RangeData> {
    const notes: string[] = [];
    const [diary, waterOut] = await Promise.all([diaryByDate(from, to), rpc.waterSeries(from, to).catch(() => null)]);
    const waterBy = new Map<string, number>(
      (waterOut && Array.isArray(waterOut.days) ? waterOut.days : []).map((d) => [String(rec(d).date), num(rec(d).glasses) ?? 0]),
    );
    const dates = dayDates(from, to);
    const days: RangeDay[] = [];

    if (diary) {
      for (const date of dates) {
        const row = diary.get(date);
        if (!row) {
          days.push({ date, kcal: null, protein: null, carbs: null, fat: null, fiber: null, partial: [], water: waterOut ? (waterBy.get(date) ?? 0) : null, logged: false });
          continue;
        }
        const itemsN = num(row.items) ?? 0;
        const rowsWith = rec(row.rowsWith);
        const missing = { protein: 0, carbs: 0, fat: 0, fiber: 0 };
        for (const k of NUTRIENT_KEYS) {
          const known = num(rowsWith[k]);
          missing[k] = known === null ? 0 : Math.max(0, itemsN - known);
        }
        const kcal = num(row.kcal);
        days.push({
          date,
          kcal: kcal === null ? null : Math.round(kcal),
          protein: num(row.protein) === null ? null : round1(num(row.protein) as number),
          carbs: num(row.carbs) === null ? null : round1(num(row.carbs) as number),
          fat: num(row.fat) === null ? null : round1(num(row.fat) as number),
          fiber: num(row.fiber) === null ? null : round1(num(row.fiber) as number),
          partial: partialOf(missing),
          water: waterOut ? (waterBy.get(date) ?? 0) : null,
          logged: kcal !== null,
        });
      }
    } else {
      // BYOK fallback for a server without ai.diaryRange: kcal for any range from day.kcalSeries, macros and fiber from the
      // diary itself for the last FALLBACK_MACRO_DAYS days only; older days keep them null.
      const series = await rpc.kcalSeries(from, to);
      const kcalBy = new Map(series.map((r) => [r.date, num(r.kcal)]));
      const macroFrom = daysBetween(from, to) + 1 > FALLBACK_MACRO_DAYS ? shiftDate(to, -(FALLBACK_MACRO_DAYS - 1)) : from;
      const macroDates = dates.filter((d) => d >= macroFrom && kcalBy.get(d) != null);
      const perDay = new Map<string, DayData["totals"]>();
      await Promise.all(
        macroDates.map(async (date) => {
          const listed = await rpc.foodByDate(date);
          const items = (Array.isArray(listed.items) ? listed.items : []).map(dayItem);
          perDay.set(date, {
            kcal: items.reduce((s, i) => s + i.kcal, 0),
            protein: macroSum(items, "protein"),
            carbs: macroSum(items, "carbs"),
            fat: macroSum(items, "fat"),
            fiber: macroSum(items, "fiber"),
            rows: items.length,
          });
        }),
      );
      if (macroFrom !== from) notes.push(`protein, carbs, fat and fiber only exist from ${macroFrom} to ${to}; older days are null (unknown)`);
      for (const date of dates) {
        const kcal = kcalBy.get(date) ?? null;
        const t = perDay.get(date);
        days.push({
          date,
          kcal: kcal === null ? null : Math.round(kcal),
          protein: t?.protein.g ?? null,
          carbs: t?.carbs.g ?? null,
          fat: t?.fat.g ?? null,
          fiber: t?.fiber.g ?? null,
          partial: t ? partialOf({ protein: t.protein.missingRows, carbs: t.carbs.missingRows, fat: t.fat.missingRows, fiber: t.fiber.missingRows }) : [],
          water: waterOut ? (waterBy.get(date) ?? 0) : null,
          logged: kcal !== null,
        });
      }
    }
    if (!waterOut) notes.push("water is unknown (could not be read)");
    if (days.some((d) => d.partial.length > 0)) {
      notes.push("a day listing `partial` has logged rows without that value, so its figure is a lower bound");
    }
    return { days, notes };
  }

  async function weights(from: string): Promise<WeightData> {
    const out = await rpc.weightHistory(365);
    const entries: WeighIn[] = [];
    for (const e of Array.isArray(out.entries) ? out.entries : []) {
      const r = rec(e);
      const kg = num(r.weightKg);
      // A weigh-in a health store wrote is not shared with an own-key provider.
      if (byok && typeof r.source === "string" && HEALTH_STORE_SOURCES.includes(r.source)) continue;
      if (typeof r.date === "string" && kg !== null && r.date >= from) entries.push({ date: r.date.slice(0, 10), kg: round1(kg) });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const target = num(rec(out.summary).targetKg);
    const maternal = await isMaternalPlan().catch(() => false);
    return { entries, targetKg: maternal || target === null ? null : round1(target) };
  }

  async function profile(): Promise<ProfileData> {
    profileCache ??= (async () => {
      // The own-key engine's latest weight comes from the weigh-ins it may read (the server's figure can be a health store's).
      const [out, allowance, maternal, ownWeights] = await Promise.all([
        rpc.myProfile(),
        rpc.scanAllowance ? rpc.scanAllowance().catch(() => null) : Promise.resolve(null),
        isMaternalPlan().catch(() => false),
        byok ? weights("0000-01-01").catch(() => null) : Promise.resolve(null),
      ]);
      const p = rec(rec(out).profile);
      const t = rec(rec(out).targets);
      const birthYear = num(p.birthYear);
      const year = Number(today().slice(0, 4));
      const goal = p.goal === "lose" || p.goal === "maintain" || p.goal === "gain" ? p.goal : null;
      const a = rec(allowance);
      return {
        ageYears: birthYear === null ? null : year - birthYear,
        sex: p.gender === "male" || p.gender === "female" ? p.gender : null,
        heightCm: num(p.heightCm),
        // A maternal plan has no weight goal: the loss/gain framing is withheld rather than sent.
        goal: maternal ? null : goal,
        activityLevel: typeof t.level === "string" ? flat(t.level, 20) : typeof p.activityLevel === "string" ? flat(p.activityLevel, 20) : null,
        tdeeKcal: num(t.tdee) === null ? null : Math.round(num(t.tdee) as number),
        targetWeightKg: maternal || num(p.targetWeightKg) === null ? null : round1(num(p.targetWeightKg) as number),
        targetDate: maternal || typeof p.targetDate !== "string" ? null : flat(p.targetDate, 10),
        latestWeightKg: byok
          ? (ownWeights?.entries.at(-1)?.kg ?? null)
          : num(rec(out).latestWeightKg) === null ? null : round1(num(rec(out).latestWeightKg) as number),
        scanAllowance: allowance ? { used: num(a.used) ?? 0, quota: num(a.quota), left: num(a.left) } : null,
      };
    })();
    return profileCache;
  }

  const usualGrams: ToolData["usualGrams"] = rpc.recentFoods
    ? async (name) => {
        const recent = rpc.recentFoods;
        if (!recent) return null;
        recentIndex ??= recent().then((out) => {
          const map = new Map<string, number>();
          for (const raw of Array.isArray(out.items) ? out.items : []) {
            const r = rec(raw);
            const grams = num(r.grams);
            if (typeof r.name !== "string" || grams === null || grams <= 0) continue;
            map.set(normalize(r.name), grams);
            const found = lookupFood(r.name);
            if (found.ok) map.set(`row:${found.food.code ?? found.food.name}`, grams);
          }
          return map;
        });
        const index = await recentIndex;
        const direct = index.get(normalize(name));
        if (direct !== undefined) return direct;
        const found = lookupFood(name);
        return found.ok ? (index.get(`row:${found.food.code ?? found.food.name}`) ?? null) : null;
      }
    : undefined;

  return { engine: opts.engine, today, day, range, weights, profile, ...(usualGrams ? { usualGrams } : {}) };
}
