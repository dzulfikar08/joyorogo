// Database side of the meal planner: reads the person's day budget, history and saved plan, runs the planner, saves
// the result. Everything the planner decides is in planner.ts / week.ts; this file only feeds and stores it.

import { and, between, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";
import { mealPlan, mealPlanSwap, mealPrefs, mealShoppingCheck } from "@joyorogo/db/schema/meal";
import type { MealPlanRow } from "@joyorogo/db/schema/meal";
import { plate } from "@joyorogo/db/schema/plans";

import { effectiveRamadan, jakartaClockHour, jakartaToday, shiftDate } from "../engine";
import type { Meal } from "../engine";
import { isFastingPattern } from "../fasting";
import { readCalibrationPrefs } from "../calibration-store";
import { budgetKcal } from "../exercise-credit";
import { loadDayCredit } from "../exercise-credit-store";
import { buildPlan, planQueries, proteinGoalG, trainingDayQuery } from "../plan";
import type { ProfileRow } from "../plan";
import { habitFoods, buildHistoryIndex } from "./history";
import type { HistoryIndex, LoggedPlate } from "./history";
import { addNutrition, alternativesFor, buildCandidates, DEFAULT_PREFS, dayMeets, itemAllowed, zeroNutrition } from "./planner";
import type { Alternative, Candidate, PlanPrefs } from "./planner";
import { dayTargets, itemNumbers } from "./view";
import type { DayTargets } from "./view";
import { daySlots, planWeek, slotsStillOpen } from "./week";
import type { DaySpec, SlotShare } from "./week";
import { ALLERGENS } from "./types";
import type { Allergen, Nutrition, PlannedDay, PlannedItem, PlannedSlot } from "./types";

export const PLAN_DAYS = 7;
const HISTORY_DAYS = 60;
export const MAX_DISLIKES = 20;

// --- Preferences ---------------------------------------------------------------------------------------------

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function readPrefs(db: Database, userId: string): Promise<PlanPrefs> {
  const [row] = await db.select().from(mealPrefs).where(eq(mealPrefs.userId, userId)).limit(1);
  if (!row) return DEFAULT_PREFS;
  return {
    allergens: parseList(row.allergens).filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a)),
    dislikes: parseList(row.dislikes),
    budgetFriendly: row.budgetFriendly,
    cookPref: row.cookPref === "cook" || row.cookPref === "warung" ? row.cookPref : "any",
  };
}

export async function writePrefs(db: Database, userId: string, prefs: PlanPrefs): Promise<PlanPrefs> {
  const clean: PlanPrefs = {
    allergens: ALLERGENS.filter((a) => prefs.allergens.includes(a)),
    dislikes: [...new Set(prefs.dislikes.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0))].slice(0, MAX_DISLIKES),
    budgetFriendly: prefs.budgetFriendly,
    cookPref: prefs.cookPref,
  };
  const values = {
    allergens: JSON.stringify(clean.allergens),
    dislikes: JSON.stringify(clean.dislikes),
    budgetFriendly: clean.budgetFriendly,
    cookPref: clean.cookPref,
    updatedAt: new Date(),
  };
  await db.insert(mealPrefs).values({ userId, ...values }).onConflictDoUpdate({ target: mealPrefs.userId, set: values });
  return clean;
}

// --- History -------------------------------------------------------------------------------------------------

