// Daily accuracy digest job. Once a day, from the */5 cron (see index.ts), it
// builds the accuracy report for the previous WIB day, runs the regression
// photos through the current pipeline, stores everything as JSON in R2
// (reports/accuracy/<date>.json) and mails the admins. Idempotent per day: a
// stored report is never rebuilt (except `force`), a failed email is retried a
// few times, and an R2 lock keeps two runs from spending the AI budget twice.
//
// Cost caps: at most REGRESSION_CAP photos go through the model per run, at
// most twice that many meta.json files are read to find them, and no new photo
// starts after REGRESSION_DEADLINE_MS. No D1 writes except the email_log claim.
import { and, eq, sql } from "drizzle-orm";

import {
  REPORT_PREFIX,
  buildAccuracyReport,
  caseId,
  compareRegression,
  dayStartMs,
  emptyOutcomes,
  failedRegressionCase,
  orderRegressionCandidates,
  reportKey,
  scoreRegressionCase,
  summarizeRegression,
} from "@joyorogo/api/lib/accuracy-report";
import type {
  AccuracyReport,
  EmailState,
  FeedbackRow,
  LedgerRow,
  Outcomes,
  RegressionCaseResult,
  RegressionReport,
} from "@joyorogo/api/lib/accuracy-report";
import { DATASET_PREFIX, EXTERNAL_DATASET_PREFIX } from "@joyorogo/api/lib/dataset";
import type { DatasetMeta } from "@joyorogo/api/lib/dataset";
import { shiftDate, jakartaToday } from "@joyorogo/api/lib/engine";
import { FEEDBACK_PREFIX } from "@joyorogo/api/lib/feedback-keep";
import type { FeedbackKeepMeta } from "@joyorogo/api/lib/feedback-keep";
import type { MatchItem } from "@joyorogo/api/lib/scan-match";
import { isSessionSql, outcomeSql, wibDaySql } from "@joyorogo/api/lib/scan-outcome";
import type { ScanDiff, ScanOutcome } from "@joyorogo/api/lib/scan-outcome";
import { bytesToBase64 } from "@joyorogo/api/lib/sticker";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import { analyzeFoodPhoto } from "@joyorogo/api/lib/vision";
import type { AiRunner } from "@joyorogo/api/lib/vision";
import type { Database } from "@joyorogo/db";
import { aiUsage, scanFeedback } from "@joyorogo/db/schema/fitness";

import { sendAccuracyDigest } from "./email";
import type { EmailEnv } from "./email";

/** Photos the daily regression sends through the model, at most. */
export const REGRESSION_CAP = 40;
/** meta.json reads allowed per photo of the cap while looking for labelled cases. */
const META_READS_PER_CASE = 2;
const REGRESSION_CONCURRENCY = 3;
/** R2 list pages (1000 keys each) read per prefix. */
const LIST_PAGES_MAX = 10;
/** No new regression photo starts after this long. */
const REGRESSION_DEADLINE_MS = 10 * 60 * 1000;
/** A run younger than this blocks another; older locks are a crashed run. */
const LOCK_TTL_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const EMAIL_MAX_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days of trend (and suggestion evidence) behind a report, the report day included. */
const WINDOW_DAYS = 7;
/** 07:00 WIB: the earliest the daily job starts. */
const START_MINUTE_WIB = 7 * 60;

export type JobDeps = {
  db: Database;
  bucket: StickersBucket | undefined;
  ai: AiRunner | undefined;
  model?: string;
  email: EmailEnv;
  /** Injectable for tests. */
  now?: () => number;
  analyze?: typeof analyzeFoodPhoto;
  sendDigest?: typeof sendAccuracyDigest;
  cap?: number;
};

export type JobResult = {
  date: string;
  status: "built" | "exists" | "email_retried" | "busy" | "gave_up" | "no_bucket";
  report?: AccuracyReport;
};

// ------------------------------------------------------------------- R2 json

async function readJson<T>(bucket: StickersBucket, key: string): Promise<T | null> {
  const object = await bucket.get(key).catch(() => null);
  if (!object) return null;
  try {
    return JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as T;
  } catch {
    return null;
  }
}

