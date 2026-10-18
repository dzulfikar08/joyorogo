// JoyoFit's strength records (Pro writes, D1 `strength_record`). Zod mirror of watch-fit's
// `src/features/strength/types.ts`: change both together. A record is `{ kind, id, json, updatedAt, deletedAt }`
// where `json` is the document exactly as the phone stores it; the server validates it and stores the same string,
// so keys it does not know yet (a newer app) are preserved. Storage and pull live in `strength-record-store.ts`.

import { z } from "zod";

export const STRENGTH_KINDS = ["workout", "routine", "folder", "exercise", "pref"] as const;
export type StrengthKind = (typeof STRENGTH_KINDS)[number];

export const STRENGTH_LIMITS = {
  /** Records in one push. */
  batch: 100,
  /** Records one account may hold. */
  perUser: 50_000,
  /** Records in one pull page. */
  pullPage: 200,
  /** Serialized size of one record's document. */
  maxJsonBytes: 48 * 1024,
  /** Serialized size of one pull page, so a page stays small on a phone; at least one record always goes out. */
  pullPageBytes: 1_500_000,
  maxExercises: 60,
  maxSets: 60,
  maxNote: 2000,
  maxId: 64,
  maxName: 200,
} as const;

const ms = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(STRENGTH_LIMITS.maxId);
const note = z.string().max(STRENGTH_LIMITS.maxNote);
const name = z.string().max(STRENGTH_LIMITS.maxName);
// A catalog slug (`barbell_bench_press`), `custom_<base36>` or `custom_rogo_<uuid>`.
const exerciseId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
// Muscle and equipment ids come from the app's catalog, which grows: shape only.
const catalogKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const setType = z.enum(["normal", "warmup", "drop", "failure"]);
const restSec = z.number().int().min(0).max(3600).nullable();
const supersetGroup = z.number().int().min(0).max(99).nullable();
const weightKg = z.number().min(0).max(2000).nullable();
const reps = z.number().int().min(0).max(10_000).nullable();
const seconds = z.number().min(0).max(86_400).nullable();

const strengthSetSchema = z.looseObject({
  id,
  type: setType,
  weightKg,
  reps,
  seconds,
  rpe: z.number().min(0).max(10).nullable(),
  done: z.boolean(),
  doneAt: ms.nullable(),
});

const strengthExerciseSchema = z.looseObject({
  key: id,
  exerciseId,
  note,
  restSec,
  supersetGroup,
  sets: z.array(strengthSetSchema).max(STRENGTH_LIMITS.maxSets),
});

const workoutSchema = z.looseObject({
  id,
  name,
  startedAt: ms,
  endedAt: ms,
  durationSec: z.number().int().min(0).max(7 * 86_400),
  note,
  routineId: id.nullable(),
  planKey: z.string().max(128).nullable(),
  exercises: z.array(strengthExerciseSchema).max(STRENGTH_LIMITS.maxExercises),
  workoutStart: ms.nullable(),
  kcal: z.number().min(0).max(100_000).nullable(),
  kcalSource: z.enum(["watch", "estimate"]).nullable(),
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

const routineSetSchema = z.looseObject({ type: setType, weightKg, reps, seconds });

const routineExerciseSchema = z.looseObject({
  exerciseId,
  restSec,
  note,
  supersetGroup,
  sets: z.array(routineSetSchema).max(STRENGTH_LIMITS.maxSets),
});

const routineSchema = z.looseObject({
  id,
  name,
  folderId: id.nullable(),
  note,
  exercises: z.array(routineExerciseSchema).max(STRENGTH_LIMITS.maxExercises),
  sortOrder: z.number().min(-1e15).max(1e15),
  createdAt: ms,
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

const folderSchema = z.looseObject({
  id,
  name,
  sortOrder: z.number().min(-1e15).max(1e15),
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

const exerciseSchema = z.looseObject({
  id: exerciseId,
  name,
  primary: z.array(catalogKey).max(12),
  equipment: catalogKey,
  timed: z.boolean(),
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

const prefSchema = z.looseObject({
  id: exerciseId,
  restSec,
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

const DOC_SCHEMAS = {
  workout: workoutSchema,
  routine: routineSchema,
  folder: folderSchema,
  exercise: exerciseSchema,
  pref: prefSchema,
} as const satisfies Record<StrengthKind, z.ZodType>;

/** One record on the wire (push input, pull output). An unknown `kind` fails the whole request. */
export const strengthRecordSchema = z.object({
  kind: z.enum(STRENGTH_KINDS),
  id,
  json: z.string().min(2).max(STRENGTH_LIMITS.maxJsonBytes),
  updatedAt: ms,
  deletedAt: ms.nullable(),
});

export type StrengthRecordInput = z.infer<typeof strengthRecordSchema>;

export const strengthPushSchema = z.object({
  records: z.array(strengthRecordSchema).max(STRENGTH_LIMITS.batch),
});

export const strengthPullSchema = z.object({
  since: ms.default(0),
  limit: z.number().int().min(1).max(STRENGTH_LIMITS.pullPage).optional(),
});

export type StrengthInvalidReason = "too_large" | "not_json" | "shape" | "id_mismatch";

export type StrengthValidation = { ok: true } | { ok: false; reason: StrengthInvalidReason };

/**
 * Checks a record's document: size, JSON, the shape of its kind, and that the document's own `id` is the record id.
 * The record's `updatedAt` / `deletedAt` columns are what last-write-wins uses; they come from the phone beside the
 * document and are trusted the same way.
 */
export function validateStrengthRecord(record: StrengthRecordInput): StrengthValidation {
  if (new TextEncoder().encode(record.json).length > STRENGTH_LIMITS.maxJsonBytes) {
    return { ok: false, reason: "too_large" };
  }
  let value: unknown;
  try {
    value = JSON.parse(record.json);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = DOC_SCHEMAS[record.kind].safeParse(value);
  if (!parsed.success) return { ok: false, reason: "shape" };
  const doc: { id: string } = parsed.data;
  if (doc.id !== record.id) return { ok: false, reason: "id_mismatch" };
  return { ok: true };
}

export interface PullRow {
  kind: string;
  id: string;
  json: string;
  updatedAt: number;
  deletedAt: number | null;
  serverAt: number;
}

export interface PullPage {
  records: { kind: string; id: string; json: string; updatedAt: number; deletedAt: number | null }[];
  /** `server_at` of the last record of the page, or the `since` that was asked for when the page is empty. */
  cursor: number;
  hasMore: boolean;
}

/**
 * Builds the answer from rows read in (server_at, kind, id) order, `limit + 1` of them at most: the extra row only
 * says there is more. A page also stops at `pullPageBytes` of documents (never before its first record).
 */
export function buildPullPage(rows: readonly PullRow[], since: number, limit: number): PullPage {
  const records: PullPage["records"] = [];
  let bytes = 0;
  let cursor = since;
  let taken = 0;
  for (const row of rows) {
    if (taken >= limit) break;
    const size = row.json.length;
    if (taken > 0 && bytes + size > STRENGTH_LIMITS.pullPageBytes) break;
    bytes += size;
    taken += 1;
    cursor = row.serverAt;
    records.push({ kind: row.kind, id: row.id, json: row.json, updatedAt: row.updatedAt, deletedAt: row.deletedAt });
  }
  return { records, cursor, hasMore: taken < rows.length };
}

/** The `server_at` of the first row of a push: after `now` and after every row the account already has. */
export function firstServerAt(now: number, maxServerAt: number | null): number {
  return Math.max(now, (maxServerAt ?? 0) + 1);
}
