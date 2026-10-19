import { describe, expect, test } from "bun:test";

import { computePortion, INGREDIENTS, recipeById, RECIPES } from "./catalog";
import { aggregateShopping, groupShopping, roundUpGrams } from "./shopping";
import type { PlannedItem } from "./types";

const item = (id: string, scale = 1, carbScale = 1): PlannedItem => ({ ref: `r:${id}`, scale, carbScale });

describe("shopping list", () => {
  test("rounds purchases up to what a shopper can ask for", () => {
    expect(roundUpGrams(0)).toBe(0);
    expect(roundUpGrams(12)).toBe(15);
    expect(roundUpGrams(80)).toBe(80);
    expect(roundUpGrams(81)).toBe(90);
    expect(roundUpGrams(201)).toBe(250);
  });

  test("sums an ingredient over meals: two plates with rice = the rice of both, bought as raw rice", () => {
    const withRice = RECIPES.filter((r) => r.ing.some(([k]) => k === "nasi")).slice(0, 2);
    expect(withRice).toHaveLength(2);
    const [a, b] = withRice;
    if (!a || !b) return;
    const cooked = [a, b].reduce((sum, r) => sum + (computePortion(r).lines.find((l) => l.key === "nasi")?.grams ?? 0), 0);
    const entries = aggregateShopping([item(a.id), item(b.id)], "id");
    const rice = entries.find((e) => e.key === "nasi");
    expect(rice?.name).toBe("Beras");
    expect(rice?.uses).toBe(2);
    const ratio = INGREDIENTS.nasi?.shop?.ratio ?? 1;
    expect(rice?.grams).toBe(roundUpGrams(cooked * ratio));
    expect(rice?.cat).toBe("karbo");
  });

  test("uses the portion that is planned: half rice buys half the rice", () => {
    const r = RECIPES.find((x) => x.ing.some(([k]) => k === "nasi"));
    if (!r) return;
    const full = aggregateShopping([item(r.id)], "id").find((e) => e.key === "nasi")?.grams ?? 0;
    const half = aggregateShopping([item(r.id, 1, 0.5)], "id").find((e) => e.key === "nasi")?.grams ?? 0;
    expect(half).toBeLessThan(full);
  });

  test("countable things are counted: eggs in pieces with their weight", () => {
    const r = RECIPES.find((x) => x.ing.some(([k]) => k === "telur-ayam"));
    if (!r) return;
    const egg = aggregateShopping([item(r.id)], "id").find((e) => e.key === "telur-ayam");
    expect(egg?.amount).toMatch(/butir/);
    const en = aggregateShopping([item(r.id)], "en").find((e) => e.key === "telur-ayam");
    expect(en?.amount).toMatch(/egg/);
    expect(en?.name).toBe("Egg");
  });

  test("foods the person logs themselves have no ingredient list and add nothing", () => {
    const habit: PlannedItem = { ref: "h:bubur", scale: 1, carbScale: 1, habit: { name: "Bubur", kcal: 300, proteinG: 10, carbsG: 40, fatG: 8, grams: 300, times: 4 } };
    expect(aggregateShopping([habit], "id")).toEqual([]);
    expect(aggregateShopping([item("tidak-ada")], "id")).toEqual([]);
  });

  test("groups by shop category in a fixed order and carries the ticks", () => {
    const sample = RECIPES.slice(0, 12).map((r) => item(r.id));
    const entries = aggregateShopping(sample, "id");
    const first = entries[0];
    const groups = groupShopping(entries, new Set(first ? [first.key] : []), "id");
    const cats = groups.map((g) => g.cat);
    expect(cats).toEqual([...cats].sort((a, b) => ["karbo", "protein", "sayur", "buah", "susu", "bumbu"].indexOf(a) - ["karbo", "protein", "sayur", "buah", "susu", "bumbu"].indexOf(b)));
    expect(groups.flatMap((g) => g.items)).toHaveLength(entries.length);
    expect(groups.flatMap((g) => g.items).filter((i) => i.checked)).toHaveLength(first ? 1 : 0);
    expect(recipeById(sample[0]?.ref.slice(2) ?? "")).toBeDefined();
  });
});
