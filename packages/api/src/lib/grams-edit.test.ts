import { describe, expect, test } from "bun:test";

import { setWithBone } from "./bone-chip";
import { gramsFromOf, stampGramsEdit, withoutGramsEdits } from "./grams-edit";
import type { StampSource } from "./grams-edit";
import { itemAtCount } from "./piece-chip";
import { swapPortionPrior } from "./portion-chip";
import { swapScaleRead, tareScaleRows } from "./scale-chip";

describe("grams edit stamps", () => {
  test("a stamp is added once and never mutates the row", () => {
    const row: { name: string; grams: number; gramsEdits?: StampSource[] } = { name: "nasi", grams: 100 };
    const once = stampGramsEdit(row, "prior");
    expect(once).toEqual({ ...row, gramsEdits: ["prior"] });
    expect(stampGramsEdit(once, "prior")).toBe(once);
    expect(stampGramsEdit(once, "count").gramsEdits).toEqual(["prior", "count"]);
    expect(row).toEqual({ name: "nasi", grams: 100 });
  });

  test("withoutGramsEdits strips them, gramsFromOf adds typed kcal and is undefined for a clean row", () => {
    const row = stampGramsEdit({ name: "nasi", grams: 100 }, "bone");
    expect(withoutGramsEdits([row])).toEqual([{ name: "nasi", grams: 100 }]);
    expect(gramsFromOf(row, false)).toEqual(["bone"]);
    expect(gramsFromOf(row, true)).toEqual(["bone", "typed"]);
    expect(gramsFromOf({ name: "nasi" }, false)).toBeUndefined();
    expect(gramsFromOf({ name: "nasi" }, true)).toEqual(["typed"]);
  });

  test("every chip helper stamps the row it returns, and returns an untouched row unstamped", () => {
    const egg = { name: "telur", portion: "1 butir", grams: 50, kcal: 75, pieces: { count: 1, unit: "butir", unitGrams: 50 } };
    expect((itemAtCount(egg, 3) as { gramsEdits?: string[] }).gramsEdits).toEqual(["count"]);
    expect(itemAtCount(egg, 1)).toBe(egg);

    const chicken = { name: "ayam", grams: 200, grossGrams: 200, edibleGrams: 130, withBone: true, kcal: 380 };
    expect((setWithBone(chicken, false, "dengan tulang") as { gramsEdits?: string[] }).gramsEdits).toEqual(["bone"]);
    expect(setWithBone(chicken, true, "dengan tulang")).toBe(chicken);

    const rice = {
      name: "nasi putih",
      grams: 150,
      kcal: 195,
      portionPrior: { active: "ai" as const, other: { grams: 100, kcal: 130 }, n: 0, source: "typical" as const },
    };
    expect((swapPortionPrior(rice) as { gramsEdits?: string[] }).gramsEdits).toEqual(["prior"]);

    const scaled = {
      name: "nasi",
      grams: 250,
      kcal: 325,
      scaleRead: { active: "scale" as const, other: { grams: 300, kcal: 390 }, text: "250", unit: "g" as const, grams: 250, count: 1 },
    };
    expect((swapScaleRead(scaled) as { gramsEdits?: string[] }).gramsEdits).toEqual(["scale"]);
    expect((tareScaleRows([scaled], 50)![0] as { gramsEdits?: string[] }).gramsEdits).toEqual(["tare"]);
  });
});
