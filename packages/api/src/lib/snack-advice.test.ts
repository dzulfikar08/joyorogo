import { describe, expect, test } from "bun:test";

import { adviseSnack, dayImpactLine, dominantKind, mealSplit } from "./snack-advice";
import type { SnackAdviceInput } from "./snack-advice";

const at = (h: number, m = 0) => h * 60 + m;

const base: SnackAdviceInput = {
  name: "Pisang goreng",
  kcal: 400,
  kind: "camilan",
  slot: "snack",
  eatenKcal: 0,
  eatKcal: 1800,
  eatenByMeal: {},
  nowMin: at(16),
  ramadan: false,
};

const IF_168 = { active: true, pattern: "16:8", windowOpen: "12:00" } as const;

describe("adviseSnack", () => {
  test("lunch done, snack 400, dinner pending: hati-hati, dinner shrinks", () => {
    const advice = adviseSnack({
      ...base,
      eatenKcal: 1050,
      eatenByMeal: { sarapan: 400, makan_siang: 650 },
    });
    expect(advice?.verdict).toBe("hati-hati");
    expect(advice?.numbers).toMatchObject({
      remainingKcal: 750,
      reserveKcal: 540,
      spareKcal: 210,
      afterKcal: 350,
    });
    expect(advice?.upcoming.map((m) => m.label)).toEqual(["makan malam"]);
    expect(advice?.summary).toBe("Muat, tapi mengurangi jatah makan malam.");
    expect(advice?.reason).toContain("dibagi dulu buat makan malam");
    expect(advice?.reason).toContain("ruang buat camilan terbatas");
  });

  test("same snack when the day has little left: lewat", () => {
    const advice = adviseSnack({
      ...base,
      eatenKcal: 1500,
      eatenByMeal: { sarapan: 500, makan_siang: 1000 },
    });
    expect(advice?.verdict).toBe("lewat");
    expect(advice?.numbers).toMatchObject({ remainingKcal: 300, afterKcal: -100, overKcal: 100 });
    expect(advice?.summary).toBe("Melewati target hari ini.");
    expect(advice?.reason).toContain("boleh simpan");
  });

  test("small snack in the morning: aman, no suggestions", () => {
    const advice = adviseSnack({ ...base, kcal: 100, nowMin: at(8, 30) });
    expect(advice?.verdict).toBe("aman");
    expect(advice?.numbers.reserveKcal).toBe(1620);
    expect(advice?.numbers.spareKcal).toBe(180);
    expect(advice?.suggestions).toEqual([]);
  });

  test("already over target: lewat with the day total", () => {
    const advice = adviseSnack({ ...base, eatenKcal: 1900, nowMin: at(20), kcal: 150 });
    expect(advice?.verdict).toBe("lewat");
    expect(advice?.numbers.remainingKcal).toBe(0);
    expect(advice?.summary).toBe("Target hari ini sudah terpakai.");
    expect(advice?.reason).toContain("sudah terpenuhi");
  });

  test("beyond tdee the day passes daily needs, below it only passes the target", () => {
    const over = { ...base, eatenKcal: 2000, tdeeKcal: 2100, kcal: 300, nowMin: at(21) };
    expect(adviseSnack(over)?.reason).toContain("melewati kebutuhan harianmu");
    const under = adviseSnack({ ...over, tdeeKcal: 2600 })?.reason;
    expect(under).toContain("masih di bawah kebutuhan harianmu");
    expect(under).not.toContain("melewati");
  });

  test("half portion is offered with its kcal and the verdict it would get", () => {
    const advice = adviseSnack({
      ...base,
      eatenKcal: 1050,
      eatenByMeal: { sarapan: 400, makan_siang: 650 },
    });
    const half = advice?.suggestions.find((s) => s.type === "half");
    expect(half).toEqual({ type: "half", label: "Setengah porsi", kcal: 200, verdict: "aman" });
    expect(advice?.suggestions.some((s) => s.type === "swap")).toBe(true);
    expect(advice?.suggestions.find((s) => s.type === "lighter-next")).toMatchObject({
      targetKcal: 350,
    });
  });

  test("swap falls back to generic wording without numbers when nothing fits", () => {
    const advice = adviseSnack({ ...base, eatenKcal: 1750, nowMin: at(22), kcal: 300 });
    const swap = advice?.suggestions.find((s) => s.type === "swap");
    expect(swap && "text" in swap ? swap.text : "").toMatch(/^[^0-9]+$/);
  });

  test("a meal logged to its own slot does not reserve that slot", () => {
    const meal = adviseSnack({
      ...base,
      name: "Nasi padang",
      kind: "makanan",
      slot: "makan_siang",
      kcal: 700,
      nowMin: at(12, 30),
    });
    expect(meal?.upcoming.map((m) => m.label)).toEqual(["makan malam"]);
    expect(meal?.verdict).toBe("aman");
    // the same kcal as a camilan sits on top of lunch too
    const snack = adviseSnack({ ...base, kcal: 700, nowMin: at(12, 30) });
    expect(snack?.upcoming.map((m) => m.label)).toEqual(["makan siang", "makan malam"]);
  });

  test("a skipped breakfast frees its share once its time is over", () => {
    const early = adviseSnack({ ...base, kcal: 100, nowMin: at(9) });
    const late = adviseSnack({ ...base, kcal: 100, nowMin: at(11) });
    expect(early?.upcoming.map((m) => m.label)).toContain("sarapan");
    expect(late?.upcoming.map((m) => m.label)).not.toContain("sarapan");
  });

  test("the explanation never repeats the figures the card shows as numbers", () => {
    const cases: SnackAdviceInput[] = [
      { ...base, eatenKcal: 1050, eatenByMeal: { sarapan: 400, makan_siang: 650 } },
      { ...base, eatenKcal: 1500, eatenByMeal: { sarapan: 500, makan_siang: 1000 } },
      { ...base, eatenKcal: 1900, nowMin: at(20), kcal: 150 },
      { ...base, kcal: 100, nowMin: at(8, 30) },
      { ...base, kcal: 150, eatenKcal: 1200, nowMin: at(21), fasting: IF_168 },
      { ...base, kcal: 150, nowMin: at(9), fasting: IF_168 },
    ];
    for (const input of cases) {
      const advice = adviseSnack(input);
      expect(advice?.reason).not.toMatch(/\d/);
      expect(advice?.reason).not.toContain("kkal");
      expect(advice?.summary.length).toBeLessThanOrEqual(70);
    }
  });

  test("outside the IF window the summary is one line with the window and no figures", () => {
    const advice = adviseSnack({ ...base, kcal: 150, nowMin: at(9), fasting: IF_168 });
    expect(advice?.verdict).toBe("hati-hati");
    expect(advice?.summary).toBe("Di luar jendela makan IF (12:00–20:00).");
  });

  test("outside the window and over target says both in the summary", () => {
    const advice = adviseSnack({ ...base, kcal: 500, eatenKcal: 1700, nowMin: at(21), fasting: IF_168 });
    expect(advice?.summary).toBe("Di luar jendela makan IF (12:00–20:00). Melewati target hari ini.");
  });

  test("IF window closed: lifts aman to hati-hati and says why", () => {
    const advice = adviseSnack({
      ...base,
      kcal: 150,
      eatenKcal: 1200,
      nowMin: at(21),
      fasting: IF_168,
    });
    expect(advice?.outsideWindow).toBe(true);
    expect(advice?.verdict).toBe("hati-hati");
    expect(advice?.upcoming).toEqual([]);
    expect(advice?.reason).toContain("sedang tutup");
  });

  test("IF window closed and over target stays lewat", () => {
    const advice = adviseSnack({
      ...base,
      kcal: 500,
      eatenKcal: 1700,
      nowMin: at(21),
      fasting: IF_168,
    });
    expect(advice?.verdict).toBe("lewat");
    expect(advice?.outsideWindow).toBe(true);
  });

  test("IF window not yet open still reserves the window's meals", () => {
    const advice = adviseSnack({ ...base, kcal: 150, nowMin: at(9), fasting: IF_168 });
    expect(advice?.outsideWindow).toBe(true);
    expect(advice?.upcoming.map((m) => m.label)).toEqual(["buka puasa", "makan terakhir"]);
  });

  test("IF window open: reserves only the meal ahead and stays aman", () => {
    const advice = adviseSnack({
      ...base,
      kcal: 150,
      eatenKcal: 600,
      nowMin: at(13),
      fasting: IF_168,
    });
    expect(advice?.outsideWindow).toBe(false);
    expect(advice?.upcoming).toEqual([{ label: "makan terakhir", needKcal: 720 }]);
    expect(advice?.verdict).toBe("aman");
  });

  test("IF inactive or Ramadan ignores the fasting window", () => {
    const off = adviseSnack({
      ...base,
      nowMin: at(21),
      fasting: { active: false, pattern: null, windowOpen: null },
    });
    expect(off?.outsideWindow).toBe(false);
    const ramadan = adviseSnack({ ...base, ramadan: true, nowMin: at(21), fasting: IF_168 });
    expect(ramadan?.outsideWindow).toBe(false);
  });

  test("Ramadan: berbuka is the meal ahead, sahur is behind", () => {
    const advice = adviseSnack({
      ...base,
      ramadan: true,
      eatenKcal: 700,
      eatenByMeal: { sahur: 700 },
      nowMin: at(15, 30),
    });
    expect(advice?.upcoming).toEqual([{ label: "berbuka", needKcal: 810 }]);
    expect(advice?.verdict).toBe("hati-hati");
    expect(advice?.summary).toBe("Muat, tapi mengurangi jatah berbuka.");
  });

  test("Ramadan before dawn: sahur is still ahead", () => {
    const advice = adviseSnack({ ...base, ramadan: true, kcal: 100, nowMin: at(2) });
    expect(advice?.upcoming.map((m) => m.label)).toEqual(["sahur", "berbuka"]);
  });

  test("returns null without a target or kcal", () => {
    expect(adviseSnack({ ...base, eatKcal: 0 })).toBeNull();
    expect(adviseSnack({ ...base, kcal: 0 })).toBeNull();
  });
});

describe("helpers", () => {
  test("split follows the day's mode", () => {
    expect(mealSplit(false).makan_malam).toBe(0.3);
    expect(mealSplit(true).berbuka).toBe(0.45);
    const sum = Object.values(mealSplit(false)).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  test("dominantKind is meal-first", () => {
    expect(dominantKind(["minuman", "makanan", "camilan"])).toBe("makanan");
    expect(dominantKind(["minuman", "camilan"])).toBe("camilan");
    expect(dominantKind(["minuman"])).toBe("minuman");
    expect(dominantKind([])).toBe("makanan");
  });

  test("past-day line is neutral", () => {
    expect(dayImpactLine(1200, 1800, 400)).toBe("Total hari itu jadi 1600 kkal dari target 1800 kkal.");
    expect(dayImpactLine(1200, 0, 400)).toBe("Total hari itu jadi 1600 kkal.");
    expect(dayImpactLine(1200, 1800, 0)).toBeNull();
  });
});
