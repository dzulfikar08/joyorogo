import { describe, expect, test } from "bun:test";

import { mealIdeas } from "./ideas";

describe("mealIdeas", () => {
  test("a spent budget gets no food ideas", () => {
    expect(mealIdeas(60, "makan_malam")).toEqual([]);
    expect(mealIdeas(-200, "snack")).toEqual([]);
  });

  test("every idea fits the remaining budget, most protein per kcal first", () => {
    const ideas = mealIdeas(450, "makan_malam");
    expect(ideas.length).toBe(3);
    for (const idea of ideas) expect(idea.kcal).toBeLessThanOrEqual(450);
    const density = ideas.map((i) => i.proteinG / i.kcal);
    expect(density).toEqual(density.toSorted((a, b) => b - a));
  });

  test("a big dinner budget is answered with a meal, not a boiled egg", () => {
    for (const idea of mealIdeas(900, "makan_malam")) expect(idea.kcal).toBeGreaterThanOrEqual(250);
  });

  test("when no meal fits the slot, snack-sized ideas fill in", () => {
    const ideas = mealIdeas(170, "makan_siang");
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) expect(idea.kcal).toBeLessThanOrEqual(170);
  });
});
