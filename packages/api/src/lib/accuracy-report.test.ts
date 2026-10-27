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
  photoRates,
  scoreRegressionCase,
  summarizeRegression,
} from "./accuracy-report";
import type { LedgerRow, RegressionCaseResult, WindowScan } from "./accuracy-report";
import { editOf, scanDiff } from "./scan-outcome";
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

describe("photoRates: every photo scan, one voice per user", () => {
  const SAME = [item("Nasi putih", 200, 260)];
  const unchanged = (userId: string, hour: number): WindowScan => ({
    userId,
    createdAt: at(hour),
    session: { savedLabel: "accurate", diff: scanDiff(SAME, SAME), edit: editOf(scanDiff(SAME, SAME)) },
  });
  const unsaved = (userId: string, hour: number): WindowScan => ({ userId, createdAt: at(hour), session: {} });
  const edited = (
    userId: string,
    hour: number,
    saved: CompactItem[],
    extra: Partial<WindowScan["session"]> = {},
  ): WindowScan => {
    const diff = scanDiff(SAME, saved);
    return {
      userId,
      createdAt: at(hour),
      session: { savedLabel: "corrected", diff, edit: editOf(diff, extra.altTaps), ...extra },
    };
  };

  test("scans that were never saved stay in the denominator of the headline, not of the saved-only rate", () => {
    const rates = photoRates(
      [unchanged("a", 8), unchanged("a", 9), edited("a", 10, [item("Nasi putih", 100, 130)]), unsaved("a", 11), unsaved("a", 12)],
      NOW,
    );
    expect(rates).toMatchObject({ scans: 5, resolved: 3, saved: 3, unchanged: 2 });
    expect(rates.unchangedOfAll).toBeCloseTo(2 / 5, 4);
    expect(rates.unchangedOfResolved).toBeCloseTo(2 / 3, 4);
  });

  test("a wrong first answer fixed in place instead of retaken moves the saved-only rate, not the headline", () => {
    const retaken = [unchanged("a", 8), unsaved("a", 9), unchanged("a", 10), unsaved("a", 11)];
    const fixed = [unchanged("a", 8), edited("a", 9, [item("Nasi putih", 100, 130)]), unchanged("a", 10), edited("a", 11, [item("Nasi putih", 100, 130)])];
    const before = photoRates(retaken, NOW);
    const after = photoRates(fixed, NOW);
    expect(before.unchangedOfAll).toBe(after.unchangedOfAll);
    expect(before.unchangedOfResolved).toBe(1);
    expect(after.unchangedOfResolved).toBe(0.5);
  });

  test("scans younger than the abandon window are not judged yet", () => {
    const rates = photoRates([unchanged("a", 8), { userId: "a", createdAt: NOW - 60_000, session: {} }], NOW);
    expect(rates.scans).toBe(1);
    expect(rates.unchangedOfAll).toBe(1);
  });

  test("one heavy user cannot move the by-user rate, and the report says how many users and how big the biggest is", () => {
    const heavy = Array.from({ length: 12 }, (_, i) => unchanged("heavy", 8 + (i % 8)));
    const others = [
      unsaved("b", 9),
      edited("b", 10, [item("Nasi putih", 100, 130)]),
      unsaved("c", 9),
      edited("c", 10, [item("Nasi putih", 100, 130)]),
    ];
    const rates = photoRates([...heavy, ...others], NOW);
    expect(rates.users).toBe(3);
    expect(rates.topUserShare).toBeCloseTo(12 / 16, 4);
    expect(rates.unchangedOfAll).toBeCloseTo(12 / 16, 4);
    // heavy 100%, b 0%, c 0%
    expect(rates.unchangedOfAllByUser).toBeCloseTo(1 / 3, 4);
    const without = photoRates(others, NOW);
    expect(without.unchangedOfAllByUser).toBe(0);
    // the heavy user moves the by-user rate by their one voice, not twelve
    expect(rates.unchangedOfAllByUser! - without.unchangedOfAllByUser!).toBeCloseTo(1 / 3, 4);
  });

  test("grams-only and chip-only edits are not identity corrections; renames and removals are", () => {
    const gramsOnly = edited("a", 8, [item("Nasi putih", 100, 130)]);
    const renamed = edited("a", 9, [item("Nasi uduk", 205, 270)]);
    const removed = edited("a", 10, [item("Telur", 50, 80)]);
    const altTap = edited("a", 11, [item("Nasi uduk", 200, 260)], { corrections: 1, altTaps: [{ f: "Nasi putih", t: "Nasi uduk" }] });
    const rates = photoRates([gramsOnly, renamed, removed, altTap, unchanged("a", 12)], NOW);
    expect(rates.saved).toBe(5);
    expect(rates.identityEdits).toBe(2);
    expect(rates.gramsEdits).toBe(2);
    expect(rates.identityRate).toBeCloseTo(2 / 5, 4);
    expect(rates.gramsEditRate).toBeCloseTo(2 / 5, 4);
    expect(rates.sources).toEqual({ typed: 1, alt: 1 });
  });

  test("the sources a save recorded are counted per scan", () => {
    const diff = scanDiff(SAME, [item("Nasi putih", 100, 130)]);
    const chip: WindowScan = {
      userId: "a",
      createdAt: at(8),
      session: { savedLabel: "corrected", diff, edit: editOf(diff, [], new Map([["nasiputih", ["prior"]]])) },
    };
    const rates = photoRates([chip, chip], NOW);
    expect(rates.sources).toEqual({ prior: 2 });
    expect(rates.identityRate).toBe(0);
    expect(rates.gramsEditRate).toBe(1);
  });

  test("saves from before the edit kind was stored are classified from their diff", () => {
    const diff = scanDiff(SAME, [item("Nasi uduk", 205, 270)]);
    const rates = photoRates([{ userId: "a", createdAt: at(8), session: { savedLabel: "corrected", diff } }], NOW);
    expect(rates.identityEdits).toBe(1);
  });

  test("an empty window has null rates", () => {
    expect(photoRates([], NOW)).toMatchObject({ scans: 0, users: 0, topUserShare: null, unchangedOfAll: null, unchangedOfAllByUser: null, identityRate: null });
  });
});

describe("buildAccuracyReport: photo blocks", () => {
  const base = { date: DATE, nowMs: NOW, scans: [ledger(sessions[0]!)], priorDays: [], weekDiffs: [], failed: [], corrections: [], feedback: [] };

  test("day and week come from the window; scans of other days stay out of the day", () => {
    const window: WindowScan[] = [
      { userId: "a", createdAt: at(8), session: { savedLabel: "accurate" } },
      { userId: "b", createdAt: at(9), session: {} },
      { userId: "a", createdAt: START - 60_000, session: {} },
    ];
    const report = buildAccuracyReport({ ...base, window });
    expect(report.scans.photo).toMatchObject({ scans: 2, users: 2, unchanged: 1 });
    expect(report.scans.weekPhoto).toMatchObject({ scans: 3, users: 2, unchanged: 1 });
    expect(accuracyReportSummary(report).photo).toMatchObject({ scans: 2, unchangedOfAll: 0.5 });
  });

  test("without a window the report is the old shape", () => {
    const report = buildAccuracyReport(base);
    expect("photo" in report.scans).toBe(false);
    expect("photo" in accuracyReportSummary(report)).toBe(false);
  });
});
