// The day's slots and the week loop around planDay: budgets in, a stable 7-day plan out.

import { NORMAL_SLOTS, RAMADAN_SLOTS, ramadanSplit } from "../engine";
import type { Meal } from "../engine";
import { buildSchedule } from "../fasting";
import type { FastingPattern } from "../fasting";
import { NORMAL_SHARES, planDay, zeroNutrition } from "./planner";
import type { DayPlan } from "./planner";
import type { Candidate, PlanPrefs } from "./planner";
import type { Nutrition, PlannedDay, PlannedSlot } from "./types";

export type SlotShare = { slot: Meal; share: number };

/**
 * The slots of a day and each one's share of the budget, in display order. Ramadan follows the app's own split
 * (berbuka, snack, sahur). An intermittent-fasting window follows its eating schedule (lib/fasting buildSchedule).
 * Everything else is sarapan / makan siang / makan malam / snack. Hamil and Menyusui never fast.
 */
export function daySlots(opts: { ramadan: boolean; fasting: { pattern: FastingPattern; windowStart: string } | null }): SlotShare[] {
  if (opts.ramadan) {
    const split = ramadanSplit();
    return RAMADAN_SLOTS.map((slot) => ({ slot, share: split[slot] }));
  }
  if (opts.fasting) {
    const merged = new Map<Meal, number>();
    for (const m of buildSchedule(opts.fasting.pattern, opts.fasting.windowStart)) {
      // the middle "camilan" of a window is this app's snack slot, whatever the clock says
      const slot: Meal = m.kind === "camilan" ? "snack" : m.meal;
      merged.set(slot, (merged.get(slot) ?? 0) + m.share);
    }
    return [...merged.entries()].map(([slot, share]) => ({ slot, share }));
  }
  return NORMAL_SLOTS.map((slot) => ({ slot, share: NORMAL_SHARES[slot] ?? 0 }));
}

/** Clock hour (WIB) after which a slot's time has passed on the current day. Normal days only. */
const SLOT_END_HOUR: Partial<Record<Meal, number>> = { sarapan: 10.5, makan_siang: 15.5, snack: 21, makan_malam: 23.5 };

/** Open slots of today: the ones whose time has not passed yet (normal days only; fasting/Ramadan keep every slot). */
export function slotsStillOpen(slots: SlotShare[], hour: number, normalDay: boolean): SlotShare[] {
  if (!normalDay) return slots;
  return slots.filter(({ slot }) => hour < (SLOT_END_HOUR[slot] ?? 24));
}

export type DaySpec = {
  date: string;
  budgetKcal: number;
  proteinG: number;
  /** every slot of the day, display order */
  order: Meal[];
  /** slots to plan now */
  open: SlotShare[];
  /** nutrition already counted toward the day (food eaten + items that stay) */
  fixed: Nutrition;
  /** items that stay as they are (eaten plan items, pinned swaps), already inside `fixed` where they were eaten */
  keep: PlannedSlot[];
  blocked: Set<string>;
};

export type WeekInput = {
  seed: string;
  days: DaySpec[];
  prefs: PlanPrefs;
  candidates: Candidate[];
  /** refs used on days outside `days` (when only some days are replanned) */
  baseUsage?: Map<string, number>;
};

export type DayOutcome = { day: PlannedDay; total: Nutrition; cost: number };

/**
 * Plans the days in order. A dish used in an earlier day counts toward the weekly caps of the later ones, so the
 * week varies; the previous day's dishes are discouraged. When a day cannot be filled under the caps they are
 * loosened by one use at a time until it can.
 */
export function planWeek(input: WeekInput): DayOutcome[] {
  const usage = new Map(input.baseUsage ?? []);
  const out: DayOutcome[] = [];
  let prev = new Set<string>();
  for (const spec of input.days) {
    const keptRefs = new Set(spec.keep.map((k) => k.item.ref));
    for (const ref of keptRefs) usage.set(ref, (usage.get(ref) ?? 0) + 1);
    let plan: DayPlan | null = null;
    for (let capBonus = 0; capBonus <= 2; capBonus++) {
      plan = planDay({
        date: spec.date,
        seed: input.seed,
        budgetKcal: spec.budgetKcal,
        proteinG: spec.proteinG,
        slots: spec.open,
        fixed: spec.fixed,
        prefs: input.prefs,
        candidates: input.candidates,
        weekUsage: usage,
        prevRefs: prev,
        blocked: new Set([...spec.blocked, ...keptRefs]),
        capBonus,
      });
      if (plan.slots.length === spec.open.length) break;
    }
    const planned = plan?.slots ?? [];
    const slots = [...spec.keep, ...planned].toSorted((a, b) => spec.order.indexOf(a.slot) - spec.order.indexOf(b.slot));
    for (const p of planned) usage.set(p.item.ref, (usage.get(p.item.ref) ?? 0) + 1);
    prev = new Set(slots.map((s) => s.item.ref));
    out.push({ day: { date: spec.date, slots }, total: plan?.total ?? spec.fixed, cost: plan?.cost ?? 0 });
  }
  return out;
}

export { zeroNutrition };
