import { describe, expect, test } from "bun:test";

import { swapScaleRead, tareScaleRows } from "./scale-chip";
import type { ScaleReadChip } from "./scale-chip";

type Row = { name: string; grams?: number; kcal: number; protein?: number; scaleRead?: ScaleReadChip };

const chip = (grams: number, count: number, other: { grams: number; kcal: number }): ScaleReadChip => ({
  active: "scale",
  other,
  text: String(grams),
  unit: "g",
  grams,
  count,
});

describe("tareScaleRows: the scale weighed the bowl too", () => {
  test("one row: the bowl comes off, kcal per gram stays, and tare 0 puts the reading back", () => {
    const soto: Row[] = [{ name: "soto daging", grams: 668, kcal: 418, protein: 25, scaleRead: chip(668, 1, { grams: 500, kcal: 313 }) }];
    const tared = tareScaleRows(soto, 350)!;
    expect(tared[0]).toMatchObject({ grams: 318, kcal: 199, scaleRead: { tare: 350 } });
    expect(tared[0]!.protein).toBeCloseTo(11.9, 1);
    const back = tareScaleRows(tared, 0)!;
    expect(back[0]).toMatchObject({ grams: 668, kcal: 418 });
    expect(back[0]!.scaleRead?.tare).toBeUndefined();
  });

  test("a reading shared by two rows: both shrink in proportion and add up to reading minus plate; other rows stay", () => {
    const plate: Row[] = [
      { name: "nasi putih", grams: 450, kcal: 585, scaleRead: chip(600, 2, { grams: 200, kcal: 260 }) },
      { name: "ayam goreng", grams: 150, kcal: 390, scaleRead: chip(600, 2, { grams: 100, kcal: 260 }) },
      { name: "es teh", grams: 250, kcal: 90 },
    ];
    const tared = tareScaleRows(plate, 400)!;
    expect(tared[0]!.grams! + tared[1]!.grams!).toBe(200);
    expect(tared[0]!.grams).toBe(150);
    expect(tared[2]).toEqual(plate[2]!);
  });

  test("a row showing the photo estimate keeps it; the scale side it flips to is net of the bowl", () => {
    const soto: Row[] = [{ name: "soto daging", grams: 668, kcal: 418, scaleRead: chip(668, 1, { grams: 500, kcal: 313 }) }];
    const onPhoto = swapScaleRead(soto[0]!);
    const tared = tareScaleRows([onPhoto], 350)!;
    expect(tared[0]).toMatchObject({ grams: 500, kcal: 313 });
    expect(swapScaleRead(tared[0]!)).toMatchObject({ grams: 318 });
  });

  test("a container as heavy as the reading, or no reading at all: nothing to do", () => {
    const soto: Row[] = [{ name: "soto daging", grams: 668, kcal: 418, scaleRead: chip(668, 1, { grams: 500, kcal: 313 }) }];
    expect(tareScaleRows(soto, 668)).toBeNull();
    expect(tareScaleRows([{ name: "nasi", grams: 100, kcal: 130 }], 50)).toBeNull();
  });
});
