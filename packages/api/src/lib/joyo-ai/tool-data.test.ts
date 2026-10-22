import { describe, expect, test } from "bun:test";

import { FORBIDDEN_KEYS, SECRET, TODAY, fakeRpc } from "./data-fixtures";
import { FALLBACK_MACRO_DAYS, createToolData } from "./tool-data";
import type { RogoRpc } from "./tool-data";
import { runTool } from "./tools";

const dataFor = (rpc: RogoRpc) => createToolData(rpc, { today: () => TODAY });

describe("createToolData sanitises", () => {
  test("day, range, weights and profile are named fields only", async () => {
    for (const maternal of [false, true]) {
      const data = dataFor(fakeRpc({ maternal }));
      const all = JSON.stringify([
        await data.day(TODAY),
        await data.range("2026-10-15", TODAY),
        await data.weights("2026-09-01"),
        await data.profile(),
        await data.usualGrams?.("nasi putih"),
      ]);
      for (const key of FORBIDDEN_KEYS) expect(all).not.toContain(`"${key}":`);
      for (const value of Object.values(SECRET)) expect(all).not.toContain(value);
      expect(all).not.toContain("founder");
      expect(all).not.toContain("secret-handle");
    }
  });

  test("a maternal plan withholds goal, target weight and date but returns ordinary numbers", async () => {
    const data = dataFor(fakeRpc({ maternal: true }));
    const profile = await data.profile();
    expect(profile).toMatchObject({ goal: null, targetWeightKg: null, targetDate: null, ageYears: 36, heightCm: 165 });
    expect((await data.weights("2026-09-01")).targetKg).toBeNull();
    expect((await data.day(TODAY)).targets?.kcal).toBe(2000);
    expect(Object.keys(profile).sort()).toEqual(
      ["activityLevel", "ageYears", "goal", "heightCm", "latestWeightKg", "scanAllowance", "sex", "targetDate", "targetWeightKg", "tdeeKcal"].sort(),
    );
  });

  test("age is the year difference from the birth year", async () => {
    const data = createToolData(fakeRpc(), { today: () => "2030-03-01" });
    expect((await data.profile()).ageYears).toBe(40);
  });
});

describe("day: macro nulls are never 0", () => {
  test("rows lacking a macro are counted, and a macro nobody has is null", async () => {
    const day = await dataFor(fakeRpc()).day(TODAY);
    expect(day.totals.protein).toEqual({ g: 11, missingRows: 1 });
    expect(day.totals.fiber).toEqual({ g: 0.2, missingRows: 2 });
    expect(day.remainingPartial).toEqual(["protein", "carbs", "fat", "fiber"]);
    const empty = await dataFor(fakeRpc()).day("2026-10-21");
    expect(empty.totals.protein).toEqual({ g: null, missingRows: 0 });
    expect(empty.remaining?.protein).toBeNull();
    expect(empty.remaining?.kcal).toBe(2000);
  });

  test("only rows with no value at all: null total and null remaining", async () => {
    const rpc = fakeRpc();
    rpc.foodByDate = async () =>
      ({ items: [{ meal: "snack", name: "Roti", kcal: 200, protein: null, carbs: null, fat: null, fiber: null, grams: null, source: "manual" }], totals: {} }) as never;
    const day = await dataFor(rpc).day(TODAY);
    expect(day.totals.kcal).toBe(200);
    expect(day.totals.protein).toEqual({ g: null, missingRows: 1 });
    expect(day.remaining).toMatchObject({ kcal: 1800, protein: null, carbs: null, fat: null, fiber: null });
    expect(day.remainingPartial).toEqual([]);
  });

  test("optional parts that fail (water, fasting) become null, the day still reads", async () => {
    const rpc = fakeRpc();
    rpc.waterSeries = async () => {
      throw new Error("down");
    };
    rpc.fastingToday = async () => {
      throw new Error("down");
    };
    const day = await dataFor(rpc).day(TODAY);
    expect(day.water).toBeNull();
    expect(day.fasting).toBeNull();
    expect(day.totals.kcal).toBe(410);
  });

  test("fasting under Ramadan or inactive is not reported", async () => {
    const rpc = fakeRpc();
    rpc.fastingToday = async () => ({ active: true, ramadan: true, pattern: "16:8", state: "puasa" }) as never;
    expect((await dataFor(rpc).day(TODAY)).fasting).toBeNull();
    rpc.fastingToday = async () => ({ active: false, ramadan: false, pattern: null, state: null }) as never;
    expect((await dataFor(rpc).day(TODAY)).fasting).toBeNull();
  });

  test("no profile: no targets, no remaining", async () => {
    const rpc = fakeRpc();
    rpc.daySummary = async (date) => ({ hasProfile: false, targets: null, protein: null, maternal: null, date }) as never;
    const day = await dataFor(rpc).day(TODAY);
    expect(day.targets).toBeNull();
    expect(day.remaining).toBeNull();
  });
});

