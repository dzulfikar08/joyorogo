// Implicit accuracy labels for every photo scan, with no photo and no extra
// table. A scan session is the ai_usage ledger row (scan_type "user") that
// ai.analyzeFood writes; its usage_json carries the session's `photoId` and
// then gains, as the user moves along:
//
//   aiItems     what the model first answered for every scan, text only, no photo:
//               compact items { n name, g grams, gs where the grams came from, k kcal, p/c/f/fi macros,
//               cf confidence }; savedItems carry the same gs (see GramSource)
//   retries     "Hitung ulang" passes (count), retryAt, retryItems (latest pass),
//               retryLog (every pass: i, at, model, hint, items)
//   corrections successful ai.correctScan calls (count)
//   savedAt     ms of the diary save (food.addScan with scanPhotoId)
//   savedLabel  "accurate" (saved as the AI answered) | "corrected" (edited)
//   savedItems  what the diary got, compact
//   diff        compact summary AI answer -> saved items (ScanDiff)
//   edit        what kind of edit the save was: SessionEdit { kind: none | identity | grams, src: where the
//               changed numbers came from }. Absent on saves from before it existed: savedEdit() derives the
//               kind from diff + altTaps (the chip sources are then unknown).
//   keep        1 once the user opted in to keeping the photo (feedback consent)
//   shadow      silent A/B on a sample of first scans (lib/shadow-scan.ts): what the
//               shadow prompt variant answered for the same photo, beside aiItems.
//               Never shown to the user and never charged to the quota. { variant,
//               at, ms, model, items } or { variant, at, ms, error } when it failed.
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
import type { GramsEditSource } from "./grams-edit";

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

/**
 * Where an item's grams came from, so error can be split by source:
 *   model  the photo estimate, as the vision model answered
 *   scale  a kitchen-scale display read from the photo (lib/scale-reading.ts), container already taken off
 *   prior  the user's usual or typical portion started the row (lib/portion-prior.ts)
 *   user   the grams are not what the scan answered: typed, a chip, a correction, a container weight
 */
export type GramSource = "model" | "scale" | "prior" | "user";

