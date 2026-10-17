// Implicit accuracy labels for every photo scan, with no photo and no extra
// table. A scan session is the ai_usage ledger row (scan_type "user") that
// ai.analyzeFood writes; its usage_json carries the session's `photoId` and
// then gains, as the user moves along:
//
//   aiItems     what the model first answered for every scan, text only, no photo:
//               compact items { n name, g grams, k kcal, p/c/f/fi macros, cf confidence }
//   retries     "Hitung ulang" passes (count), retryAt, retryItems (latest pass),
//               retryLog (every pass: i, at, model, hint, items)
//   corrections successful ai.correctScan calls (count)
//   savedAt     ms of the diary save (food.addScan with scanPhotoId)
//   savedLabel  "accurate" (saved as the AI answered) | "corrected" (edited)
//   savedItems  what the diary got, compact
//   diff        compact summary AI answer -> saved items (ScanDiff)
//   keep        1 once the user opted in to keeping the photo (feedback consent)
//
// Outcome of a session (scanOutcome / outcomeSql):
//   retried    any retry, whatever got saved: the first answer was not enough
//   accurate   saved unchanged
//   corrected  saved with edits or after a typed/spoken correction
//   abandoned  never saved and older than ABANDON_AFTER_MS (derived at read time)
//   pending    never saved, still young
//
// Explicit ratings (scan_feedback) stay separate. The retry tap is only a
// retry outcome; old clients still send an implicit kurang_akurat with it, which
// the server marks "retry_tap" in reasons_json (see FEEDBACK_MARK).
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { aiUsage, scanFeedback } from "@joyorogo/db/schema/fitness";

import { itemsDiff } from "./dataset";
import type { DatasetItem } from "./dataset";

/** A scan nobody saved this long after it ran counts as abandoned. */
export const ABANDON_AFTER_MS = 60 * 60 * 1000;
/** Ledger rows older than this are never touched by session updates (photos expire in ~2 days). */
const SESSION_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/** Reserved entries of scan_feedback.reasons_json next to the user-chosen reasons. */
export const FEEDBACK_MARK = {
  /** Implicit verdict an older client sent with the "Hitung ulang" tap. */
  retryTap: "retry_tap",
  /** The user ticked "Boleh simpan foto ini untuk bantu memperbaiki AI". */
  keepPhoto: "keep_photo",
} as const;

/** n name, g grams, k kcal, p/c/f/fi protein/carbs/fat/fiber (g), cf model confidence 0-1. */
export type CompactItem = {
  n: string;
  g?: number;
  k: number;
  p?: number;
  c?: number;
  f?: number;
  fi?: number;
  cf?: number;
};

export type ScanDiff = {
  /** Same weight, new dish name. */
  renamed: Array<{ from: CompactItem; to: CompactItem }>;
  removed: CompactItem[];
  added: CompactItem[];
  /** [ai, saved] for the numbers that moved. */
  changed: Array<{ n: string; g?: [number, number]; k?: [number, number] }>;
  aiKcal: number;
  savedKcal: number;
};

export type ScanSession = {
  photoId?: string;
  aiItems?: CompactItem[];
  retries?: number;
  retryAt?: number;
  retryItems?: CompactItem[];
  /** Every "Hitung ulang" pass in order: i (1-based), at, model, hint, items. */
  retryLog?: Array<{ i: number; at: number; model: string; hint?: string; items: CompactItem[] }>;
  corrections?: number;
  savedAt?: number;
  savedLabel?: "accurate" | "corrected";
  savedItems?: CompactItem[];
  diff?: ScanDiff;
  keep?: number;
};

export type ScanOutcome = "accurate" | "corrected" | "retried" | "abandoned" | "pending";

