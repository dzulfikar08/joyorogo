import { describe, expect, test } from "bun:test";

import { shiftDate } from "./engine";
import type { WeighIn } from "./engine";
import {
  FAST_LOSS_DISMISS_DAYS,
  fastLossNote,
  isFastLossDismissed,
  lowIntakeDays,
  proteinPerKg,
  weeklyLossPct,
} from "./safety";
import type { LoggedDay } from "./safety";

const TODAY = "2026-10-22";
const day = (offset: number) => shiftDate(TODAY, offset);

/** Weigh-ins `[daysAgo, kg]`, oldest first. */
function weighIns(...entries: [number, number][]): WeighIn[] {
  return entries.map(([ago, kg]) => ({ date: day(-ago), weightKg: kg }));
}

/** A steady line: 70 kg a month ago, falling `perWeek` kg a week up to today. */
function steady(perWeek: number): WeighIn[] {
  const out: WeighIn[] = [];
  for (let ago = 40; ago >= 0; ago--) {
    out.push({ date: day(-ago), weightKg: Math.round((70 - (perWeek / 7) * (40 - ago)) * 10) / 10 });
  }
  return out;
}

const full = (offset: number, kcal: number, meals = 3): LoggedDay => ({ date: day(offset), kcal, meals });

describe("weeklyLossPct", () => {
  test("a steady 1 kg a week fall on ~70 kg is above 1%", () => {
    const pct = weeklyLossPct(steady(1), TODAY);
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(1.2);
    expect(pct!).toBeLessThan(1.6);
  });

  test("a steady 0.4 kg a week fall is well under 1%", () => {
    expect(weeklyLossPct(steady(0.4), TODAY)!).toBeLessThan(0.7);
  });

  test("a gain reads as a negative loss", () => {
    expect(weeklyLossPct(steady(-0.5), TODAY)!).toBeLessThan(0);
  });

  test("fewer than 3 weigh-ins in the 7 days says nothing", () => {
    const history = [...steady(1).slice(0, -7), ...weighIns([6, 66.5], [0, 65.5])];
    expect(weeklyLossPct(history, TODAY)).toBeNull();
  });

  test("three weigh-ins inside 3 days are too close to define a pace", () => {
    expect(weeklyLossPct(weighIns([2, 70], [1, 69], [0, 68]), TODAY)).toBeNull();
  });

  test("an old fall outside the 7 days is not counted", () => {
    const flat = weighIns([30, 80], [29, 79], [28, 78], [6, 70], [3, 70], [0, 70]);
    expect(weeklyLossPct(flat, TODAY)!).toBeLessThan(0.5);
  });
});

describe("lowIntakeDays", () => {
  const bmr = 1500; // limit = max(1200, 1000) = 1200
  test("counts fully logged days under 0.8 x BMR", () => {
    const days = [full(-1, 900), full(-2, 1100), full(-3, 1199), full(-4, 1300), full(-5, 800)];
    expect(lowIntakeDays(days, bmr, TODAY)).toBe(4);
  });

  test("ignores today, days older than 5, and partly logged days", () => {
    const days = [full(0, 500), full(-6, 500), full(-1, 500, 2), full(-2, 1500)];
    expect(lowIntakeDays(days, bmr, TODAY)).toBe(0);
  });

  test("a day of a few logged coffees is a skipped day, not a fast", () => {
    expect(lowIntakeDays([full(-1, 40), full(-2, 120)], bmr, TODAY)).toBe(0);
  });

  test("the hard floor lifts the limit for a small body", () => {
    // 0.8 x 1100 = 880, the floor is 1000: 950 kcal is low, 1000 is not.
    expect(lowIntakeDays([full(-1, 950), full(-2, 1000)], 1100, TODAY)).toBe(1);
  });
});

