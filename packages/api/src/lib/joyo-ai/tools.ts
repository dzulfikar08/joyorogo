// Ported from JoyoFit (watch-fit) src/features/ai/tools.ts, adapted for JoyoRogo.
/**
 * The tools of Joyo AI: seven, all read-only, defined once in a neutral schema (the adapters translate it per provider) and run
 * wherever the engine runs (the phone for the own-key engine, the server for the hosted one) over the same `ToolData`.
 *
 * Every result is JSON text capped at TOOL_LIMITS.resultChars. Arithmetic (sums, remaining, means, deltas, ranks) is done here,
 * never left to the model. Unknown stays null: a macro that no logged row has, a food we have no row for and a nutrient column
 * we lack (sugar) are never turned into 0 or a guess. Free text from the diary is flattened.
 */

import type { Engine, ToolCall, ToolSpec } from "./types";
import { daysBetween, shiftDate } from "../engine";
import { flat } from "./digest";
import { RANK_BY, TYPICAL_PORTION_NOTE, amountsFor, choosePortion, compareFoods, fitsToday, lookupFood, searchFoods } from "./foods";
import type { RankBy, Remaining } from "./foods";
import { BYOK_HEALTH_NOTE, MEAL_ORDER } from "./tool-data";
import type { DayData, MacroSum, RangeDay, ToolData, WeighIn } from "./tool-data";

export const TOOL_LIMITS = { maxDays: 90, maxRows: 200, resultChars: 6_000, itemsPerDay: 40 } as const;

export const TOOL_NAMES = ["get_day", "get_range", "get_weight_trend", "get_targets", "search_foods", "compare_foods", "fits_today"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

const RANGE_FIELDS = ["kcal", "protein", "carbs", "fat", "fiber", "water"] as const;
type RangeField = (typeof RANGE_FIELDS)[number];

const DATE = { type: "string", description: "Local date, YYYY-MM-DD" } as const; // i18n-ok: model-facing text

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "get_day",
    // i18n-ok: model-facing text
    description:
      "One day of the person's diary: every logged item by meal (name, grams, kcal, protein, carbs, fat, fiber, scanned), the day's totals, the app's own targets for that day (kcal is the eat budget including counted exercise), what is remaining of each (negative = over), water glasses and goal, and the fasting state if the person fasts. A macro total is {g, missingRows}: some logged rows have no value for it, so g is a lower bound; null means no row has it. Defaults to today.",
    parameters: { type: "object", properties: { date: { ...DATE, description: "Local date, YYYY-MM-DD; default today" } } }, // i18n-ok: model-facing text
  },
  {
    name: "get_range",
    // i18n-ok: model-facing text
    description:
      "Per-day figures over a date range of at most 90 days: kcal, protein, carbs, fat, fiber, water glasses and whether anything was logged. A day with nothing logged has kcal null (not 0). Protein/carbs/fat/fiber are null when the source has no value for that day; a day with `partial` has rows without that value, so its figure is a lower bound. Also returns means over the days that have the value. Use it for averages and patterns.",
    parameters: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        fields: { type: "array", items: { type: "string", enum: [...RANGE_FIELDS] }, description: "Which figures to return; default all" }, // i18n-ok: model-facing text
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_weight_trend",
    // i18n-ok: model-facing text
    description:
      "Weigh-ins over the last N days (7 to 365; downsampled to at most 60 points): first, last, change in kg, mean weekly change, and the last 7 days against the 7 days before it (mean weight and mean logged kcal), computed in code. Use it for questions about weight going up or down.",
    parameters: { type: "object", properties: { days: { type: "integer", minimum: 7, maximum: 365, description: "How many days back, 7 to 365; default 30" } } }, // i18n-ok: model-facing text
  },
  {
    name: "get_targets",
    // i18n-ok: model-facing text
    description:
      "The person's profile numbers and targets: age, sex, height, goal, activity level, TDEE, today's eat budget in kcal (including counted exercise), protein/carbs/fat/fiber targets, target weight and date, latest weight, and today's free scan allowance.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_foods",
    // i18n-ok: model-facing text
    description:
      "Looks a food name up in OUR food data (Indonesian TKPI 2019, a dish library, a few USDA rows). Returns up to 8 candidate rows with code and name, and for the best ones kcal and fiber per 100 g plus per typical portion (`portion` with its source; typical = our household estimate). Use it when a name is ambiguous or unknown before comparing.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Food name in Indonesian, English or Malay, or a TKPI code such as ER073" }, // i18n-ok: model-facing text
        limit: { type: "integer", minimum: 1, maximum: 8, description: "Candidates to return, default 5" }, // i18n-ok: model-facing text
      },
      required: ["query"],
    },
  },
  {
    name: "compare_foods",
    // i18n-ok: model-facing text
    description:
      "Compares 2 to 6 foods from OUR data: per 100 g (kcal, protein, carbs, fat, fiber) and per typical portion (the person's own usual grams, a typical dish serving, one counted piece, or our typical household portion such as 1 slice of papaya, source typical), ranked by one nutrient (highest first). A food we have no row for is listed under `unknown` and never ranked; a row whose macros do not add up has them withheld (null) but keeps kcal and fiber. Sugar is not in our data (always unknown). A food with no portion at all is compared per 100 g, or pass grams. NEVER quote a number for a food that is not in this result.",
    parameters: {
      type: "object",
      properties: {
        foods: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6, description: "Food names as the person said them" }, // i18n-ok: model-facing text
        grams: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
          description: "Grams eaten: one number for all foods, or one per food in the same order. Omit to use typical portions (do not ask the person for grams first).", // i18n-ok: model-facing text
        },
        by: { type: "string", enum: [...RANK_BY], description: "Nutrient to rank by; default fiber" }, // i18n-ok: model-facing text
      },
      required: ["foods"],
    },
  },
  {
    name: "fits_today",
    // i18n-ok: model-facing text
    description:
      "How one food fits TODAY's remaining kcal, protein, carbs, fat and fiber (the app's own numbers: target minus eaten): the food's amounts and what is left after eating it, with over flags (null = unknown). Grams default to the typical portion: the person's own usual grams, a dish serving, a counted piece, or our typical household portion (an estimate, source typical: assume one portion, state the assumption and answer without asking for grams). Only when the result says needsGrams do you ask the person for grams.",
    parameters: {
      type: "object",
      properties: {
        food: { type: "string", description: "Food name as the person said it" }, // i18n-ok: model-facing text
        grams: { type: "number", description: "Grams to eat; default one typical portion" }, // i18n-ok: model-facing text
      },
      required: ["food"],
    },
  },
];

