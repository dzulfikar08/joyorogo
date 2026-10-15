import { describe, expect, test } from "bun:test";

import type { FitnessDay } from "./fitness-hint";
import { mealIdeas } from "./ideas";
import {
  CARB_BOOST_HARD,
  CARB_BOOST_VERY_HARD,
  buildGuidance,
  guidanceNumbers,
  premiumUnlocked,
} from "./readiness-food";
import type { GuidanceInput, HistoryFood } from "./readiness-food";
import { paywallConfig } from "./tiers";

const day = (patch: Partial<FitnessDay>): FitnessDay => ({
  recoveryPct: null,
  strain: null,
  sleepPct: null,
  readiness: null,
  ...patch,
});

const TARGETS = { eatKcal: 1800, proteinG: 100, carbsG: 200 };
const NOTHING_EATEN = { kcal: 0, proteinG: 0, carbsG: 0, names: [] };

const input = (patch: Partial<GuidanceInput> = {}): GuidanceInput => ({
  day: day({ recoveryPct: 80, strain: 8, sleepPct: 95 }),
  targets: TARGETS,
  eaten: NOTHING_EATEN,
  history: [],
  slot: "makan_siang",
  ...patch,
});

const food = (patch: Partial<HistoryFood> & { name: string }): HistoryFood => ({
  days: 5,
  kcal: 300,
  proteinG: 20,
  carbsG: 30,
  meals: ["makan_siang"],
  ...patch,
});

describe("focus thresholds", () => {
  const focus = (patch: Partial<FitnessDay>) => buildGuidance(input({ day: day(patch) })).focus;

  test("strain 14 is the first hard day, 13.9 is not", () => {
    expect(focus({ strain: 13.9, recoveryPct: 80 })).toBe("steady");
    expect(focus({ strain: 14, recoveryPct: 80 })).toBe("fuel");
  });

  test("recovery 33 needs rest, 34 does not", () => {
    expect(focus({ recoveryPct: 33 })).toBe("recover");
    expect(focus({ recoveryPct: 34 })).toBe("steady");
  });

  test("sleep 74 needs rest, 75 does not", () => {
    expect(focus({ sleepPct: 74 })).toBe("recover");
    expect(focus({ sleepPct: 75 })).toBe("steady");
  });

  test("a strained or run down readiness word needs rest even with fine numbers", () => {
    expect(focus({ readiness: "Strained", recoveryPct: 80 })).toBe("recover");
    expect(focus({ readiness: "Run down" })).toBe("recover");
    expect(focus({ readiness: "Primed" })).toBe("steady");
  });

  test("a hard day on a body that did not recover is both", () => {
    expect(focus({ strain: 15, recoveryPct: 20 })).toBe("fuel_recover");
  });
});

