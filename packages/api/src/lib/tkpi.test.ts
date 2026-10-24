import { describe, expect, test } from "bun:test";

import { atwaterAdjust, calibrateItems, edibleFractionOf, libraryKcal, TKPI_DISHES } from "./tkpi";
import { lookupTkpi2019 } from "./tkpi2019";

describe("konjac rice", () => {
  test("is its own row, not nasi putih, and its low kcal is not clamped up", () => {
    for (const name of ["nasi konjac", "beras konjac", "nasi beras konjac", "konjac rice", "shirataki rice", "nasi shirataki"]) {
      for (const region of [undefined, "MY" as const]) {
        const [item] = calibrateItems([{ name, kcal: 40, grams: 150 }], { region });
        expect(item?.matched).toBe(true);
        expect(item?.kcal).toBeLessThan(110);
      }
    }
    expect(libraryKcal("nasi beras konjac", 150)).toBe(105);
    expect(libraryKcal("konjac rice", 100)).toBe(15);
    expect(calibrateItems([{ name: "nasi putih", kcal: 40, grams: 150 }])[0]?.kcal).toBe(195);
  });
});

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

  test("bandSlack (eval harness only) widens the band; Infinity leaves the model's kcal; default unchanged", () => {
    const nasgor = { name: "nasi goreng", kcal: 1200, grams: 250 };
    expect(calibrateItems([nasgor], { bandSlack: 0.5 })[0]?.kcal).toBe(1050);
    expect(calibrateItems([nasgor], { bandSlack: Infinity })[0]?.kcal).toBe(1200);
    expect(calibrateItems([nasgor], {})[0]?.kcal).toBe(700);
    const rendang = { name: "rendang", kcal: 50, grams: 150 };
    expect(calibrateItems([rendang], { bandSlack: 0.5 })[0]?.kcal).toBe(150);
    expect(calibrateItems([rendang], { bandSlack: Infinity })[0]?.kcal).toBe(50);
    // The 9 kcal/g cap still holds with no band.
    expect(calibrateItems([{ name: "nasi goreng", kcal: 5000, grams: 100 }], { bandSlack: Infinity })[0]?.kcal).toBe(900);
    // A library dish whose band starts at 0 (a zero-calorie drink) must not turn into NaN.
    const zero = TKPI_DISHES.find((d) => d.plausibleKcalRange[0] === 0);
    expect(zero).toBeDefined();
    expect(calibrateItems([{ name: zero!.name, kcal: 40, grams: zero!.typicalPortionG }], { bandSlack: Infinity })[0]?.kcal).toBe(40);
  });

  test("small items keep the grams the model gave: no gram floor, the band scales down with them", () => {
    const [white] = calibrateItems([{ name: "putih telur rebus", kcal: 52, grams: 100 }]);
    expect(white).toMatchObject({ matched: true, grams: 100, kcal: 52 });
    const [small] = calibrateItems([{ name: "putih telur", kcal: 20, grams: 40 }]);
    expect(small).toMatchObject({ grams: 40, kcal: 20 });
    // Named as something else (lontong), the weight is still the model's and untouched.
    expect(calibrateItems([{ name: "lontong", kcal: 195, grams: 100 }])[0]?.grams).toBe(100);
  });

  test("egg white is priced as egg white: a 200 kcal guess for 100 g is pulled into its band", () => {
    expect(calibrateItems([{ name: "putih telur rebus", kcal: 200, grams: 100 }])[0]?.kcal).toBe(150);
  });

  test("a bone-in dish prices the edible part: grams stay as seen, kcal follow edible grams", () => {
    const [item] = calibrateItems([{ name: "ayam goreng", kcal: 700, grams: 200, asSeen: true }]);
    // 200 g with bone x 0.65 = 130 g of meat; 260 kcal/100 g x 1.35 slack = 456
    expect(item).toMatchObject({ grams: 200, edibleGrams: 130, kcal: 456 });
  });

  test("a plain model estimate under the edible ceiling is left alone", () => {
    expect(calibrateItems([{ name: "ikan goreng", kcal: 300, grams: 300, asSeen: true }])[0]).toMatchObject({ grams: 300, edibleGrams: 195, kcal: 300 });
  });

  test("grams a person weighed or typed are eaten grams: no edible fraction without asSeen", () => {
    const [item] = calibrateItems([{ name: "ayam goreng", kcal: 480, grams: 160 }]);
    expect(item?.edibleGrams).toBeUndefined();
    expect(item?.kcal).toBe(480);
  });

  test("boneless wording and dishes without bone get no edible fraction", () => {
    const fillet = calibrateItems([{ name: "ayam goreng fillet", kcal: 450, grams: 200, asSeen: true }])[0];
    expect(fillet?.edibleGrams).toBeUndefined();
    expect(fillet?.kcal).toBe(450);
    expect(calibrateItems([{ name: "nasi goreng", kcal: 400, grams: 250 }])[0]?.edibleGrams).toBeUndefined();
  });

  test("bone-in dish with no weight answered shows the weight with bone (typical portion / fraction)", () => {
    const [item] = calibrateItems([{ name: "ayam bakar", kcal: 300, asSeen: true }]);
    expect(item?.grams).toBe(308);
    expect(item?.edibleGrams).toBe(200);
  });

  test("edibleFractionOf only applies to library rows that carry one", () => {
    const fried = TKPI_DISHES.find((d) => d.name === "ayam goreng")!;
    expect(edibleFractionOf(fried, "ayam goreng paha")).toBe(0.65);
    expect(edibleFractionOf(fried, "ayam goreng tanpa tulang")).toBe(1);
    expect(edibleFractionOf(TKPI_DISHES.find((d) => d.name === "bakso")!, "bakso")).toBe(1);
  });

  test("a chicken part takes its own edible share, and both weights ride on the item", () => {
    const wing = calibrateItems([{ name: "ayam goreng sayap", kcal: 700, grams: 200, asSeen: true }])[0];
    // 200 g with bone x 0.5 = 100 g; 260 kcal/100 g x 1.35 slack = 351
    expect(wing).toMatchObject({ grams: 200, edibleGrams: 100, grossGrams: 200, withBone: true, kcal: 351 });
    expect(calibrateItems([{ name: "ayam goreng paha bawah", kcal: 700, grams: 200, asSeen: true }])[0]).toMatchObject({ edibleGrams: 120, grossGrams: 200 });
    expect(calibrateItems([{ name: "ayam bakar dada", kcal: 300, grams: 200, asSeen: true }])[0]).toMatchObject({ edibleGrams: 140 });
  });

  test("ribs and whole fish without a library row state the edible part and keep the model's kcal", () => {
    expect(calibrateItems([{ name: "iga bakar", kcal: 850, grams: 400, asSeen: true }])[0]).toMatchObject({ grams: 400, edibleGrams: 200, grossGrams: 400, withBone: true, kcal: 850 });
    expect(calibrateItems([{ name: "lele goreng", kcal: 300, grams: 200, asSeen: true }])[0]).toMatchObject({ edibleGrams: 110, kcal: 300 });
  });

  test("a bone-in item with no weight or not as seen carries no bone weights", () => {
    expect(calibrateItems([{ name: "iga bakar", kcal: 850, grams: 400 }])[0]?.edibleGrams).toBeUndefined();
    expect(calibrateItems([{ name: "sop iga", kcal: 400, grams: 400, asSeen: true }])[0]?.edibleGrams).toBeUndefined();
    expect(calibrateItems([{ name: "iga bakar", kcal: 850, asSeen: true }])[0]?.edibleGrams).toBeUndefined();
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
    const [single] = calibrateItems([{ name: "Telur ceplok", kcal: 620, grams: 60 }]);
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
    expect(item?.kcal).toBeLessThanOrEqual(160); // the 15 g band (80) doubled for 30 g
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

// Regression: "martabak telur 50 g (1 potong)" was logged at 300 kcal (6 kcal/g,
// table 250 kcal/100 g = 125). The 150 g portion's band minimum clamped it up.
describe("band follows grams, not the typical portion", () => {
  const kcalOf = (name: string, kcal: number, grams: number) =>
    calibrateItems([{ name, kcal, grams }])[0];

  test("martabak telur 50 g stays near per-100 g x grams", () => {
    const item = kcalOf("martabak telur", 145, 50);
    expect(item?.matched).toBe(true);
    expect(item?.kcal).toBe(145);
    expect(kcalOf("martabak telur", 20, 50)?.kcal).toBe(100);
    expect(kcalOf("martabak telur", 600, 50)?.kcal).toBe(200);
  });

  test("a typical portion keeps the library band", () => {
    expect(kcalOf("martabak telur", 20, 150)?.kcal).toBe(300);
    expect(kcalOf("martabak telur", 900, 150)?.kcal).toBe(600);
  });

  test("larger than typical raises the band too", () => {
    expect(kcalOf("nasi goreng", 800, 500)?.kcal).toBe(800);
  });

  test("every library dish at any portion stays near its per-100 g reference", () => {
    for (const dish of TKPI_DISHES) {
      for (const grams of [dish.typicalPortionG / 3, dish.typicalPortionG, dish.typicalPortionG * 2]) {
        const ref = (dish.kcalPer100g * grams) / 100;
        for (const modelKcal of [0, 5000]) {
          const item = kcalOf(dish.name, modelKcal, grams);
          if (!item?.matched) continue;
          // Library bands span 0.25x..5.5x of the per-100 g reference at worst (sambal, kerupuk).
          expect(item.kcal).toBeLessThanOrEqual(Math.max(ref * 5.5, 25));
          expect(item.kcal).toBeGreaterThanOrEqual(ref * 0.25 - 1);
        }
      }
    }
  });

  test("no output exceeds 9 kcal per gram, matched or not", () => {
    for (const [name, grams] of [
      ["makanan adb3f2", 10],
      ["makanan adb3f2", 30],
      ["pizza margherita", 5],
      ["martabak telur", 20],
      ["sambal", 3],
    ] as const) {
      const item = kcalOf(name, 5000, grams);
      expect((item?.kcal ?? 0) / grams).toBeLessThanOrEqual(9);
    }
  });
});

describe("consistent staples and drinks", () => {
  const kcal = (name: string, grams: number, modelKcal: number) => calibrateItems([{ name, kcal: modelKcal, grams }])[0];

  test("an English rice name is the same row and kcal as nasi putih", () => {
    const english = kcal("White rice", 150, 231);
    const local = kcal("nasi putih", 150, 182);
    expect(english?.name).toBe("nasi putih");
    expect(english?.kcal).toBe(195);
    expect(local?.kcal).toBe(195);
  });

  test("plain rice is flagged fixed-density; a rice dish priced in a band is not", () => {
    expect(kcal("nasi putih", 150, 182)?.fixedDensity).toBe(true);
    expect(kcal("nasi goreng", 250, 450)?.fixedDensity).toBeUndefined();
  });

  test("americano and black coffee are ~5 kcal whatever the model said", () => {
    for (const [name, model] of [["Es Kopi Americano", 60], ["Americano Es", 20], ["Iced Americano", 35], ["kopi hitam", 5]] as const) {
      const item = kcal(name, 240, model);
      expect(item?.kcal).toBe(5);
      expect(item?.matched).toBe(true);
    }
  });

  test("es kopi susu is its own row at the same kcal on every scan", () => {
    expect(kcal("es kopi susu", 250, 60)?.kcal).toBe(175);
    expect(kcal("Es Kopi Susu Gula Aren", 250, 230)?.kcal).toBe(175);
  });

  test("juice with and without sugar are two rows keyed by the name", () => {
    expect(kcal("jus mangga", 250, 40)?.kcal).toBe(138);
    expect(kcal("jus mangga tanpa gula", 250, 120)?.kcal).toBe(88);
  });

  test("a fixed kcal keeps the model's macro split proportional", () => {
    const item = calibrateItems([{ name: "nasi putih", kcal: 200, grams: 150, protein: 4, carbs: 44, fat: 0.4 }])[0];
    expect(item?.kcal).toBe(195);
    expect(item?.carbs).toBeCloseTo(42.9, 1);
  });

  test("the eval harness's bandSlack leaves the model's number alone", () => {
    expect(calibrateItems([{ name: "nasi putih", kcal: 231, grams: 150 }], { bandSlack: 0.5 })[0]?.kcal).toBe(231);
  });
});
