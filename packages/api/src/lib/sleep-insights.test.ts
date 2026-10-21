import { describe, expect, test } from "bun:test";

import {
  LEANING_NIGHTS,
  benjaminiHochberg,
  buildFactorSamples,
  evaluateFactor,
  foodTime,
  gate,
  hasRecentAlcohol,
  isFreeNight,
  lastCaffeineBeforeBed,
  needOf,
  releaseNew,
  socialJetlag,
  stratifiedPermutationP,
  visibleFindings,
  weekRegularity,
} from "./sleep-insights";
import type { EngineContext, FactorEval, FactorSamples, FactorState, FoodInput, NightInput, Sample, WorkoutInput } from "./sleep-insights";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TZ = 420;
// 2026-09-01 00:00 WIB
const START = Date.UTC(2026, 8, 1) - TZ * 60_000;

const ctx: EngineContext = { userId: "u", freeDaysMask: 65, maternal: false, ramadanOn: () => false, dayOffsetMin: 420 };

/** Night i: onset 23:00 WIB of day i, wake 06:30 next day. */
function night(i: number, over: Partial<NightInput> = {}): NightInput {
  const onsetMs = START + i * DAY + 23 * HOUR;
  const wakeMs = onsetMs + 7.5 * HOUR;
  const wakeDate = new Date(wakeMs + TZ * 60_000).toISOString().slice(0, 10);
  return {
    wakeDate,
    onsetMs,
    wakeMs,
    tzOffsetMin: TZ,
    asleepS: 7 * 3600,
    awakeS: 20 * 60,
    awakenings: 2,
    hasStages: true,
    deepS: 5000,
    remS: 5000,
    lightS: 12000,
    hrvMs: 50,
    rhrBpm: 55,
    tempCMean: null,
    rhPctMean: null,
    ...over,
  };
}

/** A coffee logged at `hour` WIB on day i (a snack, picker time so it is trusted). */
function coffee(i: number, hour: number): FoodInput {
  const t = START + i * DAY + hour * HOUR;
  return { date: new Date(t + TZ * 60_000).toISOString().slice(0, 10), meal: "snack", name: "Kopi susu", kcal: 120, eatenAt: t, createdAt: t };
}

/** Two logged meals so the night counts as complete. */
function meals(i: number, dinnerHour = 19): FoodInput[] {
  const day = new Date(START + i * DAY + TZ * 60_000).toISOString().slice(0, 10);
  const at = (h: number) => START + i * DAY + h * HOUR;
  return [
    { date: day, meal: "sarapan", name: "Nasi", kcal: 400, eatenAt: at(7), createdAt: at(7) },
    { date: day, meal: "makan_malam", name: "Soto", kcal: 500, eatenAt: at(dinnerHour), createdAt: at(dinnerHour) },
  ];
}

describe("foodTime", () => {
  test("picker time always wins; createdAt only when it fits the day and the meal", () => {
    const base = { date: "2026-09-03", meal: "sarapan", name: "x", kcal: 1 };
    const wib = (day: number, h: number) => Date.UTC(2026, 8, day, h) - TZ * 60_000;
    expect(foodTime({ ...base, eatenAt: wib(3, 7), createdAt: wib(5, 20) })).toEqual({ ms: wib(3, 7), known: true });
    expect(foodTime({ ...base, eatenAt: null, createdAt: wib(3, 8) }).known).toBe(true);
    // breakfast logged at 21:00, and a back-filled day
    expect(foodTime({ ...base, eatenAt: null, createdAt: wib(3, 21) }).known).toBe(false);
    expect(foodTime({ ...base, eatenAt: null, createdAt: wib(4, 8) }).known).toBe(false);
    // snacks fit any hour of their own day
    expect(foodTime({ ...base, meal: "snack", eatenAt: null, createdAt: wib(3, 21) }).known).toBe(true);
  });
});