describe("target scaling", () => {
  test("carb boost is a share of the carb target: 10% from strain 14, 20% from 18", () => {
    const hard = guidanceNumbers(day({ strain: 14 }), TARGETS, NOTHING_EATEN);
    expect(hard.carbs.boostG).toBe(Math.round((200 * CARB_BOOST_HARD) / 5) * 5);
    expect(hard.carbs).toMatchObject({ targetG: 200, boostG: 20, goalG: 220, remainingG: 220 });

    const veryHard = guidanceNumbers(day({ strain: 18 }), TARGETS, NOTHING_EATEN);
    expect(veryHard.carbs.boostG).toBe(Math.round((200 * CARB_BOOST_VERY_HARD) / 5) * 5);
    expect(veryHard.carbs.goalG).toBe(240);
  });

  test("no boost below strain 14, whatever the recovery is", () => {
    const n = guidanceNumbers(day({ strain: 13, recoveryPct: 10 }), TARGETS, NOTHING_EATEN);
    expect(n.carbs.boostG).toBe(0);
    expect(n.roomKcal).toBe(1800);
  });

  test("remaining is target minus what is logged and never goes negative", () => {
    const n = guidanceNumbers(day({ strain: 15 }), TARGETS, {
      kcal: 1000,
      proteinG: 130,
      carbsG: 100,
      names: [],
    });
    expect(n.protein).toEqual({ targetG: 100, eatenG: 130, remainingG: 0 });
    expect(n.carbs.remainingG).toBe(120);
    // 1800 + 20 g carbs x 4 kcal - 1000
    expect(n.roomKcal).toBe(880);
    expect(
      guidanceNumbers(day({ strain: 15 }), TARGETS, { ...NOTHING_EATEN, kcal: 5000 }).roomKcal,
    ).toBe(0);
  });

  test("the lines state the real numbers and the basis names the rule", () => {
    const g = buildGuidance(
      input({
        day: day({ strain: 15.2, recoveryPct: 80 }),
        eaten: { kcal: 600, proteinG: 40, carbsG: 70, names: [] },
      }),
    );
    const text = g.lines.join(" ");
    expect(text).toContain("15,2");
    expect(text).toContain("220 g (200 g + 20 g)");
    expect(text).toContain("sisa 150 g");
    expect(text).toContain("1.280 kkal");
    expect(g.basis).toContain("1.800 kkal");
    expect(g.basis).toContain("bar di diary");
    expect(g.basis).toContain("10%");
    expect(g.basis).toContain("strain 14");
  });

  test("a rest-only day shows no carb boost and no carb numbers", () => {
    const g = buildGuidance(input({ day: day({ recoveryPct: 20 }) }));
    expect(g.numbers?.carbs.boostG).toBe(0);
    expect(g.basis).not.toContain("Tambahan karbohidrat");
    expect(g.lines.join(" ")).toContain("Protein: sudah 0 g dari target 100 g, sisa 100 g.");
    expect(g.lines.join(" ")).toContain("Pemulihan 20%");
  });

  test("a steady day asks for no adjustment and suggests nothing", () => {
    const g = buildGuidance(input({ history: [food({ name: "Ayam bakar" })] }));
    expect(g.focus).toBe("steady");
    expect(g.foods).toEqual([]);
    expect(g.lines[0]).toContain("Tidak ada penyesuaian");
  });

  test("a reached kcal target says so instead of suggesting more food", () => {
    const g = buildGuidance(
      input({
        day: day({ recoveryPct: 20 }),
        eaten: { kcal: 1850, proteinG: 40, carbsG: 150, names: [] },
        history: [food({ name: "Ayam bakar" })],
      }),
    );
    expect(g.numbers?.roomKcal).toBe(0);
    expect(g.foods).toEqual([]);
    expect(g.lines.join(" ")).toContain("Target kkal hari ini sudah terpenuhi");
  });
});

describe("without targets", () => {
  test("stays qualitative: no numbers, no basis, no foods", () => {
    const g = buildGuidance(
      input({
        day: day({ strain: 16, recoveryPct: 20 }),
        targets: null,
        history: [food({ name: "Ayam bakar" })],
      }),
    );
    expect(g.numbers).toBeNull();
    expect(g.basis).toBeNull();
    expect(g.foods).toEqual([]);
    expect(g.lines.join(" ")).toContain("Isi profil");
    // the only digits are the watch's own scores, never a gram or kcal target
    expect(g.lines.join(" ")).not.toMatch(/\d+\s?(g|kkal)\b/);
  });

  test("a steady day without targets is just the no-adjustment line", () => {
    const g = buildGuidance(input({ targets: null }));
    expect(g.lines).toEqual(["Tidak ada penyesuaian dari skor hari ini. Ikuti target harianmu."]);
  });
});

