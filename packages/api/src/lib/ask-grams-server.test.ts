import { describe, expect, test } from "bun:test";

import { withAskGrams } from "./ask-grams-server";
import { typicalPortionG } from "./tkpi";

const bowl = { name: "bubur kacang hijau", grams: 300, kcal: 330, kind: "makanan" };

describe("typicalPortionG", () => {
  test("is the library dish's serving, undefined for a combination or a food with no library row", () => {
    expect(typicalPortionG("bubur kacang hijau")).toBe(350);
    expect(typicalPortionG("nasi goreng telur ceplok")).toBeUndefined();
    expect(typicalPortionG("xyzzy tak dikenal")).toBeUndefined();
  });
});

describe("withAskGrams", () => {
  test("marks the lone heavy row and gives the three sizes of a library dish", () => {
    expect(withAskGrams([bowl])).toEqual([{ ...bowl, askGrams: true, sizeOptions: [175, 350, 525] }]);
  });

  test("a heavy row the library has no serving for asks with the typed box alone", () => {
    const [row] = withAskGrams([{ ...bowl, name: "xyzzy tak dikenal" }]);
    expect(row).toMatchObject({ askGrams: true });
    expect(row).not.toHaveProperty("sizeOptions");
  });

  test("leaves every other answer as it is", () => {
    const plate = [bowl, { ...bowl, name: "kerupuk", grams: 20 }];
    expect(withAskGrams(plate)).toBe(plate);
    expect(withAskGrams([{ ...bowl, grams: 120 }])[0]).not.toHaveProperty("askGrams");
    expect(withAskGrams([{ ...bowl, kind: "minuman" }])[0]).not.toHaveProperty("sizeOptions");
  });
});
