import { describe, expect, test } from "bun:test";

import {
  aggregateNutrients,
  budgetRemaining,
  ideaValueMap,
  kcalPerRp1000,
  matchLastPrice,
  monthStart,
  plateKey,
  proteinPerRp1000,
  rankBestValue,
  spendingSummary,
  weekStart,
} from "./plates";

const plate = (over: Partial<Parameters<typeof spendingSummary>[0][number]> = {}) => ({
  date: "2026-10-13",
  meal: "makan_siang",
  name: "Nasi padang",
  place: null,
  priceIdr: null,
  createdAt: 0,
  ...over,
});

describe("plateKey", () => {
  test("case and whitespace insensitive", () => {
    expect(plateKey("  Nasi   PADANG ")).toBe(plateKey("nasi padang"));
    expect(plateKey("Nasi Padang", "RM  Sederhana")).toBe(plateKey("nasi padang", "rm sederhana"));
    expect(plateKey("Nasi padang")).not.toBe(plateKey("Nasi padang", "RM Sederhana"));
  });
});

describe("nutrient aggregation and value metrics", () => {
  test("nulls count as zero", () => {
    const totals = aggregateNutrients([
      { kcal: 200, protein: 5, carbs: null, fat: 3, fiber: null },
      { kcal: 100, protein: null, carbs: 20, fat: null, fiber: 2 },
    ]);
    expect(totals).toEqual({ kcal: 300, proteinG: 5, carbsG: 20, fatG: 3, fiberG: 2 });
  });

  test("zero price is guarded like a null price", () => {
    expect(proteinPerRp1000(30, null)).toBeNull();
    expect(proteinPerRp1000(30, 0)).toBeNull();
    expect(proteinPerRp1000(30, 20000)).toBeCloseTo(1.5);
    expect(kcalPerRp1000(700, 20000)).toBeCloseTo(35);
    expect(kcalPerRp1000(700, 0)).toBeNull();
  });
});

describe("WIB week and month boundaries", () => {
  test("week starts Monday", () => {
    // 2026-10-11 is a Sunday: its week started 2026-10-05.
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-13")).toBe("2026-10-12");
  });

  test("month start edges", () => {
    expect(monthStart("2026-10-13")).toBe("2026-10-01");
    expect(monthStart("2026-10-01")).toBe("2026-10-01");
    expect(monthStart("2026-01-31")).toBe("2026-01-01");
  });
});

describe("spendingSummary", () => {
  test("day, week, and month rollups exclude null and zero prices", () => {
    const plates = [
      plate({ date: "2026-10-13", priceIdr: 28000 }),
      plate({ date: "2026-10-13", name: "Pecel", priceIdr: 0 }),
      plate({ date: "2026-10-13", name: "Tanpa harga" }),
      plate({ date: "2026-10-10", priceIdr: 12000 }), // same week, past day
      plate({ date: "2026-10-01", priceIdr: 15000 }), // same month, past week
      plate({ date: "2026-09-20", priceIdr: 99000 }), // outside month
      plate({ date: "2026-10-20", priceIdr: 50000 }), // future-dated: excluded
    ];
    const summary = spendingSummary(plates, "2026-10-13");
    expect(summary.today).toBe(28000);
    // Monday of this WIB week is 2026-10-12, so 10-10 is last week.
    expect(summary.week).toBe(28000);
    expect(summary.month).toBe(55000);
  });

  test("week spans the Monday boundary", () => {
    // 2026-10-11 is Sunday: Monday 2026-10-05 starts the WIB week.
    const plates = [
      plate({ date: "2026-10-11", priceIdr: 10000 }),
      plate({ date: "2026-10-04", priceIdr: 40000 }), // Sunday before: last week
    ];
    expect(spendingSummary(plates, "2026-10-11").week).toBe(10000);
    expect(spendingSummary(plates, "2026-10-11").month).toBe(50000);
  });

  test("average per meal slot over priced plates only", () => {
    const plates = [
      plate({ date: "2026-10-13", meal: "sarapan", priceIdr: 10000 }),
      plate({ date: "2026-10-12", meal: "sarapan", priceIdr: 20000 }),
      plate({ date: "2026-10-12", meal: "sarapan", name: "Gratis" }),
      plate({ date: "2026-10-12", meal: "makan_malam", priceIdr: 30000 }),
    ];
    const summary = spendingSummary(plates, "2026-10-13");
    expect(summary.avgPerSlot.sarapan).toBe(15000);
    expect(summary.avgPerSlot.makan_malam).toBe(30000);
    expect(summary.avgPerSlot.snack).toBeNull();
  });
});

