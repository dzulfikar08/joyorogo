import { describe, expect, test } from "bun:test";

import { hasBone, setWithBone, stripBoneLabel } from "./bone-chip";

const drumstick = {
  name: "ayam goreng",
  portion: "2 potong, dengan tulang",
  grams: 200,
  grossGrams: 200,
  edibleGrams: 130,
  withBone: true,
  kcal: 380,
};

describe("setWithBone", () => {
  test("off: grams become the edible part, kcal stay, the portion drops the bone label", () => {
    const off = setWithBone(drumstick, false, "dengan tulang");
    expect(off).toMatchObject({
      grams: 130,
      withBone: false,
      kcal: 380,
      portion: "2 potong",
      grossGrams: 200,
      edibleGrams: 130,
    });
  });

  test("on again: the gross weight and the label come back", () => {
    const back = setWithBone(setWithBone(drumstick, false, "dengan tulang"), true, "dengan tulang");
    expect(back).toMatchObject({ grams: 200, withBone: true, portion: "2 potong, dengan tulang" });
  });

  test("already on that side, or a row with no bone data: the same row", () => {
    expect(setWithBone(drumstick, true, "dengan tulang")).toBe(drumstick);
    const rice = { name: "nasi", grams: 150 };
    expect(setWithBone(rice, false, "dengan tulang")).toBe(rice);
    expect(hasBone(rice)).toBe(false);
    expect(hasBone(drumstick)).toBe(true);
  });

  test("the English label is stripped too", () => {
    expect(stripBoneLabel("1 piece, with bone")).toBe("1 piece");
    expect(stripBoneLabel("with bone")).toBeUndefined();
  });
});