describe("statistics", () => {
  test("a clear effect has a small permutation p, a null one does not, and the seed repeats it", () => {
    const rng = (n: number) => ((n * 9301 + 49297) % 233280) / 233280;
    const effect: Sample[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      exposed: i % 3 === 0,
      value: 420 + rng(i) * 20 - (i % 3 === 0 ? 40 : 0),
      stratum: (i % 7 === 0 ? 1 : 0) as 0 | 1,
    }));
    const noise = effect.map((s, i) => ({ ...s, value: 420 + rng(i * 7 + 3) * 40 }));
    expect(stratifiedPermutationP(effect, 1)).toBeLessThan(0.02);
    expect(stratifiedPermutationP(noise, 1)).toBeGreaterThan(0.2);
    expect(stratifiedPermutationP(effect, 5)).toBe(stratifiedPermutationP(effect, 5));
  });

  test("stratification: exposure that only happens on free nights is not credited with the free-night difference", () => {
    const samples: Sample[] = Array.from({ length: 30 }, (_, i) => {
      const free = i % 3 === 0;
      return { date: `d${i}`, exposed: free, value: free ? 480 : 420, stratum: free ? 1 : 0 };
    });
    // Unstratified this would be perfectly significant; within strata the label cannot vary, so p stays 1.
    expect(stratifiedPermutationP(samples, 9)).toBe(1);
  });

  test("Benjamini-Hochberg", () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03, 0.2]).map((v) => Number(v.toFixed(3)))).toEqual([0.04, 0.053, 0.053, 0.2]);
    expect(benjaminiHochberg([])).toEqual([]);
  });
});

describe("factor samples", () => {
  const nights = Array.from({ length: 20 }, (_, i) => night(i));

  test("caffeine: exposed within the decay window, dropped when the night is not logged or the time is unknown", () => {
    const foods = [...nights.flatMap((_, i) => meals(i)), coffee(0, 16), coffee(1, 9)];
    const f = buildFactorSamples(nights, foods, [], ctx).find((x) => x.factor === "caffeine")!;
    const byDate = new Map(f.samples.map((s) => [s.date, s]));
    // 16:00 coffee, onset 23:00: 80 * 0.5^(7/5) ~ 30 mg -> exposed. 9:00 coffee: 14 h -> ~11 mg -> not.
    expect(byDate.get(nights[0]!.wakeDate)!.exposed).toBe(true);
    expect(byDate.get(nights[1]!.wakeDate)!.exposed).toBe(false);

    // Night 5 has no meals logged: it is dropped, never counted as "no coffee".
    const sparse = foods.filter((x) => !(x.date === new Date(START + 5 * DAY + TZ * 60_000).toISOString().slice(0, 10)));
    const g = buildFactorSamples(nights, sparse, [], ctx).find((x) => x.factor === "caffeine")!;
    expect(g.samples.some((s) => s.date === nights[5]!.wakeDate)).toBe(false);

    // A coffee logged at an unknown time (breakfast slot logged at 21:00 without picker) drops that night.
    const t = START + 2 * DAY + 21 * HOUR;
    const unknown: FoodInput = { date: new Date(START + 2 * DAY + TZ * 60_000).toISOString().slice(0, 10), meal: "sarapan", name: "Kopi", kcal: 50, eatenAt: null, createdAt: t };
    const h = buildFactorSamples(nights, [...foods, unknown], [], ctx).find((x) => x.factor === "caffeine")!;
    expect(h.samples.some((s) => s.date === nights[2]!.wakeDate)).toBe(false);
  });

  test("Hamil/Menyusui: no caffeine factor; Ramadan drops caffeine and dinner nights", () => {
    const foods = nights.flatMap((_, i) => meals(i));
    const maternal = buildFactorSamples(nights, foods, [], { ...ctx, maternal: true });
    expect(maternal.find((x) => x.factor === "caffeine")!.available).toBe(false);
    const ramadan = buildFactorSamples(nights, foods, [], { ...ctx, ramadanOn: () => true });
    expect(ramadan.find((x) => x.factor === "caffeine")!.samples).toHaveLength(0);
    expect(ramadan.find((x) => x.factor === "dinner")!.samples).toHaveLength(0);
    expect(ramadan.find((x) => x.factor === "regularity")!.samples).toHaveLength(20);
  });

  test("dinner: gap under 3 h is exposed; no dinner logged drops the night", () => {
    const foods = nights.flatMap((_, i) => (i === 3 ? [] : meals(i, i % 2 === 0 ? 21 : 18)));
    // night 3 has no meals at all (incomplete) -> dropped
    const f = buildFactorSamples(nights, foods, [], ctx).find((x) => x.factor === "dinner")!;
    const byDate = new Map(f.samples.map((s) => [s.date, s.exposed]));
    expect(byDate.get(nights[0]!.wakeDate)).toBe(true); // 21:00 dinner, 23:00 onset
    expect(byDate.get(nights[1]!.wakeDate)).toBe(false);
    expect(byDate.has(nights[3]!.wakeDate)).toBe(false);
  });

  test("workout: unavailable without a backup; vigorous ending within 3 h exposes; a light one drops the night", () => {
    const end = (i: number, h: number) => START + i * DAY + h * HOUR;
    const w = (i: number, vigorous: boolean | null): WorkoutInput => ({ startMs: end(i, 19), endMs: end(i, 20.5), vigorous });
    const none = buildFactorSamples(nights, [], [], ctx).find((x) => x.factor === "workout")!;
    expect(none.available).toBe(false);
    const f = buildFactorSamples(nights, [], [w(0, true), w(1, false), w(2, null), { ...w(3, true), startMs: end(3, 20.3) }], ctx).find(
      (x) => x.factor === "workout",
    )!;
    expect(f.available).toBe(true);
    const byDate = new Map(f.samples.map((s) => [s.date, s.exposed]));
    expect(byDate.get(nights[0]!.wakeDate)).toBe(true);
    expect(byDate.has(nights[1]!.wakeDate)).toBe(false);
    expect(byDate.has(nights[2]!.wakeDate)).toBe(false);
    // 12 min workout is too short to count at all
    expect(byDate.get(nights[3]!.wakeDate)).toBe(false);
    expect(byDate.get(nights[4]!.wakeDate)).toBe(false);
  });

  test("regularity: a night 60 min or more from the median bedtime is exposed", () => {
    const shifted = nights.map((n, i) => (i % 4 === 0 ? { ...n, onsetMs: n.onsetMs + 90 * 60_000 } : n));
    const f = buildFactorSamples(shifted, [], [], ctx).find((x) => x.factor === "regularity")!;
    expect(f.samples.filter((s) => s.exposed)).toHaveLength(5);
  });

  test("temperature: the person's own warmest third is exposed; unavailable without a sensor", () => {
    expect(buildFactorSamples(nights, [], [], ctx).find((x) => x.factor === "temperature")!.available).toBe(false);
    const withTemp = nights.map((n, i) => ({ ...n, tempCMean: 26 + i * 0.2, rhPctMean: 70 }));
    const f = buildFactorSamples(withTemp, [], [], ctx).find((x) => x.factor === "temperature")!;
    expect(f.available).toBe(true);
    const exposed = f.samples.filter((s) => s.exposed).length;
    expect(exposed).toBeGreaterThanOrEqual(6);
    expect(exposed).toBeLessThanOrEqual(8);
    expect(f.threshold).toBeCloseTo(26 + 13 * 0.2, 5);
  });
});

