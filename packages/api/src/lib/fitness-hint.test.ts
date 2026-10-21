import { describe, expect, test } from "bun:test";

import { fitnessFigures, fitnessHints, fitnessVerdict, hasFitnessData } from "./fitness-hint";
import type { FitnessDay } from "./fitness-hint";

const day = (patch: Partial<FitnessDay>): FitnessDay => ({
  recoveryPct: null,
  strain: null,
  sleepPct: null,
  readiness: null,
  ...patch,
});

describe("hasFitnessData", () => {
  test("needs at least one score or the readiness word", () => {
    expect(hasFitnessData(null)).toBe(false);
    expect(hasFitnessData(day({}))).toBe(false);
    expect(hasFitnessData(day({ strain: 0 }))).toBe(true);
    expect(hasFitnessData(day({ readiness: "Balanced" }))).toBe(true);
  });
});

describe("fitnessHints", () => {
  test("hard day: energy and carbohydrate need is higher", () => {
    const [hint] = fitnessHints(day({ strain: 15.2, recoveryPct: 70 }));
    expect(hint).toContain("energi dan karbohidrat");
  });

  test("low recovery: protein, fluids and sleep", () => {
    const hints = fitnessHints(day({ recoveryPct: 20, strain: 4 }));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("protein, cairan, dan tidur");
  });

  test("short sleep and run-down readiness also trigger the recovery hint", () => {
    expect(fitnessHints(day({ sleepPct: 60 }))[0]).toContain("Tidurmu kurang");
    expect(fitnessHints(day({ readiness: "Run down" }))[0]).toContain("terbebani");
  });

  test("a hard day on low recovery gives both hints", () => {
    expect(fitnessHints(day({ strain: 18, recoveryPct: 30 }))).toHaveLength(2);
  });

  test("nothing stands out on an ordinary day", () => {
    expect(fitnessHints(day({ strain: 9, recoveryPct: 55, sleepPct: 92, readiness: "Balanced" }))).toEqual([]);
    expect(fitnessHints(day({ recoveryPct: 34, sleepPct: 75, strain: 13.9 }))).toEqual([]);
  });
});

describe("fitnessFigures", () => {
  test("recovery, strain and readiness, each with its unit; sleep never shows", () => {
    const figures = fitnessFigures(day({ recoveryPct: 72, strain: 11.44, sleepPct: 90, readiness: "Balanced" }), "id");
    expect(figures.map((f) => [f.id, f.value, f.unit])).toEqual([
      ["recovery", "72", "%"],
      ["strain", "11,4", "/21"],
      ["readiness", "Seimbang", null],
    ]);
  });

  test("a score JoyoFit did not push is skipped, and the decimal follows the language", () => {
    const figures = fitnessFigures(day({ strain: 7, sleepPct: 80 }), "en");
    expect(figures.map((f) => [f.id, f.value])).toEqual([["strain", "7.0"]]);
    expect(fitnessFigures(day({ sleepPct: 80 }))).toEqual([]);
  });
});

describe("fitnessVerdict", () => {
  test("one line, rest before a hard day", () => {
    expect(fitnessVerdict(day({ recoveryPct: 20, strain: 16 }), "id")).toBe("Pemulihan rendah, istirahat dulu");
    expect(fitnessVerdict(day({ readiness: "Run down" }), "id")).toBe("Tubuh terbebani, istirahat dulu");
    expect(fitnessVerdict(day({ sleepPct: 60 }), "en")).toBe("Short on sleep, take it easy");
    expect(fitnessVerdict(day({ strain: 15, recoveryPct: 70 }), "id")).toBe("Hari berat, butuh energi lebih");
  });

  test("null when nothing stands out", () => {
    expect(fitnessVerdict(day({ strain: 9, recoveryPct: 55, sleepPct: 92, readiness: "Balanced" }), "id")).toBeNull();
  });
});
