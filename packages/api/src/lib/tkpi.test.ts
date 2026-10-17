import { describe, expect, test } from "bun:test";

import { atwaterAdjust, calibrateItems, TKPI_DISHES } from "./tkpi";
import { lookupTkpi2019 } from "./tkpi2019";

describe("calibrateItems", () => {
  test("clamps overrange kcal into the plausible band", () => {
    const [item] = calibrateItems([{ name: "nasi goreng", kcal: 1200, grams: 250 }]);
    expect(item?.matched).toBe(true);
    expect(item?.kcal).toBe(700);
  });

  test("clamps underrange kcal up into the plausible band", () => {
    const [item] = calibrateItems([{ name: "rendang", kcal: 50, grams: 150 }]);
    expect(item?.kcal).toBe(300);
  });

  test("fills missing grams from the typical portion", () => {
    const [item] = calibrateItems([{ name: "bakso", kcal: 400 }]);
    expect(item?.grams).toBe(400);
  });

  test("fills missing fiber from library per-100g values", () => {
    const [item] = calibrateItems([{ name: "gado-gado", kcal: 380, grams: 300 }]);
    expect(item?.fiber).toBe(12);
  });

  test("keeps model-provided grams and fiber when present", () => {
    const [item] = calibrateItems([{ name: "nasi goreng", kcal: 500, grams: 180, fiber: 3 }]);
    expect(item?.grams).toBe(180);
    expect(item?.fiber).toBe(3);
  });

  test("matches aliases", () => {
    const [nasgor] = calibrateItems([{ name: "NasGor spesial", kcal: 600, grams: 250 }]);
    const [esteh] = calibrateItems([{ name: "es teh manis jumbo", kcal: 80, grams: 400 }]);
    expect(nasgor?.matched).toBe(true);
    expect(esteh?.matched).toBe(true);
  });

  test("leaves unknown dishes alone apart from the generic sanity clamp", () => {
    const [kept] = calibrateItems([{ name: "pizza margherita", kcal: 780, grams: 300, fiber: 2 }]);
    const [clamped] = calibrateItems([{ name: "pizza margherita", kcal: 9000 }]);
    expect(kept?.matched).toBe(false);
    expect(kept?.kcal).toBe(780);
    expect(kept?.fiber).toBe(2);
    expect(clamped?.kcal).toBe(4000);
  });

  test("a plate naming two library dishes is not clamped into either one's band", () => {
    // Longest key used to win: "telur ceplok" clamped the whole plate to 220.
    const [combo] = calibrateItems([{ name: "Nasi goreng telur ceplok", kcal: 620, grams: 330 }]);
    expect(combo?.kcal).toBe(620);
    expect(combo?.matched).toBe(false);
    const [single] = calibrateItems([{ name: "Telur ceplok", kcal: 620, grams: 330 }]);
    expect(single?.kcal).toBeLessThan(620);
  });

  test("library covers at least 40 dishes", () => {
    expect(TKPI_DISHES.length).toBeGreaterThanOrEqual(40);
  });
});

// Regression for JRG-32: owner's real-plate scan (nasi putih + tumis + tempe +
// telur dadar + sambal). Sambal matched "sambal goreng ati" → 350 kcal kept;
// rice macros (karbo 150 g) were never checked against kcal.
describe("JRG-32 accuracy fixes", () => {
  const ownerPlate = [
    {
      name: "Nasi Putih 1 porsi sedang",
      portion: "± 150 g",
      grams: 150,
      kcal: 195,
      protein: 4,
      carbs: 150,
      fat: 0,
      fiber: 1,
      confidence: 1,
    },
    {
      name: "Tumis Wortel dan Kol",
      portion: "± 60 g",
      grams: 60,
      kcal: 40,
      protein: 1,
      carbs: 5,
      fat: 2,
      fiber: 2,
      confidence: 0.9,
    },
    {
      name: "Tempe Goreng",
      portion: "± 50 g",
      grams: 50,
      kcal: 120,
      protein: 9,
      carbs: 7,
      fat: 7,
      fiber: 4,
      confidence: 0.9,
    },
    {
      name: "Telur Dadar Sayur",
      portion: "± 80 g",
      grams: 80,
      kcal: 180,
      protein: 10,
      carbs: 5,
      fat: 14,
      fiber: 1,
      confidence: 0.9,
    },
    {
      name: "Sambal",
      portion: "± 15 g",
      grams: 15,
      kcal: 350,
      protein: 1,
      carbs: 2,
      fat: 2,
      fiber: 0,
      confidence: 0.9,
    },
  ];

  test("sambal no longer hits sambal goreng ati and is pulled to macro reality", () => {
    const [sambal] = calibrateItems(ownerPlate.slice(4));
    expect(sambal?.matched).toBe(true); // plain "sambal" entry now exists
    expect(sambal?.kcal).toBeLessThanOrEqual(80);
  });

  test("sambal stays plausible even if the library entry vanished", () => {
    const fixed = atwaterAdjust({ name: "Sambal", kcal: 350, protein: 1, carbs: 2, fat: 2 });
    expect(fixed.kcal).toBeLessThanOrEqual(80);
  });

  test("inflated rice macros are rescaled to the reported kcal", () => {
    const [rice] = calibrateItems(ownerPlate.slice(0, 1));
    expect(rice?.kcal).toBe(195);
    expect(rice?.carbs).toBeLessThan(60); // was 150 g — 150 g carbs alone is 600 kcal
    expect(rice?.carbs).toBeGreaterThan(30); // still a real plate of rice
  });

  test("realistic items pass through untouched", () => {
    const fixed = calibrateItems(ownerPlate.slice(1, 4));
    expect(fixed.map((i) => i.kcal)).toEqual([40, 120, 180]);
    expect(fixed[1]?.protein).toBe(9);
  });

  test("unmatched garbage respects the per-gram density cap", () => {
    const [blob] = calibrateItems([{ name: "makanan adb3f2", grams: 100, kcal: 3000 }]);
    expect(blob?.kcal).toBeLessThanOrEqual(700);
  });
});