describe("food picking", () => {
  const recover = (patch: Partial<GuidanceInput>) =>
    buildGuidance(input({ day: day({ recoveryPct: 20 }), ...patch }));

  test("suggests the user's own frequent foods, densest protein first", () => {
    const g = recover({
      history: [
        food({ name: "Nasi goreng", proteinG: 12, kcal: 500 }),
        food({ name: "Dada ayam bakar", proteinG: 35, kcal: 280 }),
        food({ name: "Telur rebus 2", proteinG: 13, kcal: 150 }),
      ],
    });
    expect(g.foods.map((f) => f.name)).toEqual(["Dada ayam bakar", "Telur rebus 2", "Nasi goreng"]);
    expect(g.foods.every((f) => f.source === "riwayat" && f.role === "protein")).toBe(true);
    expect(g.foods[0]).toMatchObject({ kcal: 280, proteinG: 35, days: 5 });
  });

  test("never suggests what is already logged today, drinks, or foods without macros", () => {
    const g = recover({
      eaten: { kcal: 300, proteinG: 20, carbsG: 20, names: ["  Dada Ayam  bakar "] },
      history: [
        food({ name: "Dada ayam bakar", proteinG: 35 }),
        food({ name: "Es kopi susu", proteinG: 10, kcal: 180 }),
        food({ name: "Sate misterius", proteinG: null }),
        food({ name: "Tempe goreng", proteinG: 14, kcal: 200 }),
      ],
    });
    expect(g.foods[0]?.name).toBe("Tempe goreng");
    const names = g.foods.map((f) => f.name);
    expect(names).not.toContain("Dada ayam bakar");
    expect(names).not.toContain("Es kopi susu");
    expect(names).not.toContain("Sate misterius");
  });

  test("a food seen on one day only is not frequent", () => {
    const g = recover({ history: [food({ name: "Rendang", days: 1, proteinG: 30 })] });
    expect(g.foods.map((f) => f.name)).not.toContain("Rendang");
  });

  test("every pick fits the kcal still open", () => {
    const g = recover({
      eaten: { kcal: 1450, proteinG: 40, carbsG: 150, names: [] },
      history: [
        food({ name: "Rendang", kcal: 450, proteinG: 30 }),
        food({ name: "Tahu kukus", kcal: 120, proteinG: 10 }),
      ],
    });
    expect(g.numbers?.roomKcal).toBe(350);
    expect(g.foods.length).toBeGreaterThan(0);
    for (const pick of g.foods) expect(pick.kcal).toBeLessThanOrEqual(350);
    expect(g.foods.map((f) => f.name)).toContain("Tahu kukus");
    expect(g.foods.map((f) => f.name)).not.toContain("Rendang");
  });

  test("a food from the current meal slot comes before a denser one from another slot", () => {
    const g = recover({
      slot: "sarapan",
      history: [
        food({ name: "Dada ayam bakar", proteinG: 35, kcal: 280, meals: ["makan_malam"] }),
        food({ name: "Telur dadar", proteinG: 12, kcal: 200, meals: ["sarapan"] }),
      ],
    });
    expect(g.foods[0]?.name).toBe("Telur dadar");
  });

  test("thin history is topped up from the app's food database, labelled as such", () => {
    const g = recover({ history: [food({ name: "Tempe goreng", proteinG: 14, kcal: 200 })] });
    expect(g.foods[0]).toMatchObject({ name: "Tempe goreng", source: "riwayat" });
    const database = g.foods.slice(1);
    expect(database.length).toBe(2);
    const catalog = mealIdeas(g.numbers?.roomKcal ?? 0, "makan_siang", 6).map((i) => i.name);
    for (const pick of database) {
      expect(pick.source).toBe("database");
      expect(catalog).toContain(pick.name);
      expect(pick.proteinG).toBeGreaterThanOrEqual(8);
    }
  });

  test("no history at all still gets database picks, none invented", () => {
    const g = recover({ history: [] });
    expect(g.foods.length).toBe(3);
    const catalog = mealIdeas(g.numbers?.roomKcal ?? 0, "makan_siang", 6).map((i) => i.name);
    for (const pick of g.foods) expect(catalog).toContain(pick.name);
  });

  test("a hard day picks carb foods; thin history falls back to TKPI staples", () => {
    const own = buildGuidance(
      input({
        day: day({ strain: 16, recoveryPct: 80 }),
        history: [
          food({ name: "Nasi uduk", carbsG: 55, kcal: 350, proteinG: 8 }),
          food({ name: "Pisang goreng", carbsG: 32, kcal: 160, proteinG: 1 }),
          food({ name: "Roti bakar", carbsG: 40, kcal: 250, proteinG: 6 }),
        ],
      }),
    );
    expect(own.foods.map((f) => f.role)).toEqual(["karbo", "karbo", "karbo"]);
    expect(own.foods.every((f) => f.source === "riwayat")).toBe(true);

    const staples = buildGuidance(input({ day: day({ strain: 16, recoveryPct: 80 }) }));
    expect(staples.foods.length).toBeGreaterThan(0);
    const nasi = staples.foods.find((f) => f.name === "Nasi");
    expect(nasi).toMatchObject({ source: "database", portion: "100 g", kcal: 180, carbsG: 40 });
  });

  test("hard day on a tired body: protein picks first, then a carb pick", () => {
    const g = buildGuidance(
      input({
        day: day({ strain: 16, recoveryPct: 20 }),
        history: [
          food({ name: "Dada ayam bakar", proteinG: 35, kcal: 280, carbsG: 2 }),
          food({ name: "Tempe goreng", proteinG: 14, kcal: 200, carbsG: 10 }),
          food({ name: "Nasi uduk", proteinG: 8, kcal: 350, carbsG: 55 }),
        ],
      }),
    );
    expect(g.focus).toBe("fuel_recover");
    expect(g.foods.map((f) => f.role)).toEqual(["protein", "protein", "karbo"]);
    expect(g.foods[2]?.name).toBe("Nasi uduk");
  });

  test("a reached protein target drops the protein picks", () => {
    const g = recover({
      eaten: { kcal: 900, proteinG: 105, carbsG: 100, names: [] },
      history: [food({ name: "Dada ayam bakar" })],
    });
    expect(g.numbers?.protein.remainingG).toBe(0);
    expect(g.foods).toEqual([]);
  });
});