const writeJson = (bucket: StickersBucket, key: string, value: unknown) =>
  bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });

async function listKeys(bucket: StickersBucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const result = await bucket.list({ prefix, cursor });
    keys.push(...result.objects.map((object) => object.key));
    if (!result.truncated || !result.cursor) break;
    cursor = result.cursor;
  }
  return keys;
}

/** The stored reports, newest date first. */
export async function listReportDates(bucket: StickersBucket): Promise<string[]> {
  return (await listKeys(bucket, REPORT_PREFIX))
    .flatMap((key) => {
      const match = /^reports\/accuracy\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
      return match ? [match[1]!] : [];
    })
    .sort()
    .reverse();
}

export const readReport = (bucket: StickersBucket, date: string) =>
  readJson<AccuracyReport>(bucket, reportKey(date));

// -------------------------------------------------------------------- inputs

const toLedger = (row: { createdAt: Date; model: string; usageJson: string | null }): LedgerRow => ({
  createdAt: row.createdAt.getTime(),
  model: row.model,
  usageJson: row.usageJson,
});

/** The rows one report is built from: the report day, plus counts and diffs of the days before it. */
export async function loadReportInput(db: Database, date: string, nowMs: number) {
  const start = dayStartMs(date);
  const end = start + DAY_MS;
  const windowStart = dayStartMs(shiftDate(date, -(WINDOW_DAYS - 1)));
  const inDay = (column: unknown) => sql`${column} >= ${start} and ${column} < ${end}`;
  const inWindow = sql`${aiUsage.createdAt} >= ${windowStart} and ${aiUsage.createdAt} < ${end}`;
  const ledgerOfDay = (scanType: "user" | "failed" | "correction") =>
    db
      .select({ createdAt: aiUsage.createdAt, model: aiUsage.model, usageJson: aiUsage.usageJson })
      .from(aiUsage)
      .where(and(eq(aiUsage.scanType, scanType), inDay(aiUsage.createdAt)));
  const outcome = outcomeSql(nowMs);
  const day = wibDaySql(aiUsage.createdAt);

  const [scans, failed, corrections, feedback, priorRows, diffRows] = await Promise.all([
    ledgerOfDay("user"),
    ledgerOfDay("failed"),
    ledgerOfDay("correction"),
    db
      .select({
        rating: scanFeedback.rating,
        reasonsJson: scanFeedback.reasonsJson,
        note: scanFeedback.note,
        createdAt: scanFeedback.createdAt,
      })
      .from(scanFeedback)
      .where(inDay(scanFeedback.createdAt)),
    db
      .select({ day, outcome, n: sql<number>`count(*)` })
      .from(aiUsage)
      .where(and(isSessionSql(), sql`${aiUsage.createdAt} >= ${windowStart} and ${aiUsage.createdAt} < ${start}`))
      .groupBy(day, outcome),
    db
      .select({ diff: sql<string | null>`json_extract(${aiUsage.usageJson}, '$.diff')` })
      .from(aiUsage)
      .where(
        and(
          isSessionSql(),
          sql`json_extract(${aiUsage.usageJson}, '$.savedLabel') = 'corrected'`,
          inWindow,
        ),
      ),
  ]);

  const prior = new Map<string, Outcomes>();
  for (const row of priorRows) {
    const counts = prior.get(row.day) ?? emptyOutcomes();
    counts[row.outcome as ScanOutcome] += Number(row.n);
    prior.set(row.day, counts);
  }
  const weekDiffs = diffRows.flatMap((row) => {
    try {
      return row.diff ? [JSON.parse(row.diff) as ScanDiff] : [];
    } catch {
      return [];
    }
  });
  return {
    date,
    nowMs,
    scans: scans.map(toLedger),
    failed: failed.map(toLedger),
    corrections: corrections.map(toLedger),
    feedback: feedback.map((row): FeedbackRow => ({ ...row, createdAt: row.createdAt.getTime() })),
    priorDays: [...prior].map(([priorDay, outcomes]) => ({ day: priorDay, outcomes })),
    weekDiffs,
  };
}