/** The last 60 days of food_log as plates: components of one plate summed, named by the plate. */
export async function loadHistoryIndex(db: Database, userId: string, today: string): Promise<HistoryIndex> {
  const since = shiftDate(today, -HISTORY_DAYS);
  const pid = sql<string>`coalesce(${foodLog.plateId}, ${foodLog.id})`;
  const rows = await db
    .select({
      name: sql<string>`coalesce(max(${plate.name}), max(${foodLog.name}))`,
      meal: sql<string>`max(${foodLog.meal})`,
      date: sql<string>`max(${foodLog.date})`,
      kcal: sql<number>`sum(${foodLog.kcal})`,
      protein: sql<number | null>`sum(${foodLog.protein})`,
      carbs: sql<number | null>`sum(${foodLog.carbs})`,
      fat: sql<number | null>`sum(${foodLog.fat})`,
      grams: sql<number | null>`sum(${foodLog.grams})`,
    })
    .from(foodLog)
    .leftJoin(plate, eq(plate.id, foodLog.plateId))
    .where(and(eq(foodLog.userId, userId), gte(foodLog.date, since), lte(foodLog.date, today)))
    .groupBy(pid)
    .limit(3000);
  const plates: LoggedPlate[] = rows.map((r) => ({
    name: r.name,
    meal: r.meal as Meal,
    date: r.date,
    kcal: r.kcal,
    proteinG: r.protein,
    carbsG: r.carbs,
    fatG: r.fat,
    grams: r.grams,
  }));
  return buildHistoryIndex(habitFoods(plates));
}

// --- Targets -------------------------------------------------------------------------------------------------

export type PlanTargets = {
  prof: ProfileRow;
  maternal: boolean;
  /** today's budget with the workout credit */
  liveKcal: number;
  /** the plan's base target: what every later day gets */
  baseKcal: number;
  proteinToday: number;
  proteinBase: number;
  /** the live budget is higher than the base because of counted activity */
  creditKcal: number;
};

/**
 * Day budget and protein goal from the same path day.summary uses (buildPlan with the person's calibration, the day's
 * exercise credit, strength-day protein). Null without a profile.
 */
export async function loadTargets(db: Database, userId: string, today: string): Promise<PlanTargets | null> {
  const [[profileRows, latestRows, weighIns, intake, exercise, calibrationRows], workoutRows] = await Promise.all([
    db.batch(planQueries(db, userId, today)),
    trainingDayQuery(db, userId, today),
  ]);
  const prof = profileRows[0];
  if (!prof) return null;
  const plan = buildPlan(
    prof,
    { latestWeightKg: latestRows[0]?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(calibrationRows) },
    today,
  );
  const credit = await loadDayCredit(db, userId, today, plan.targets.includedKcal);
  const base = plan.targets.eatKcal;
  return {
    prof,
    maternal: plan.maternal !== null,
    liveKcal: budgetKcal(base, credit),
    baseKcal: base,
    proteinToday: proteinGoalG(plan, prof.heightCm, workoutRows.length > 0),
    proteinBase: proteinGoalG(plan, prof.heightCm, false),
    creditKcal: credit.countedKcal,
  };
}

/** The slots of one date for this person: Ramadan split, fasting window, or the normal four. */
export function slotsOfDate(t: PlanTargets, date: string): { slots: SlotShare[]; normal: boolean } {
  const ramadanPref = t.maternal && t.prof.ramadanMode === "auto" ? "off" : t.prof.ramadanMode;
  const ramadan = effectiveRamadan(ramadanPref, new Date(`${date}T12:00:00+07:00`));
  const pattern = t.prof.fastingPattern;
  const fasting = !t.maternal && !ramadan && isFastingPattern(pattern) ? { pattern, windowStart: t.prof.fastingWindowStart } : null;
  return { slots: daySlots({ ramadan, fasting }), normal: !ramadan && fasting === null };
}

export function targetsOfDate(t: PlanTargets, date: string, today: string): DayTargets {
  return date === today ? dayTargets(t.liveKcal, t.proteinToday, "live") : dayTargets(t.baseKcal, t.proteinBase, "base");
}

// --- The saved plan ------------------------------------------------------------------------------------------

export type StoredDay = PlannedDay & { salt?: number };
export type StoredPlan = { startDate: string; seed: string; generation: number; days: StoredDay[]; createdAt: Date; updatedAt: Date };

function parseDays(json: string): StoredDay[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as StoredDay[]) : [];
  } catch {
    return [];
  }
}