describe("budgetRemaining", () => {
  test("null and non-positive budgets disable the feature", () => {
    expect(budgetRemaining(5000, null)).toBeNull();
    expect(budgetRemaining(5000, 0)).toBeNull();
  });
  test("can go negative", () => {
    expect(budgetRemaining(30000, 20000)).toBe(-10000);
    expect(budgetRemaining(0, 20000)).toBe(20000);
  });
});

describe("matchLastPrice", () => {
  const history = [
    plate({ name: "Nasi padang", place: "RM Sederhana", priceIdr: 28000, createdAt: 1 }),
    plate({ name: "nasi padang", place: null, priceIdr: 25000, createdAt: 2 }),
    plate({ name: "Pecel", priceIdr: 12000, createdAt: 3 }),
    plate({ name: "Tanpa harga", createdAt: 4 }),
  ];

  test("prefers the name+place match", () => {
    const hit = matchLastPrice("Nasi Padang", "rm sederhana", history);
    expect(hit?.priceIdr).toBe(28000);
    expect(hit?.place).toBe("RM Sederhana");
  });

  test("falls back to name only and returns the newest", () => {
    expect(matchLastPrice("nasi padang", null, history)?.priceIdr).toBe(25000);
    expect(matchLastPrice("  pecel  ", undefined, history)?.priceIdr).toBe(12000);
  });

  test("no match or unpriced plates yield null", () => {
    expect(matchLastPrice("Mie ayam", null, history)).toBeNull();
    expect(matchLastPrice("Tanpa harga", null, history)).toBeNull();
  });
});

describe("rankBestValue", () => {
  const plates = [
    {
      id: "p1",
      ...plate({ name: "Nasi padang", priceIdr: 28000, createdAt: 1, date: "2026-10-01" }),
    },
    {
      id: "p2",
      ...plate({ name: "Nasi padang", priceIdr: 24000, createdAt: 0, date: "2026-09-01" }),
    },
    { id: "p3", ...plate({ name: "Pecel + tempe", priceIdr: 12000, createdAt: 2 }) },
    { id: "p4", ...plate({ name: "Unpriced", createdAt: 3 }) },
    { id: "p5", ...plate({ name: "Zero", priceIdr: 0, createdAt: 4 }) },
  ] as Array<Parameters<typeof rankBestValue>[0][number]>;

  const nutrients = {
    p1: { kcal: 700, proteinG: 31, carbsG: 60, fatG: 25, fiberG: 5 },
    p3: { kcal: 350, proteinG: 18, carbsG: 30, fatG: 10, fiberG: 6 },
  };

  test("dedupes by name keeping the latest price and ranks by protein per Rp1.000", () => {
    const ranked = rankBestValue(plates, nutrients);
    expect(ranked.map((entry) => entry.name)).toEqual(["Pecel + tempe", "Nasi padang"]);
    expect(ranked[0]!.proteinPer1000).toBeCloseTo(1.5);
    expect(ranked[0]!.priceIdr).toBe(12000);
    expect(ranked[1]!.proteinPer1000).toBeCloseTo(31 / 28);
    expect(ranked[1]!.priceIdr).toBe(28000); // newer duplicate wins
  });

  test("plates without components are dropped", () => {
    expect(rankBestValue(plates, { p3: nutrients.p3! }).map((e) => e.name)).toEqual([
      "Pecel + tempe",
    ]);
  });
});

describe("ideaValueMap", () => {
  test("keeps the best value per name key", () => {
    const plates = [
      { id: "p1", ...plate({ name: "Bakso kuah", priceIdr: 10000, createdAt: 1 }) },
      { id: "p2", ...plate({ name: "Bakso  Kuah", priceIdr: 8000, createdAt: 2 }) },
    ] as Array<Parameters<typeof ideaValueMap>[0][number]>;
    const map = ideaValueMap(plates, {
      p1: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 8, fiberG: 2 },
      p2: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 8, fiberG: 2 },
    });
    expect(map.get(plateKey("bakso kuah"))).toBeCloseTo(20 / 8); // cheaper plate wins
  });
});