describe("TKPI 2019 second-stage lookup", () => {
  test("unmatched bahan falls back to official per-100 g values", () => {
    // "Cabai merah, segar" is not in the 44-dish library but is in TKPI 2019 (36 kcal/100 g).
    const [item] = calibrateItems([
      { name: "Cabai merah segar", grams: 50, kcal: 999, protein: 90, carbs: 90, fat: 90 },
    ]);
    expect(item?.matched).toBe(true);
    expect(item?.kcal).toBe(18); // 36 × 50/100
    expect(item?.carbs).toBe(3.7); // 7.3 × 50/100, rounded — was 90 g of model hallucination
  });

  test("curated 44-dish library still wins over the raw table", () => {
    const [rice] = calibrateItems([
      { name: "Nasi Putih", grams: 150, kcal: 195, protein: 4, carbs: 150, fat: 0 },
    ]);
    expect(rice?.kcal).toBe(195); // dish band, not AP001's 180/100 g → 270
  });
});

describe("condiment-tail guard and density bands", () => {
  const kcalOf = (name: string, kcal: number, grams: number) =>
    calibrateItems([{ name, kcal, grams }])[0];

  test("a sambal tail does not clamp the whole dish into the sambal band", () => {
    const item = kcalOf("ayam penyet sambal ijo", 350, 150);
    expect(item?.kcal).toBe(350);
    expect(item?.matched).toBe(false);
    expect(kcalOf("ayam suwir sambal matah", 170, 100)?.kcal).toBe(170);
  });

  test("a kecap or kuah tail does not hit the TKPI 2019 condiment row", () => {
    expect(kcalOf("daging sapi bumbu kecap", 220, 80)?.kcal).toBe(220);
    expect(kcalOf("telur rebus kuah kecap", 190, 120)?.kcal).toBe(190);
  });

  test("a plain condiment (no protein or staple head) still uses the library band", () => {
    const item = kcalOf("sambal", 300, 30);
    expect(item?.matched).toBe(true);
    expect(item?.kcal).toBeLessThanOrEqual(80);
  });

  test("TKPI 2019 reverse containment needs the row to start with the query", () => {
    const item = kcalOf("kacang tanah", 230, 40);
    expect(item?.kcal).toBeGreaterThan(200);
    expect(item?.kcal).toBeLessThan(260);
    expect(lookupTkpi2019("kacang tanah")?.name ?? "").not.toMatch(/^oncom/i);
  });

  test("density bands lift low-balled mayo, peanut sauce, peanuts and nuggets", () => {
    expect(kcalOf("saus mayones", 100, 30)?.kcal).toBe(143);
    expect(kcalOf("bumbu kacang", 60, 50)?.kcal).toBe(88);
    expect(kcalOf("kacang tanah", 30, 40)?.kcal).toBeGreaterThanOrEqual(165);
    expect(kcalOf("nugget ayam", 80, 50)?.kcal).toBe(91);
  });

  test("density bands cap inflated values too and skip items without grams", () => {
    expect(kcalOf("saus mayones", 400, 30)?.kcal).toBe(265);
    expect(calibrateItems([{ name: "saus mayones", kcal: 100 }])[0]?.kcal).toBe(100);
  });
});

describe("compound dishes that start with an ingredient", () => {
  const kcalOf = (name: string, kcal: number, grams: number) =>
    calibrateItems([{ name, kcal, grams }])[0];

  test("tahu tek 300 g is not clamped into the tahu band", () => {
    const item = kcalOf("tahu tek", 450, 300);
    expect(item?.kcal).toBe(450);
    expect(item?.matched).toBe(false);
    expect(kcalOf("tahu tek", 150, 300)?.kcal).toBe(150);
  });

  test("other compounds keep the model's kcal", () => {
    for (const name of ["tahu campur", "tahu gejrot", "tahu telur", "tempe mendoan", "tempe bacem"]) {
      expect(kcalOf(name, 380, 250)?.kcal).toBe(380);
    }
  });

  test("the plain ingredient and its library aliases still use their band", () => {
    expect(kcalOf("tahu", 900, 100)?.matched).toBe(true);
    expect(kcalOf("tahu goreng", 900, 100)?.matched).toBe(true);
    expect(kcalOf("tempe goreng", 60, 24)?.matched).toBe(true);
    expect(kcalOf("orek tempe", 40, 100)?.matched).toBe(true);
  });
});