function fromRow(row: MealPlanRow): StoredPlan {
  return { startDate: row.startDate, seed: row.seed, generation: row.generation, days: parseDays(row.daysJson), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** The plan in force on `date`: the latest one that started on or before it and still covers it. */
export async function readPlan(db: Database, userId: string, date: string): Promise<StoredPlan | null> {
  const [row] = await db
    .select()
    .from(mealPlan)
    .where(and(eq(mealPlan.userId, userId), lte(mealPlan.startDate, date)))
    .orderBy(desc(mealPlan.startDate))
    .limit(1);
  if (!row) return null;
  return shiftDate(row.startDate, PLAN_DAYS - 1) >= date ? fromRow(row) : null;
}

async function savePlan(db: Database, userId: string, plan: StoredPlan): Promise<void> {
  const values = { seed: plan.seed, generation: plan.generation, daysJson: JSON.stringify(plan.days), updatedAt: plan.updatedAt };
  await db
    .insert(mealPlan)
    .values({ userId, startDate: plan.startDate, createdAt: plan.createdAt, ...values })
    .onConflictDoUpdate({ target: [mealPlan.userId, mealPlan.startDate], set: values });
}

// --- Eaten ---------------------------------------------------------------------------------------------------

export type EatenState = {
  /** per date, per meal slot: everything logged */
  byDate: Map<string, Partial<Record<Meal, Nutrition>>>;
  existingLogIds: Set<string>;
};

export async function loadEaten(db: Database, userId: string, from: string, to: string, logIds: string[]): Promise<EatenState> {
  const rows = await db
    .select({
      date: foodLog.date,
      meal: foodLog.meal,
      kcal: sql<number>`sum(${foodLog.kcal})`,
      protein: sql<number | null>`sum(${foodLog.protein})`,
      carbs: sql<number | null>`sum(${foodLog.carbs})`,
      fat: sql<number | null>`sum(${foodLog.fat})`,
      fiber: sql<number | null>`sum(${foodLog.fiber})`,
    })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), between(foodLog.date, from, to)))
    .groupBy(foodLog.date, foodLog.meal);
  const byDate = new Map<string, Partial<Record<Meal, Nutrition>>>();
  for (const r of rows) {
    const day = byDate.get(r.date) ?? {};
    day[r.meal as Meal] = { kcal: r.kcal ?? 0, proteinG: r.protein ?? 0, carbsG: r.carbs ?? 0, fatG: r.fat ?? 0, fiberG: r.fiber ?? 0 };
    byDate.set(r.date, day);
  }
  const existing =
    logIds.length === 0
      ? []
      : await db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), inArray(foodLog.id, logIds)));
  return { byDate, existingLogIds: new Set(existing.map((r) => r.id)) };
}

export const sumNutrition = (parts: Partial<Record<Meal, Nutrition>> | undefined): Nutrition => {
  let total = zeroNutrition();
  for (const n of Object.values(parts ?? {})) if (n) total = addNutrition(total, n);
  return total;
};

// --- Planning ------------------------------------------------------------------------------------------------

export type PlanContext = {
  db: Database;
  userId: string;
  today: string;
  targets: PlanTargets;
  prefs: PlanPrefs;
  index: HistoryIndex;
  candidates: Candidate[];
};

export async function loadPlanContext(db: Database, userId: string): Promise<PlanContext | null> {
  const today = jakartaToday();
  const [targets, prefs, index] = await Promise.all([loadTargets(db, userId, today), readPrefs(db, userId), loadHistoryIndex(db, userId, today)]);
  if (!targets) return null;
  return { db, userId, today, targets, prefs, index, candidates: buildCandidates(prefs, index) };
}