// ---------------------------------------------------------------- regression

type RegressionCase = {
  key: string;
  group: "owner" | "feedback";
  truth: MatchItem[];
};

/** The saved items of a labelled case (the diary save of an owner scan, the save after a consented rating). */
async function loadCase(bucket: StickersBucket, key: string): Promise<RegressionCase | null> {
  const group = key.startsWith(DATASET_PREFIX) ? "owner" : "feedback";
  const meta = await readJson<DatasetMeta | FeedbackKeepMeta>(bucket, `${key}/meta.json`);
  if (!meta) return null;
  const truth: MatchItem[] =
    group === "owner"
      ? ((meta as DatasetMeta).final?.items ?? []).map((i) => ({ name: i.name, grams: i.grams, kcal: i.kcal }))
      : ((meta as FeedbackKeepMeta).savedItems ?? []).map((i) => ({ name: i.n, grams: i.g, kcal: i.k }));
  return truth.length > 0 ? { key, group, truth } : null;
}

type PreviousRun = { date: string; results: RegressionCaseResult[] };

/** The latest earlier report that has regression results, looking back at most a week. */
async function loadPreviousRun(bucket: StickersBucket, date: string): Promise<PreviousRun | null> {
  const earlier = (await listReportDates(bucket)).filter((d) => d < date).slice(0, WINDOW_DAYS);
  for (const prevDate of earlier) {
    const report = await readReport(bucket, prevDate);
    const results = report?.regression?.results;
    if (results?.some((r) => r.ok)) return { date: prevDate, results };
  }
  return null;
}

const emptyRegression = (cap: number, error: string): RegressionReport => ({
  cap,
  candidates: 0,
  summary: summarizeRegression([]),
  results: [],
  comparison: null,
  flags: [],
  error,
});

/**
 * Runs up to `cap` labelled photos through the production pipeline and scores
 * them against what the users saved. Never throws: a failure becomes `error`.
 */
export async function runRegression(opts: {
  bucket: StickersBucket;
  ai: AiRunner | undefined;
  model?: string;
  date: string;
  cap: number;
  analyze: typeof analyzeFoodPhoto;
  now: () => number;
}): Promise<RegressionReport> {
  const { bucket, ai, cap, analyze, now } = opts;
  if (!ai) return emptyRegression(cap, "binding AI tidak tersedia");
  try {
    const keys = [
      ...(await listKeys(bucket, DATASET_PREFIX)),
      ...(await listKeys(bucket, FEEDBACK_PREFIX)),
    ].flatMap((key) =>
      // External cases (dataset/external/) carry another contributor's weights, not a diary save; they run through scripts/eval-scans.ts only.
      key.endsWith("/meta.json") && !key.startsWith(EXTERNAL_DATASET_PREFIX)
        ? [key.slice(0, -"/meta.json".length)]
        : [],
    );
    const ordered = orderRegressionCandidates(keys, Math.floor(dayStartMs(opts.date) / DAY_MS), cap);

    // First `cap` labelled cases, reading no more than META_READS_PER_CASE x cap metas.
    const cases: RegressionCase[] = [];
    let reads = 0;
    for (const key of ordered) {
      if (cases.length >= cap || reads >= cap * META_READS_PER_CASE) break;
      reads += 1;
      const found = await loadCase(bucket, key);
      if (found) cases.push(found);
    }

    const startedAt = now();
    const results: Array<RegressionCaseResult | null> = cases.map(() => null);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        const c = cases[index];
        if (!c || now() - startedAt > REGRESSION_DEADLINE_MS) return;
        const meta = { id: caseId(c.key), group: c.group };
        const photo = await bucket.get(`${c.key}/photo.jpg`).catch(() => null);
        if (!photo) continue;
        const began = now();
        try {
          const analysis = await analyze(ai, {
            imageBase64: bytesToBase64(await photo.arrayBuffer()),
            mimeType: photo.httpMetadata?.contentType ?? "image/jpeg",
            model: opts.model,
          });
          results[index] = scoreRegressionCase(
            meta,
            analysis.items.map((i) => ({ name: i.name, grams: i.grams, kcal: i.kcal })),
            c.truth,
            now() - began,
          );
        } catch {
          results[index] = failedRegressionCase(meta, now() - began);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REGRESSION_CONCURRENCY, cases.length) }, worker));

    const done = results.filter((r): r is RegressionCaseResult => r !== null);
    const { comparison, flags } = compareRegression(done, await loadPreviousRun(bucket, opts.date));
    return {
      cap,
      candidates: keys.length,
      summary: summarizeRegression(done),
      results: done,
      comparison,
      flags,
    };
  } catch (error) {
    console.error("[accuracy] regression failed", error);
    return emptyRegression(cap, error instanceof Error ? error.message : String(error));
  }
}

