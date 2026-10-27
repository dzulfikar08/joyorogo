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
import type { GramsEditSource } from "./grams-edit";
import {
  isRetryDerivedFeedback,
  parseFeedbackReasons,
  parseSession,
  savedEdit,
  scanOutcome,
} from "./scan-outcome";
import type { CompactItem, ScanDiff, ScanOutcome, ScanSession } from "./scan-outcome";

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

/**
 * One photo scan of the trend window with what the rates need (usage_json without its heavy keys). `userId` only
 * groups the scans: it never reaches a stored report.
 */
export type WindowScan = {
  userId: string;
  createdAt: number;
  session: Pick<ScanSession, "retries" | "savedLabel" | "corrections" | "diff" | "altTaps" | "edit">;
};

/**
 * The rates over photo scans. Two denominators and two weightings:
 *   `unchangedOfAll`       saved unchanged / every scan old enough to judge, saved or not. A wrong first answer
 *                          that is retaken or dropped stays in the denominator: fixing it in place and saving
 *                          cannot move this number the way it moves `unchangedOfResolved`.
 *   `unchangedOfResolved`  saved unchanged / (unchanged + corrected + retried): the digest's older "tanpa koreksi".
 * Every rate comes pooled and `ByUser`: the mean of each user's own rate, so one user cannot move it. Reports
 * from before this block have none of it.
 */
export type PhotoRates = {
  /** Scans not still pending (a session is pending until ABANDON_AFTER_MS). */
  scans: number;
  /** accurate + corrected + retried. */
  resolved: number;
  /** Scans saved to the diary, retried-then-saved included. */
  saved: number;
  /** Saved unchanged. */
  unchanged: number;
  /** Distinct users with a scan in the window. */
  users: number;
  /** The busiest user's share of `scans`, 0..1. */
  topUserShare: number | null;
  unchangedOfAll: number | null;
  unchangedOfAllByUser: number | null;
  unchangedOfResolved: number | null;
  unchangedOfResolvedByUser: number | null;
  /** Saved scans where the person changed what the dish is (rename, removed, added), apart from chip taps. */
  identityEdits: number;
  /** Saved scans edited with no identity change: numbers moved, or a "Mungkin juga" name swap. */
  gramsEdits: number;
  /** identityEdits / saved, and the by-user mean. */
  identityRate: number | null;
  identityRateByUser: number | null;
  /** gramsEdits / saved, and the by-user mean. */
  gramsEditRate: number | null;
  gramsEditRateByUser: number | null;
  /** Saved scans in which each source moved a number (a scan can count under several). */
  sources: Partial<Record<GramsEditSource, number>>;
};

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

/** One side of the shadow comparison, over the scans where the user saved a diary entry. */
export type ShadowArm = {
  /** Micro name F1 against the saved items, 0..1. */
  f1: number | null;
  /** Mean kcal shortfall, % of the saved plate (0 when at or above it): the under-estimate. */
  shortfallPct: number | null;
  /** Mean signed plate kcal error, %; positive = ran high. */
  signedPct: number | null;
  /** Plates more than SHADOW_CLOSE_PCT over / under the saved kcal. */
  over: number;
  under: number;
};

/** Shadow test (lib/shadow-scan.ts): did the variant land closer to what users saved than production? */
export type ShadowReport = {
  variant: string;
  /** Scans of the day that carry a shadow answer, and how many of those failed. */
  sampled: number;
  failed: number;
  /** Shadow answered and the user saved (as answered or edited): the scans that can be scored. */
  scored: number;
  /** Of the scored scans, those the user edited before or after saving. */
  corrected: number;
  prod: ShadowArm;
  shadow: ShadowArm;
  /** Per scored scan: more saved names matched, else kcal closer to the saved plate (beyond SHADOW_TIE_PCT points). */
  shadowCloser: number;
  prodCloser: number;
  tie: number;
  /** The same comparison on the corrected scans only. */
  correctedShadowCloser: number;
  correctedProdCloser: number;
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
    /** Every photo scan of the day. */
    total: number;
    /** Of those, scans with a session record (outcome labels). Older clients and scans from before the labels have none. */
    labelled: number;
    outcomes: Outcomes;
    /** accurate + corrected + retried. */
    resolved: number;
    /** "Tanpa koreksi": accurate / resolved, 0..1. */
    accurateRate: number | null;
    /** Oldest first; the last entry is `date`. */
    trend: TrendDay[];
    /** Accurate rate over the whole trend window. */
    weekRate: number | null;
    /** Rates over every photo scan of the day / of the trend window. Absent in reports from before they existed. */
    photo?: PhotoRates;
    weekPhoto?: PhotoRates;
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
  /** Absent in reports from before the shadow test; null when no scan of the day was sampled. */
  shadow?: ShadowReport | null;
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
  /** Every photo scan of the trend window, `date` included, with its user: the per-user rates. Omitted = no `photo` blocks. */
  window?: readonly WindowScan[];
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
const round4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);
const round1 = (n: number) => Math.round(n * 10) / 10;

