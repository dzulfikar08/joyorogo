// The coach document JoyoFit syncs (Pro writes, D1 `coach_doc`). Zod mirror of watch-fit's
// `src/features/coach/doc.ts`: change both together. Unknown extra keys are stripped, what the server reads is strict.
// Storage is one conditional write that decides on `rev` (same idea as JoyoFit's gear document).

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { coachDoc } from "@joyorogo/db/schema/coach";

export const COACH_DOC_LIMITS = {
  /** Serialized size of the document. */
  maxBytes: 512 * 1024,
  maxDone: 5000,
  maxLogs: 2000,
  maxExercisesPerLog: 40,
  maxSetsPerExercise: 20,
  maxWeeks: 40,
} as const;

const ms = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const shortText = z.string().max(64);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const weekAdjustSchema = z.object({
  scalePct: z.number().min(0).max(300),
  reason: z.enum(["low_recovery", "missed", "overreaching", "strong", "steady"]),
  at: ms,
});

export const coachPlanSchema = z.object({
  id: shortText,
  kind: z.enum(["run", "strength"]),
  goal: z.enum(["run5k", "run10k", "runHalf", "runRoutine", "strengthFull"]),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(1).max(7),
  setting: z.enum(["home", "gym"]).nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  startDay: localDate,
  weeks: z.number().int().min(1).max(COACH_DOC_LIMITS.maxWeeks),
  createdAt: ms,
  updatedAt: ms,
  adjust: z
    .record(z.string().max(8), weekAdjustSchema)
    .refine((value) => Object.keys(value).length <= COACH_DOC_LIMITS.maxWeeks, "too many weeks"),
});

const doneEntrySchema = z.object({
  workoutStart: z.number().int().min(0).nullable(),
  at: ms,
  manual: z.boolean(),
  skipped: z.boolean(),
});

const loggedSetSchema = z.object({
  reps: z.number().int().min(0).max(10_000),
  seconds: z.number().min(0).max(86_400).nullable(),
  weightKg: z.number().min(0).max(1000).nullable(),
});

const loggedExerciseSchema = z.object({
  exerciseId: shortText,
  sets: z.array(loggedSetSchema).max(COACH_DOC_LIMITS.maxSetsPerExercise),
});

const strengthLogSchema = z.object({
  at: ms,
  exercises: z.array(loggedExerciseSchema).max(COACH_DOC_LIMITS.maxExercisesPerLog),
});

export const coachDocSchema = z.object({
  version: z.literal(1),
  plan: coachPlanSchema.nullable(),
  planUpdatedAt: ms,
  done: z
    .record(z.string().max(96), doneEntrySchema)
    .refine((value) => Object.keys(value).length <= COACH_DOC_LIMITS.maxDone, "too many done entries"),
  logs: z
    .record(z.string().max(96), strengthLogSchema)
    .refine((value) => Object.keys(value).length <= COACH_DOC_LIMITS.maxLogs, "too many logs"),
});

export type CoachDoc = z.infer<typeof coachDocSchema>;

export interface StoredCoachDoc {
  rev: number;
  doc: CoachDoc | null;
}

export type PutCoachDocResult =
  | { status: "ok"; rev: number }
  | { status: "conflict"; rev: number; doc: CoachDoc | null };

function parseStored(json: string): CoachDoc | null {
  try {
    const parsed = coachDocSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `{ rev: 0, doc: null }` when the account has no document. */
export async function readCoachDoc(db: Database, userId: string): Promise<StoredCoachDoc> {
  const [row] = await db
    .select({ doc: coachDoc.doc, rev: coachDoc.rev })
    .from(coachDoc)
    .where(eq(coachDoc.userId, userId))
    .limit(1);
  return row ? { rev: row.rev, doc: parseStored(row.doc) } : { rev: 0, doc: null };
}

/**
 * Stores `doc` only when `baseRev` is the stored rev (0 when there is no row). One statement decides, so two phones
 * racing cannot both win: a first write inserts and on conflict updates only while the rev still is 0 (it never is
 * once a row exists); a later write updates only where rev = baseRev.
 */
export async function writeCoachDoc(
  db: Database,
  userId: string,
  baseRev: number,
  doc: CoachDoc,
  now: number = Date.now(),
): Promise<PutCoachDocResult> {
  const json = JSON.stringify(doc);
  const next = baseRev + 1;
  const changed =
    baseRev === 0
      ? await db
          .insert(coachDoc)
          .values({ userId, doc: json, rev: next, updatedAt: now })
          .onConflictDoNothing()
          .returning({ rev: coachDoc.rev })
      : await db
          .update(coachDoc)
          .set({ doc: json, rev: next, updatedAt: now })
          .where(sql`${coachDoc.userId} = ${userId} and ${coachDoc.rev} = ${baseRev}`)
          .returning({ rev: coachDoc.rev });
  if (changed.length === 1) return { status: "ok", rev: next };
  const current = await readCoachDoc(db, userId);
  return { status: "conflict", rev: current.rev, doc: current.doc };
}
