import { describe, expect, test } from "bun:test";

import { resplitScaleAfterCorrection, resplitScaleRows, swapScaleRead, tareScaleRows } from "./scale-chip";
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

describe("tareScaleRows after the scan's own container estimate", () => {
  test("a weighed container replaces the estimate and its label", () => {
    const soto: Row[] = [
      { name: "soto daging", grams: 418, kcal: 261, scaleRead: { ...chip(668, 1, { grams: 668, kcal: 418 }), tare: 250, tareKind: "bowl" } },
    ];
    const tared = tareScaleRows(soto, 300)!;
    expect(tared[0]).toMatchObject({ grams: 368, scaleRead: { tare: 300 } });
    expect(tared[0]!.scaleRead).not.toHaveProperty("tareKind");
    const none = tareScaleRows(tared, 0)!;
    expect(none[0]).toMatchObject({ grams: 668 });
    expect(none[0]!.scaleRead).not.toHaveProperty("tare");
  });
});

type Full = Row & { kind?: string };
const plate = (): Full[] => [
  { name: "nasi putih", grams: 200, kcal: 260, scaleRead: chip(300, 3, { grams: 200, kcal: 260 }) },
  { name: "ayam goreng", grams: 70, kcal: 170, scaleRead: chip(300, 3, { grams: 70, kcal: 170 }) },
  { name: "telur dadar", grams: 30, kcal: 60, scaleRead: chip(300, 3, { grams: 30, kcal: 60 }) },
  { name: "es teh", grams: 250, kcal: 90, kind: "minuman" },
];

describe("resplitScaleRows: a row left out hands its share back", () => {
  test("the reading is shared by the rows that stay, in the photo-estimate proportions", () => {
    const next = resplitScaleRows(plate(), [true, true, false, true])!;
    expect(next[0]!.grams! + next[1]!.grams!).toBe(300);
    expect(next[0]!.grams! / next[1]!.grams!).toBeCloseTo(200 / 70, 1);
    expect(next[0]!.kcal).toBeGreaterThan(260);
    expect(next[0]!.scaleRead).toMatchObject({ count: 2, grams: 300 });
    // The left-out row and the drink are untouched.
    expect(next[2]!.grams).toBe(30);
    expect(next[3]!.grams).toBe(250);
  });

  test("putting the row back restores the first split", () => {
    const out = resplitScaleRows(plate(), [true, true, false, true])!;
    const back = resplitScaleRows(out, [true, true, true, true])!;
    expect(back.slice(0, 3).map((r) => r.grams)).toEqual([200, 70, 30]);
    expect(back[0]!.scaleRead!.count).toBe(3);
  });

  test("one row left takes the whole reading", () => {
    const next = resplitScaleRows(plate(), [true, false, false, true])!;
    expect(next[0]!.grams).toBe(300);
  });

  test("the container stays off: the rows share reading minus tare", () => {
    const rows = plate().map((r) => (r.scaleRead ? { ...r, scaleRead: { ...r.scaleRead, tare: 100, tareKind: "plate" as const } } : r));
    const next = resplitScaleRows(rows, [true, false, true, true])!;
    expect(next[0]!.grams! + next[2]!.grams!).toBe(200);
    expect(next[0]!.scaleRead).toMatchObject({ tare: 100, tareKind: "plate" });
  });

  test("nothing to do: no reading, a row on the photo estimate, or every covered row left out", () => {
    expect(resplitScaleRows([{ name: "nasi", grams: 100, kcal: 130 }], [false])).toBeNull();
    const onPhoto = plate();
    onPhoto[1] = swapScaleRead(onPhoto[1]!);
    expect(resplitScaleRows(onPhoto, [true, true, false, true])).toBeNull();
    expect(resplitScaleRows(plate(), [false, false, false, true])).toBeNull();
  });
});

describe("resplitScaleAfterCorrection: a Koreksi that removes rows", () => {
  const patch = (rows: Array<Row & { kind?: string }>, origins: Array<number | null>, changes: Array<{ index: number; kind: string }> = []) => ({
    items: rows,
    origins,
    changes,
  });
  // What the server returns: kept rows exactly as sent (no chip).
  const sent = (r: Full): Row & { kind?: string } => {
    const { scaleRead: _chip, ...rest } = r;
    return rest;
  };

  test("two rows removed: the remaining rows take the whole reading, chip back, kcal follow", () => {
    const base = plate();
    const out = resplitScaleAfterCorrection(base, patch([sent(base[0]!), sent(base[3]!)], [0, 3]));
    expect(out[0]!.grams).toBe(300);
    expect(out[0]!.kcal).toBe(Math.round((260 * 300) / 200));
    expect(out[0]!.scaleRead).toMatchObject({ active: "scale", count: 1, grams: 300, other: { grams: 200 } });
    // The drink was never on the scale.
    expect(out[1]!.grams).toBe(250);
    expect(out[1]!.scaleRead).toBeUndefined();
  });

  test("the soto-style case: reading 313, two of five removed, one added with grams the user stated", () => {
    const base: Full[] = [
      { name: "nasi", grams: 150, kcal: 195, scaleRead: chip(313, 5, { grams: 150, kcal: 195 }) },
      { name: "ayam", grams: 90, kcal: 220, scaleRead: chip(313, 5, { grams: 90, kcal: 220 }) },
      { name: "timun", grams: 20, kcal: 3, scaleRead: chip(313, 5, { grams: 20, kcal: 3 }) },
      { name: "telur dadar", grams: 40, kcal: 80, scaleRead: chip(313, 5, { grams: 40, kcal: 80 }) },
      { name: "abon", grams: 13, kcal: 60, scaleRead: chip(313, 5, { grams: 13, kcal: 60 }) },
    ];
    const rows = [sent(base[0]!), sent(base[1]!), sent(base[2]!), { name: "serundeng", grams: 30, kcal: 140 }];
    const out = resplitScaleAfterCorrection(base, patch(rows, [0, 1, 2, null], [{ index: 3, kind: "added" }]));
    expect(out[0]!.grams! + out[1]!.grams! + out[2]!.grams! + out[3]!.grams!).toBe(313);
    expect(out[3]).toBe(rows[3]!);
    expect(out[3]!.grams).toBe(30);
    expect(out[0]!.scaleRead!.count).toBe(3);
  });

  test("a portion the person set in the same correction keeps its grams and comes off the pool first", () => {
    const base = plate();
    const rows = [sent(base[0]!), { ...sent(base[1]!), grams: 100, kcal: 244 }];
    const out = resplitScaleAfterCorrection(base, patch(rows, [0, 1], [{ index: 1, kind: "portion" }]));
    expect(out[1]!.grams).toBe(100);
    expect(out[0]!.grams).toBe(200);
    expect(out[1]!.scaleRead).toBeUndefined();
  });

  test("nothing removed, or a covered row on the photo estimate: the correction's own list", () => {
    const base = plate();
    const all = patch(base.map(sent), [0, 1, 2, 3]);
    const same = resplitScaleAfterCorrection(base, all);
    expect(same.every((r, i) => r === all.items[i])).toBe(true);
    const onPhoto = plate();
    onPhoto[1] = swapScaleRead(onPhoto[1]!);
    const two = patch([sent(onPhoto[1]!)], [1]);
    expect(resplitScaleAfterCorrection(onPhoto, two)[0]).toBe(two.items[0]!);
  });
});
