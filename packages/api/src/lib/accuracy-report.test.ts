import { describe, expect, test } from "bun:test";

import {
  accuracyReportSummary,
  buildAccuracyReport,
  caseId,
  compareRegression,
  dayStartMs,
  emptyOutcomes,
  failedRegressionCase,
  orderRegressionCandidates,
  scoreRegressionCase,
  summarizeRegression,
} from "./accuracy-report";
import type { LedgerRow, RegressionCaseResult } from "./accuracy-report";
import { scanDiff } from "./scan-outcome";
import type { CompactItem } from "./scan-outcome";

const DATE = "2026-10-16";
const START = dayStartMs(DATE);
const NOW = START + 31 * 60 * 60 * 1000; // the next day, 07:00 WIB

const item = (n: string, g: number, k: number): CompactItem => ({ n, g, k });

type Session = {
  at: number;
  ai: CompactItem[];
  saved?: CompactItem[];
  retries?: number;
  corrections?: number;
  timing?: Record<string, number>;
  tooMany?: boolean;
  repaired?: boolean;
};

function ledger(s: Session): LedgerRow {
  const diff = s.saved ? scanDiff(s.ai, s.saved) : undefined;
  const edited = diff && (diff.renamed.length + diff.removed.length + diff.added.length + diff.changed.length > 0);
  return {
    createdAt: s.at,
    model: "m",
    usageJson: JSON.stringify({
      photoId: `p${s.at}`,
      aiItems: s.ai,
      ...(s.retries ? { retries: s.retries } : {}),
      ...(s.corrections ? { corrections: s.corrections } : {}),
      ...(s.saved ? { savedLabel: edited || s.corrections ? "corrected" : "accurate", savedItems: s.saved, diff } : {}),
      ...(s.timing ? { serverTiming: s.timing } : {}),
      ...(s.tooMany ? { tooMany: true } : {}),
      ...(s.repaired ? { repaired: true } : {}),
    }),
  };
}

const at = (hour: number, minute = 0) => START + (hour * 60 + minute) * 60_000;

const sessions: Session[] = [
  // Saved as answered.
  { at: at(8), ai: [item("Nasi putih", 200, 260)], saved: [item("Nasi putih", 200, 260)], timing: { aiMs: 4000, totalMs: 5000 } },
  { at: at(9), ai: [item("Soto", 300, 200)], saved: [item("Soto", 300, 200)], timing: { aiMs: 6000, totalMs: 7000 } },
  // Renamed perkedel -> rolade, three times (the rename keeps the weight).
  ...[10, 11, 12].map((h): Session => ({
    at: at(h),
    ai: [item("Perkedel", 80, 150)],
    saved: [item("Rolade", 82, 160)],
    timing: { aiMs: 8000, totalMs: 9000 },
    repaired: h === 10,
  })),
  // Nasi goreng: AI grams 280 vs saved 200 (+40%), four scans of it.
  ...[13, 14, 15, 16].map((h): Session => ({
    at: at(h),
    ai: [item("Nasi goreng", 280, 560)],
    saved: [item("Nasi goreng", 200, 400)],
    timing: { aiMs: 10_000, totalMs: 12_000 },
    tooMany: h === 13,
  })),
  // Kerupuk removed twice, sambal added once.
  { at: at(17), ai: [item("Nasi putih", 200, 260), item("Kerupuk", 20, 70)], saved: [item("Nasi putih", 200, 260)] },
  { at: at(18), ai: [item("Soto", 300, 200), item("Kerupuk", 20, 70)], saved: [item("Soto", 300, 200), item("Sambal", 5, 20)] },
  // A retry, and a correction by text.
  { at: at(19), ai: [item("Mie", 150, 300)], retries: 1 },
  { at: at(20), ai: [item("Ayam", 100, 250)], saved: [item("Ayam", 100, 250)], corrections: 1 },
  // Never saved, older than an hour at NOW: abandoned.
  { at: at(21), ai: [item("Tempe", 50, 100)] },
];

const priorDays = [
  { day: "2026-10-15", outcomes: { ...emptyOutcomes(), accurate: 8, corrected: 2 } },
  { day: "2026-10-14", outcomes: { ...emptyOutcomes(), accurate: 4, corrected: 4, retried: 2 } },
  // Outside the 7-day window: ignored.
  { day: "2026-10-01", outcomes: { ...emptyOutcomes(), accurate: 99 } },
];

