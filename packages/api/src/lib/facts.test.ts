import { describe, expect, test } from "bun:test";

import {
  equivalentLine,
  equivalentUnits,
  CHICKEN_RICE_PLATE_KCAL,
  FOOD_FACTS_MY,
  FOOD_FACTS_SG,
  randomFact,
  pickFact,
  ROTI_CANAI_PIECE_KCAL,
} from "./facts";
import { MYFCD_DISHES } from "./myfcd-dishes";

describe("Indomie equivalence on the scan result (Indonesia)", () => {
  test("one decimal, rounded to the nearest tenth of a pack", () => {
    expect(equivalentUnits(380, "id")).toBe(1);
    expect(equivalentUnits(570, "id")).toBe(1.5);
    expect(equivalentUnits(1847, "id")).toBe(4.9);
  });

  test("no line when it would round to zero packs", () => {
    expect(equivalentLine(15, "id")).toBeNull();
    expect(equivalentLine(0, "en")).toBeNull();
    expect(equivalentLine(10, "ms")).toBeNull();
  });

  test("Indonesian uses a decimal comma, English a point and pack plurals", () => {
    expect(equivalentLine(570, "id")).toBe("Setara 1,5 bungkus Indomie");
    expect(equivalentLine(570, "en")).toBe("About 1.5 packs of Indomie");
    expect(equivalentLine(380, "en")).toBe("About 1 pack of Indomie");
  });
});

describe("roti canai equivalence (Malaysia)", () => {
  test("the unit is one piece of the dish table's roti canai", () => {
    const row = MYFCD_DISHES.find((dish) => dish.name === "roti canai")!;
    expect(Math.round((row.typicalPortionG * row.kcalPer100g) / 100)).toBe(ROTI_CANAI_PIECE_KCAL);
  });

  test("Bahasa Melayu compares to roti canai, not Indomie", () => {
    expect(equivalentLine(369, "ms")).toBe("Bersamaan 1.5 keping roti canai");
    expect(equivalentLine(492, "ms")).toBe("Bersamaan 2 keping roti canai");
    expect(equivalentUnits(492, "ms")).toBe(2);
    expect(equivalentLine(492, "ms")).not.toContain("Indomie");
  });
});

describe("Malaysian food facts", () => {
  const DISH: Record<(typeof FOOD_FACTS_MY)[number]["id"], string> = {
    nasiLemak: "nasi lemak",
    rotiCanai: "roti canai",
    miloAis: "milo ais",
    charKueyTeow: "char kuey teow",
    meeGorengMamak: "mee goreng mamak",
    laksa: "laksa",
    cendol: "cendol",
    karipap: "karipap",
    nasiAyam: "nasi ayam",
    satay: "satay ayam",
    pisangGoreng: "pisang goreng",
    kuihLapis: "kuih lapis",
    nasiLemakAyam: "nasi lemak ayam goreng",
  };

  test("every fact matches its dish row at the row's portion, within the rounding to 5", () => {
    for (const fact of FOOD_FACTS_MY) {
      const row = MYFCD_DISHES.find((dish) => dish.name === DISH[fact.id])!;
      const portion = (row.typicalPortionG * row.kcalPer100g) / 100;
      expect(Math.abs(fact.kcal - portion)).toBeLessThanOrEqual(5);
    }
  });

  test("no pork dish in a pool every user may see", () => {
    for (const fact of FOOD_FACTS_MY) expect(DISH[fact.id]).not.toMatch(/bak kut|char siu|babi/);
  });

  test("Bahasa Melayu users get the Malaysian pool, Indonesian users keep theirs", () => {
    const ms = pickFact("2026-10-21", "ms");
    expect(FOOD_FACTS_MY.some((fact) => fact.kcal === ms.kcal)).toBe(true);
    expect(ms.text).not.toMatch(/geprek|seblak|pempek/);
    expect(ms.move).toMatch(/^(berlari|berjalan|berbasikal) /);
    expect(pickFact("2026-10-21", "id").text.length).toBeGreaterThan(0);
  });
});

describe("chicken rice equivalence (Singapore)", () => {
  test("the unit is one plate of the dish table's steamed chicken rice", () => {
    const row = MYFCD_DISHES.find((dish) => dish.name === "nasi ayam")!;
    expect(Math.round((row.typicalPortionG * row.kcalPer100g) / 100)).toBe(CHICKEN_RICE_PLATE_KCAL);
  });

  test("English in Singapore reads 'Same as N plates of chicken rice'", () => {
    expect(equivalentLine(764, "en", "SG")).toBe("Same as 1.5 plates of chicken rice");
    expect(equivalentLine(509, "en", "SG")).toBe("Same as 1 plate of chicken rice");
    expect(equivalentUnits(1018, "en", "SG")).toBe(2);
  });

  test("no line below a twentieth of a plate", () => {
    expect(equivalentLine(10, "en", "SG")).toBeNull();
  });

  test("outside Singapore the unit does not change", () => {
    expect(equivalentLine(380, "en", "ID")).toBe("About 1 pack of Indomie");
    expect(equivalentLine(380, "en")).toBe("About 1 pack of Indomie");
    expect(equivalentLine(380, "en", "MY")).toBe("About 1 pack of Indomie");
    expect(equivalentLine(246, "ms", "SG")).toBe("Bersamaan 1 keping roti canai");
  });
});

describe("Singapore food facts", () => {
  const DISH: Record<(typeof FOOD_FACTS_SG)[number]["id"], string> = {
    nasiAyam: "nasi ayam",
    charKwayTeow: "char kuey teow",
    laksa: "laksa",
    nasiLemak: "nasi lemak",
    rotiPrata: "roti canai",
    kayaToast: "roti bakar kaya",
    kopi: "kopi",
    bubbleTea: "bubble tea",
    satay: "satay ayam",
    cendol: "cendol",
  };

  test("every fact matches its dish row at the row's portion, within the rounding to 5", () => {
    for (const fact of FOOD_FACTS_SG) {
      const row = MYFCD_DISHES.find((dish) => dish.name === DISH[fact.id])!;
      const portion = (row.typicalPortionG * row.kcalPer100g) / 100;
      expect(Math.abs(fact.kcal - portion)).toBeLessThanOrEqual(5);
    }
  });

  test("English in Singapore gets the hawker pool, with Singapore names", () => {
    const sg = pickFact("2026-10-21", "en", "SG");
    expect(FOOD_FACTS_SG.some((fact) => fact.kcal === sg.kcal)).toBe(true);
    expect(sg.text).not.toMatch(/geprek|seblak|pempek/);
    const texts = new Set(Array.from({ length: 200 }, () => randomFact("en", "SG").text));
    expect(texts.has("1 plate of char kway teow")).toBe(true);
    expect(texts.has("1 piece of plain prata")).toBe(true);
  });

  test("a Bahasa Melayu UI keeps the Malaysian pool even on a Singapore network", () => {
    const ms = pickFact("2026-10-21", "ms", "SG");
    expect(FOOD_FACTS_MY.some((fact) => fact.kcal === ms.kcal)).toBe(true);
  });

  test("Indonesia is unchanged", () => {
    expect(pickFact("2026-10-21", "en", "ID")).toEqual(pickFact("2026-10-21", "en"));
  });
});
