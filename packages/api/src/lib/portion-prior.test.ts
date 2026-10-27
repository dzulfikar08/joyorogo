import { describe, expect, test } from "bun:test";

import { withoutGramsEdits } from "./grams-edit";
import { chipGrams, priorLabelKey, swapPortionPrior } from "./portion-chip";
import {
  PRIOR_BIG_PLATE,
  PRIOR_MIN_ENTRIES,
  PRIOR_SUGGEST_ENTRIES,
  TYPICAL_MIN_RATIO,
  TYPICAL_PORTIONS,
  buildPriors,
  countOf,
  priorFood,
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
  test("two entries are enough for the chip, fewer are no history", () => {
    expect(priorOf([100])).toBeNull();
    expect(priorOf([100, 100])).toEqual({ grams: 100, n: PRIOR_SUGGEST_ENTRIES, tight: true });
    expect(priorOf([100, 100], 5)).toBeNull();
    expect(priorOf([100, 100, 100, 100, 100], 5)).toEqual({ grams: 100, n: 5, tight: true });
  });

  test("median of tight entries; spread over 25% means no prior", () => {
    expect(priorOf([90, 100, 100, 105, 110])).toEqual({ grams: 100, n: 5, tight: true });
    expect(priorOf([50, 100, 100, 150, 200])).toBeNull();
    expect(priorOf([80, 150])).toBeNull();
  });

  test("a spread inside 25% without a tight cluster is a loose prior", () => {
    expect(priorOf([100, 130])).toEqual({ grams: 115, n: 2 });
    expect(priorOf([80, 100, 120])).toEqual({ grams: 100, n: 3 });
  });

  test("one odd save among agreeing ones does not hide the habit", () => {
    // The owner's egg whites: 100, 100, then a 200 he saved for two pieces.
    expect(priorOf([200, 100, 100])).toEqual({ grams: 100, n: 2, tight: true });
    expect(priorOf([100, 200, 100, 100, 100])).toEqual({ grams: 100, n: 4, tight: true });
    // Half of them is not a habit.
    expect(priorOf([200, 100, 100, 200])).toBeNull();
  });

  test("only the newest entries count", () => {
    const newest = Array.from({ length: 12 }, () => 150);
    const older = Array.from({ length: 13 }, () => 100);
    expect(priorOf([...newest, ...older])).toEqual({ grams: 150, n: 12, tight: true });
  });

  test("per canonical food", () => {
    const priors = buildPriors([
      ...[100, 100, 95, 105, 100].map((grams) => ({ food: "nasi", grams })),
      ...[40, 90, 150, 20, 60].map((grams) => ({ food: "tempe goreng", grams })),
    ]);
    expect([...priors.keys()]).toEqual(["nasi"]);
  });

  test("the entries needed come from the caller (the harness tunes it)", () => {
    const samples = [100, 100, 100].map((grams) => ({ food: "nasi", grams }));
    expect(buildPriors(samples).get("nasi")).toEqual({ grams: 100, n: 3, tight: true });
    expect(buildPriors(samples, 5).size).toBe(0);
  });
});

