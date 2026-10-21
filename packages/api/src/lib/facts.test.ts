import { describe, expect, test } from "bun:test";

import { indomieLine, indomiePacks } from "./facts";

describe("Indomie equivalence on the scan result", () => {
  test("one decimal, rounded to the nearest tenth of a pack", () => {
    expect(indomiePacks(380)).toBe(1);
    expect(indomiePacks(570)).toBe(1.5);
    expect(indomiePacks(1847)).toBe(4.9);
  });

  test("no line when it would round to zero packs", () => {
    expect(indomieLine(15, "id")).toBeNull();
    expect(indomieLine(0, "en")).toBeNull();
  });

  test("Indonesian uses a decimal comma, English a point and pack plurals", () => {
    expect(indomieLine(570, "id")).toBe("Setara 1,5 bungkus Indomie");
    expect(indomieLine(570, "en")).toBe("About 1.5 packs of Indomie");
    expect(indomieLine(380, "en")).toBe("About 1 pack of Indomie");
  });
});