describe("fastLossNote", () => {
  const base = {
    today: TODAY,
    weighIns: steady(0.3),
    days: [] as LoggedDay[],
    bmrKcal: 1500,
    maternal: false,
    gaining: false,
  };

  test("nothing for a calm person", () => {
    expect(fastLossNote(base)).toBeNull();
  });

  test("fast weight fall trips the weight reason with a one-decimal percent", () => {
    const note = fastLossNote({ ...base, weighIns: steady(1) });
    expect(note?.reasons).toEqual(["weight"]);
    expect(note?.weeklyPct).toBeGreaterThanOrEqual(1);
    expect(note?.weeklyPct).toBe(Math.round(note!.weeklyPct! * 10) / 10);
    expect(note?.lowIntakeDays).toBe(0);
  });

  test("3 of 5 low days trip the intake reason; 2 do not", () => {
    const low = [full(-1, 900), full(-2, 1000), full(-3, 1100), full(-4, 1800), full(-5, 1900)];
    const note = fastLossNote({ ...base, days: low });
    expect(note?.reasons).toEqual(["intake"]);
    expect(note?.lowIntakeDays).toBe(3);
    expect(note?.weeklyPct).toBeNull();
    expect(fastLossNote({ ...base, days: low.slice(1) })).toBeNull();
  });

  test("both reasons ride one note", () => {
    const low = [full(-1, 900), full(-2, 1000), full(-3, 1100)];
    const note = fastLossNote({ ...base, weighIns: steady(1), days: low });
    expect(note?.reasons).toEqual(["weight", "intake"]);
  });

  test("a single noisy weigh-in never trips it", () => {
    // Weight flat at 70 kg for a month, then one reading 1.5 kg low: the smoothed trend moves a fraction of it.
    const flat = Array.from({ length: 30 }, (_, i) => ({ date: day(-29 + i), weightKg: 70 }));
    const dip = [...flat.slice(0, -1), { date: TODAY, weightKg: 68.5 }];
    expect(fastLossNote({ ...base, weighIns: dip })).toBeNull();
    const lone = weighIns([0, 60]);
    expect(fastLossNote({ ...base, weighIns: lone })).toBeNull();
  });

  test("two weigh-ins in the week never trip it, however far apart the readings", () => {
    expect(fastLossNote({ ...base, weighIns: weighIns([30, 75], [6, 70], [0, 66]) })).toBeNull();
  });

  test("Hamil / Menyusui get nothing, even with a steep fall and low days", () => {
    const low = [full(-1, 900), full(-2, 1000), full(-3, 1100)];
    expect(fastLossNote({ ...base, weighIns: steady(1.5), days: low, maternal: true })).toBeNull();
  });

  test("a gain plan has its own flag and gets nothing here", () => {
    const low = [full(-1, 900), full(-2, 1000), full(-3, 1100)];
    expect(fastLossNote({ ...base, weighIns: steady(1.5), days: low, gaining: true })).toBeNull();
  });

  test("no weigh-ins and no logged days is silent", () => {
    expect(fastLossNote({ ...base, weighIns: [], days: [] })).toBeNull();
  });
});

describe("isFastLossDismissed", () => {
  test("hidden on the day and for the next days of the window, back after", () => {
    expect(isFastLossDismissed(TODAY, TODAY)).toBe(true);
    expect(isFastLossDismissed(day(-(FAST_LOSS_DISMISS_DAYS - 1)), TODAY)).toBe(true);
    expect(isFastLossDismissed(day(-FAST_LOSS_DISMISS_DAYS), TODAY)).toBe(false);
  });

  test("nothing stored, malformed, or a future stamp hides nothing", () => {
    expect(isFastLossDismissed(null, TODAY)).toBe(false);
    expect(isFastLossDismissed("yesterday", TODAY)).toBe(false);
    expect(isFastLossDismissed(day(2), TODAY)).toBe(false);
  });
});

describe("proteinPerKg", () => {
  const base = { proteinG: 62, proteinKnown: true, weightKg: 78, gaining: false, maternal: false };

  test("62 g on 78 kg is 0.8 g/kg against the 1.2-1.6 guide", () => {
    expect(proteinPerKg(base)).toEqual({ gPerKg: 0.8, guide: { min: 1.2, max: 1.6 } });
  });

  test("a gain plan keeps the gain range", () => {
    expect(proteinPerKg({ ...base, gaining: true })?.guide).toEqual({ min: 1.6, max: 2.2 });
  });

  test("unknown protein is not zero: nothing to say", () => {
    expect(proteinPerKg({ ...base, proteinG: 0, proteinKnown: false })).toBeNull();
  });

  test("a known zero is a real zero", () => {
    expect(proteinPerKg({ ...base, proteinG: 0 })?.gPerKg).toBe(0);
  });

  test("no weight, or a maternal profile, shows nothing", () => {
    expect(proteinPerKg({ ...base, weightKg: null })).toBeNull();
    expect(proteinPerKg({ ...base, weightKg: 0 })).toBeNull();
    expect(proteinPerKg({ ...base, maternal: true })).toBeNull();
  });
});