/** The tools as an engine sees them: the own-key engine's budget has no exercise credit (health-store data is not shared with it). */
export function toolSpecsFor(engine: Engine): readonly ToolSpec[] {
  if (engine === "hosted") return TOOL_SPECS;
  return TOOL_SPECS.map((spec) => ({
    ...spec,
    description: spec.description
      .replace("(kcal is the eat budget including counted exercise)", "(kcal is the base eat budget; credit for exercise from health apps is not shared with own-key AI)")
      .replace("today's eat budget in kcal (including counted exercise)", "today's base eat budget in kcal (no credit for exercise from health apps, which is not shared with own-key AI)"), // i18n-ok: model-facing text
  }));
}

/** What the answer screen shows under a reply as "based on": the tool and its plain arguments. No health values. */
export interface ToolTrace {
  tool: ToolName;
  args: Record<string, string | number | string[]>;
}

/** What a tool step shows after it ran: how many rows it found, or that it found nothing or failed. No health values. */
export interface ToolSummary {
  count: number | null;
  empty: boolean;
  failed: boolean;
  /** Kept for shape parity with JoyoFit (signed-out state); always false here, the data is read through the account. */
  notConnected: boolean;
  /** A food tool where none of the named foods is in our data. */
  unknown: boolean;
}

export interface ToolOutcome {
  content: string;
  trace: ToolTrace;
  summary: ToolSummary;
}

class ToolInputError extends Error {}

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

const round1 = (n: number): number => Math.round(n * 10) / 10;

const okSummary = (count: number | null, empty: boolean, unknown = false): ToolSummary => ({ count, empty, failed: false, notConnected: false, unknown });
const FAILED: ToolSummary = { count: null, empty: false, failed: true, notConnected: false, unknown: false };

interface Dispatched {
  value: Record<string, unknown>;
  /** The list inside `value` whose rows may be dropped to fit the cap, and which end is the old one. */
  listKey?: string;
  trace: ToolTrace;
  summary: ToolSummary;
}