const failed: LedgerRow[] = [
  { createdAt: at(9), model: "m", usageJson: JSON.stringify({ reason: "timeout" }) },
  { createdAt: at(10), model: "m", usageJson: JSON.stringify({ reason: "timeout" }) },
  { createdAt: at(11), model: "m", usageJson: JSON.stringify({ reason: "not_food" }) },
];
const corrections: LedgerRow[] = [
  { createdAt: at(20), model: "m", usageJson: JSON.stringify({ outcome: "ok" }) },
  { createdAt: at(21), model: "m", usageJson: JSON.stringify({ outcome: "voice_empty" }) },
];

const feedback = [
  { rating: "akurat", reasonsJson: null, note: null, createdAt: at(9) },
  { rating: "salah", reasonsJson: JSON.stringify(["makanan"]), note: "  ini rolade, bukan perkedel ", createdAt: at(10) },
  { rating: "kurang_akurat", reasonsJson: JSON.stringify(["retry_tap"]), note: null, createdAt: at(11) },
  { rating: "dilewati", reasonsJson: null, note: null, createdAt: at(12) },
];

const weekDiffs = [
  ...sessions
    .filter((s) => s.saved)
    .map((s) => scanDiff(s.ai, s.saved!))
    .filter((d) => d.renamed.length + d.removed.length + d.added.length + d.changed.length > 0),
  // Earlier in the week: two more perkedel -> rolade and one more nasi goreng.
  scanDiff([item("Perkedel", 80, 150)], [item("Rolade", 80, 150)]),
  scanDiff([item("Perkedel", 80, 150)], [item("Rolade", 80, 150)]),
];

const report = buildAccuracyReport({
  date: DATE,
  nowMs: NOW,
  scans: sessions.map(ledger),
  priorDays,
  weekDiffs,
  failed,
  corrections,
  feedback,
});

describe("buildAccuracyReport: scans and outcomes", () => {
  test("counts every outcome of the day", () => {
    expect(report.scans.total).toBe(sessions.length);
    expect(report.scans.outcomes).toEqual({ accurate: 2, corrected: 10, retried: 1, abandoned: 1, pending: 0 });
    // 2 accurate of 13 resolved.
    expect(report.scans.resolved).toBe(13);
    expect(report.scans.accurateRate).toBeCloseTo(2 / 13, 5);
  });

  test("7-day trend: oldest first, prior days from the counts, window edges respected", () => {
    expect(report.scans.trend.map((d) => d.day)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);
    const byDay = Object.fromEntries(report.scans.trend.map((d) => [d.day, d]));
    expect(byDay["2026-10-15"]).toEqual({ day: "2026-10-15", resolved: 10, accurate: 8, rate: 0.8 });
    expect(byDay["2026-10-14"]).toMatchObject({ resolved: 10, accurate: 4, rate: 0.4 });
    expect(byDay["2026-10-12"]).toEqual({ day: "2026-10-12", resolved: 0, accurate: 0, rate: null });
    // The 2026-10-01 row is outside the window: 2 + 8 + 4 accurate of 13 + 10 + 10 resolved.
    expect(report.scans.weekRate).toBeCloseTo(14 / 33, 5);
  });
});

describe("buildAccuracyReport: dishes", () => {
  test("rename pairs (AI name → saved name) with counts", () => {
    expect(report.dishes.renames[0]).toEqual({ from: "perkedel", to: "rolade", n: 3 });
  });

  test("most removed and most added items", () => {
    expect(report.dishes.removed[0]).toEqual({ name: "kerupuk", n: 2 });
    expect(report.dishes.added).toEqual([{ name: "sambal", n: 1 }]);
  });

  test("grams and kcal bias per dish: signed mean, over vs under", () => {
    const nasiGoreng = report.bias.dishes.find((d) => d.name === "nasi goreng");
    expect(nasiGoreng).toEqual({ name: "nasi goreng", n: 4, over: 4, under: 0, gramsPct: 40, kcalPct: 40 });
    expect(report.bias.kcal.n).toBe(10);
    expect(report.bias.kcal.over).toBeGreaterThan(0);
  });

  test("top problems read like the email lines, most frequent first", () => {
    expect(report.problems.length).toBeLessThanOrEqual(5);
    expect(report.problems.map((p) => p.text)).toContain("perkedel → rolade ×3");
    expect(report.problems.map((p) => p.text)).toContain("nasi goreng gram +40% di 4 scan");
    expect(report.problems[0]!.n).toBeGreaterThanOrEqual(report.problems.at(-1)!.n);
  });

  test("suggestions come from the week and name the evidence; none from thin data", () => {
    const texts = report.suggestions.map((s) => s.text);
    expect(texts).toContain('Tambah alias: "perkedel" → "rolade"');
    expect(texts).toContain("Turunkan gram default nasi goreng");
    // sambal (1 scan) and kerupuk (2 scans) are under the threshold.
    expect(texts.some((t) => t.includes("sambal") || t.includes("kerupuk"))).toBe(false);
    const alias = report.suggestions.find((s) => s.kind === "alias")!;
    expect(alias.evidence).toContain("5 scan");
  });
});

