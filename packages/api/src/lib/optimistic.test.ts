import { describe, expect, test } from "bun:test";

import { DEFAULT_ADD_BACK_SETTINGS, exerciseCredit } from "./exercise-credit";
import { applySummaryDelta, applyWeightCheckIn, deletedMsg, removeById, upsertById } from "./optimistic";

const TODAY = "2026-10-14";

function summary() {
  return {
    date: TODAY,
    eatenKcal: 1000,
    eatenByMeal: { sarapan: 400, makan_siang: 600, makan_malam: 0, snack: 0, sahur: 0, berbuka: 0 },
    burnedKcal: 2000,
    weekEatenKcal: 14000,
    weekBurnedKcal: 20000,
    weekMeals: 20,
    weekProtein: 700,
    weekCarbs: 1400,
    weekFat: 350,
    protein: { eatenG: 60, targetG: 105 },
    sleepHoursLastNight: null as number | null,
    latestWeightKg: null as number | null,
    weightLoggedToday: false,
  };
}

describe("applySummaryDelta", () => {
  test("food add patches same-day totals and week rollups", () => {
    const s = applySummaryDelta(summary(), { date: TODAY, meal: "sarapan", kcal: 250, protein: 10, meals: 1 }, TODAY);
    expect(s.eatenKcal).toBe(1250);
    expect(s.eatenByMeal.sarapan).toBe(650);
    expect(s.weekEatenKcal).toBe(14250);
    expect(s.weekMeals).toBe(21);
    expect(s.weekProtein).toBe(710);
    expect(s.protein?.eatenG).toBe(70);
    expect(s.burnedKcal).toBe(2000);
  });

  test("food delete mirrors the add", () => {
    const s = applySummaryDelta(summary(), { date: TODAY, meal: "snack", kcal: -250, protein: -10, meals: -1 }, TODAY);
    expect(s.eatenKcal).toBe(750);
    expect(s.weekMeals).toBe(19);
  });

  test("exercise delta moves burn side only", () => {
    const s = applySummaryDelta(summary(), { date: TODAY, burnKcal: 150 }, TODAY);
    expect(s.eatenKcal).toBe(1000);
    expect(s.burnedKcal).toBe(2150);
    expect(s.weekBurnedKcal).toBe(20150);
  });

  test("a workout raises the day's budget by the counted share, within the cap", () => {
    const credited = {
      ...summary(),
      targets: { eatKcal: 2000, exerciseKcal: 0 },
      exerciseCredit: exerciseCredit({ settings: DEFAULT_ADD_BACK_SETTINGS, rows: [], steps: null, weightKg: 70 }),
    };
    const added = applySummaryDelta(credited, { date: TODAY, burnKcal: 400 }, TODAY);
    expect(added.targets).toEqual({ eatKcal: 2300, exerciseKcal: 300 });
    expect(added.exerciseCredit?.workoutKcal).toBe(400);
    const capped = applySummaryDelta(added, { date: TODAY, burnKcal: 2000 }, TODAY);
    expect(capped.targets).toEqual({ eatKcal: 3000, exerciseKcal: 1000 });
    const removed = applySummaryDelta(capped, { date: TODAY, burnKcal: -2400 }, TODAY);
    expect(removed.targets).toEqual({ eatKcal: 2000, exerciseKcal: 0 });
  });

  test("other-date rows only touch week rollups", () => {
    const s = applySummaryDelta(summary(), { date: "2026-10-12", kcal: 300, meals: 1 }, TODAY);
    expect(s.eatenKcal).toBe(1000);
    expect(s.weekEatenKcal).toBe(14300);
    expect(s.weekMeals).toBe(21);
  });

  test("rows outside the 7-day window are ignored", () => {
    const s = applySummaryDelta(summary(), { date: "2026-10-01", kcal: 300, meals: 1 }, TODAY);
    expect(s.weekEatenKcal).toBe(14000);
    expect(s.weekMeals).toBe(20);
  });

  test("sleep lands on the summary of the night date + 1", () => {
    const s = applySummaryDelta(summary(), { date: "2026-10-13", sleepHours: 7.5 }, TODAY);
    expect(s.sleepHoursLastNight).toBe(7.5);
    const other = applySummaryDelta(summary(), { date: TODAY, sleepHours: 7.5 }, TODAY);
    expect(other.sleepHoursLastNight).toBeNull();
  });
});

describe("applyWeightCheckIn", () => {
  test("sets latest weight and the logged flag on the same-day summary", () => {
    const s = applyWeightCheckIn(summary(), { date: TODAY, weightKg: 80.4 }, TODAY);
    expect(s.latestWeightKg).toBe(80.4);
    expect(s.weightLoggedToday).toBe(true);
  });

  test("past-date caches keep their own latest weight (settle refetch owns them)", () => {
    const s = applyWeightCheckIn(summary(), { date: "2026-10-13", weightKg: 80.4 }, TODAY);
    expect(s.latestWeightKg).toBeNull();
    expect(s.weightLoggedToday).toBe(false);
  });
});

describe("list helpers", () => {
  test("upsertById inserts and replaces", () => {
    const rows = [{ id: "a", kcal: 1 }, { id: "b", kcal: 2 }];
    expect(upsertById(rows, { id: "c", kcal: 3 })).toHaveLength(3);
    const next = upsertById(rows, { id: "b", kcal: 9 });
    expect(next.find((r) => r.id === "b")?.kcal).toBe(9);
    expect(rows.find((r) => r.id === "b")?.kcal).toBe(2);
  });

  test("removeById drops one row and keeps identity when absent", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(removeById(rows, "a")).toEqual([{ id: "b" }]);
    expect(removeById(rows, "zzz")).toBe(rows);
  });
});

describe("deletedMsg", () => {
  test("falls back when the name is blank", () => {
    expect(deletedMsg("Nasi goreng")).toBe("Nasi goreng dihapus");
    expect(deletedMsg("  ")).toBe("Catatan dihapus");
    expect(deletedMsg(null, "Latihan")).toBe("Latihan dihapus");
  });
});