/** Keeps a result under the character cap: list rows are dropped from the old end (the front), anything else is refused. */
function cap(value: Record<string, unknown>, listKey: string | undefined): string {
  let json = JSON.stringify(value);
  if (json.length <= TOOL_LIMITS.resultChars) return json;
  const list = listKey && Array.isArray(value[listKey]) ? [...(value[listKey] as unknown[])] : null;
  if (list && listKey) {
    let dropped = 0;
    while (list.length > 1 && json.length > TOOL_LIMITS.resultChars) {
      list.shift();
      dropped += 1;
      json = JSON.stringify({ ...value, [listKey]: list, truncatedRows: dropped });
    }
    if (json.length <= TOOL_LIMITS.resultChars) return json;
  }
  return JSON.stringify({ error: "result too large, ask for a shorter range" }); // i18n-ok: model-facing text
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? flat(v, max) : "");

function positiveNumber(v: unknown, what: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 5_000) throw new ToolInputError(`${what} must be a number of grams above 0 and at most 5000`); // i18n-ok: model-facing text
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------------------------------------------------
// get_day

const macroOut = (sum: MacroSum): MacroSum | null => (sum.g === null ? null : sum);

function dayResult(day: DayData): Record<string, unknown> {
  const shown = day.items.slice(0, TOOL_LIMITS.itemsPerDay);
  const itemOut = ({ name, grams, kcal, protein, carbs, fat, fiber, scanned }: DayData["items"][number]) => ({ name, grams, kcal, protein, carbs, fat, fiber, scanned });
  const meals: { meal: string; items: ReturnType<typeof itemOut>[] }[] = MEAL_ORDER.map((meal) => ({
    meal: meal as string,
    items: shown.filter((i) => i.meal === meal).map(itemOut),
  })).filter((m) => m.items.length > 0);
  // A meal slot this build does not know still shows up, after the known ones.
  const otherItems = shown.filter((i) => !(MEAL_ORDER as readonly string[]).includes(i.meal));
  if (otherItems.length > 0) meals.push({ meal: "other", items: otherItems.map(itemOut) });
  const t = day.totals;
  return {
    date: day.date,
    logged: day.items.length > 0,
    meals,
    ...(day.items.length > shown.length ? { itemsOmitted: day.items.length - shown.length } : {}),
    totals: { kcal: t.kcal, protein: macroOut(t.protein), carbs: macroOut(t.carbs), fat: macroOut(t.fat), fiber: macroOut(t.fiber), rows: t.rows },
    targets: day.targets,
    remaining: day.remaining,
    ...(day.remainingPartial.length > 0 ? { remainingUpperBound: day.remainingPartial } : {}), // i18n-ok: model-facing text
    water: day.water,
    fasting: day.fasting,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// get_range

function rangeArgs(a: Record<string, unknown>): { from: string; to: string; clamped: boolean } {
  if (!isDate(a.from) || !isDate(a.to)) throw new ToolInputError("from and to must be dates as YYYY-MM-DD"); // i18n-ok: model-facing text
  let from = a.from;
  let to = a.to;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) + 1 > TOOL_LIMITS.maxDays) return { from: shiftDate(to, -(TOOL_LIMITS.maxDays - 1)), to, clamped: true };
  return { from, to, clamped: false };
}

function fieldsArg(raw: unknown): RangeField[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...RANGE_FIELDS];
  const wanted = raw.filter((f): f is RangeField => typeof f === "string" && (RANGE_FIELDS as readonly string[]).includes(f));
  return wanted.length > 0 ? [...new Set(wanted)] : [...RANGE_FIELDS];
}

/** Mean over the days that HAVE the value (never counting a missing day as 0). */
function meanOf(values: readonly (number | null)[]): { mean: number | null; days: number } {
  const v = values.filter((x): x is number => x !== null);
  return { mean: v.length === 0 ? null : round1(v.reduce((s, x) => s + x, 0) / v.length), days: v.length };
}

function rangeRow(d: RangeDay, fields: readonly RangeField[]): Record<string, unknown> {
  const row: Record<string, unknown> = { date: d.date, logged: d.logged };
  for (const f of fields) row[f] = f === "water" ? d.water : d[f];
  const partial = d.partial.filter((n) => (fields as readonly string[]).includes(n));
  if (partial.length > 0) row.partial = partial;
  return row;
}