describe("buildAccuracyReport: ratings, health, latency, corrections", () => {
  test("explicit ratings exclude dismissals and retry taps; notes are trimmed, with no user fields", () => {
    expect(report.ratings).toMatchObject({ total: 2, akurat: 1, kurang: 0, salah: 1, retryTaps: 1 });
    expect(report.ratings.notes).toEqual([
      { rating: "salah", reasons: ["makanan"], note: "ini rolade, bukan perkedel" },
    ]);
  });

  test("failed by reason, too many, repaired", () => {
    expect(report.health.failed).toEqual({ total: 3, byReason: { timeout: 2, not_food: 1 } });
    expect(report.health.tooMany).toBe(1);
    expect(report.health.repaired).toBe(1);
  });

  test("latency percentiles come from the stage timings", () => {
    // aiMs of the 9 scans that have timings: 4000, 6000, 8000 x3, 10000 x4.
    expect(report.latency.aiMs).toEqual({ n: 9, p50: 8000, p95: 10_000 });
    expect(report.latency.ttftMs).toEqual({ n: 0, p50: null, p95: null });
  });

  test("correction usage", () => {
    expect(report.corrections).toEqual({ used: 2, failed: 1, sessions: 1 });
  });

  test("the report holds no user identifiers", () => {
    const json = JSON.stringify(report);
    expect(json).not.toContain("photoId");
    expect(json).not.toMatch(/@|userId/);
  });
});

describe("buildAccuracyReport: an empty day", () => {
  test("zero scans: zero counts, null rates, no problems", () => {
    const empty = buildAccuracyReport({
      date: DATE,
      nowMs: NOW,
      scans: [],
      priorDays: [],
      weekDiffs: [],
      failed: [],
      corrections: [],
      feedback: [],
    });
    expect(empty.scans.total).toBe(0);
    expect(empty.scans.accurateRate).toBeNull();
    expect(empty.problems).toEqual([]);
    expect(empty.latency.aiMs.p50).toBeNull();
    expect(accuracyReportSummary(empty).total).toBe(0);
  });
});

const result = (id: string, ai: number, truth: number, tp: number, aiKcal: number, truthKcal: number): RegressionCaseResult => ({
  id,
  group: "owner",
  ok: true,
  tp,
  ai,
  truth,
  aiKcal,
  truthKcal,
  ms: 3000,
});

describe("regression scoring", () => {
  test("name matches and plate kcal against the saved truth", () => {
    const scored = scoreRegressionCase(
      { id: "a", group: "owner" },
      [
        { name: "nasi goreng", kcal: 500 },
        { name: "krupuk udang", kcal: 50 },
      ],
      [
        { name: "Nasi Goreng", kcal: 600 },
        { name: "telur ceplok", kcal: 90 },
      ],
      1200,
    );
    expect(scored).toMatchObject({ ok: true, tp: 1, ai: 2, truth: 2, aiKcal: 550, truthKcal: 690, ms: 1200 });
  });

  test("summary: micro F1, kcal shortfall only counts under-estimates, failures apart", () => {
    const summary = summarizeRegression([
      result("a", 2, 2, 2, 400, 500), // 20% short
      result("b", 1, 1, 1, 600, 500), // 20% high: no shortfall
      failedRegressionCase({ id: "c", group: "feedback" }, 100),
    ]);
    expect(summary).toMatchObject({ cases: 2, failed: 1, precision: 1, recall: 1, f1: 1 });
    expect(summary.shortfallPct).toBe(10);
    expect(summary.signedPct).toBe(0);
  });
});