type UserTally = {
  scans: number;
  resolved: number;
  saved: number;
  unchanged: number;
  identity: number;
  grams: number;
};

/** Mean of each user's own rate over the users it is defined for (denominator > 0). */
function meanByUser(
  tallies: Iterable<UserTally>,
  num: (t: UserTally) => number,
  den: (t: UserTally) => number,
): number | null {
  const rates: number[] = [];
  for (const tally of tallies) if (den(tally) > 0) rates.push(num(tally) / den(tally));
  return round4(meanOf(rates));
}

/** The rates of `PhotoRates` over the scans given. Pure: `nowMs` only decides which scans are still pending. */
export function photoRates(scans: readonly WindowScan[], nowMs: number): PhotoRates {
  const byUser = new Map<string, UserTally>();
  const sources: Partial<Record<GramsEditSource, number>> = {};
  for (const scan of scans) {
    const outcome = scanOutcome(scan.session, scan.createdAt, nowMs);
    if (outcome === "pending") continue;
    const tally = byUser.get(scan.userId) ?? { scans: 0, resolved: 0, saved: 0, unchanged: 0, identity: 0, grams: 0 };
    byUser.set(scan.userId, tally);
    tally.scans += 1;
    if (outcome === "accurate" || outcome === "corrected" || outcome === "retried") tally.resolved += 1;
    if (outcome === "accurate") tally.unchanged += 1;
    const edit = savedEdit(scan.session);
    if (!edit) continue;
    tally.saved += 1;
    if (edit.kind === "identity") tally.identity += 1;
    else if (edit.kind === "grams") tally.grams += 1;
    for (const source of edit.src ?? []) sources[source] = (sources[source] ?? 0) + 1;
  }
  const all = [...byUser.values()];
  const sum = (pick: (t: UserTally) => number) => all.reduce((total, t) => total + pick(t), 0);
  const total = sum((t) => t.scans);
  const resolved = sum((t) => t.resolved);
  const saved = sum((t) => t.saved);
  const unchanged = sum((t) => t.unchanged);
  const identityEdits = sum((t) => t.identity);
  const gramsEdits = sum((t) => t.grams);
  return {
    scans: total,
    resolved,
    saved,
    unchanged,
    users: byUser.size,
    topUserShare: total > 0 ? round4(Math.max(...all.map((t) => t.scans)) / total) : null,
    unchangedOfAll: round4(ratio(unchanged, total)),
    unchangedOfAllByUser: meanByUser(all, (t) => t.unchanged, (t) => t.scans),
    unchangedOfResolved: round4(ratio(unchanged, resolved)),
    unchangedOfResolvedByUser: meanByUser(all, (t) => t.unchanged, (t) => t.resolved),
    identityEdits,
    gramsEdits,
    identityRate: round4(ratio(identityEdits, saved)),
    identityRateByUser: meanByUser(all, (t) => t.identity, (t) => t.saved),
    gramsEditRate: round4(ratio(gramsEdits, saved)),
    gramsEditRateByUser: meanByUser(all, (t) => t.grams, (t) => t.saved),
    sources,
  };
}

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
  const scans = sessionsOf(input.scans);
  // Only scans with a photo id are sessions: they carry the labels (outcome, diff).
  const sessions = scans.filter((s) => s.usage.photoId !== undefined);

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
        scans.flatMap((s) => {
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
      total: scans.length,
      labelled: sessions.length,
      outcomes,
      resolved,
      accurateRate: ratio(outcomes.accurate, resolved),
      trend,
      weekRate: ratio(weekAccurate, weekResolved),
      ...(input.window
        ? {
            photo: photoRates(
              input.window.filter((scan) => scan.createdAt >= dayStartMs(date) && scan.createdAt < dayStartMs(shiftDate(date, 1))),
              nowMs,
            ),
            weekPhoto: photoRates(input.window, nowMs),
          }
        : {}),
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
      tooMany: scans.filter((s) => s.usage.tooMany).length,
      repaired: scans.filter((s) => s.usage.repaired).length,
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
    shadow: shadowReport(sessions.map((s) => s.usage)),
    regression: null,
    email: null,
  };
}

// ----------------------------------------------------------------- shadow

/** A plate within this share of the saved kcal is neither over nor under. */
export const SHADOW_CLOSE_PCT = 5;
/** Kcal errors closer than this many percentage points do not decide which side was closer. */
export const SHADOW_TIE_PCT = 2;

const asMatch = (items: readonly CompactItem[]): MatchItem[] =>
  items.map((item) => ({ name: item.n, ...(item.g !== undefined ? { grams: item.g } : {}), kcal: item.k }));

type ShadowScore = { tp: number; ai: number; truth: number; errPct: number | null };

function scoreAgainst(answer: readonly CompactItem[], saved: readonly CompactItem[]): ShadowScore {
  const a = asMatch(answer);
  const t = asMatch(saved);
  const savedKcal = plateKcal(t);
  return {
    tp: pairItems(a, t).length,
    ai: a.length,
    truth: t.length,
    errPct: savedKcal > 0 ? ((plateKcal(a) - savedKcal) * 100) / savedKcal : null,
  };
}