type ItemLike = {
  name: string;
  grams?: number | null;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  confidence?: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** At most 15 items, names cut at 80 chars: a ledger row stays a few KB even with retries. */
export function compactItems(items: readonly ItemLike[]): CompactItem[] {
  return items.slice(0, 15).map((item) => ({
    n: item.name.slice(0, 80),
    ...(item.grams != null ? { g: Math.round(item.grams) } : {}),
    k: Math.round(item.kcal),
    ...(item.protein != null ? { p: round1(item.protein) } : {}),
    ...(item.carbs != null ? { c: round1(item.carbs) } : {}),
    ...(item.fat != null ? { f: round1(item.fat) } : {}),
    ...(item.fiber != null ? { fi: round1(item.fiber) } : {}),
    ...(item.confidence != null ? { cf: Math.round(item.confidence * 100) / 100 } : {}),
  }));
}

const toDataset = (item: CompactItem): DatasetItem => ({
  name: item.n,
  ...(item.g !== undefined ? { grams: item.g } : {}),
  kcal: item.k,
});

const fromDataset = (item: DatasetItem): CompactItem => ({
  n: item.name,
  ...(item.grams !== undefined ? { g: item.grams } : {}),
  k: item.kcal,
});

/** A renamed dish keeps its weight: unmatched pairs within this share of the larger weight are one rename. */
const RENAME_GRAMS_TOLERANCE = 0.25;

/**
 * What the user changed between the model's answer and the diary. Items pair
 * by name (itemsDiff); the leftovers pair up as renames when the weights agree,
 * the rest are removed / added.
 */
export function scanDiff(ai: readonly CompactItem[], saved: readonly CompactItem[]): ScanDiff {
  const raw = itemsDiff(ai.map(toDataset), saved.map(toDataset));
  const removed = raw.removed.map(fromDataset);
  const added = raw.added.map(fromDataset);
  const renamed: ScanDiff["renamed"] = [];
  // Closest weights pair first, so two leftovers do not steal each other's match.
  for (;;) {
    let best: { r: number; a: number; gap: number } | null = null;
    removed.forEach((from, r) =>
      added.forEach((to, a) => {
        if (from.g === undefined || to.g === undefined) return;
        const gap = Math.abs(from.g - to.g) / Math.max(from.g, to.g);
        if (gap <= RENAME_GRAMS_TOLERANCE && (!best || gap < best.gap)) best = { r, a, gap };
      }),
    );
    if (!best) break;
    const { r, a } = best as { r: number; a: number };
    renamed.push({ from: removed.splice(r, 1)[0]!, to: added.splice(a, 1)[0]! });
  }
  return {
    renamed,
    removed,
    added,
    changed: raw.changed.map(({ name, ai: before, final: after }) => ({
      n: name,
      ...(before.grams !== after.grams && before.grams !== undefined && after.grams !== undefined
        ? { g: [before.grams, after.grams] as [number, number] }
        : {}),
      ...(before.kcal !== after.kcal ? { k: [before.kcal, after.kcal] as [number, number] } : {}),
    })),
    aiKcal: ai.reduce((sum, item) => sum + item.k, 0),
    savedKcal: saved.reduce((sum, item) => sum + item.k, 0),
  };
}

export function diffIsEmpty(diff: ScanDiff): boolean {
  return diff.renamed.length + diff.removed.length + diff.added.length + diff.changed.length === 0;
}

/** accurate = saved as answered; corrected = edited, or a correction was asked for. */
export function savedLabel(diff: ScanDiff, corrections: number): "accurate" | "corrected" {
  return corrections > 0 || !diffIsEmpty(diff) ? "corrected" : "accurate";
}

export function parseSession(usageJson: string | null | undefined): ScanSession | null {
  if (!usageJson) return null;
  try {
    const parsed = JSON.parse(usageJson) as ScanSession;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Mirror of outcomeSql for one parsed session. */
export function scanOutcome(session: ScanSession, createdAtMs: number, nowMs: number): ScanOutcome {
  if ((session.retries ?? 0) > 0) return "retried";
  if (session.savedLabel) return session.savedLabel;
  return nowMs - createdAtMs > ABANDON_AFTER_MS ? "abandoned" : "pending";
}

/** The answer the user was looking at when they saved: the last retry, else the first pass. */
export function currentAnswer(session: ScanSession): CompactItem[] {
  return session.retryItems ?? session.aiItems ?? [];
}

/**
 * SQL for a session's outcome (same rules as scanOutcome). `nowMs` is a
 * parameter so a query and its tests agree on "old enough to be abandoned".
 */
export function outcomeSql(nowMs: number): SQL<ScanOutcome> {
  const usage = aiUsage.usageJson;
  return sql<ScanOutcome>`case
    when coalesce(json_extract(${usage}, '$.retries'), 0) > 0 then 'retried'
    when json_extract(${usage}, '$.savedLabel') is not null then json_extract(${usage}, '$.savedLabel')
    when ${aiUsage.createdAt} < ${nowMs - ABANDON_AFTER_MS} then 'abandoned'
    else 'pending' end`;
}

/** An old client's retry tap and its implicit rating land within this window of each other. */
const RETRY_TAP_WINDOW_MS = 60_000;

/**
 * Old clients send kurang_akurat (no reasons, no note, afterRetry false) when
 * the user taps "Hitung ulang". When the retry reaches the server after that
 * row, mark the row so it counts as a retry, not an explicit rating.
 */
export function markRetryTapFeedback(db: Database, userId: string, photoId: string): Promise<unknown> {
  return db
    .update(scanFeedback)
    .set({ reasonsJson: JSON.stringify([FEEDBACK_MARK.retryTap]) })
    .where(
      and(
        eq(scanFeedback.userId, userId),
        eq(scanFeedback.photoId, photoId),
        eq(scanFeedback.rating, "kurang_akurat"),
        eq(scanFeedback.afterRetry, false),
        isNull(scanFeedback.reasonsJson),
        isNull(scanFeedback.note),
        gte(scanFeedback.createdAt, new Date(Date.now() - RETRY_TAP_WINDOW_MS)),
      ),
    );
}

/** The reverse order: the rating row arrives after the retry already ran (< RETRY_TAP_WINDOW_MS ago). */
export function retryJustRan(session: ScanSession | null | undefined): boolean {
  return session?.retryAt !== undefined && Date.now() - session.retryAt <= RETRY_TAP_WINDOW_MS;
}

/** Rows that are scan sessions: successful photo scans with a photoId (new clients and servers only). */
export function isSessionSql(): SQL<boolean> {
  return sql<boolean>`${aiUsage.scanType} = 'user' and json_extract(${aiUsage.usageJson}, '$.photoId') is not null`;
}

function sessionWhere(userId: string, photoId: string): SQL | undefined {
  return and(
    eq(aiUsage.userId, userId),
    eq(aiUsage.scanType, "user"),
    gte(aiUsage.createdAt, new Date(Date.now() - SESSION_WINDOW_MS)),
    sql`json_extract(${aiUsage.usageJson}, '$.photoId') = ${photoId}`,
  );
}

type SessionRow = { usageJson: string | null; createdAt: Date };

export async function loadSession(
  db: Database,
  userId: string,
  photoId: string,
): Promise<(SessionRow & { session: ScanSession }) | null> {
  const [row] = await db
    .select({ usageJson: aiUsage.usageJson, createdAt: aiUsage.createdAt })
    .from(aiUsage)
    .where(sessionWhere(userId, photoId))
    .limit(1);
  if (!row) return null;
  return { ...row, session: parseSession(row.usageJson) ?? {} };
}

/** Atomic in-place edit of a session's usage_json: json_set(usage_json, path, value, ...). */
function patchSession(
  db: Database,
  userId: string,
  photoId: string,
  patch: SQL,
): Promise<unknown> {
  return db.update(aiUsage).set({ usageJson: patch }).where(sessionWhere(userId, photoId));
}

const setSql = (pairs: Array<[path: string, value: SQL]>): SQL =>
  sql`json_set(coalesce(${aiUsage.usageJson}, '{}'), ${sql.join(
    pairs.map(([path, value]) => sql`${path}, ${value}`),
    sql`, `,
  )})`;

const jsonArg = (value: unknown): SQL => sql`json(${JSON.stringify(value)})`;

/** "Hitung ulang": one more pass. The count is incremented inside the statement, so two taps never lose one. */
export function recordSessionRetry(
  db: Database,
  userId: string,
  photoId: string,
  pass: { model: string; hint?: string; items: readonly ItemLike[] },
): Promise<unknown> {
  const items = compactItems(pass.items);
  const entry = sql`json_set(json(${JSON.stringify({
    at: Date.now(),
    model: pass.model,
    ...(pass.hint ? { hint: pass.hint.slice(0, 200) } : {}),
    items,
  })}), '$.i', coalesce(json_extract(${aiUsage.usageJson}, '$.retries'), 0) + 1)`;
  return patchSession(
    db,
    userId,
    photoId,
    setSql([
      ["$.retries", sql`coalesce(json_extract(${aiUsage.usageJson}, '$.retries'), 0) + 1`],
      ["$.retryAt", sql`${Date.now()}`],
      ["$.retryItems", jsonArg(items)],
      [
        "$.retryLog",
        sql`json(json_insert(coalesce(json_extract(${aiUsage.usageJson}, '$.retryLog'), '[]'), '$[#]', ${entry}))`,
      ],
    ]),
  );
}

/** A successful typed/spoken correction. */
export function recordSessionCorrection(
  db: Database,
  userId: string,
  photoId: string,
): Promise<unknown> {
  return patchSession(
    db,
    userId,
    photoId,
    setSql([["$.corrections", sql`coalesce(json_extract(${aiUsage.usageJson}, '$.corrections'), 0) + 1`]]),
  );
}

/** The user opted in to keeping the photo (see feedback-keep.ts). */
export function markSessionKeep(db: Database, userId: string, photoId: string): Promise<unknown> {
  return patchSession(db, userId, photoId, setSql([["$.keep", sql`1`]]));
}

/**
 * The diary save: diff against the answer on screen, label, store. Returns the
 * session as it was (null when there is none, e.g. a scan from before this
 * existed) with the new fields, so callers can follow up on `keep`.
 */
export async function recordSessionSaved(
  db: Database,
  userId: string,
  photoId: string,
  saved: readonly ItemLike[],
): Promise<(ScanSession & { savedItems: CompactItem[] }) | null> {
  const found = await loadSession(db, userId, photoId);
  if (!found) return null;
  const savedItems = compactItems(saved);
  const diff = scanDiff(currentAnswer(found.session), savedItems);
  const label = savedLabel(diff, found.session.corrections ?? 0);
  await patchSession(
    db,
    userId,
    photoId,
    setSql([
      ["$.savedAt", sql`${Date.now()}`],
      ["$.savedLabel", sql`${label}`],
      ["$.savedItems", jsonArg(savedItems)],
      ["$.diff", jsonArg(diff)],
    ]),
  );
  return { ...found.session, savedAt: Date.now(), savedLabel: label, savedItems, diff };
}

/** Parsed scan_feedback.reasons_json: the user's reasons apart from the reserved marks. */
export function parseFeedbackReasons(reasonsJson: string | null | undefined): {
  reasons: string[];
  retryTap: boolean;
  keepPhoto: boolean;
} {
  let all: string[] = [];
  try {
    const parsed = reasonsJson ? JSON.parse(reasonsJson) : [];
    if (Array.isArray(parsed)) all = parsed.filter((r): r is string => typeof r === "string");
  } catch {
    all = [];
  }
  const marks: string[] = Object.values(FEEDBACK_MARK);
  return {
    reasons: all.filter((r) => !marks.includes(r)),
    retryTap: all.includes(FEEDBACK_MARK.retryTap),
    keepPhoto: all.includes(FEEDBACK_MARK.keepPhoto),
  };
}

/** reasons_json for a row: the user's reasons plus reserved marks; null when empty. */
export function buildFeedbackReasons(reasons: readonly string[], marks: readonly string[]): string | null {
  const all = [...reasons, ...marks];
  return all.length > 0 ? JSON.stringify(all) : null;
}