describe("range with ai.diaryRange", () => {
  test("macros per day from diaryRange; a macro some rows lack is partial; unlogged days are null", async () => {
    const calls: string[] = [];
    const { days, notes } = await dataFor(fakeRpc({ calls })).range("2026-10-19", TODAY);
    expect(calls).toContain("diaryRange");
    expect(calls).not.toContain("kcalSeries");
    expect(days.map((d) => [d.date, d.kcal, d.logged])).toEqual([
      ["2026-10-19", null, false],
      ["2026-10-20", 1800, true],
      ["2026-10-21", null, false],
      [TODAY, 410, true],
    ]);
    expect(days[1]).toMatchObject({ protein: 80, fiber: 18, partial: ["protein", "fiber"] });
    expect(days[3]?.partial).toEqual(["protein", "carbs", "fat", "fiber"]);
    expect(days[0]).toMatchObject({ protein: null, carbs: null, fat: null, fiber: null, partial: [] });
    expect(notes.join(" ")).toContain("lower bound");
  });
});

describe("range BYOK fallback (no ai.diaryRange)", () => {
  const diaryDays: Record<string, unknown[]> = {
    "2026-10-20": [
      { meal: "sarapan", name: "Nasi", kcal: 600, protein: 15, carbs: 100, fat: 10, fiber: 3, grams: 200, source: "manual" },
      { meal: "snack", name: "Roti", kcal: 1200, protein: null, carbs: null, fat: null, fiber: null, grams: null, source: "manual" },
    ],
  };

  function fallbackRpc(calls: string[]): RogoRpc {
    const rpc = fakeRpc({ noDiaryRange: true });
    rpc.kcalSeries = async (from, to) => {
      calls.push(`kcalSeries ${from} ${to}`);
      const out: { date: string; kcal: number | null }[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        out.push({ date, kcal: date === "2026-10-20" ? 1800 : date === "2026-09-10" ? 2100 : date === "2026-08-25" ? 1900 : null });
      }
      return out as never;
    };
    rpc.foodByDate = async (date) => {
      calls.push(`foodByDate ${date}`);
      return { items: diaryDays[date] ?? [], totals: {} } as never;
    };
    return rpc;
  }

  test("kcal for any range from kcalSeries; macros and fiber from the diary for the last 14 days only, older days null", async () => {
    const calls: string[] = [];
    const { days, notes } = await dataFor(fallbackRpc(calls)).range("2026-09-01", TODAY);
    expect(calls.filter((c) => c.startsWith("foodByDate"))).toEqual(["foodByDate 2026-10-20"]);
    const old = days.find((d) => d.date === "2026-09-10");
    expect(old).toMatchObject({ kcal: 2100, logged: true, protein: null, carbs: null, fat: null, fiber: null });
    const recent = days.find((d) => d.date === "2026-10-20");
    expect(recent).toMatchObject({ kcal: 1800, protein: 15, carbs: 100, fat: 10, fiber: 3, partial: ["protein", "carbs", "fat", "fiber"] });
    expect(notes.join(" ")).toContain("only exist from 2026-10-09");
    expect(FALLBACK_MACRO_DAYS).toBe(14);
  });

  test.each([
    ["ORPCError NOT_FOUND", { code: "NOT_FOUND", status: 404 }],
    ["an HTTP 404", { status: 404 }],
  ])("diaryRange rejecting with %s falls back, and asks only once", async (_label, error) => {
    const calls: string[] = [];
    const rpc = fakeRpc({ diaryRangeError: error, calls });
    rpc.kcalSeries = async (from, to) => {
      calls.push("kcalSeries");
      const out: { date: string; kcal: number | null }[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push({ date: d.toISOString().slice(0, 10), kcal: null });
      }
      return out as never;
    };
    const data = dataFor(rpc);
    const first = await data.range("2026-10-15", TODAY);
    const second = await data.range("2026-10-16", TODAY);
    expect(first.days).toHaveLength(8);
    expect(second.days).toHaveLength(7);
    expect(calls.filter((c) => c === "diaryRange")).toHaveLength(1);
    expect(calls.filter((c) => c === "kcalSeries")).toHaveLength(2);
  });

  test("any other diaryRange failure is NOT swallowed into a fallback", async () => {
    const rpc = fakeRpc({ diaryRangeError: { code: "INTERNAL_SERVER_ERROR", status: 500 } });
    await expect(dataFor(rpc).range("2026-10-15", TODAY)).rejects.toMatchObject({ status: 500 });
    const out = await runTool({ id: "1", name: "get_range", args: { from: "2026-10-15", to: TODAY } }, dataFor(rpc));
    expect(JSON.parse(out.content)).toEqual({ error: "the data could not be read" });
  });

  test("the tool answers through the fallback with null (unknown) macros for old days", async () => {
    const calls: string[] = [];
    const out = await runTool({ id: "1", name: "get_range", args: { from: "2026-08-20", to: "2026-09-12" } }, dataFor(fallbackRpc(calls)));
    const json = JSON.parse(out.content);
    expect(json.days.find((d: { date: string }) => d.date === "2026-09-10")).toMatchObject({ kcal: 2100, protein: null, fiber: null });
    expect(json.days.find((d: { date: string }) => d.date === "2026-08-25")).toMatchObject({ kcal: 1900, protein: null, fiber: null });
    expect(json.means.protein).toEqual({ mean: null, days: 0 });
    expect(json.means.kcal).toEqual({ mean: 2000, days: 2 });
    // only the day inside the last 14 days of the range was read from the diary
    expect(calls.filter((c) => c.startsWith("foodByDate"))).toEqual(["foodByDate 2026-09-10"]);
  });
});

describe("usualGrams", () => {
  test("the person's latest grams for a food, matched by name or by the row the name resolves to", async () => {
    const data = dataFor(fakeRpc());
    expect(await data.usualGrams?.("Nasi putih")).toBe(120);
    expect(await data.usualGrams?.("nasi")).toBe(120);
    expect(await data.usualGrams?.("white rice")).toBe(120);
    expect(await data.usualGrams?.("pepaya")).toBeNull();
    expect(await data.usualGrams?.("kue lapis surga xyz")).toBeNull();
  });

  test("absent without food.recent", () => {
    const rpc = fakeRpc();
    delete rpc.recentFoods;
    expect(dataFor(rpc).usualGrams).toBeUndefined();
  });
});

describe("profile", () => {
  test("scan allowance is optional; the tier is never carried", async () => {
    const rpc = fakeRpc();
    delete rpc.scanAllowance;
    expect((await dataFor(rpc).profile()).scanAllowance).toBeNull();
    expect((await dataFor(fakeRpc()).profile()).scanAllowance).toEqual({ used: 2, quota: null, left: null });
  });
});
