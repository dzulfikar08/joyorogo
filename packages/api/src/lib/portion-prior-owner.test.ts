// The owner's real egg whites (lib/fixtures/owner-putih-telur.json, production 2026-10-22): the model answered
// 50 g, he saved 100 g, and the next scan said 50 g again. Each scan is replayed against the diary rows
// that existed before it.
import { describe, expect, test } from "bun:test";

import { ownerPutihTelurRows } from "./owner-putih-telur-fixture";
import type { SavedEggRow as Saved } from "./owner-putih-telur-fixture";
import { buildPriors, priorFood, userSetSamples, withPortionPrior } from "./portion-prior";

const rows = ownerPutihTelurRows();

type AiItem = { name: string; portion: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fiber: number; kind: "makanan" };

/** What the model answered for a saved row, or null when the row's scan was of another dish (renamed afterwards). */
function modelAnswer(row: Saved): AiItem | null {
  const list = JSON.parse(row.itemsJson ?? "[]") as AiItem[];
  return list.find((entry) => priorFood(entry.name) === priorFood("putih telur")) ?? null;
}

const scans = rows.flatMap((row, index) => {
  const ai = modelAnswer(row);
  if (!ai) return [];
  const before = rows.slice(0, index).reverse();
  return [{ row, ai, priors: buildPriors(userSetSamples(before)) }];
});

const shownGrams = (scan: (typeof scans)[number]) => withPortionPrior(scan.ai, scan.priors).grams;

describe("the owner's putih telur sequence", () => {
  test("the fixture is eight scans of boiled egg white, after three renamed rows", () => {
    expect(rows).toHaveLength(11);
    expect(scans.map((s) => s.ai.grams)).toEqual([100, 50, 60, 100, 100, 50, 50, 50]);
  });

  test("with fewer than two corrections in the history the model's number shows", () => {
    expect(scans.slice(0, 3).map(shownGrams)).toEqual([100, 50, 60]);
  });

  test("after two saves at 100 g the history is a usual portion, and the same weight needs no chip", () => {
    const [fourth] = scans.slice(3);
    expect(fourth!.priors.get(priorFood("putih telur"))).toMatchObject({ grams: 100, n: 2, tight: true });
    expect(withPortionPrior(fourth!.ai, fourth!.priors)).toBe(fourth!.ai);
  });

  test("two pieces: the 100 g the model gave for '2 plastik kecil' starts at the 200 g he saved", () => {
    const pieces = scans[4]!;
    expect(pieces.ai.portion).toBe("2 plastik kecil");
    expect(withPortionPrior(pieces.ai, pieces.priors)).toMatchObject({ grams: 200, portionPrior: { active: "prior", n: 2, other: { grams: 100 } } });
  });

  test("the three scans that came out at 50 g start at 100 g, 52 kcal, with the model's 50 g one tap away", () => {
    for (const scan of scans.slice(5)) {
      expect(scan.ai.grams).toBe(50);
      const shown = withPortionPrior(scan.ai, scan.priors);
      expect(shown).toMatchObject({ grams: 100, portionPrior: { active: "prior", source: "you", other: { grams: 50, kcal: 25 } } });
      expect(shown.kcal).toBeGreaterThanOrEqual(50);
      expect(shown.kcal).toBeLessThanOrEqual(54);
    }
  });

  test("the 200 g save of two pieces is 100 g a piece, so it never splits the habit", () => {
    const last = scans.at(-1)!;
    const history = rows.slice(0, rows.indexOf(last.row)).reverse();
    const samples = userSetSamples(history).filter((sample) => sample.food === priorFood("putih telur"));
    expect(samples.map((sample) => sample.grams)).toEqual([100, 100, 100, 100, 100]);
  });

  test("a photo of three pieces starts at three times the usual weight", () => {
    const last = scans.at(-1)!;
    const three = { ...last.ai, portion: "3 buah", grams: 150, kcal: 78 };
    expect(withPortionPrior(three, last.priors)).toMatchObject({ grams: 300, portionPrior: { active: "prior", other: { grams: 150 } } });
  });
});