/** n name, g grams, gs where they came from, k kcal, p/c/f/fi protein/carbs/fat/fiber (g), cf model confidence 0-1, a the alternate names the scan offered ("Mungkin juga"). */
export type CompactItem = {
  n: string;
  g?: number;
  gs?: GramSource;
  k: number;
  p?: number;
  c?: number;
  f?: number;
  fi?: number;
  cf?: number;
  a?: string[];
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

/**
 * What a save changed, apart from "corrected" being true for any edit:
 *   none      the diary has the answer's dishes and numbers (a typed correction that was undone, say)
 *   identity  the person changed what the dish is: a rename, a removed or an added item, not offered by a chip
 *   grams     only numbers (grams, kcal) moved, or a dish name was swapped by a "Mungkin juga" chip: edits
 *             that cost one tap and say nothing about whether the model named the dish right
 * `src` lists the distinct sources of the changed numbers (GramsEditSource), `alt` for a chip-swapped name.
 */
export type SessionEdit = { kind: "none" | "identity" | "grams"; src?: GramsEditSource[] };

/** One shadow-variant answer for a scan (see lib/shadow-scan.ts). */
export type ShadowRun = {
  variant: string;
  at: number;
  /** Model call time, ms. */
  ms: number;
  model?: string;
  items?: CompactItem[];
  /** Failure reason (a ScanFailReason, or "error"); no items then. */
  error?: string;
};

export type ScanSession = {
  photoId?: string;
  aiItems?: CompactItem[];
  shadow?: ShadowRun;
  retries?: number;
  retryAt?: number;
  retryItems?: CompactItem[];
  /** Every "Hitung ulang" pass in order: i (1-based), at, model, hint, items. */
  retryLog?: Array<{ i: number; at: number; model: string; hint?: string; items: CompactItem[] }>;
  corrections?: number;
  /** Every alternate-name chip tapped ("Mungkin juga"): f = the name it replaced, t = the alternate. */
  altTaps?: Array<{ f: string; t: string }>;
  savedAt?: number;
  savedLabel?: "accurate" | "corrected";
  savedItems?: CompactItem[];
  diff?: ScanDiff;
  edit?: SessionEdit;
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
  /** The chips a scan answer carries: which side is showing says where the grams came from. */
  scaleRead?: { active: string } | null;
  portionPrior?: { active: string } | null;
  alt?: readonly string[] | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Where the grams of a scan answer's item came from, read off the chip that is showing. */
function gramSourceOf(item: ItemLike): GramSource {
  if (item.scaleRead?.active === "scale") return "scale";
  if (item.portionPrior?.active === "prior") return "prior";
  return "model";
}

/**
 * At most 15 items, names cut at 80 chars: a ledger row stays a few KB even with retries. `sources` (default on)
 * stamps `gs` on every item with grams, for a scan answer; a diary row has no chip to read it from, so the save
 * passes false and takes the sources from the answer (savedGramSources).
 */
export function compactItems(items: readonly ItemLike[], sources = true): CompactItem[] {
  return items.slice(0, 15).map((item) => ({
    n: item.name.slice(0, 80),
    ...(item.grams != null ? { g: Math.round(item.grams) } : {}),
    ...(sources && item.grams != null ? { gs: gramSourceOf(item) } : {}),
    k: Math.round(item.kcal),
    ...(item.protein != null ? { p: round1(item.protein) } : {}),
    ...(item.carbs != null ? { c: round1(item.carbs) } : {}),
    ...(item.fat != null ? { f: round1(item.fat) } : {}),
    ...(item.fiber != null ? { fi: round1(item.fiber) } : {}),
    ...(item.confidence != null ? { cf: Math.round(item.confidence * 100) / 100 } : {}),
    ...(item.alt?.length ? { a: item.alt.slice(0, 2).map((name) => name.slice(0, 80)) } : {}),
  }));
}

/**
 * The saved items with where each one's grams came from: an item keeps the source of the answer's item it matches
 * (same name, or same grams under another name) when the grams are unchanged, anything else is the user's.
 */
export function savedGramSources(saved: readonly CompactItem[], answer: readonly CompactItem[]): CompactItem[] {
  const open = [...answer];
  const take = (match: (a: CompactItem) => boolean): CompactItem | undefined => {
    const at = open.findIndex(match);
    return at < 0 ? undefined : open.splice(at, 1)[0];
  };
  const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= 1;
  return saved.map((item) => {
    if (item.g === undefined) return item;
    const name = item.n.trim().toLowerCase();
    const found =
      take((a) => a.n.trim().toLowerCase() === name && same(a.g, item.g)) ??
      take((a) => a.n.trim().toLowerCase() !== name && same(a.g, item.g));
    return { ...item, gs: found ? (found.gs ?? "model") : "user" };
  });
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

/**
 * accurate = saved as answered; corrected = edited, or a correction was asked for. Any edit counts, a chip tap
 * included: what kind of edit it was is `editOf`.
 */
export function savedLabel(diff: ScanDiff, corrections: number): "accurate" | "corrected" {
  return corrections > 0 || !diffIsEmpty(diff) ? "corrected" : "accurate";
}

/** Case, spacing and punctuation folded away: one key for "Nasi Goreng" and "nasi-goreng". */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The kind of an edit and the sources of its numbers, from the diff the save produced. A rename that a "Mungkin
 * juga" tap explains (the tap's chain of names leads from the answer's name to the saved one, a removed + added
 * pair included) is a chip edit, not an identity correction. A changed number takes the stamps its row was sent
 * with (`stamps`, keyed by dish name; see lib/grams-edit.ts), "typed" when it had none.
 */
export function editOf(
  diff: ScanDiff,
  altTaps: ReadonlyArray<{ f: string; t: string }> = [],
  stamps: ReadonlyMap<string, readonly GramsEditSource[]> = new Map(),
): SessionEdit {
  const next = new Map<string, string[]>();
  for (const tap of altTaps) next.set(nameKey(tap.f), [...(next.get(nameKey(tap.f)) ?? []), nameKey(tap.t)]);
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const queue = [nameKey(from)];
    const goal = nameKey(to);
    for (let head = 0; head < queue.length; head++) {
      const here = queue[head]!;
      if (here === goal) return true;
      if (seen.has(here)) continue;
      seen.add(here);
      queue.push(...(next.get(here) ?? []));
    }
    return false;
  };
  let chipNames = 0;
  let identity = 0;
  for (const { from, to } of diff.renamed) {
    if (reaches(from.n, to.n)) chipNames += 1;
    else identity += 1;
  }
  const added = [...diff.added];
  for (const gone of diff.removed) {
    const at = added.findIndex((item) => reaches(gone.n, item.n));
    if (at < 0) identity += 1;
    else {
      added.splice(at, 1);
      chipNames += 1;
    }
  }
  identity += added.length;

  const src = new Set<GramsEditSource>();
  if (chipNames > 0) src.add("alt");
  for (const change of diff.changed) {
    const stamped = stamps.get(nameKey(change.n));
    if (stamped && stamped.length > 0) for (const source of stamped) src.add(source);
    else src.add("typed");
  }
  const kind = identity > 0 ? "identity" : chipNames + diff.changed.length > 0 ? "grams" : "none";
  return src.size > 0 ? { kind, src: [...src] } : { kind };
}

/** The edit a saved session recorded; derived from its diff for saves from before `edit` was stored; null when unsaved. */
export function savedEdit(session: ScanSession): SessionEdit | null {
  if (!session.savedLabel) return null;
  if (session.edit) return session.edit;
  return session.diff ? editOf(session.diff, session.altTaps) : null;
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

/** A successful correction: typed, spoken, or a tap on an alternate-name chip (`altTap`, which is also logged). */
export function recordSessionCorrection(
  db: Database,
  userId: string,
  photoId: string,
  altTap?: { from: string; to: string },
): Promise<unknown> {
  const pairs: Array<[string, SQL]> = [
    ["$.corrections", sql`coalesce(json_extract(${aiUsage.usageJson}, '$.corrections'), 0) + 1`],
  ];
  if (altTap) {
    const tap = jsonArg({ f: altTap.from.slice(0, 80), t: altTap.to.slice(0, 80) });
    pairs.push(["$.altTaps", sql`json(json_insert(coalesce(json_extract(${aiUsage.usageJson}, '$.altTaps'), '[]'), '$[#]', ${tap}))`]);
  }
  return patchSession(db, userId, photoId, setSql(pairs));
}

/** The shadow variant's answer for this scan, stored beside the production answer. */
export function recordSessionShadow(
  db: Database,
  userId: string,
  photoId: string,
  run: ShadowRun,
): Promise<unknown> {
  return patchSession(db, userId, photoId, setSql([["$.shadow", jsonArg(run)]]));
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
  /** Per saved dish, the chips that moved its numbers: what addScan received as `gramsFrom`. */
  gramsFrom: ReadonlyArray<{ name: string; from?: readonly GramsEditSource[] }> = [],
): Promise<(ScanSession & { savedItems: CompactItem[] }) | null> {
  const found = await loadSession(db, userId, photoId);
  if (!found) return null;
  const answer = currentAnswer(found.session);
  const savedItems = savedGramSources(compactItems(saved, false), answer);
  const diff = scanDiff(answer, savedItems);
  const label = savedLabel(diff, found.session.corrections ?? 0);
  const stamps = new Map<string, readonly GramsEditSource[]>();
  for (const { name, from } of gramsFrom) if (from && from.length > 0) stamps.set(nameKey(name), from);
  const edit = editOf(diff, found.session.altTaps, stamps);
  await patchSession(
    db,
    userId,
    photoId,
    setSql([
      ["$.savedAt", sql`${Date.now()}`],
      ["$.savedLabel", sql`${label}`],
      ["$.savedItems", jsonArg(savedItems)],
      ["$.diff", jsonArg(diff)],
      ["$.edit", jsonArg(edit)],
    ]),
  );
  return { ...found.session, savedAt: Date.now(), savedLabel: label, savedItems, diff, edit };
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

/**
 * Moment of the deploy that stopped treating the "Hitung ulang" tap as an
 * explicit rating. Older kurang_akurat rows with no reasons and no note are
 * retry taps in disguise. Set to the planned deploy time (2026-10-17 14:30 WIB).
 */
export const RETRY_TAP_CUTOVER_MS = Date.parse("2026-10-17T14:30:00+07:00");

/** scan_feedback rows that only record a "Hitung ulang" tap, not a rating. */
export function retryDerivedSql(): SQL<boolean> {
  return sql<boolean>`(coalesce(${scanFeedback.reasonsJson} like '%"${sql.raw(FEEDBACK_MARK.retryTap)}"%', 0) or (${scanFeedback.rating} = 'kurang_akurat' and coalesce(${scanFeedback.reasonsJson}, '') in ('', '[]') and coalesce(${scanFeedback.note}, '') = '' and ${scanFeedback.createdAt} < ${RETRY_TAP_CUTOVER_MS}))`;
}

/** Mirror of retryDerivedSql for one scan_feedback row. */
export function isRetryDerivedFeedback(row: {
  rating: string;
  reasonsJson: string | null;
  note: string | null;
  createdAt: number;
}): boolean {
  const reasons = row.reasonsJson ?? "";
  return (
    parseFeedbackReasons(row.reasonsJson).retryTap ||
    (row.rating === "kurang_akurat" &&
      (reasons === "" || reasons === "[]") &&
      !row.note &&
      row.createdAt < RETRY_TAP_CUTOVER_MS)
  );
}

/** Calendar day in WIB (UTC+7) for a ms timestamp column. */
export const wibDaySql = (column: unknown) =>
  sql<string>`date((${column} / 1000) + 25200, 'unixepoch')`;