describe("compareRegression", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const run = (tp: number, aiKcal: number) => ids.map((id) => result(id, 2, 2, tp, aiKcal, 500));

  test("name accuracy down and kcal under-estimate up are flagged", () => {
    const { comparison, flags } = compareRegression(run(1, 400), { date: "2026-10-15", results: run(2, 480) });
    expect(comparison).toMatchObject({ prevDate: "2026-10-15", common: 10, f1Prev: 1, f1Now: 0.5 });
    expect(flags).toHaveLength(2);
    expect(flags[0]).toBe("Akurasi nama turun: 100% → 50% (10 foto sama dengan 2026-10-15)");
    expect(flags[1]).toContain("Kalori terlalu rendah naik: rata-rata kurang 4% → 20%");
  });

  test("small moves are not flagged", () => {
    expect(compareRegression(run(2, 475), { date: "2026-10-15", results: run(2, 480) }).flags).toEqual([]);
  });

  test("too few shared cases means no comparison", () => {
    const prev = { date: "2026-10-15", results: ids.slice(0, 7).map((id) => result(id, 2, 2, 2, 500, 500)) };
    expect(compareRegression(run(0, 100), prev)).toEqual({ comparison: null, flags: [] });
    expect(compareRegression(run(0, 100), null)).toEqual({ comparison: null, flags: [] });
  });
});

describe("orderRegressionCandidates", () => {
  const keys = Array.from({ length: 100 }, (_, i) => `dataset/u/${i}`);

  test("the anchor half is the same every day; the rest rotates and covers everything", () => {
    const day1 = orderRegressionCandidates(keys, 1, 40);
    const day2 = orderRegressionCandidates(keys, 2, 40);
    expect(day1.slice(0, 20)).toEqual(day2.slice(0, 20));
    expect(day1.slice(20, 40)).not.toEqual(day2.slice(20, 40));
    expect(new Set(day1).size).toBe(100);
    // Four days of 20 rotating slots walk the 80 non-anchor cases once.
    const seen = new Set<string>();
    for (let day = 0; day < 4; day++) {
      for (const key of orderRegressionCandidates(keys, day, 40).slice(20, 40)) seen.add(key);
    }
    expect(seen.size).toBe(80);
  });

  test("fewer cases than the cap: all of them, in a stable order", () => {
    const few = keys.slice(0, 5);
    expect(orderRegressionCandidates(few, 3, 40).sort()).toEqual([...few].sort());
    expect(orderRegressionCandidates(few, 3, 40)).toEqual(orderRegressionCandidates([...few].reverse(), 9, 40));
  });

  test("case ids are anonymous and stable", () => {
    expect(caseId("dataset/u/1")).toBe(caseId("dataset/u/1"));
    expect(caseId("dataset/u/1")).toMatch(/^[0-9a-f]{8}$/);
    expect(caseId("dataset/u/1")).not.toContain("dataset");
  });
});

describe("buildAccuracyReport: scans without a session record", () => {
  const legacy = (hour: number, aiMs: number): LedgerRow => ({
    createdAt: at(hour),
    model: "m",
    usageJson: JSON.stringify({ serverTiming: { aiMs, totalMs: aiMs + 500 }, tooMany: hour === 9 }),
  });
  const mixed = buildAccuracyReport({
    date: DATE,
    nowMs: NOW,
    scans: [legacy(9, 3000), legacy(10, 5000), ledger(sessions[0]!)],
    priorDays: [],
    weekDiffs: [],
    failed: [],
    corrections: [],
    feedback: [],
  });

  test("count in the total, the latency and the health numbers, but have no outcome", () => {
    expect(mixed.scans).toMatchObject({ total: 3, labelled: 1, resolved: 1 });
    expect(mixed.scans.outcomes.accurate).toBe(1);
    expect(mixed.latency.aiMs.n).toBe(3);
    expect(mixed.health.tooMany).toBe(1);
  });

  test("a day of only such scans has no accurate rate", () => {
    const only = buildAccuracyReport({
      date: DATE,
      nowMs: NOW,
      scans: [legacy(9, 3000), legacy(10, 5000)],
      priorDays: [],
      weekDiffs: [],
      failed: [],
      corrections: [],
      feedback: [],
    });
    expect(only.scans).toMatchObject({ total: 2, labelled: 0, resolved: 0, accurateRate: null });
    expect(accuracyReportSummary(only)).toMatchObject({ total: 2, labelled: 0 });
  });
});
