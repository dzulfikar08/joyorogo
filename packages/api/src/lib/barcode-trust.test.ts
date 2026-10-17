import { describe, expect, test } from "bun:test";

import { consensus, submissionsAgree } from "./barcode-trust";
import type { Submission } from "./barcode-trust";

function sub(userId: string | null, at: number, kcal100: number, over: Partial<Submission> = {}): Submission {
  return {
    userId,
    name: `Produk ${userId}`,
    brand: null,
    quantity: null,
    servingSize: 30,
    unit: "g",
    kcal100,
    protein100: 6,
    carbs100: 60,
    fat100: 20,
    fiber100: 2,
    sugar100: 10,
    at,
    ...over,
  };
}

describe("submissionsAgree", () => {
  test("label rounding agrees, a different reading does not", () => {
    expect(submissionsAgree(sub("a", 1, 440), sub("b", 2, 452))).toBe(true);
    expect(submissionsAgree(sub("a", 1, 440), sub("b", 2, 150))).toBe(false);
    expect(submissionsAgree(sub("a", 1, 440), sub("b", 2, 440, { carbs100: 30 }))).toBe(false);
  });

  test("a nutrient one side left blank does not disagree", () => {
    expect(submissionsAgree(sub("a", 1, 440), sub("b", 2, 440, { fiber100: null, sugar100: null }))).toBe(true);
  });
});

describe("consensus", () => {
  test("nobody, nothing", () => {
    expect(consensus([])).toBeNull();
  });

  test("one submission stands alone", () => {
    const only = sub("a", 1, 440);
    expect(consensus([only])).toEqual({ winner: only, contributors: 1 });
  });

  test("a second user's agreeing numbers confirm; the newest reading is shown", () => {
    const first = sub("a", 1, 440);
    const second = sub("b", 2, 450);
    expect(consensus([first, second])).toEqual({ winner: second, contributors: 2 });
  });

  test("a second user who disagrees overrides a lone first submission", () => {
    const first = sub("a", 1, 440);
    const second = sub("b", 2, 150, { carbs100: 20, fat100: 6, protein100: 2 });
    const result = consensus([first, second]);
    expect(result?.winner).toBe(second);
    expect(result?.contributors).toBe(1);
  });

  test("a third user settles it; a confirmed value is not overridden by one newer outlier", () => {
    const a = sub("a", 1, 440);
    const b = sub("b", 2, 445);
    const outlier = sub("c", 3, 150, { carbs100: 20, fat100: 6, protein100: 2 });
    const result = consensus([a, b, outlier]);
    expect(result?.contributors).toBe(2);
    expect(result?.winner.userId).toBe("b");
    const tiebreak = consensus([a, outlier, sub("d", 4, 152, { carbs100: 21, fat100: 6, protein100: 2 })]);
    expect(tiebreak?.winner.userId).toBe("d");
    expect(tiebreak?.contributors).toBe(2);
  });
});