describe("pieces and food names", () => {
  test("countOf: the pieces field, else the number a portion text starts with, a weight is no count", () => {
    expect(countOf({ pieces: { count: 3 }, portion: "1 buah" })).toBe(3);
    expect(countOf({ portion: "2 plastik kecil" })).toBe(2);
    expect(countOf({ portion: "1 buah" })).toBe(1);
    expect(countOf({ portion: "200 g" })).toBe(1);
    expect(countOf({ portion: "250 ml" })).toBe(1);
    expect(countOf({ portion: "satu porsi sedang" })).toBe(1);
    expect(countOf({})).toBe(1);
  });

  test("priorFood: cooking-state words and brackets do not make another food", () => {
    expect(priorFood("Putih Telur")).toBe(priorFood("putih telur rebus"));
    expect(priorFood("putih telur (rebus)")).toBe(priorFood("putih telur"));
    expect(priorFood("nasi kukus")).toBe("nasi");
    expect(priorFood("telur dadar")).not.toBe(priorFood("telur rebus"));
    expect(priorFood("ayam goreng")).toBe("ayam goreng");
  });

  test("a saved weight is per piece: 200 g saved for the AI's '2 plastik kecil' is 100 g a piece", () => {
    const row = (grams: number, portion: string, aiGrams: number): HistoryRow => ({
      name: "Putih Telur",
      grams,
      source: "ai",
      itemsJson: JSON.stringify([{ name: "putih telur", portion, grams: aiGrams, kcal: 25 }]),
    });
    const samples = userSetSamples([row(200, "2 plastik kecil", 100), row(100, "1 buah", 50)]);
    expect(samples.map((s) => s.grams)).toEqual([100, 100]);
    expect(new Set(samples.map((s) => s.food)).size).toBe(1);
  });

  test("the usual grams scale with the pieces on the photo", () => {
    const usual = buildPriors([100, 100].map((grams) => ({ food: priorFood("putih telur"), grams })));
    const white = { name: "putih telur", portion: "1 buah", grams: 50, kcal: 26, protein: 5, carbs: 1, fat: 0, kind: "makanan" as const };
    expect(withPortionPrior(white, usual)).toMatchObject({ grams: 100, portionPrior: { active: "prior", other: { grams: 50 } } });
    const three = withPortionPrior({ ...white, portion: "3 buah", grams: 150, kcal: 78 }, usual);
    expect(three).toMatchObject({ grams: 300, portionPrior: { active: "prior", other: { grams: 150 } } });
    // Three pieces at the usual 100 g each is what the model said: nothing to say.
    const same = { ...white, portion: "3 buah", grams: 300, kcal: 156 };
    expect(withPortionPrior(same, usual)).toBe(same);
  });
});

const history = (...grams: number[]) => buildPriors(grams.map((g) => ({ food: "nasi", grams: g })));
const priors = history(100, 100, 95, 105, 100);
const rice = { name: "nasi putih", portion: "1 centong", grams: 130, kcal: 170, protein: 3.6, carbs: 36, fat: 0.4, fiber: 0.4, kind: "makanan" as const };

describe("withPortionPrior: a solid history starts at the usual grams", () => {
  test("starts at the usual grams, kcal through calibration, the model's numbers behind the chip", () => {
    const out = withPortionPrior(rice, priors);
    expect(out.grams).toBe(100);
    expect(out.kcal).toBe(130);
    expect(out.portion).toBeUndefined();
    expect(out.protein).toBeCloseTo(2.8, 1);
    expect(out.portionPrior).toEqual({
      active: "prior",
      n: 5,
      source: "you",
      other: { portion: "1 centong", grams: 130, kcal: 170, protein: 3.6, carbs: 36, fat: 0.4, fiber: 0.4 },
    });
  });

  test("agreeing weights start at the usual grams from two entries; two that only sit close offer it", () => {
    expect(withPortionPrior(rice, history(100, 100, 100))).toMatchObject({ grams: 100, portionPrior: { active: "prior", n: PRIOR_MIN_ENTRIES } });
    expect(withPortionPrior(rice, history(100, 100))).toMatchObject({ grams: 100, kcal: 130, portionPrior: { active: "prior", n: 2, source: "you", other: { grams: 130, kcal: 170, portion: "1 centong" } } });
    const loose = withPortionPrior(rice, history(100, 130));
    expect(loose).toMatchObject({ grams: 130, kcal: 170, portion: "1 centong", portionPrior: { active: "ai", n: 2, source: "you", other: { grams: 115 } } });
    expect(withPortionPrior(rice, history(100, 100, 100), { minEntries: 5 })).toMatchObject({ grams: 130, portionPrior: { active: "ai", n: 3 } });
  });

  test("a clearly bigger plate keeps the model's number, the usual grams stay on the chip", () => {
    const big = { ...rice, grams: Math.round(100 * PRIOR_BIG_PLATE) + 1, kcal: 300 };
    expect(withPortionPrior(big, priors)).toMatchObject({ grams: big.grams, kcal: 300, portionPrior: { active: "ai", n: 5, other: { grams: 100 } } });
    const edge = { ...rice, grams: Math.round(100 * PRIOR_BIG_PLATE), kcal: 300 };
    expect(withPortionPrior(edge, priors).grams).toBe(100);
  });

  test("the big-plate ratio is a parameter", () => {
    const plate = { ...rice, grams: 150, kcal: 195 };
    expect(withPortionPrior(plate, priors).grams).toBe(150);
    expect(withPortionPrior(plate, priors, { bigPlate: 1.6 }).grams).toBe(100);
  });

  test("the personal history wins over the typical portion", () => {
    const mine = history(200, 200, 190);
    const plate = { ...rice, grams: 150, kcal: 195 };
    expect(withPortionPrior(plate, mine)).toMatchObject({ grams: 200, portionPrior: { source: "you", n: 3 } });
  });

  test("a smaller model answer also starts at the usual grams, and the chip swaps both ways", () => {
    const small = withPortionPrior({ ...rice, grams: 80, kcal: 104 }, priors);
    expect(small.grams).toBe(100);
    const swapped = swapPortionPrior(small);
    expect(swapped).toMatchObject({ grams: 80, kcal: 104, portion: "1 centong", portionPrior: { active: "ai" } });
    expect(withoutGramsEdits([swapPortionPrior(swapped)])).toEqual([small]);
  });
});