// ---------------------------------------------------------------------------------------------------------------------
// get_weight_trend

function downsample(entries: readonly WeighIn[], max: number): WeighIn[] {
  if (entries.length <= max) return [...entries];
  const picked = new Set<number>();
  for (let i = 0; i < max; i += 1) picked.add(Math.round((i * (entries.length - 1)) / (max - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => entries[i] as WeighIn);
}

function windowStats(entries: readonly WeighIn[], rows: readonly RangeDay[], from: string, to: string) {
  const weights = entries.filter((e) => e.date >= from && e.date <= to).map((e) => e.kg);
  const kcal = rows.filter((r) => r.date >= from && r.date <= to).map((r) => r.kcal);
  const w = meanOf(weights);
  const k = meanOf(kcal);
  return { from, to, meanKg: w.mean, weighIns: w.days, meanKcal: k.mean === null ? null : Math.round(k.mean), loggedDays: k.days };
}

// ---------------------------------------------------------------------------------------------------------------------
// Dispatch

/** Tools whose figures hang on the kcal budget carry the health-store note for the own-key engine, so the model never reads missing activity as zero. */
const BYOK_NOTE_TOOLS: readonly string[] = ["get_day", "get_targets", "fits_today"];

async function dispatch(call: ToolCall, data: ToolData): Promise<Dispatched> {
  const a = call.args ?? {};
  const today = data.today();
  switch (call.name) {
    case "get_day": {
      const date = a.date === undefined || a.date === null || a.date === "" ? today : a.date;
      if (!isDate(date)) throw new ToolInputError("date must be YYYY-MM-DD"); // i18n-ok: model-facing text
      const day = await data.day(date);
      return { value: dayResult(day), trace: { tool: "get_day", args: { date } }, summary: okSummary(day.items.length, day.items.length === 0) };
    }
    case "get_range": {
      const { from, to, clamped } = rangeArgs(a);
      const fields = fieldsArg(a.fields);
      const range = await data.range(from, to);
      const rows = range.days.slice(-TOOL_LIMITS.maxRows);
      const notes = [...range.notes];
      if (clamped) notes.push(`range cut to the last ${TOOL_LIMITS.maxDays} days: ${from} to ${to}`);
      const means: Record<string, { mean: number | null; days: number }> = {};
      for (const f of fields) if (f !== "water") means[f] = meanOf(rows.map((d) => d[f]));
      const loggedDays = rows.filter((d) => d.logged).length;
      return {
        value: { from, to, days: rows.map((d) => rangeRow(d, fields)), loggedDays, means, ...(notes.length > 0 ? { notes } : {}) },
        listKey: "days",
        trace: { tool: "get_range", args: { from, to } },
        summary: okSummary(loggedDays, loggedDays === 0),
      };
    }
    case "get_weight_trend": {
      const wanted = a.days === undefined ? 30 : Math.round(Number(a.days));
      if (!Number.isFinite(wanted)) throw new ToolInputError("days must be a number from 7 to 365"); // i18n-ok: model-facing text
      const days = Math.min(365, Math.max(7, wanted));
      const from = shiftDate(today, -(days - 1));
      const compareFrom = shiftDate(today, -13);
      const [weights, range] = await Promise.all([data.weights(from < compareFrom ? from : compareFrom), data.range(compareFrom, today).catch(() => null)]);
      const inWindow = weights.entries.filter((e) => e.date >= from && e.date <= today);
      const first = inWindow[0] ?? null;
      const last = inWindow.at(-1) ?? null;
      const spanDays = first && last ? daysBetween(first.date, last.date) : 0;
      const deltaKg = first && last && first !== last ? round1(last.kg - first.kg) : null;
      const last7 = windowStats(weights.entries, range?.days ?? [], shiftDate(today, -6), today);
      const prev7 = windowStats(weights.entries, range?.days ?? [], shiftDate(today, -13), shiftDate(today, -7));
      return {
        value: {
          days,
          from,
          to: today,
          weighIns: inWindow.length,
          points: downsample(inWindow, 60).map((e) => ({ date: e.date, kg: e.kg })),
          first,
          last,
          deltaKg,
          meanWeeklyChangeKg: deltaKg !== null && spanDays >= 7 ? round1((deltaKg / spanDays) * 7) : null,
          last7,
          previous7: prev7,
          deltaMeanKg: last7.meanKg !== null && prev7.meanKg !== null ? round1(last7.meanKg - prev7.meanKg) : null,
          deltaMeanKcal: last7.meanKcal !== null && prev7.meanKcal !== null ? last7.meanKcal - prev7.meanKcal : null,
          targetKg: weights.targetKg,
          ...(range ? {} : { notes: ["kcal comparison could not be read"] }), // i18n-ok: model-facing text
        },
        trace: { tool: "get_weight_trend", args: { days } },
        summary: okSummary(inWindow.length, inWindow.length === 0),
      };
    }
    case "get_targets": {
      const [profile, day] = await Promise.all([data.profile(), data.day(today).catch(() => null)]);
      const t = day?.targets ?? null;
      const known = profile.ageYears !== null || profile.sex !== null || profile.heightCm !== null || t !== null;
      return {
        value: {
          person: { ageYears: profile.ageYears, sex: profile.sex, heightCm: profile.heightCm, goal: profile.goal },
          activityLevel: profile.activityLevel,
          tdeeKcal: profile.tdeeKcal,
          today: { date: today, eatKcal: t?.kcal ?? null, proteinG: t?.protein ?? null, carbsG: t?.carbs ?? null, fatG: t?.fat ?? null, fiberG: t?.fiber ?? null },
          targetWeightKg: profile.targetWeightKg,
          targetDate: profile.targetDate,
          latestWeightKg: profile.latestWeightKg,
          scanAllowance: profile.scanAllowance,
        },
        trace: { tool: "get_targets", args: {} },
        summary: okSummary(null, !known),
      };
    }
    case "search_foods": {
      const query = text(a.query, 60);
      if (query.length < 2) throw new ToolInputError("query is required (at least 2 characters)"); // i18n-ok: model-facing text
      const limit = a.limit === undefined ? 5 : Math.min(8, Math.max(1, Math.round(Number(a.limit)) || 5));
      const candidates = searchFoods(query, limit).map((c, i) => {
        const base: Record<string, unknown> = { code: c.code, name: c.name, source: c.source };
        if (i < 3) {
          const found = lookupFood(c.code ?? c.name);
          if (found.ok) {
            const { food } = found;
            base.per100g = { kcal: food.per100g.kcal, fiber: food.per100g.fiber };
            const portion = choosePortion(food);
            if (portion) {
              const per = amountsFor(food, portion.grams);
              base.portion = portion;
              base.perPortion = { kcal: per.kcal, fiber: per.fiber };
            }
          }
        }
        return base;
      });
      return {
        value: { query, candidates, ...(candidates.length === 0 ? { note: "no row in our data; say the food is unknown and do not guess numbers" } : {}) }, // i18n-ok: model-facing text
        listKey: "candidates",
        trace: { tool: "search_foods", args: { foods: [query] } },
        summary: okSummary(candidates.length, candidates.length === 0, candidates.length === 0),
      };
    }
    case "compare_foods": {
      if (!Array.isArray(a.foods)) throw new ToolInputError("foods must be a list of 2 to 6 food names"); // i18n-ok: model-facing text
      const all = a.foods.map((f) => text(f, 60)).filter((f) => f !== "");
      if (all.length < 2) throw new ToolInputError("foods must list at least 2 food names"); // i18n-ok: model-facing text
      const foods = all.slice(0, 6);
      const by = a.by === undefined ? "fiber" : a.by;
      if (typeof by !== "string" || !(RANK_BY as readonly string[]).includes(by)) throw new ToolInputError(`by must be one of ${RANK_BY.join(", ")}`); // i18n-ok: model-facing text
      let grams: number | (number | null)[] | undefined;
      if (Array.isArray(a.grams)) grams = foods.map((_, i) => (a.grams as unknown[])[i] === undefined || (a.grams as unknown[])[i] === null ? null : positiveNumber((a.grams as unknown[])[i], "grams"));
      else if (a.grams !== undefined && a.grams !== null) grams = positiveNumber(a.grams, "grams");
      const usual = data.usualGrams ? await Promise.all(foods.map((f) => data.usualGrams?.(f).catch(() => null) ?? null)) : undefined;
      const result = compareFoods(foods, { by: by as RankBy, ...(grams === undefined ? {} : { grams }), ...(usual ? { usualGrams: usual } : {}) });
      const known = result.items.length;
      return {
        value: {
          by: result.by,
          order: result.order,
          items: result.items.map((i) => ({ query: i.query, name: i.name, code: i.code, source: i.source, per100g: i.per100g, dataNote: i.dataNote, portion: i.portion, perPortion: i.perPortion })),
          per100gRanking: result.per100gRanking,
          perPortionRanking: result.perPortionRanking,
          unrankable: result.unrankable,
          noPortion: result.noPortion,
          unknown: result.unknown,
          notes: result.notes,
          ...(all.length > foods.length ? { foodsCut: `only the first ${foods.length} foods were compared` } : {}), // i18n-ok: model-facing text
        },
        trace: { tool: "compare_foods", args: { foods: foods.map((f) => flat(f, 40)) } },
        summary: okSummary(known, false, known === 0),
      };
    }
    case "fits_today": {
      const query = text(a.food, 60);
      if (query.length < 2) throw new ToolInputError("food is required"); // i18n-ok: model-facing text
      const asked = a.grams === undefined || a.grams === null ? null : positiveNumber(a.grams, "grams");
      const found = lookupFood(query);
      const trace: ToolTrace = { tool: "fits_today", args: { foods: [flat(query, 40)] } };
      if (!found.ok) {
        return {
          value: { food: query, unknown: true, reason: found.reason, candidates: found.candidates, note: "not in our data: say it is unknown, never guess numbers" }, // i18n-ok: model-facing text
          trace,
          summary: okSummary(0, false, true),
        };
      }
      const food = found.food;
      const usual = data.usualGrams ? await data.usualGrams(query).catch(() => null) : null;
      const portion = choosePortion(food, { asked, usual });
      if (!portion) {
        return {
          value: {
            food: food.name,
            code: food.code,
            per100g: food.per100g,
            dataNote: food.dataNote,
            needsGrams: true,
            note: "we have no typical portion for this food: ask the person how many grams, then call again with grams", // i18n-ok: model-facing text
          },
          trace,
          summary: okSummary(1, false),
        };
      }
      const day = await data.day(today);
      const remaining: Remaining = day.remaining ?? { kcal: null, protein: null, carbs: null, fat: null, fiber: null };
      const fit = fitsToday(food, portion.grams, remaining);
      return {
        value: {
          food: food.name,
          code: food.code,
          dataNote: food.dataNote,
          portion,
          ...(portion.source === "typical" ? { portionNote: TYPICAL_PORTION_NOTE } : {}),
          amounts: fit.amounts,
          remainingBefore: remaining,
          after: fit.after,
          over: fit.over,
          ...(day.remaining === null ? { note: "no targets are set for today, so nothing can be compared" } : {}), // i18n-ok: model-facing text
          ...(day.remainingPartial.length > 0 ? { remainingUpperBound: day.remainingPartial } : {}), // i18n-ok: model-facing text
        },
        trace,
        summary: okSummary(1, false),
      };
    }
    default:
      throw new ToolInputError(`unknown tool ${flat(String(call.name), 40)}`); // i18n-ok: model-facing text
  }
}

/**
 * Runs one tool call. A bad argument or a failing data source never throws: the model gets `{"error": "..."}` and can adjust,
 * and the loop stays bounded by its own round limit.
 */
export async function runTool(call: ToolCall, data: ToolData): Promise<ToolOutcome> {
  const known = isToolName(call.name);
  try {
    const out = await dispatch(call, data);
    const value = data.engine === "byok" && BYOK_NOTE_TOOLS.includes(call.name) ? { ...out.value, healthDataNote: BYOK_HEALTH_NOTE } : out.value;
    return { content: cap(value, out.listKey), trace: out.trace, summary: out.summary };
  } catch (error) {
    const message = error instanceof ToolInputError ? error.message : "the data could not be read"; // i18n-ok: model-facing text
    return {
      content: JSON.stringify({ error: message }),
      trace: { tool: known ? (call.name as ToolName) : "get_day", args: {} },
      summary: FAILED,
    };
  }
}
