import { describe, expect, test } from "bun:test";

import { swapPortionPrior } from "./portion-chip";
import {
  PRIOR_BIG_PLATE,
  buildPriors,
  priorOf,
  userSetSamples,
  withPortionPrior,
} from "./portion-prior";
import type { HistoryRow } from "./portion-prior";
import { canonicalFood } from "./tkpi";

const typed = (name: string, grams: number): HistoryRow => ({ name, grams, source: "manual", itemsJson: null });
const aiRow = (name: string, grams: number, aiGrams: number): HistoryRow => ({
  name,
  grams,
  source: "ai",
  itemsJson: JSON.stringify([{ name, grams: aiGrams, kcal: 200 }]),
});

describe("canonicalFood", () => {
  test("plain rice spellings are one food; dishes with rice stay apart", () => {
    for (const name of ["nasi putih", "Nasi Uduk", "nasi kuning", "nasi", "nasi putih hangat", "steamed rice"]) {
      expect(canonicalFood(name)).toBe("nasi");
    }
    expect(canonicalFood("nasi goreng")).toBe("nasi goreng");
    expect(canonicalFood("nasi goreng seafood")).not.toBe("nasi");
    expect(canonicalFood("tempe mendoan")).toBe("tempe mendoan");
  });
});

describe("userSetSamples: only grams the user set", () => {
  test("typed weights count, unedited AI answers never do", () => {
    const samples = userSetSamples([
      typed("nasi putih", 100),
      aiRow("nasi putih", 150, 150),
      { name: "nasi putih", grams: 150, source: "ai", itemsJson: null },
      { name: "nasi putih", grams: 150, source: "copy", itemsJson: null },
      { name: "nasi putih", grams: 150, source: "barcode", itemsJson: null },
      { name: "nasi putih", grams: null, source: "manual", itemsJson: null },
    ]);
    expect(samples).toEqual([{ food: "nasi", grams: 100 }]);
  });

  test("an AI row whose grams the user changed counts, at the user's number", () => {
    expect(userSetSamples([aiRow("Nasi Putih", 90, 150)])).toEqual([{ food: "nasi", grams: 90 }]);
  });

  test("a renamed AI row or an unreadable list is not known to be edited", () => {
    expect(userSetSamples([{ ...aiRow("nasi putih", 90, 150), name: "nasi uduk" }])).toEqual([]);
    expect(userSetSamples([{ name: "nasi putih", grams: 90, source: "ai", itemsJson: "{oops" }])).toEqual([]);
  });

  test("meal-planner rows are not typed weights", () => {
    const row: HistoryRow = {
      name: "nasi putih",
      grams: 120,
      source: "manual",
      itemsJson: JSON.stringify({ from: "meal-plan", ref: "r:1" }),
    };
    expect(userSetSamples([row])).toEqual([]);
  });
});

describe("consistency gate", () => {
  test("needs five entries", () => {
    expect(priorOf([100, 100, 100, 100])).toBeNull();
    expect(priorOf([100, 100, 100, 100, 100])).toEqual({ grams: 100, n: 5 });
  });

  test("median of tight entries; spread over 25% means no prior", () => {
    expect(priorOf([90, 100, 100, 105, 110])).toEqual({ grams: 100, n: 5 });
    expect(priorOf([50, 100, 100, 150, 200])).toBeNull();
  });

  test("per canonical food", () => {
    const priors = buildPriors([
      ...[100, 100, 95, 105, 100].map((grams) => ({ food: "nasi", grams })),
      ...[40, 90, 150, 20, 60].map((grams) => ({ food: "tempe goreng", grams })),
    ]);
    expect([...priors.keys()]).toEqual(["nasi"]);
  });
});

const priors = buildPriors([100, 100, 95, 105, 100].map((grams) => ({ food: "nasi", grams })));
const rice = { name: "nasi putih", portion: "1 centong", grams: 130, kcal: 170, protein: 3.6, carbs: 36, fat: 0.4, fiber: 0.4, kind: "makanan" as const };

describe("withPortionPrior", () => {
  test("starts at the usual grams, kcal through calibration, the model's numbers behind the chip", () => {
    const out = withPortionPrior(rice, priors);
    expect(out.grams).toBe(100);
    expect(out.kcal).toBe(131);
    expect(out.portion).toBeUndefined();
    expect(out.protein).toBeCloseTo(2.8, 1);
    expect(out.portionPrior).toEqual({
      active: "prior",
      n: 5,
      other: { portion: "1 centong", grams: 130, kcal: 170, protein: 3.6, carbs: 36, fat: 0.4, fiber: 0.4 },
    });
  });

  test("the big-plate ratio is a parameter (the harness tunes it)", () => {
    const typical = { ...rice, grams: 150, kcal: 195 };
    expect(withPortionPrior(typical, priors)).toBe(typical);
    expect(withPortionPrior(typical, priors, { bigPlate: 1.6 }).grams).toBe(100);
  });

  test("a clearly bigger plate keeps the model's number", () => {
    const big = { ...rice, grams: Math.round(100 * PRIOR_BIG_PLATE) + 1, kcal: 300 };
    expect(withPortionPrior(big, priors)).toBe(big);
    const edge = { ...rice, grams: Math.round(100 * PRIOR_BIG_PLATE), kcal: 300 };
    expect(withPortionPrior(edge, priors).grams).toBe(100);
  });

  test("no history, other food, no weight, a hidden cup or the same portion: untouched", () => {
    expect(withPortionPrior(rice, new Map())).toBe(rice);
    const tempe = { ...rice, name: "tempe goreng" };
    expect(withPortionPrior(tempe, priors)).toBe(tempe);
    const noGrams = { ...rice, grams: undefined };
    expect(withPortionPrior(noGrams, priors)).toBe(noGrams);
    const cup = { ...rice, cup: {} };
    expect(withPortionPrior(cup, priors)).toBe(cup);
    const same = { ...rice, grams: 102 };
    expect(withPortionPrior(same, priors)).toBe(same);
  });

  test("a smaller model answer also starts at the usual grams, and the chip swaps both ways", () => {
    const small = withPortionPrior({ ...rice, grams: 80, kcal: 104 }, priors);
    expect(small.grams).toBe(100);
    const swapped = swapPortionPrior(small);
    expect(swapped).toMatchObject({ grams: 80, kcal: 104, portion: "1 centong", portionPrior: { active: "ai" } });
    expect(swapPortionPrior(swapped)).toEqual(small);
  });

  test("swapping an item without a chip changes nothing", () => {
    expect(swapPortionPrior(rice)).toBe(rice);
  });
});
