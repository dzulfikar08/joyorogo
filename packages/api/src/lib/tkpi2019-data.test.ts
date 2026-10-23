import { describe, expect, test } from "bun:test";

import { atwaterConsistent } from "./joyo-ai/foods";
import { TKPI_2019 } from "./tkpi2019-data";

/**
 * Rows whose own numbers do not add up: |4P + 4C + 9F - kcal| > max(25, 35 % of kcal). They are Kemenkes print errors
 * (a shifted decimal or a swapped column) that we cannot correct without the source book, so the app withholds their
 * protein/carbs/fat (`dataNote: macros_inconsistent`, joyo-ai/foods.ts) and keeps kcal and fiber. Meal-plan recipes
 * must not use them (docs/meal-plan.md).
 *
 * The list is exact: a new offending row fails the test, and a row that gets fixed must leave the list.
 * Fixed in the data on purpose: ER073 Pepaya, segar (printed fat 12.0 g beside 46 kcal; 0.1 g per nilaigizi.com), see
 * CORRECTIONS in scripts/scrape-tkpi2019.py.
 */
const KNOWN_INCONSISTENT: Record<string, string> = {
  AP022: "Mi kering: carbs 6.3 g beside 339 kcal (decimal shift, probably 63)",
  AP040: "Bubur tinotuan (Manado): 156 kcal against 73 kcal from macros",
  BP021: "Beras Siger: carbs 28.3 g beside 344 kcal",
  BP024: "Cassavastick: 460 kcal against 240 kcal from macros",
  BR033: "Umbi Uwi, segar: carbs 82.3 g beside 120 kcal",
  CP059: "Saridele, bubuk: macros give 472 kcal against 344",
  DP042: "Olah-olah: 9 kcal beside 6 g fat",
  DR004: "Andewi, segar: 226 kcal beside 5.3 g carbs",
  FP011: "Sapi, abon: carbs 59.3 g with 10.6 g fat beside 212 kcal",
  FP035: "Babi hutan masak rica: 491 kcal against 246 kcal from macros",
  GP056: "Bou ninahu ndamate, masakan: 79 kcal against 39 kcal from macros",
  GP071: "Jukku pallu kaloa, masakan: 15 kcal beside 15.2 g protein",
  GR051: "Lokan, segar: 217 kcal against 80 kcal from macros",
  MP009: "Kopi bubuk instant: macros give 194 kcal against 129",
};

describe("TKPI 2019 data consistency", () => {
  const failing = TKPI_2019.filter(([, , , kcal, protein, fat, carbs]) => !atwaterConsistent(kcal, protein, carbs, fat)).map((row) => row[0]);

  test("every row that fails the Atwater check (4P+4C+9F vs kcal) is a known, documented print error", () => {
    const unknown = failing.filter((code) => !(code in KNOWN_INCONSISTENT));
    expect(unknown).toEqual([]);
  });

  test("no row is listed as inconsistent after it was fixed", () => {
    const fixed = Object.keys(KNOWN_INCONSISTENT).filter((code) => !failing.includes(code));
    expect(fixed).toEqual([]);
  });

  test("ER073 Pepaya, segar has the corrected fat (0.1 g), not the printed 12.0 g", () => {
    const row = TKPI_2019.find((r) => r[0] === "ER073");
    expect(row).toEqual(["ER073", "Pepaya, segar", 86.7, 46.0, 0.5, 0.1, 12.2, 1.6]);
  });
});