// ----------------------------------------------------------------------- job

type Lock = { at: number; attempts: number };
const lockKey = (date: string) => `${REPORT_PREFIX}${date}.lock`;

async function deliver(deps: JobDeps, report: AccuracyReport, now: number): Promise<void> {
  const send = deps.sendDigest ?? sendAccuracyDigest;
  const result = await send(deps.email, deps.db, report).catch(
    (error: unknown): Pick<EmailState, "status" | "detail"> => ({
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
  report.email = {
    status: result.status,
    attempts: (report.email?.attempts ?? 0) + 1,
    at: now,
    ...(result.detail ? { detail: result.detail } : {}),
  };
}

const emailNeedsRetry = (report: AccuracyReport) =>
  !report.email ||
  (report.email.status === "failed" && report.email.attempts < EMAIL_MAX_ATTEMPTS);

/**
 * Builds, stores and mails the report for `date` (default: yesterday, WIB).
 * Safe to call as often as the cron ticks: a finished day returns "exists".
 */
export async function runDailyAccuracy(
  deps: JobDeps,
  opts: { date?: string; force?: boolean } = {},
): Promise<JobResult> {
  const now = deps.now ?? Date.now;
  const date = opts.date ?? shiftDate(jakartaToday(new Date(now())), -1);
  const bucket = deps.bucket;
  if (!bucket) return { date, status: "no_bucket" };

  const existing = opts.force ? null : await readReport(bucket, date);
  if (existing && !emailNeedsRetry(existing)) return { date, status: "exists", report: existing };

  const lock = await readJson<Lock>(bucket, lockKey(date));
  if (lock && now() - lock.at < LOCK_TTL_MS) return { date, status: "busy" };
  if (lock && !opts.force && lock.attempts >= MAX_ATTEMPTS && !existing) {
    return { date, status: "gave_up" };
  }
  await writeJson(bucket, lockKey(date), { at: now(), attempts: (lock?.attempts ?? 0) + 1 } satisfies Lock);

  try {
    if (existing) {
      await deliver(deps, existing, now());
      await writeJson(bucket, reportKey(date), existing);
      return { date, status: "email_retried", report: existing };
    }

    const report = buildAccuracyReport(await loadReportInput(deps.db, date, now()));
    report.regression = await runRegression({
      bucket,
      ai: deps.ai,
      model: deps.model,
      date,
      cap: deps.cap ?? REGRESSION_CAP,
      analyze: deps.analyze ?? analyzeFoodPhoto,
      now,
    });
    // Stored before the mail goes out: a crash after this point resumes at the email.
    await writeJson(bucket, reportKey(date), report);
    await deliver(deps, report, now());
    await writeJson(bucket, reportKey(date), report);
    return { date, status: "built", report };
  } finally {
    await bucket.delete(lockKey(date)).catch(() => {});
  }
}

/** The cron gate: the daily job starts at 07:00 WIB and keeps ticking until the day's report is done. */
export const dailyAccuracyDue = (nowMs: number) => {
  const wibMinute = Math.floor(((nowMs + 7 * 60 * 60 * 1000) % DAY_MS) / 60_000);
  return wibMinute >= START_MINUTE_WIB;
};
