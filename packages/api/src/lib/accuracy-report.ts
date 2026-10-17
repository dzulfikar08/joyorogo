// Daily accuracy digest: the pure part. Takes the ai_usage / scan_feedback rows
// of one WIB day (plus the 7 days before it for the trend) and builds the JSON
// report the Worker stores in R2 (reports/accuracy/<date>.json), the email and
// the admin "Laporan" tab all read. No I/O here: apps/server/src/accuracy-job.ts
// does the queries, the R2 writes, the regression run and the mail.
//
// Reports carry dish names, counts and percentages only: no user id, name,
// email or photo id. Everything under `suggestions` is advice for a human; no
// code path turns it into a prompt, calibration or alias change.
import { shiftDate } from "./engine";
import { pairItems } from "./scan-match";
import type { MatchItem } from "./scan-match";
import {
  isRetryDerivedFeedback,
  parseFeedbackReasons,
  parseSession,
  scanOutcome,
} from "./scan-outcome";
import type { ScanDiff, ScanOutcome, ScanSession } from "./scan-outcome";

export const REPORT_VERSION = 1;
export const REPORT_PREFIX = "reports/accuracy/";
export const reportKey = (date: string) => `${REPORT_PREFIX}${date}.json`;

/** Days of trend in a report, the report day included. */
const TREND_DAYS = 7;
/** Thresholds for the problem list and the suggestions. A dish needs this many scans to count as biased. */
const BIAS_MIN_SCANS = 2;
const BIAS_MIN_PCT = 15;
const SUGGEST_MIN_SCANS = 3;
const SUGGEST_GRAMS_PCT = 25;
const TOP_LIST = 10;
const TOP_PROBLEMS = 5;
const NOTE_MAX_CHARS = 300;
const NOTES_MAX = 20;

export type Outcomes = Record<ScanOutcome, number>;

/** An ai_usage row, as the report builder needs it. */
export type LedgerRow = { createdAt: number; model: string; usageJson: string | null };
/** A scan_feedback row, as the report builder needs it. */
export type FeedbackRow = {
  rating: string;
  reasonsJson: string | null;
  note: string | null;
  createdAt: number;
};

/** What ledger usage_json holds beyond the scan session fields. */
type LedgerUsage = ScanSession & {
  serverTiming?: Partial<Record<TimingStage, number>>;
  tooMany?: boolean;
  repaired?: boolean;
  /** failed rows: why; correction rows: "ok" or the failure reason. */
  reason?: string;
  outcome?: string;
};

const TIMING_STAGES = ["receiveMs", "quotaMs", "aiMs", "ttftMs", "totalMs"] as const;
type TimingStage = (typeof TIMING_STAGES)[number];

export type TrendDay = {
  day: string;
  /** accurate + corrected + retried. */
  resolved: number;
  accurate: number;
  /** accurate / resolved, 0..1; null with no resolved scans. */
  rate: number | null;
};

export type DishBias = {
  name: string;
  /** Corrected scans where this dish's grams or kcal moved. */
  n: number;
  /** Scans where the AI ran above / below what was saved. */
  over: number;
  under: number;
  /** Signed mean, % of the saved value; positive = the AI ran high. */
  gramsPct: number | null;
  kcalPct: number | null;
};

export type Stat = { n: number; p50: number | null; p95: number | null };

export type Problem = {
  kind: "rename" | "removed" | "added" | "bias";
  text: string;
  n: number;
};

export type Suggestion = {
  kind: "alias" | "grams" | "missed" | "false_item";
  text: string;
  evidence: string;
};

/** One labelled photo re-run through the current pipeline. `id` is a hash, never a user or photo id. */
export type RegressionCaseResult = {
  id: string;
  group: "owner" | "feedback";
  ok: boolean;
  /** Items matched by name / answered / in the saved truth. */
  tp: number;
  ai: number;
  truth: number;
  aiKcal: number;
  truthKcal: number;
  ms: number;
};