function shadowArm(scores: readonly ShadowScore[]): ShadowArm {
  const tp = scores.reduce((sum, s) => sum + s.tp, 0);
  const ai = scores.reduce((sum, s) => sum + s.ai, 0);
  const truth = scores.reduce((sum, s) => sum + s.truth, 0);
  const precision = ratio(tp, ai);
  const recall = ratio(tp, truth);
  const f1 =
    precision === null || recall === null ? null : precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const errs = scores.flatMap((s) => (s.errPct === null ? [] : [s.errPct]));
  const signed = meanOf(errs);
  const shortfall = meanOf(errs.map((e) => Math.max(0, -e)));
  return {
    f1,
    shortfallPct: shortfall === null ? null : round1(shortfall),
    signedPct: signed === null ? null : round1(signed),
    over: errs.filter((e) => e > SHADOW_CLOSE_PCT).length,
    under: errs.filter((e) => e < -SHADOW_CLOSE_PCT).length,
  };
}

/** "shadow" | "prod" | "tie": more name matches first, then the smaller kcal error. */
function closer(prod: ShadowScore, shadow: ShadowScore): "shadow" | "prod" | "tie" {
  if (shadow.tp !== prod.tp) return shadow.tp > prod.tp ? "shadow" : "prod";
  if (prod.errPct === null || shadow.errPct === null) return "tie";
  const gap = Math.abs(prod.errPct) - Math.abs(shadow.errPct);
  if (Math.abs(gap) < SHADOW_TIE_PCT) return "tie";
  return gap > 0 ? "shadow" : "prod";
}

/**
 * Production answer (the first pass) and shadow answer of every sampled scan,
 * each scored against the diary items the user saved. Null when no scan of
 * the day was sampled.
 */
export function shadowReport(sessions: readonly ScanSession[]): ShadowReport | null {
  const sampled = sessions.filter((s) => s.shadow);
  if (sampled.length === 0) return null;
  const pairs = sampled.flatMap((s) => {
    if (!s.shadow?.items || !s.aiItems || !s.savedItems || s.savedItems.length === 0) return [];
    return [
      {
        corrected: s.savedLabel === "corrected",
        prod: scoreAgainst(s.aiItems, s.savedItems),
        shadow: scoreAgainst(s.shadow.items, s.savedItems),
      },
    ];
  });
  const verdicts = pairs.map((pair) => ({ ...pair, verdict: closer(pair.prod, pair.shadow) }));
  const count = (list: typeof verdicts, v: "shadow" | "prod" | "tie") =>
    list.filter((x) => x.verdict === v).length;
  const corrected = verdicts.filter((x) => x.corrected);
  return {
    variant: sampled[0]!.shadow!.variant,
    sampled: sampled.length,
    failed: sampled.filter((s) => s.shadow!.error !== undefined).length,
    scored: pairs.length,
    corrected: corrected.length,
    prod: shadowArm(pairs.map((x) => x.prod)),
    shadow: shadowArm(pairs.map((x) => x.shadow)),
    shadowCloser: count(verdicts, "shadow"),
    prodCloser: count(verdicts, "prod"),
    tie: count(verdicts, "tie"),
    correctedShadowCloser: count(corrected, "shadow"),
    correctedProdCloser: count(corrected, "prod"),
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
  /** Scans with outcome labels (a session record). */
  labelled: number;
  resolved: number;
  accurateRate: number | null;
  weekRate: number | null;
  /** Of the day's / the week's photo scans, from the `photo` blocks; absent in older reports. */
  photo?: PhotoRatesSummary;
  weekPhoto?: PhotoRatesSummary;
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

/** The list row's share of PhotoRates. */
export type PhotoRatesSummary = Pick<
  PhotoRates,
  | "scans"
  | "users"
  | "unchangedOfAll"
  | "unchangedOfAllByUser"
  | "identityRate"
  | "identityRateByUser"
  | "gramsEditRate"
  | "gramsEditRateByUser"
>;

const photoSummary = (rates: PhotoRates | undefined): PhotoRatesSummary | undefined =>
  rates && {
    scans: rates.scans,
    users: rates.users,
    unchangedOfAll: rates.unchangedOfAll,
    unchangedOfAllByUser: rates.unchangedOfAllByUser,
    identityRate: rates.identityRate,
    identityRateByUser: rates.identityRateByUser,
    gramsEditRate: rates.gramsEditRate,
    gramsEditRateByUser: rates.gramsEditRateByUser,
  };

export function accuracyReportSummary(report: AccuracyReport): AccuracyReportSummary {
  return {
    date: report.date,
    generatedAt: report.generatedAt,
    total: report.scans.total,
    labelled: report.scans.labelled,
    resolved: report.scans.resolved,
    accurateRate: report.scans.accurateRate,
    weekRate: report.scans.weekRate,
    ...(report.scans.photo ? { photo: photoSummary(report.scans.photo) } : {}),
    ...(report.scans.weekPhoto ? { weekPhoto: photoSummary(report.scans.weekPhoto) } : {}),
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