/** One day's planning inputs from what is saved for it and what has been eaten. */
export function daySpec(ctx: PlanContext, date: string, existing: StoredDay | undefined, eaten: EatenState, extraBlocked: Set<string>): DaySpec {
  const { slots, normal } = slotsOfDate(ctx.targets, date);
  const isToday = date === ctx.today;
  const t = targetsOfDate(ctx.targets, date, ctx.today);
  const eatenByMeal = eaten.byDate.get(date);
  const covered = (slot: Meal) => (eatenByMeal?.[slot]?.kcal ?? 0) > 0;
  const keep: PlannedSlot[] = [];
  let fixed = isToday ? sumNutrition(eatenByMeal) : zeroNutrition();
  for (const entry of existing?.slots ?? []) {
    const ate = entry.item.logId != null && eaten.existingLogIds.has(entry.item.logId);
    if (ate) keep.push(entry);
    else if (entry.item.pinned && !covered(entry.slot) && itemAllowed(entry.item, ctx.prefs)) {
      keep.push(entry);
      fixed = addNutrition(fixed, itemNumbers(entry.item).nutrition);
    }
  }
  const taken = new Set(keep.map((k) => k.slot));
  let open = slots.filter((s) => !taken.has(s.slot) && !(isToday && covered(s.slot)));
  if (isToday) open = slotsStillOpen(open, jakartaClockHour(), normal);
  return {
    date,
    budgetKcal: t.kcal,
    proteinG: t.proteinG,
    order: slots.map((s) => s.slot),
    open,
    fixed,
    keep,
    blocked: extraBlocked,
  };
}

export function planDates(startDate: string): string[] {
  return Array.from({ length: PLAN_DAYS }, (_, i) => shiftDate(startDate, i));
}

/**
 * Builds (first time) or rebuilds (`regenerate`) the plan that starts today. What was eaten through the plan and what
 * the person swapped in stays; everything else on today and the days ahead is planned again with a new seed.
 */
export async function generatePlan(ctx: PlanContext, opts: { regenerate: boolean }): Promise<StoredPlan> {
  const { db, userId, today } = ctx;
  const current = await readPlan(db, userId, today);
  if (current && !opts.regenerate) return current;
  const dates = planDates(today);
  const generation = (current?.generation ?? 0) + 1;
  const seed = `${userId}|${today}|g${generation}`;
  const prior = new Map((current?.days ?? []).map((d) => [d.date, d]));
  const logIds = (current?.days ?? []).flatMap((d) => d.slots.map((s) => s.item.logId).filter((id): id is string => id != null));
  const eaten = await loadEaten(db, userId, today, dates.at(-1) ?? today, logIds);
  const specs = dates.map((date) => daySpec(ctx, date, prior.get(date), eaten, new Set()));
  const outcomes = planWeek({ seed, days: specs, prefs: ctx.prefs, candidates: ctx.candidates });
  const now = new Date();
  const plan: StoredPlan = {
    startDate: today,
    seed,
    generation,
    days: outcomes.map((o) => ({ ...o.day, salt: 0 })),
    createdAt: current?.startDate === today ? current.createdAt : now,
    updatedAt: now,
  };
  await savePlan(db, userId, plan);
  return plan;
}

/** Replans one day (today: the rest of it). The person's eaten and swapped items stay. */
export async function replanDay(ctx: PlanContext, plan: StoredPlan, date: string): Promise<StoredPlan> {
  const index = plan.days.findIndex((d) => d.date === date);
  const existing = plan.days[index];
  if (!existing) return plan;
  const logIds = plan.days.flatMap((d) => d.slots.map((s) => s.item.logId).filter((id): id is string => id != null));
  const eaten = await loadEaten(ctx.db, ctx.userId, plan.startDate, plan.days.at(-1)?.date ?? date, logIds);
  const salt = (existing.salt ?? 0) + 1;
  const spec = daySpec(ctx, date, existing, eaten, await swappedAway(ctx.db, ctx.userId, date));
  const usage = refUsage(plan.days.filter((d) => d.date !== date));
  const outcome = planWeek({ seed: `${plan.seed}|d${salt}`, days: [spec], prefs: ctx.prefs, candidates: ctx.candidates, baseUsage: usage })[0];
  if (!outcome) return plan;
  const days = plan.days.map((d) => (d.date === date ? { ...outcome.day, salt } : d));
  const next: StoredPlan = { ...plan, days, updatedAt: new Date() };
  await savePlan(ctx.db, ctx.userId, next);
  return next;
}