function synthetic(n: number, effectMin: number, noise = 8): FactorSamples {
  const samples: Sample[] = Array.from({ length: n }, (_, i) => {
    const exposed = i % 3 === 0;
    const jitter = (((i * 37) % 17) - 8) * (noise / 8);
    return {
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      exposed,
      value: 420 + jitter - (exposed ? effectMin : 0),
      stratum: (i % 7 === 0 || i % 7 === 6 ? 1 : 0) as 0 | 1,
    };
  });
  return { factor: "caffeine", available: true, samples, threshold: null };
}

describe("gate", () => {
  test("below the per-group minimum no test runs; a strong effect passes as 'maybe' under 28 nights", () => {
    const few = evaluateFactor({ ...synthetic(12, 40), samples: synthetic(12, 40).samples.map((s, i) => ({ ...s, exposed: i < 3 })) }, "k", "d");
    expect(few!.p).toBeNull();
    expect(needOf(few)).toEqual({ factor: "caffeine", side: "exposed", need: 2, have: 3 });

    const e = evaluateFactor(synthetic(24, 40), "k", "2026-09-01")!;
    expect(e.p).not.toBeNull();
    expect(gate([e], {}, 24)).toEqual({ caffeine: "maybe" });
  });

  test("the 14-night window gate and the unavailable factor", () => {
    const e = evaluateFactor(synthetic(24, 40), "k", "d")!;
    expect(gate([e], {}, 13)).toEqual({ caffeine: "none" });
    expect(evaluateFactor({ ...synthetic(24, 40), available: false }, "k", "d")).toBeNull();
  });

  test("a tiny effect never shows; 'cenderung' needs 28 nights, both halves agreeing and a high-prior factor", () => {
    expect(gate([evaluateFactor(synthetic(30, 1), "k", "d")], {}, 30)).toEqual({ caffeine: "none" });
    const strong = evaluateFactor(synthetic(LEANING_NIGHTS + 4, 45), "k", "d")!;
    expect(gate([strong], {}, 32)).toEqual({ caffeine: "leaning" });
    const lowPrior: FactorEval = { ...strong, factor: "dinner" };
    expect(gate([lowPrior], {}, 32)).toEqual({ dinner: "maybe" });
    expect(gate([{ ...strong, halvesAgree: false }], {}, 32)).toEqual({ caffeine: "maybe" });
  });

  test("hysteresis: a shown finding stays at the looser bar, a hidden one needs the strict bar", () => {
    const base = evaluateFactor(synthetic(24, 40), "k", "d")!;
    // p right between the strict (0.10) and the keep (0.15) bar
    const marginal: FactorEval = { ...base, p: 0.13 };
    expect(gate([marginal], {}, 24)).toEqual({ caffeine: "none" });
    expect(gate([marginal], { caffeine: "maybe" }, 24)).toEqual({ caffeine: "maybe" });
    expect(gate([{ ...marginal, p: 0.3 }], { caffeine: "maybe" }, 24)).toEqual({ caffeine: "none" });
  });

  test("Benjamini-Hochberg across tests tightens the bar", () => {
    const base = evaluateFactor(synthetic(24, 40), "k", "d")!;
    const a: FactorEval = { ...base, p: 0.08 };
    const others = (["dinner", "workout", "regularity"] as const).map((factor): FactorEval => ({ ...base, factor, p: 0.5 }));
    // 0.08 alone passes (<= 0.10); with 3 weaker tests BH adjusts it to 0.08 * 4 / 1 = 0.32
    expect(gate([a], {}, 24)).toEqual({ caffeine: "maybe" });
    expect(gate([a, ...others], {}, 24).caffeine).toBe("none");
  });
});

