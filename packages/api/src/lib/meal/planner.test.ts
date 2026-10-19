import { describe, expect, test } from "bun:test";

import { computePortion, INGREDIENTS, recipeAllergens, recipeById, RECIPES } from "./catalog";
import { buildHistoryIndex, habitFoods } from "./history";
import type { LoggedPlate } from "./history";
import { alternativesFor, buildCandidates, BUDGET_TOLERANCE, DEFAULT_PREFS, dayMeets, itemNutrition, planDay, SWAP_KCAL_TOLERANCE, WEEK_CAP, zeroNutrition } from "./planner";
import type { PlanPrefs } from "./planner";
import type { PlannedDay, PlannedSlot } from "./types";
import { daySlots, planWeek, slotsStillOpen } from "./week";
import type { DaySpec } from "./week";

const NORMAL = daySlots({ ramadan: false, fasting: null });
const EMPTY_INDEX = buildHistoryIndex([]);

function weekSpecs(kcal: number, proteinG: number, slots = NORMAL, days = 7): DaySpec[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-10-${String(20 + i).padStart(2, "0")}`,
    budgetKcal: kcal,
    proteinG,
    order: slots.map((s) => s.slot),
    open: slots,
    fixed: zeroNutrition(),
    keep: [],
    blocked: new Set<string>(),
  }));
}

const total = (day: PlannedDay) => day.slots.reduce((sum, s) => sum + itemNutrition(s.item).kcal, 0);
const protein = (day: PlannedDay) => day.slots.reduce((sum, s) => sum + itemNutrition(s.item).proteinG, 0);

// The owner-like profile: a daily eat target between 1,500 and 2,100 kcal and a 110 g protein goal.
describe("planner: budget and protein", () => {
  for (const kcal of [1500, 1800, 2100]) {
    test(`a week at ${kcal} kcal / 110 g protein: every day within 5% and at or above the protein target`, () => {
      const out = planWeek({ seed: "owner", days: weekSpecs(kcal, 110), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
      expect(out).toHaveLength(7);
      for (const o of out) {
        const kcalDay = total(o.day);
        expect(Math.abs(kcalDay - kcal) / kcal, `${o.day.date} ${kcalDay} kcal`).toBeLessThanOrEqual(BUDGET_TOLERANCE);
        expect(protein(o.day), `${o.day.date}`).toBeGreaterThanOrEqual(110);
        expect(dayMeets(o.total, kcal, 110)).toEqual({ kcal: true, protein: true });
        expect(o.day.slots.map((s) => s.slot)).toEqual(NORMAL.map((s) => s.slot));
      }
    });
  }

  test("carbs and fat stay inside their ranges of the day's kcal", () => {
    const out = planWeek({ seed: "ranges", days: weekSpecs(1800, 110), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
    for (const o of out) {
      expect((o.total.carbsG * 4) / o.total.kcal).toBeGreaterThanOrEqual(0.38);
      expect((o.total.carbsG * 4) / o.total.kcal).toBeLessThanOrEqual(0.62);
      expect((o.total.fatG * 9) / o.total.kcal).toBeGreaterThanOrEqual(0.18);
      expect((o.total.fatG * 9) / o.total.kcal).toBeLessThanOrEqual(0.37);
    }
  });

  test("a part-eaten day plans only the rest: the eaten kcal count toward the budget", () => {
    const [spec] = weekSpecs(1800, 110, NORMAL, 1);
    if (!spec) throw new Error("no spec");
    const eaten = { kcal: 650, proteinG: 25, carbsG: 90, fatG: 20, fiberG: 4 };
    const open = NORMAL.filter((s) => s.slot !== "sarapan");
    const out = planWeek({ seed: "part", days: [{ ...spec, open, fixed: eaten }], prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) })[0];
    expect(out?.day.slots.map((s) => s.slot)).toEqual(["makan_siang", "makan_malam", "snack"]);
    expect(Math.abs((out?.total.kcal ?? 0) - 1800) / 1800).toBeLessThanOrEqual(BUDGET_TOLERANCE);
    expect(out?.total.proteinG ?? 0).toBeGreaterThanOrEqual(110);
  });
});

describe("planner: exclusions", () => {
  const prefs: PlanPrefs = { allergens: ["seafood", "telur"], dislikes: ["tempe", "jamur"], budgetFriendly: false, cookPref: "any" };

  test("never plans an allergen or a disliked ingredient", () => {
    const out = planWeek({ seed: "x", days: weekSpecs(1700, 100), prefs, candidates: buildCandidates(prefs, EMPTY_INDEX) });
    for (const o of out) {
      for (const s of o.day.slots) {
        const recipe = recipeById(s.item.ref.slice(2));
        expect(recipe).toBeDefined();
        if (!recipe) continue;
        expect(recipeAllergens(recipe)).not.toContain("seafood");
        expect(recipeAllergens(recipe)).not.toContain("telur");
        const names = [recipe.name.id, recipe.name.en, ...recipe.ing.map(([k]) => INGREDIENTS[k]?.name.id ?? "")].join(" ").toLowerCase();
        expect(names).not.toContain("tempe");
        expect(names).not.toContain("jamur");
      }
    }
  });

  test("cook-at-home and warung preferences are hard filters", () => {
    for (const cookPref of ["cook", "warung"] as const) {
      const p: PlanPrefs = { ...DEFAULT_PREFS, cookPref };
      const out = planWeek({ seed: "c", days: weekSpecs(1800, 100, NORMAL, 3), prefs: p, candidates: buildCandidates(p, EMPTY_INDEX) });
      for (const o of out) {
        for (const s of o.day.slots) {
          const recipe = recipeById(s.item.ref.slice(2));
          expect(cookPref === "cook" ? recipe?.home : recipe?.warung).toBe(true);
        }
      }
    }
  });

  test("an allergen in a food the person logs also keeps that food out", () => {
    const plates: LoggedPlate[] = Array.from({ length: 6 }, (_, i) => ({ name: "Bakpao Udang Pak Eko", meal: "makan_malam", date: `2026-10-0${i + 1}`, kcal: 500, proteinG: 25, carbsG: 60, fatG: 15, grams: 350 }));
    const index = buildHistoryIndex(habitFoods(plates));
    const p: PlanPrefs = { ...DEFAULT_PREFS, allergens: ["seafood"] };
    expect(buildCandidates(p, index).some((c) => c.isHabit)).toBe(false);
    expect(buildCandidates(DEFAULT_PREFS, index).some((c) => c.isHabit)).toBe(true);
  });

  test("budget-friendly shifts the week toward cheaper dishes", () => {
    const avgCost = (prefs: PlanPrefs) => {
      const out = planWeek({ seed: "b", days: weekSpecs(1800, 100), prefs, candidates: buildCandidates(prefs, EMPTY_INDEX) });
      const costs = out.flatMap((o) => o.day.slots.map((s) => recipeById(s.item.ref.slice(2))?.cost ?? 2));
      return costs.reduce((a, b) => a + b, 0) / costs.length;
    };
    expect(avgCost({ ...DEFAULT_PREFS, budgetFriendly: true })).toBeLessThan(avgCost(DEFAULT_PREFS));
  });
});

describe("planner: variety and determinism", () => {
  test("no dish appears more than its weekly cap (mains twice) and no dish repeats within a day", () => {
    const out = planWeek({ seed: "var", days: weekSpecs(1800, 110), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
    const counts = new Map<string, number>();
    for (const o of out) {
      const refs = o.day.slots.map((s) => s.item.ref);
      expect(new Set(refs).size).toBe(refs.length);
      for (const ref of refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
    for (const [ref, n] of counts) {
      const recipe = recipeById(ref.slice(2));
      const kind = recipe?.meals.includes("main") ? "main" : recipe?.meals.includes("breakfast") ? "breakfast" : "snack";
      expect(n, ref).toBeLessThanOrEqual(WEEK_CAP[kind]);
    }
  });

  test("the same seed gives the same week, another seed another one", () => {
    const run = (seed: string) => planWeek({ seed, days: weekSpecs(1800, 110), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) }).map((o) => o.day);
    expect(run("seed-a")).toEqual(run("seed-a"));
    expect(run("seed-a")).not.toEqual(run("seed-b"));
  });

  test("two consecutive days differ", () => {
    const out = planWeek({ seed: "consec", days: weekSpecs(1800, 110), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
    for (let i = 1; i < out.length; i++) {
      const prev = new Set(out[i - 1]?.day.slots.map((s) => s.item.ref));
      const overlap = out[i]?.day.slots.filter((s) => prev.has(s.item.ref)).length ?? 0;
      expect(overlap).toBeLessThanOrEqual(1);
    }
  });
});

describe("planner: history", () => {
  // A dish the catalog knows by a name people log, eaten often.
  const dish = RECIPES.find((r) => r.meals.includes("main") && (r.aka ?? []).length > 0 && computePortion(r).nutrition.proteinG > 25);
  if (!dish) throw new Error("catalog has no main with aka");
  const nutrition = computePortion(dish).nutrition;
  const plates: LoggedPlate[] = Array.from({ length: 8 }, (_, i) => ({
    name: dish.aka?.[0] ?? dish.name.id,
    meal: "makan_siang",
    date: `2026-10-${String(1 + i).padStart(2, "0")}`,
    kcal: nutrition.kcal,
    proteinG: nutrition.proteinG,
    carbsG: nutrition.carbsG,
    fatG: nutrition.fatG,
    grams: 300,
  }));

  test("a food eaten at least 3 times is a habit, rarer ones are not", () => {
    expect(habitFoods(plates)).toHaveLength(1);
    expect(habitFoods(plates.slice(0, 2))).toHaveLength(0);
    expect(habitFoods(plates)[0]?.times).toBe(8);
  });

  test("the logged name is matched to its catalog dish and that dish is favoured", () => {
    const index = buildHistoryIndex(habitFoods(plates));
    expect(index.affinity.get(dish.id)?.times).toBe(8);
    const uses = (idx: typeof index) => {
      const out = planWeek({ seed: "hist", days: weekSpecs(1800, 100), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, idx) });
      return out.filter((o) => o.day.slots.some((s) => s.item.ref === `r:${dish.id}`)).length;
    };
    expect(uses(index)).toBeGreaterThan(uses(EMPTY_INDEX));
    expect(uses(index)).toBeGreaterThanOrEqual(2);
  });

  test("a frequent food outside the catalog becomes a plan candidate with the person's own numbers", () => {
    const own: LoggedPlate[] = Array.from({ length: 5 }, (_, i) => ({ name: "Ketan Serundeng Bu Tini", meal: "sarapan", date: `2026-10-0${i + 1}`, kcal: 420, proteinG: 22, carbsG: 55, fatG: 12, grams: 350 }));
    const index = buildHistoryIndex(habitFoods(own));
    expect(index.unmatched).toHaveLength(1);
    const cands = buildCandidates(DEFAULT_PREFS, index).filter((c) => c.isHabit);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.find((c) => c.item.scale === 1)?.n).toMatchObject({ kcal: 420, proteinG: 22 });
    const out = planWeek({ seed: "own", days: weekSpecs(1800, 100, NORMAL, 3), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, index) });
    expect(out.some((o) => o.day.slots.some((s) => s.item.habit?.name === "Ketan Serundeng Bu Tini"))).toBe(true);
  });

  test("a lighter version is only offered for a habit that is heavier than it", () => {
    const fried = RECIPES.find((r) => (r.betterOf ?? []).includes("ayam goreng"));
    expect(fried).toBeDefined();
    if (!fried) return;
    const kcal = computePortion(fried).nutrition.kcal;
    const mk = (k: number): LoggedPlate[] => Array.from({ length: 4 }, (_, i) => ({ name: "Ayam goreng", meal: "makan_siang", date: `2026-10-0${i + 1}`, kcal: k, proteinG: 30, carbsG: 40, fatG: 25, grams: 250 }));
    expect(buildHistoryIndex(habitFoods(mk(kcal + 200))).better.get(fried.id)?.name).toBe("Ayam goreng");
    expect(buildHistoryIndex(habitFoods(mk(Math.max(80, kcal - 100)))).better.has(fried.id)).toBe(false);
  });
});

describe("planner: swap", () => {
  const candidates = buildCandidates(DEFAULT_PREFS, EMPTY_INDEX);
  const plan = planWeek({ seed: "swap", days: weekSpecs(1800, 110, NORMAL, 1), prefs: DEFAULT_PREFS, candidates })[0];

  test("alternatives have similar kcal and protein and fit the slot", () => {
    for (const entry of plan?.day.slots ?? []) {
      const cur = itemNutrition(entry.item);
      const alts = alternativesFor({ slot: entry.slot, current: entry.item, candidates, exclude: new Set(plan?.day.slots.map((s) => s.item.ref)), seed: "x", limit: 8 });
      expect(alts.length, entry.slot).toBeGreaterThan(0);
      for (const a of alts) {
        expect(Math.abs(a.n.kcal - cur.kcal) / cur.kcal).toBeLessThanOrEqual(SWAP_KCAL_TOLERANCE + 1e-9);
        expect(a.n.proteinG).toBeGreaterThanOrEqual(Math.min(cur.proteinG * 0.8, cur.proteinG - 3) - 1e-9);
        expect(a.item.ref).not.toBe(entry.item.ref);
        const recipe = recipeById(a.item.ref.slice(2));
        const kinds = entry.slot === "sarapan" ? ["breakfast"] : entry.slot === "snack" ? ["snack"] : ["main"];
        expect(recipe?.meals.some((m) => kinds.includes(m))).toBe(true);
      }
    }
  });

  test("alternatives respect exclusions: a swapped-away or already-planned dish is never offered", () => {
    const first = plan?.day.slots[1];
    if (!first) throw new Error("no slot");
    const base = alternativesFor({ slot: first.slot, current: first.item, candidates, exclude: new Set(), seed: "x", limit: 50 });
    const banned = base[0]?.item.ref ?? "";
    const after = alternativesFor({ slot: first.slot, current: first.item, candidates, exclude: new Set([banned]), seed: "x", limit: 50 });
    expect(after.some((a) => a.item.ref === banned)).toBe(false);
  });

  test("a day with one slot swapped stays inside the budget by replanning the others around it", () => {
    const [spec] = weekSpecs(1800, 110, NORMAL, 1);
    const day = plan?.day.slots ?? [];
    const swapped: PlannedSlot | undefined = day[1];
    if (!spec || !swapped) throw new Error("no slot");
    const alt = alternativesFor({ slot: swapped.slot, current: swapped.item, candidates, exclude: new Set(), seed: "z", limit: 8 }).at(-1);
    if (!alt) throw new Error("no alternative");
    const pinned = { slot: swapped.slot, item: { ...alt.item, pinned: true } };
    const out = planWeek({
      seed: "re",
      days: [{ ...spec, open: NORMAL.filter((s) => s.slot !== swapped.slot), keep: [pinned], fixed: alt.n }],
      prefs: DEFAULT_PREFS,
      candidates,
    })[0];
    expect(out?.day.slots.find((s) => s.slot === swapped.slot)?.item.ref).toBe(alt.item.ref);
    expect(dayMeets(out?.total ?? zeroNutrition(), 1800, 110)).toEqual({ kcal: true, protein: true });
  });
});

describe("planner: slots", () => {
  test("Ramadan plans berbuka, snack and sahur only", () => {
    const slots = daySlots({ ramadan: true, fasting: null });
    expect(slots.map((s) => s.slot)).toEqual(["berbuka", "snack", "sahur"]);
    const out = planWeek({ seed: "r", days: weekSpecs(1800, 100, slots, 2), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
    for (const o of out) {
      expect(o.day.slots.map((s) => s.slot)).toEqual(["berbuka", "snack", "sahur"]);
      expect(Math.abs(total(o.day) - 1800) / 1800).toBeLessThanOrEqual(BUDGET_TOLERANCE);
    }
  });

  test("a 16:8 fasting window plans the meals of its schedule", () => {
    const slots = daySlots({ ramadan: false, fasting: { pattern: "16:8", windowStart: "12:00" } });
    expect(slots.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 5);
    expect(slots.length).toBe(3);
    const out = planWeek({ seed: "f", days: weekSpecs(1700, 100, slots, 2), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX) });
    for (const o of out) expect(Math.abs(total(o.day) - 1700) / 1700).toBeLessThanOrEqual(BUDGET_TOLERANCE);
  });

  test("OMAD plans one meal", () => {
    const slots = daySlots({ ramadan: false, fasting: { pattern: "omad", windowStart: "18:00" } });
    expect(slots).toHaveLength(1);
  });

  test("today drops the slots whose time has passed on a normal day only", () => {
    expect(slotsStillOpen(NORMAL, 13, true).map((s) => s.slot)).toEqual(["makan_siang", "makan_malam", "snack"]);
    expect(slotsStillOpen(NORMAL, 13, false)).toHaveLength(4);
  });

  test("a budget the catalog cannot fill leaves slots empty instead of failing", () => {
    const [spec] = weekSpecs(40, 100, NORMAL, 1);
    if (!spec) throw new Error("no spec");
    const out = planDay({ date: spec.date, seed: "tiny", budgetKcal: 40, proteinG: 100, slots: NORMAL, fixed: zeroNutrition(), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, EMPTY_INDEX), weekUsage: new Map(), prevRefs: new Set() });
    expect(out.slots).toEqual([]);
  });
});

describe("planner: the weekly caps hold for foods the person logs too", () => {
  test("a habit lunch is used twice a week at most, a habit snack three times", () => {
    const plates: LoggedPlate[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: "Ayam Kremes Bu Sri", meal: "makan_siang" as const, date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, kcal: 600, proteinG: 38, carbsG: 50, fatG: 28, grams: 300 })),
      ...Array.from({ length: 30 }, (_, i) => ({ name: "Kopi Susu Gula Aren", meal: "snack" as const, date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, kcal: 160, proteinG: 4, carbsG: 22, fatG: 6, grams: 250 })),
    ];
    const index = buildHistoryIndex(habitFoods(plates));
    const out = planWeek({ seed: "habit-cap", days: weekSpecs(1800, 100), prefs: DEFAULT_PREFS, candidates: buildCandidates(DEFAULT_PREFS, index) });
    const used = (name: string) => out.filter((o) => o.day.slots.some((s) => s.item.habit?.name === name)).length;
    expect(used("Ayam Kremes Bu Sri")).toBeGreaterThanOrEqual(1);
    expect(used("Ayam Kremes Bu Sri")).toBeLessThanOrEqual(WEEK_CAP.main);
    expect(used("Kopi Susu Gula Aren")).toBeLessThanOrEqual(WEEK_CAP.snack);
  });
});