export function refUsage(days: StoredDay[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const d of days) for (const s of d.slots) usage.set(s.item.ref, (usage.get(s.item.ref) ?? 0) + 1);
  return usage;
}

// --- Swaps ---------------------------------------------------------------------------------------------------

/** Refs the person swapped away from on that date: never offered back that day. */
export async function swappedAway(db: Database, userId: string, date: string): Promise<Set<string>> {
  const rows = await db
    .select({ ref: mealPlanSwap.fromRef })
    .from(mealPlanSwap)
    .where(and(eq(mealPlanSwap.userId, userId), eq(mealPlanSwap.date, date)));
  return new Set(rows.map((r) => r.ref));
}

export type SwapOptions = { current: PlannedItem; alternatives: Alternative[] };

/** Alternatives for one slot of a saved day: not already on that day, not swapped away before, same size. */
export async function swapAlternatives(ctx: PlanContext, plan: StoredPlan, date: string, slot: Meal, limit: number): Promise<SwapOptions | null> {
  const day = plan.days.find((d) => d.date === date);
  const current = day?.slots.find((s) => s.slot === slot)?.item;
  if (!day || !current) return null;
  const exclude = new Set([...day.slots.map((s) => s.item.ref), ...(await swappedAway(ctx.db, ctx.userId, date))]);
  exclude.delete(current.ref);
  return {
    current,
    alternatives: alternativesFor({ slot, current, candidates: ctx.candidates, exclude, seed: `${plan.seed}|${date}|${slot}`, limit }),
  };
}

/**
 * Puts `item` in a slot, pinned. When the day no longer meets its budget or protein the other open meals of the day
 * are planned again around it (only kept when that scores better than leaving them).
 */
export async function applySwap(ctx: PlanContext, plan: StoredPlan, date: string, slot: Meal, item: PlannedItem): Promise<{ plan: StoredPlan; replanned: boolean }> {
  const day = plan.days.find((d) => d.date === date);
  const old = day?.slots.find((s) => s.slot === slot);
  if (!day || !old) return { plan, replanned: false };
  await ctx.db.insert(mealPlanSwap).values({ id: crypto.randomUUID(), userId: ctx.userId, date, slot, fromRef: old.item.ref, toRef: item.ref, createdAt: new Date() });
  const swapped: StoredDay = { ...day, slots: day.slots.map((s) => (s.slot === slot ? { slot, item: { ...item, pinned: true } } : s)) };
  let days = plan.days.map((d) => (d.date === date ? swapped : d));
  let next: StoredPlan = { ...plan, days, updatedAt: new Date() };
  const logIds = days.flatMap((d) => d.slots.map((s) => s.item.logId).filter((id): id is string => id != null));
  const eaten = await loadEaten(ctx.db, ctx.userId, plan.startDate, days.at(-1)?.date ?? date, logIds);
  const spec = daySpec(ctx, date, swapped, eaten, await swappedAway(ctx.db, ctx.userId, date));
  const totalOf = (d: StoredDay) => {
    let total = spec.fixed;
    for (const s of d.slots) {
      const kept = spec.keep.some((k) => k.slot === s.slot);
      if (!kept && spec.open.some((o) => o.slot === s.slot)) total = addNutrition(total, itemNumbers(s.item).nutrition);
    }
    return total;
  };
  const before = totalOf(swapped);
  const fits = dayMeets(before, spec.budgetKcal, spec.proteinG);
  let replanned = false;
  if (!(fits.kcal && fits.protein)) {
    // the swapped item is pinned, so it sits in `keep` (not open) and the planner works around it
    const outcome = planWeek({ seed: `${plan.seed}|swap|${date}|${slot}`, days: [spec], prefs: ctx.prefs, candidates: ctx.candidates, baseUsage: refUsage(plan.days.filter((d) => d.date !== date)) })[0];
    if (outcome) {
      const after = dayMeets(outcome.total, spec.budgetKcal, spec.proteinG);
      const better = (after.kcal ? 1 : 0) + (after.protein ? 1 : 0) > (fits.kcal ? 1 : 0) + (fits.protein ? 1 : 0);
      if (better) {
        days = days.map((d) => (d.date === date ? { ...outcome.day, salt: d.salt } : d));
        next = { ...next, days };
        replanned = true;
      }
    }
  }
  await savePlan(ctx.db, ctx.userId, next);
  return { plan: next, replanned };
}

