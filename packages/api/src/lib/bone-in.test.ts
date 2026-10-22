import { describe, expect, test } from "bun:test";

import { boneInFraction } from "./bone-in";

describe("boneInFraction", () => {
  test("chicken parts have their own edible share", () => {
    expect(boneInFraction("ayam goreng sayap")).toBe(0.5);
    expect(boneInFraction("sayap ayam bakar")).toBe(0.5);
    expect(boneInFraction("ayam goreng paha bawah")).toBe(0.6);
    expect(boneInFraction("ayam goreng paha atas")).toBe(0.7);
    expect(boneInFraction("ayam bakar paha")).toBe(0.65);
    expect(boneInFraction("ayam goreng dada")).toBe(0.7);
    expect(boneInFraction("fried chicken drumstick")).toBe(0.6);
  });

  test("ribs and whole fish", () => {
    expect(boneInFraction("iga bakar")).toBe(0.5);
    expect(boneInFraction("iga babi panggang")).toBe(0.5);
    expect(boneInFraction("lele goreng")).toBe(0.55);
    expect(boneInFraction("gurame bakar")).toBe(0.55);
  });

  test("a part word without its animal is not a bone-in part", () => {
    expect(boneInFraction("paha katak")).toBeUndefined();
    expect(boneInFraction("dada")).toBeUndefined();
  });

  test("boneless wording and dishes that hold more than the piece are not bone-in", () => {
    expect(boneInFraction("ayam goreng fillet")).toBeUndefined();
    expect(boneInFraction("chicken katsu dada")).toBeUndefined();
    expect(boneInFraction("sop iga")).toBeUndefined();
    expect(boneInFraction("nasi goreng ayam")).toBeUndefined();
    expect(boneInFraction("bandeng presto")).toBeUndefined();
    expect(boneInFraction("nasi ayam goreng paha")).toBeUndefined();
  });
});