describe("release", () => {
  const ev = (factor: FactorEval["factor"], diff: number): FactorEval => ({
    factor, outcome: "asleep", n: 20, exposed: 6, other: 14, diff, sd: 20, p: 0.01, halvesAgree: true, threshold: null, nights: [], through: "d",
  });
  test("at most one new finding becomes visible per day, the strongest first; falling out resets", () => {
    const states: Partial<Record<FactorEval["factor"], FactorState>> = {
      caffeine: { eval: ev("caffeine", -30), status: "maybe", firstShownDay: null },
      regularity: { eval: ev("regularity", -50), status: "maybe", firstShownDay: null },
    };
    releaseNew(states, "2026-09-10");
    expect(states.regularity!.firstShownDay).toBe("2026-09-10");
    expect(states.caffeine!.firstShownDay).toBeNull();
    releaseNew(states, "2026-09-10");
    expect(states.caffeine!.firstShownDay).toBeNull();
    expect(visibleFindings(states).map((f) => f.factor)).toEqual(["regularity"]);
    releaseNew(states, "2026-09-11");
    expect(visibleFindings(states).map((f) => f.factor)).toEqual(["caffeine", "regularity"]);
    states.regularity!.status = "none";
    releaseNew(states, "2026-09-12");
    expect(states.regularity!.firstShownDay).toBeNull();
  });
});

describe("general facts", () => {
  const nights = Array.from({ length: 10 }, (_, i) => night(i));
  test("last caffeine before the usual bedtime", () => {
    const now = START + 9 * DAY + 20 * HOUR;
    expect(lastCaffeineBeforeBed([coffee(8, 16.67)], nights, now)).toEqual({ clock: "16:40", hoursBeforeBed: 6 });
    // 8 a.m. coffee is far from bedtime: nothing to say
    expect(lastCaffeineBeforeBed([coffee(8, 8)], nights, now)).toBeNull();
    expect(lastCaffeineBeforeBed([coffee(8, 16)], nights.slice(0, 2), now)).toBeNull();
  });

  test("alcohol tip needs a drink, not tape", () => {
    const t = START + DAY;
    const item = (name: string): FoodInput => ({ date: "2026-09-02", meal: "snack", name, kcal: 100, eatenAt: t, createdAt: t });
    expect(hasRecentAlcohol([item("Bir")], t + HOUR)).toBe(true);
    expect(hasRecentAlcohol([item("Tape ketan")], t + HOUR)).toBe(false);
  });

  test("regularity needs 5 of the last 7 nights; social jetlag needs 4 work and 2 free nights", () => {
    expect(weekRegularity(nights.slice(0, 4))).toBeNull();
    expect(weekRegularity(nights)!.sdMin).toBe(0);
    const longer = Array.from({ length: 28 }, (_, i) => {
      const n = night(i);
      return isFreeNight(n.wakeDate, 65) ? { ...n, onsetMs: n.onsetMs + 2 * HOUR, wakeMs: n.wakeMs + 2 * HOUR } : n;
    });
    expect(socialJetlag(longer, 65, longer[27]!.wakeDate)).toBe(120);
    expect(socialJetlag(longer.slice(0, 5), 65, longer[4]!.wakeDate)).toBeNull();
  });
});