export type RegressionSummary = {
  cases: number;
  failed: number;
  /** Micro name precision / recall / F1, 0..1; null with nothing scored. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Mean kcal shortfall, % of the saved plate (0 when the AI ran at or above it): the under-estimate. */
  shortfallPct: number | null;
  /** Mean signed plate kcal error, %; positive = the AI ran high. */
  signedPct: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type RegressionComparison = {
  prevDate: string;
  /** Cases present and answered in both runs: the only ones compared. */
  common: number;
  f1Prev: number;
  f1Now: number;
  shortfallPrev: number;
  shortfallNow: number;
};

export type RegressionReport = {
  /** Most photos one day may run. */
  cap: number;
  /** Labelled photos available in R2 (owner dataset + consented feedback) when the run started. */
  candidates: number;
  summary: RegressionSummary;
  results: RegressionCaseResult[];
  comparison: RegressionComparison | null;
  /** Human-readable regressions (Indonesian). */
  flags: string[];
  /** Why the run did not happen or stopped early. */
  error?: string;
};

export type EmailState = {
  status: "sent" | "skipped_no_scans" | "off" | "failed";
  attempts: number;
  at: number;
  detail?: string;
};

export type AccuracyReport = {
  version: typeof REPORT_VERSION;
  /** The WIB day the report covers. */
  date: string;
  generatedAt: number;
  scans: {
    total: number;
    outcomes: Outcomes;
    /** accurate + corrected + retried. */
    resolved: number;
    /** "Tanpa koreksi": accurate / resolved, 0..1. */
    accurateRate: number | null;
    /** Oldest first; the last entry is `date`. */
    trend: TrendDay[];
    /** Accurate rate over the whole trend window. */
    weekRate: number | null;
  };
  ratings: {
    total: number;
    akurat: number;
    kurang: number;
    salah: number;
    /** "Hitung ulang" taps recorded as feedback: not ratings. */
    retryTaps: number;
    notes: Array<{ rating: string; reasons: string[]; note: string }>;
  };
  dishes: {
    renames: Array<{ from: string; to: string; n: number }>;
    removed: Array<{ name: string; n: number }>;
    added: Array<{ name: string; n: number }>;
  };
  bias: {
    /** Plate-level kcal of corrected scans, same math as the admin Feedback tab. */
    kcal: { n: number; over: number; under: number; meanPct: number | null };
    dishes: DishBias[];
  };
  health: {
    failed: { total: number; byReason: Record<string, number> };
    tooMany: number;
    /** Scans whose model JSON needed repair (recorded since the repair counter shipped). */
    repaired: number;
  };
  latency: Record<TimingStage, Stat>;
  corrections: {
    /** Typed/spoken fixes asked for (correction ledger rows), and how many of them failed. */
    used: number;
    failed: number;
    /** Scan sessions that got at least one successful correction. */
    sessions: number;
  };
  problems: Problem[];
  suggestions: Suggestion[];
  regression: RegressionReport | null;
  email: EmailState | null;
};

export type ReportInput = {
  /** WIB day to report. */
  date: string;
  nowMs: number;
  /** Photo-scan ledger rows (scan_type "user") created on `date`. */
  scans: readonly LedgerRow[];
  /** Outcome counts per WIB day for the days before `date` in the trend window (outcomeSql, grouped by day). */
  priorDays: ReadonlyArray<{ day: string; outcomes: Outcomes }>;
  /** Diffs of every corrected scan in the trend window, `date` included (the suggestions' evidence). */
  weekDiffs: readonly ScanDiff[];
  /** scan_type "failed" rows of `date`. */
  failed: readonly LedgerRow[];
  /** scan_type "correction" rows of `date`. */
  corrections: readonly LedgerRow[];
  /** scan_feedback rows of `date`. */
  feedback: readonly FeedbackRow[];
};

export const emptyOutcomes = (): Outcomes => ({
  accurate: 0,
  corrected: 0,
  retried: 0,
  abandoned: 0,
  pending: 0,
});

export const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+07:00`);

export const resolvedOf = (o: Outcomes) => o.accurate + o.corrected + o.retried;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Nearest-rank percentile, integer ms. */
function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!);
}

function stat(values: number[]): Stat {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

const meanOf = (xs: readonly number[]) =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Case-folded, single-spaced dish name: one key for "Nasi Goreng " and "nasi  goreng". */
export const dishKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

type Session = { createdAt: number; usage: LedgerUsage };

function sessionsOf(rows: readonly LedgerRow[]): Session[] {
  return rows.flatMap((row) => {
    const usage = parseSession(row.usageJson) as LedgerUsage | null;
    return usage ? [{ createdAt: row.createdAt, usage }] : [];
  });
}

type DishTally = {
  renames: Map<string, { from: string; to: string; n: number }>;
  removed: Map<string, number>;
  added: Map<string, number>;
  bias: Map<string, { grams: number[]; kcal: number[]; n: number; over: number; under: number }>;
  kcal: { pct: number[]; over: number; under: number };
};

/** Dish-level changes across the diffs of scans the user saved with edits. */
function tallyDishes(diffs: readonly ScanDiff[]): DishTally {
  const tally: DishTally = {
    renames: new Map(),
    removed: new Map(),
    added: new Map(),
    bias: new Map(),
    kcal: { pct: [], over: 0, under: 0 },
  };
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const diff of diffs) {
    for (const { from, to } of diff.renamed) {
      const a = dishKey(from.n);
      const b = dishKey(to.n);
      const key = `${a}\u0000${b}`;
      const entry = tally.renames.get(key) ?? { from: a, to: b, n: 0 };
      entry.n += 1;
      tally.renames.set(key, entry);
    }
    for (const item of diff.removed) bump(tally.removed, dishKey(item.n));
    for (const item of diff.added) bump(tally.added, dishKey(item.n));
    for (const change of diff.changed) {
      const key = dishKey(change.n);
      const entry = tally.bias.get(key) ?? { grams: [], kcal: [], n: 0, over: 0, under: 0 };
      // Signed % of what the user saved: positive = the AI ran high.
      const pct = (pair: [number, number] | undefined) =>
        pair && pair[1] > 0 ? ((pair[0] - pair[1]) * 100) / pair[1] : null;
      const grams = pct(change.g);
      const kcal = pct(change.k);
      if (grams === null && kcal === null) continue;
      if (grams !== null) entry.grams.push(grams);
      if (kcal !== null) entry.kcal.push(kcal);
      const lead = kcal ?? grams!;
      entry.n += 1;
      if (lead > 0) entry.over += 1;
      else if (lead < 0) entry.under += 1;
      tally.bias.set(key, entry);
    }
    if (diff.savedKcal > 0) {
      const pct = ((diff.aiKcal - diff.savedKcal) * 100) / diff.savedKcal;
      tally.kcal.pct.push(pct);
      if (pct > 0) tally.kcal.over += 1;
      else if (pct < 0) tally.kcal.under += 1;
    }
  }
  return tally;
}

const byCountThenName = <T extends { n: number }>(label: (x: T) => string) =>
  (a: T, b: T) => b.n - a.n || label(a).localeCompare(label(b));

function topCounts(map: Map<string, number>): Array<{ name: string; n: number }> {
  return [...map]
    .map(([name, n]) => ({ name, n }))
    .sort(byCountThenName((x) => x.name))
    .slice(0, TOP_LIST);
}

function biasList(tally: DishTally): DishBias[] {
  const pct = (xs: number[]) => {
    const m = meanOf(xs);
    return m === null ? null : Math.round(m);
  };
  return [...tally.bias]
    .map(([name, e]) => ({
      name,
      n: e.n,
      over: e.over,
      under: e.under,
      gramsPct: pct(e.grams),
      kcalPct: pct(e.kcal),
    }))
    .sort(byCountThenName((x) => x.name));
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
/** The bias figure a dish is judged by: grams when the AI was asked for them, else kcal. */
const leadPct = (b: DishBias) => b.gramsPct ?? b.kcalPct;

/** Today's top problems in one list: renames, most removed, most missed, biased dishes. */
function problemsOf(tally: DishTally, bias: readonly DishBias[]): Problem[] {
  const out: Problem[] = [];
  for (const r of tally.renames.values()) {
    out.push({ kind: "rename", n: r.n, text: `${r.from} → ${r.to} ×${r.n}` });
  }
  for (const [name, n] of tally.removed) {
    out.push({ kind: "removed", n, text: `${name} dihapus ×${n}` });
  }
  for (const [name, n] of tally.added) {
    out.push({ kind: "added", n, text: `${name} terlewat ×${n}` });
  }
  for (const b of bias) {
    const pct = leadPct(b);
    if (b.n < BIAS_MIN_SCANS || pct === null || Math.abs(pct) < BIAS_MIN_PCT) continue;
    const what = b.gramsPct !== null ? "gram" : "kalori";
    out.push({ kind: "bias", n: b.n, text: `${b.name} ${what} ${signed(pct)} di ${b.n} scan` });
  }
  return out.sort(byCountThenName((x) => x.text)).slice(0, TOP_PROBLEMS);
}

/** Advice from the whole trend window (a day alone is too thin). Humans act on it; nothing does automatically. */
function suggestionsOf(week: DishTally): Suggestion[] {
  const out: Suggestion[] = [];
  const evidence = (n: number) => `${n} scan, ${TREND_DAYS} hari terakhir`;
  for (const r of [...week.renames.values()].sort(byCountThenName((x) => x.to))) {
    if (r.n < SUGGEST_MIN_SCANS) continue;
    out.push({
      kind: "alias",
      text: `Tambah alias: "${r.from}" → "${r.to}"`,
      evidence: `AI menyebut ${r.from}, pengguna menyimpan ${r.to}; ${evidence(r.n)}`,
    });
  }
  for (const b of biasList(week)) {
    if (b.n < SUGGEST_MIN_SCANS || b.gramsPct === null || Math.abs(b.gramsPct) < SUGGEST_GRAMS_PCT) {
      continue;
    }
    const high = b.gramsPct > 0;
    out.push({
      kind: "grams",
      text: `${high ? "Turunkan" : "Naikkan"} gram default ${b.name}`,
      evidence: `gram AI rata-rata ${signed(b.gramsPct)} dari yang disimpan; ${evidence(b.n)}`,
    });
  }
  for (const { name, n } of topCounts(week.added)) {
    if (n < SUGGEST_MIN_SCANS) continue;
    out.push({
      kind: "missed",
      text: `AI sering melewatkan ${name}`,
      evidence: `ditambah manual; ${evidence(n)}`,
    });
  }
  for (const { name, n } of topCounts(week.removed)) {
    if (n < SUGGEST_MIN_SCANS) continue;
    out.push({
      kind: "false_item",
      text: `AI sering salah menambah ${name}`,
      evidence: `dihapus pengguna; ${evidence(n)}`,
    });
  }
  return out;
}

/** The accuracy report for one WIB day. Pure: every number comes from the rows given. */
export function buildAccuracyReport(input: ReportInput): AccuracyReport {
  const { date, nowMs } = input;
  const sessions = sessionsOf(input.scans);

  // Outcomes per WIB day over the trend window: the report day from its rows,
  // the days before it as counted by the same outcome SQL the admin tab uses.
  const perDay = new Map<string, Outcomes>();
  for (let i = TREND_DAYS - 1; i >= 0; i--) perDay.set(shiftDate(date, -i), emptyOutcomes());
  for (const { day, outcomes: counts } of input.priorDays) {
    const bucket = perDay.get(day);
    if (bucket && day !== date) {
      for (const key of Object.keys(bucket) as ScanOutcome[]) bucket[key] += counts[key];
    }
  }
  const today = perDay.get(date)!;
  for (const s of sessions) today[scanOutcome(s.usage, s.createdAt, nowMs)] += 1;
  const trend: TrendDay[] = [...perDay].map(([day, o]) => ({
    day,
    resolved: resolvedOf(o),
    accurate: o.accurate,
    rate: ratio(o.accurate, resolvedOf(o)),
  }));
  const weekResolved = trend.reduce((s, d) => s + d.resolved, 0);
  const weekAccurate = trend.reduce((s, d) => s + d.accurate, 0);
  const outcomes = today;
  const resolved = resolvedOf(outcomes);

  const dayTally = tallyDishes(
    sessions.flatMap((s) => (s.usage.savedLabel === "corrected" && s.usage.diff ? [s.usage.diff] : [])),
  );
  const weekTally = tallyDishes(input.weekDiffs);
  const bias = biasList(dayTally);

  // Explicit ratings: dismissals and "Hitung ulang" taps are not ratings.
  let retryTaps = 0;
  const ratings = { total: 0, akurat: 0, kurang: 0, salah: 0 };
  const notes: AccuracyReport["ratings"]["notes"] = [];
  for (const row of input.feedback) {
    if (row.rating === "dilewati") continue;
    if (isRetryDerivedFeedback(row)) {
      retryTaps += 1;
      continue;
    }
    ratings.total += 1;
    if (row.rating === "akurat") ratings.akurat += 1;
    else if (row.rating === "kurang_akurat") ratings.kurang += 1;
    else if (row.rating === "salah") ratings.salah += 1;
    const note = row.note?.trim();
    if (note && notes.length < NOTES_MAX) {
      notes.push({
        rating: row.rating,
        reasons: parseFeedbackReasons(row.reasonsJson).reasons,
        note: note.slice(0, NOTE_MAX_CHARS),
      });
    }
  }

  const failedByReason: Record<string, number> = {};
  for (const s of sessionsOf(input.failed)) {
    const reason = s.usage.reason ?? "failed";
    failedByReason[reason] = (failedByReason[reason] ?? 0) + 1;
  }
  const correctionRows = sessionsOf(input.corrections);

  const latency = Object.fromEntries(
    TIMING_STAGES.map((stage) => [
      stage,
      stat(
        sessions.flatMap((s) => {
          const value = s.usage.serverTiming?.[stage];
          return typeof value === "number" && Number.isFinite(value) ? [value] : [];
        }),
      ),
    ]),
  ) as Record<TimingStage, Stat>;

  const kcalMean = meanOf(dayTally.kcal.pct);
  return {
    version: REPORT_VERSION,
    date,
    generatedAt: nowMs,
    scans: {
      total: sessions.length,
      outcomes,
      resolved,
      accurateRate: ratio(outcomes.accurate, resolved),
      trend,
      weekRate: ratio(weekAccurate, weekResolved),
    },
    ratings: { ...ratings, retryTaps, notes },
    dishes: {
      renames: [...dayTally.renames.values()]
        .sort(byCountThenName((x) => `${x.from}${x.to}`))
        .slice(0, TOP_LIST),
      removed: topCounts(dayTally.removed),
      added: topCounts(dayTally.added),
    },
    bias: {
      kcal: {
        n: dayTally.kcal.pct.length,
        over: dayTally.kcal.over,
        under: dayTally.kcal.under,
        meanPct: kcalMean === null ? null : round1(kcalMean),
      },
      dishes: bias.slice(0, TOP_LIST),
    },
    health: {
      failed: {
        total: Object.values(failedByReason).reduce((a, b) => a + b, 0),
        byReason: failedByReason,
      },
      tooMany: sessions.filter((s) => s.usage.tooMany).length,
      repaired: sessions.filter((s) => s.usage.repaired).length,
    },
    latency,
    corrections: {
      used: correctionRows.length,
      failed: correctionRows.filter((s) => s.usage.outcome !== undefined && s.usage.outcome !== "ok")
        .length,
      sessions: sessions.filter((s) => (s.usage.corrections ?? 0) > 0).length,
    },
    problems: problemsOf(dayTally, bias),
    suggestions: suggestionsOf(weekTally),
    regression: null,
    email: null,
  };
}

// ------------------------------------------------------------- regression

/** Cases that must overlap with the previous run before a drop counts as a regression. */
export const MIN_COMMON_CASES = 8;
/** Name F1 drop (0..1) and kcal shortfall rise (% points) that raise a flag. */
export const F1_DROP_FLAG = 0.05;
export const SHORTFALL_RISE_FLAG = 3;

/** FNV-1a, 8 hex chars: a stable anonymous case id and a stable sort order. */
export function caseId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The order the daily run tries cases in. The first half of the budget is a fixed
 * anchor (by hash), so two days always share cases to compare; the rest rotates
 * through everything else, `cap - anchor` further along each day, so the whole
 * set is covered over time. The caller takes the first `cap` usable ones.
 */
export function orderRegressionCandidates(
  keys: readonly string[],
  dayIndex: number,
  cap: number,
): string[] {
  const sorted = [...new Set(keys)].sort((a, b) => caseId(a).localeCompare(caseId(b)) || a.localeCompare(b));
  const anchorN = Math.min(sorted.length, Math.ceil(cap / 2));
  const anchor = sorted.slice(0, anchorN);
  const rest = sorted.slice(anchorN);
  if (rest.length === 0) return anchor;
  const window = Math.max(1, cap - anchorN);
  const at = (((dayIndex * window) % rest.length) + rest.length) % rest.length;
  return [...anchor, ...rest.slice(at), ...rest.slice(0, at)];
}

const plateKcal = (items: readonly MatchItem[]) => items.reduce((sum, item) => sum + item.kcal, 0);

/** Name matches and plate kcal of one pipeline answer against the saved truth. */
export function scoreRegressionCase(
  meta: { id: string; group: "owner" | "feedback" },
  answer: readonly MatchItem[],
  truth: readonly MatchItem[],
  ms: number,
): RegressionCaseResult {
  return {
    ...meta,
    ok: true,
    tp: pairItems(answer, truth).length,
    ai: answer.length,
    truth: truth.length,
    aiKcal: Math.round(plateKcal(answer)),
    truthKcal: Math.round(plateKcal(truth)),
    ms,
  };
}

export const failedRegressionCase = (
  meta: { id: string; group: "owner" | "feedback" },
  ms: number,
): RegressionCaseResult => ({ ...meta, ok: false, tp: 0, ai: 0, truth: 0, aiKcal: 0, truthKcal: 0, ms });

function f1Of(cases: readonly RegressionCaseResult[]) {
  const tp = cases.reduce((s, c) => s + c.tp, 0);
  const ai = cases.reduce((s, c) => s + c.ai, 0);
  const truth = cases.reduce((s, c) => s + c.truth, 0);
  const precision = ratio(tp, ai);
  const recall = ratio(tp, truth);
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : precision === null || recall === null
        ? null
        : 0;
  return { precision, recall, f1 };
}

/** Signed plate kcal error and shortfall, % of the saved plate. Plates with no saved kcal are skipped. */
function kcalErrors(cases: readonly RegressionCaseResult[]) {
  const pcts = cases
    .filter((c) => c.truthKcal > 0)
    .map((c) => ((c.aiKcal - c.truthKcal) * 100) / c.truthKcal);
  return { signed: meanOf(pcts), shortfall: meanOf(pcts.map((p) => Math.max(0, -p))) };
}

export function summarizeRegression(results: readonly RegressionCaseResult[]): RegressionSummary {
  const ok = results.filter((r) => r.ok);
  const { precision, recall, f1 } = f1Of(ok);
  const { signed: signedPct, shortfall } = kcalErrors(ok);
  const ms = stat(ok.map((r) => r.ms));
  return {
    cases: ok.length,
    failed: results.length - ok.length,
    precision,
    recall,
    f1,
    shortfallPct: shortfall === null ? null : round1(shortfall),
    signedPct: signedPct === null ? null : round1(signedPct),
    p50Ms: ms.p50,
    p95Ms: ms.p95,
  };
}

const pct0 = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Today's run against the previous one, on the cases both answered. Fewer than
 * MIN_COMMON_CASES in common means no comparison: a different sample says nothing.
 */
export function compareRegression(
  today: readonly RegressionCaseResult[],
  prev: { date: string; results: readonly RegressionCaseResult[] } | null,
): { comparison: RegressionComparison | null; flags: string[] } {
  if (!prev) return { comparison: null, flags: [] };
  const before = new Map(prev.results.filter((r) => r.ok).map((r) => [r.id, r]));
  const now = today.filter((r) => r.ok && before.has(r.id));
  if (now.length < MIN_COMMON_CASES) return { comparison: null, flags: [] };
  const was = now.map((r) => before.get(r.id)!);
  const f1Now = f1Of(now).f1 ?? 0;
  const f1Prev = f1Of(was).f1 ?? 0;
  const shortfallNow = round1(kcalErrors(now).shortfall ?? 0);
  const shortfallPrev = round1(kcalErrors(was).shortfall ?? 0);
  const flags: string[] = [];
  if (f1Prev - f1Now >= F1_DROP_FLAG) {
    flags.push(
      `Akurasi nama turun: ${pct0(f1Prev)} → ${pct0(f1Now)} (${now.length} foto sama dengan ${prev.date})`,
    );
  }
  if (shortfallNow - shortfallPrev >= SHORTFALL_RISE_FLAG) {
    flags.push(
      `Kalori terlalu rendah naik: rata-rata kurang ${shortfallPrev}% → ${shortfallNow}% (${now.length} foto sama dengan ${prev.date})`,
    );
  }
  return {
    comparison: { prevDate: prev.date, common: now.length, f1Prev, f1Now, shortfallPrev, shortfallNow },
    flags,
  };
}

/** One row of the admin "Laporan" list: the headline numbers of a stored report. */
export type AccuracyReportSummary = {
  date: string;
  generatedAt: number;
  total: number;
  resolved: number;
  accurateRate: number | null;
  weekRate: number | null;
  outcomes: Outcomes;
  ratings: number;
  /** Regression flags, as in the report. */
  flags: string[];
  /** Top problems, as in the report. */
  problems: string[];
  suggestions: number;
  /** Name F1 of today's regression run, 0..1. */
  regressionF1: number | null;
  failed: number;
  email: EmailState["status"] | null;
};

export function accuracyReportSummary(report: AccuracyReport): AccuracyReportSummary {
  return {
    date: report.date,
    generatedAt: report.generatedAt,
    total: report.scans.total,
    resolved: report.scans.resolved,
    accurateRate: report.scans.accurateRate,
    weekRate: report.scans.weekRate,
    outcomes: report.scans.outcomes,
    ratings: report.ratings.total,
    flags: report.regression?.flags ?? [],
    problems: report.problems.slice(0, 3).map((problem) => problem.text),
    suggestions: report.suggestions.length,
    regressionF1: report.regression?.summary.f1 ?? null,
    failed: report.health.failed.total,
    email: report.email?.status ?? null,
  };
}