describe("copy", () => {
  test("Indonesian copy never uses an em dash", () => {
    const days = [
      day({ strain: 19, recoveryPct: 10, sleepPct: 60, readiness: "Run down" }),
      day({ strain: 15 }),
      day({ recoveryPct: 20 }),
      day({ strain: 5, recoveryPct: 90 }),
    ];
    for (const d of days) {
      for (const targets of [TARGETS, null]) {
        const g = buildGuidance(input({ day: d, targets }));
        const all = [g.headline, g.basis ?? "", ...g.lines, ...g.foods.map((f) => f.name)];
        expect(all.join(" ")).not.toContain("\u2014");
      }
    }
  });
});

describe("premiumUnlocked", () => {
  const paywall = paywallConfig({ FREE_DAILY_SCANS: "3" });
  const open = paywallConfig({});
  const now = new Date("2026-10-12T05:00:00Z");

  test("Founder (paid period or comp) is unlocked, free is not", () => {
    expect(
      premiumUnlocked({ tier: "free", founderUntil: new Date("2026-10-13T00:00:00Z") }, paywall, now),
    ).toBe(true);
    expect(premiumUnlocked({ tier: "founder", founderUntil: null }, paywall, now)).toBe(true);
    expect(premiumUnlocked({ tier: "free", founderUntil: null }, paywall, now)).toBe(false);
    expect(
      premiumUnlocked({ tier: "free", founderUntil: new Date("2026-10-12T04:00:00Z") }, paywall, now),
    ).toBe(false);
    expect(premiumUnlocked(undefined, paywall, now)).toBe(false);
  });

  test("a server without a paywall has nothing to sell, so everyone is unlocked", () => {
    expect(premiumUnlocked({ tier: "free", founderUntil: null }, open, now)).toBe(true);
  });
});