// --- Marking eaten -------------------------------------------------------------------------------------------

async function readPlanByStart(db: Database, userId: string, startDate: string): Promise<StoredPlan | null> {
  const [row] = await db
    .select()
    .from(mealPlan)
    .where(and(eq(mealPlan.userId, userId), eq(mealPlan.startDate, startDate)))
    .limit(1);
  return row ? fromRow(row) : null;
}

/**
 * Stores (or clears) the diary row of one planned meal. One UPDATE edits only that item inside the stored JSON and checks
 * that the slot is still where we expect it, so two requests marking different meals cannot overwrite each other.
 */
export async function setLogId(ctx: PlanContext, plan: StoredPlan, date: string, slot: Meal, logId: string | null): Promise<StoredPlan> {
  const { db, userId } = ctx;
  let current: StoredPlan | null = plan;
  for (let attempt = 0; attempt < 3 && current; attempt++) {
    const di = current.days.findIndex((d) => d.date === date);
    const si = current.days[di]?.slots.findIndex((s) => s.slot === slot) ?? -1;
    if (di < 0 || si < 0) return current;
    const day = `$[${di}]`;
    const updated = await db
      .update(mealPlan)
      .set({ daysJson: sql`json_set(${mealPlan.daysJson}, ${`${day}.slots[${si}].item.logId`}, ${logId})`, updatedAt: new Date() })
      .where(
        and(
          eq(mealPlan.userId, userId),
          eq(mealPlan.startDate, current.startDate),
          sql`json_extract(${mealPlan.daysJson}, ${`${day}.date`}) = ${date}`,
          sql`json_extract(${mealPlan.daysJson}, ${`${day}.slots[${si}].slot`}) = ${slot}`,
        ),
      )
      .returning({ startDate: mealPlan.startDate });
    const fresh = await readPlanByStart(db, userId, current.startDate);
    if (updated.length > 0 && fresh) return fresh;
    // the plan was rebuilt between our read and the write: look again with what is stored now
    current = fresh;
  }
  return current ?? plan;
}

// --- Shopping checks -----------------------------------------------------------------------------------------

export async function readChecks(db: Database, userId: string, startDate: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: mealShoppingCheck.itemKey })
    .from(mealShoppingCheck)
    .where(and(eq(mealShoppingCheck.userId, userId), eq(mealShoppingCheck.startDate, startDate)));
  return new Set(rows.map((r) => r.key));
}

export async function setCheck(db: Database, userId: string, startDate: string, key: string, checked: boolean): Promise<void> {
  if (checked) {
    await db.insert(mealShoppingCheck).values({ userId, startDate, itemKey: key, updatedAt: new Date() }).onConflictDoNothing();
  } else {
    await db
      .delete(mealShoppingCheck)
      .where(and(eq(mealShoppingCheck.userId, userId), eq(mealShoppingCheck.startDate, startDate), eq(mealShoppingCheck.itemKey, key)));
  }
}