describe("withPortionPrior: the typical rice portion for everyone else", () => {
  test("rice the model weighed heavy gets the typical portion on the chip, the model's number stays", () => {
    const out = withPortionPrior(rice, new Map());
    expect(out).toMatchObject({
      name: "nasi putih",
      grams: 130,
      kcal: 170,
      portion: "1 centong",
      portionPrior: { active: "ai", n: 0, source: "typical", other: { grams: TYPICAL_PORTIONS.nasi, kcal: 130 } },
    });
    expect(chipGrams(out)).toEqual({ ai: 130, usual: 100 });
  });

  test("one tap puts the typical portion on the row and another puts the model's back", () => {
    const out = withPortionPrior({ ...rice, grams: 150, kcal: 195 }, new Map());
    const tapped = swapPortionPrior(out);
    expect(tapped).toMatchObject({ grams: 100, kcal: 130, portionPrior: { active: "prior", source: "typical", other: { grams: 150, kcal: 195, portion: "1 centong" } } });
    expect(tapped.portion).toBeUndefined();
    expect(withoutGramsEdits([swapPortionPrior(tapped)])).toEqual([out]);
  });

  test("every plain rice spelling, the ratio decides, other foods and kinds stay untouched", () => {
    for (const name of ["nasi", "Nasi Uduk", "nasi merah", "white rice"]) {
      expect(withPortionPrior({ ...rice, name }, new Map()).portionPrior?.source).toBe("typical");
    }
    const edge = Math.ceil(TYPICAL_PORTIONS.nasi! * TYPICAL_MIN_RATIO);
    expect(withPortionPrior({ ...rice, grams: edge }, new Map()).portionPrior).toBeDefined();
    const lighter = { ...rice, grams: edge - 1, kcal: 150 };
    expect(withPortionPrior(lighter, new Map())).toBe(lighter);
    const small = { ...rice, grams: 80, kcal: 104 };
    expect(withPortionPrior(small, new Map())).toBe(small);
    for (const name of ["nasi goreng", "nasi padang", "tempe goreng", "bubur ayam"]) {
      const dish = { ...rice, name };
      expect(withPortionPrior(dish, new Map())).toBe(dish);
    }
  });

  test("the typical portion can be turned off (the harness's v1)", () => {
    expect(withPortionPrior(rice, new Map(), { typical: false })).toBe(rice);
  });
});

describe("withPortionPrior: left alone", () => {
  test("no weight, a hidden cup or the same portion: untouched", () => {
    const tempe = { ...rice, name: "tempe goreng" };
    expect(withPortionPrior(tempe, priors)).toBe(tempe);
    const noGrams = { ...rice, grams: undefined };
    expect(withPortionPrior(noGrams, priors)).toBe(noGrams);
    const cup = { ...rice, cup: {} };
    expect(withPortionPrior(cup, priors)).toBe(cup);
    const same = { ...rice, grams: 102 };
    expect(withPortionPrior(same, priors)).toBe(same);
  });

  test("swapping an item without a chip changes nothing", () => {
    expect(swapPortionPrior(rice)).toBe(rice);
  });

  test("a chip of an older server (no source) is the user's own and keeps its label", () => {
    expect(priorLabelKey({})).toBe("result.items.priorUsual");
    expect(priorLabelKey({ source: "you" })).toBe("result.items.priorUsual");
    expect(priorLabelKey({ source: "typical" })).toBe("result.items.priorTypical");
  });
});
