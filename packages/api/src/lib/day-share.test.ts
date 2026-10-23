import { describe, expect, test } from "bun:test";

import { buildDayShare, dayShareStickerIds, type DayShareInput, type DayShareRow } from "./day-share";

const url = (id: string) => `https://api.example/sticker/${id}`;
const labels: Record<string, string> = { sarapan: "Sarapan", makan_siang: "Makan siang", makan_malam: "Makan malam", snack: "Snack", sahur: "Sahur" };

const row = (over: Partial<DayShareRow> & Pick<DayShareRow, "name" | "meal" | "kcal">): DayShareRow => ({
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
  grams: null,
  scanId: null,
  plateScanId: null,
  plateId: null,
  ...over,
});

const LUNCH = [
  row({ name: "nasi liwet", meal: "makan_siang", kcal: 300, protein: 6, carbs: 60, fat: 4, fiber: 0.6, grams: 200, scanId: "nasi", plateId: "liwet" }),
  row({ name: "ayam bakar", meal: "makan_siang", kcal: 168, protein: 20, carbs: 4, fat: 8, fiber: 0.4, grams: 80, scanId: "ayam", plateId: "liwet" }),
  row({ name: "sambal", meal: "makan_siang", kcal: 50, protein: 0, carbs: 2, fat: 5, fiber: 0.4, grams: 20, scanId: "sambal", plateId: "liwet" }),
  row({ name: "Putih Telur", meal: "makan_siang", kcal: 52, protein: 11, carbs: 1, fat: 0, fiber: 0, grams: 100, scanId: "telur", plateId: "telur" }),
];
const BREAKFAST = [
  row({ name: "Pepaya", meal: "sarapan", kcal: 108, protein: 1, carbs: 27, fat: 0, fiber: 4, grams: 258, scanId: "pepaya", plateId: "pepaya" }),
  row({ name: "Americano", meal: "sarapan", kcal: 5, protein: 0, carbs: 1, fat: 0, fiber: 0, grams: 350, scanId: "kopi", plateId: "kopi" }),
];

const input = (over: Partial<DayShareInput> = {}): DayShareInput => ({
  date: "2026-10-22",
  rows: [...LUNCH, ...BREAKFAST],
  plateNames: { liwet: "Nasi Liwet Ayam Bakar" },
  slots: ["sarapan", "makan_siang", "makan_malam", "snack"],
  mealLabel: (meal) => labels[meal] ?? meal,
  stickerUrl: url,
  eatenKcal: 683,
  targets: { kcal: 1850, proteinG: 110, carbsG: 242, fatG: 51, fiberG: 26 },
  ...over,
});

describe("buildDayShare", () => {
  test("meals come in the diary's slot order, empty slots are left out, and each carries its sums", () => {
    const share = buildDayShare(input());
    expect(share.meals.map((m) => m.label)).toEqual(["Sarapan", "Makan siang"]);
    const [breakfast, lunch] = share.meals;
    expect(breakfast).toMatchObject({ kcal: 113, protein: 1, carbs: 28, fat: 0 });
    expect(lunch).toMatchObject({ kcal: 570, protein: 37, carbs: 67, fat: 17 });
    expect(lunch!.items.map((i) => [i.name, i.grams, i.kcal])).toEqual([
      ["nasi liwet", 200, 300],
      ["ayam bakar", 80, 168],
      ["sambal", 20, 50],
      ["Putih Telur", 100, 52],
    ]);
  });

  test("a day is a local noon Date and carries the diary's kcal and the four targets", () => {
    const share = buildDayShare(input());
    expect(share.date.getFullYear()).toBe(2026);
    expect(share.date.getMonth()).toBe(9);
    expect(share.date.getDate()).toBe(22);
    expect(share).toMatchObject({ kind: "dayfood", kcal: 683, targetKcal: 1850, proteinTargetG: 110, carbsTargetG: 242, fatTargetG: 51, fiberTargetG: 26, gain: false });
    expect(share).toMatchObject({ protein: 38, carbs: 95, fat: 17 });
    expect(share.fiber).toBeCloseTo(5.4, 5);
  });

  test("a named plate stands for its foods in the names line, the rest list by name once", () => {
    const lunch = buildDayShare(input()).meals[1]!;
    expect(lunch.names).toBe("Nasi Liwet Ayam Bakar, Putih Telur");
    const twice = buildDayShare(
      input({ rows: [row({ name: "Fibe mini", meal: "snack", kcal: 60 }), row({ name: "fibe MINI", meal: "snack", kcal: 60 })] }),
    );
    expect(twice.meals[0]!.names).toBe("Fibe mini");
  });

  test("without a plate cutout the biggest foods' cutouts come first, the biggest plate before the rest", () => {
    const lunch = buildDayShare(input()).meals[1]!;
    expect(lunch.stickers).toEqual([url("nasi"), url("ayam"), url("sambal"), url("telur")]);
  });

  test("a whole-plate cutout replaces the component cutouts of its scan, never sits beside them", () => {
    const rows = LUNCH.map((r) => (r.plateId === "liwet" ? { ...r, plateScanId: "piring" } : r));
    const lunch = buildDayShare(input({ rows })).meals[0]!;
    expect(lunch.stickers).toEqual([url("piring"), url("telur")]);
  });

  test("a cutout that would not load falls back to the next best one, then to none", () => {
    const rows = LUNCH.map((r) => (r.plateId === "liwet" ? { ...r, plateScanId: "piring" } : r));
    const failedPlate = buildDayShare(input({ rows, failedStickers: new Set(["piring"]) })).meals[0]!;
    expect(failedPlate.stickers).toEqual([url("nasi"), url("ayam"), url("sambal"), url("telur")]);
    const allFailed = buildDayShare(input({ rows, failedStickers: new Set(["piring", "nasi", "ayam", "sambal", "telur"]) })).meals[0]!;
    expect(allFailed.stickers).toEqual([]);
  });

  test("a macro nobody logged stays null, for a meal and for the day", () => {
    const share = buildDayShare(
      input({ rows: [row({ name: "Soto", meal: "makan_siang", kcal: 480 }), row({ name: "Teh", meal: "makan_siang", kcal: 40, carbs: 10 })] }),
    );
    expect(share.meals[0]).toMatchObject({ protein: null, carbs: 10, fat: null });
    expect(share).toMatchObject({ protein: null, carbs: 10, fat: null, fiber: null });
    expect(share.meals[0]!.items[0]).toMatchObject({ protein: null, carbs: null, fat: null, grams: null });
  });

  test("a pregnancy plan draws no kcal target, and unset or zero targets stay null", () => {
    expect(buildDayShare(input({ maternal: true })).targetKcal).toBeNull();
    const none = buildDayShare(input({ targets: { kcal: null, proteinG: 0, carbsG: null, fatG: null, fiberG: null } }));
    expect(none).toMatchObject({ targetKcal: null, proteinTargetG: null, carbsTargetG: null, fatTargetG: null, fiberTargetG: null });
  });

  test("Naikin BB is passed through", () => {
    expect(buildDayShare(input({ gain: true })).gain).toBe(true);
  });

  test("slots the diary does not list (Ramadan switched mid-day) still show, after the listed ones", () => {
    const share = buildDayShare(
      input({ rows: [row({ name: "Nasi", meal: "sahur", kcal: 400 }), row({ name: "Roti", meal: "sarapan", kcal: 200 })], slots: ["sarapan", "makan_siang"] }),
    );
    expect(share.meals.map((m) => m.label)).toEqual(["Sarapan", "Sahur"]);
  });

  test("an empty day has no meals and no invented numbers", () => {
    const share = buildDayShare(input({ rows: [], eatenKcal: 0 }));
    expect(share.meals).toEqual([]);
    expect(share).toMatchObject({ kcal: 0, protein: null, carbs: null, fat: null, fiber: null });
  });

  test("no body weight is ever part of the share", () => {
    expect(JSON.stringify(buildDayShare(input()))).not.toMatch(/weight|berat|kg/i);
  });
});

describe("dayShareStickerIds", () => {
  test("lists each cutout once, plates and components", () => {
    const rows = LUNCH.map((r) => (r.plateId === "liwet" ? { ...r, plateScanId: "piring" } : r));
    expect(dayShareStickerIds(rows).sort()).toEqual(["ayam", "nasi", "piring", "sambal", "telur"]);
    expect(dayShareStickerIds([row({ name: "Teh", meal: "snack", kcal: 30 })])).toEqual([]);
  });
});
