// Read-only export of an account's strength history for JoyoFit's one-time import (`workout.exportAll`).
// Pure helpers: the cursor, and the mapping from rows to the wire shape. The queries are in routers/workout.ts.

import { z } from "zod";

import type {
  workoutCustomExercise,
  workoutRoutine,
  workoutSession,
  workoutSet,
} from "@joyorogo/db/schema/plans";

export const EXPORT_PAGE_SIZE = 50;
/** Routines and custom exercises go out on the first page only; nobody has anywhere near this many. */
export const EXPORT_MAX_SIDE_ROWS = 500;

type SessionRow = typeof workoutSession.$inferSelect;
type SetRow = typeof workoutSet.$inferSelect;
type RoutineRow = typeof workoutRoutine.$inferSelect;
type CustomRow = typeof workoutCustomExercise.$inferSelect;

/** `cursor` is what a previous page returned as `nextCursor`; anything else is a validation error. */
export const exportInputSchema = z.object({
  cursor: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const cursor = decodeExportCursor(value);
      if (!cursor) {
        ctx.addIssue({ code: "custom", message: "invalid cursor" });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
  limit: z.number().int().min(1).max(EXPORT_PAGE_SIZE).default(EXPORT_PAGE_SIZE),
});

/** Position after the last session of a page, in the order (date desc, created_at desc, id desc). */
export interface ExportCursor {
  date: string;
  createdAt: number;
  id: string;
}

const cursorTupleSchema = z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int(), z.string().min(1).max(100)]);

/** Opaque to the client: base64 of the last row's sort tuple. */
export function encodeExportCursor(cursor: ExportCursor): string {
  return btoa(JSON.stringify([cursor.date, cursor.createdAt, cursor.id]));
}

/** Null when the string is not a cursor this server made. */
export function decodeExportCursor(raw: string): ExportCursor | null {
  try {
    const parsed = cursorTupleSchema.safeParse(JSON.parse(atob(raw)));
    if (!parsed.success) return null;
    const [date, createdAt, id] = parsed.data;
    return { date, createdAt, id };
  } catch {
    return null;
  }
}

export interface ExportSet {
  id: string;
  exerciseId: string;
  position: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  rpe: number | null;
  setType: string;
  note: string | null;
  supersetGroup: number | null;
}

export interface ExportSession {
  id: string;
  date: string;
  name: string;
  startedAt: string | null;
  durationMin: number | null;
  note: string | null;
  createdAt: string;
  kcal: number | null;
  sets: ExportSet[];
}

export function toExportSet(row: SetRow): ExportSet {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    position: row.position,
    reps: row.reps,
    weightKg: row.weightKg,
    durationSec: row.durationSec,
    rpe: row.rpe,
    setType: row.setType,
    note: row.note,
    supersetGroup: row.supersetGroup,
  };
}

/** Sessions in the order given, each with its sets in `position` order; `kcal` from the mirror row, null when it has none. */
export function toExportSessions(
  sessions: readonly (SessionRow & { kcal: number | null })[],
  sets: readonly SetRow[],
): ExportSession[] {
  const bySession = new Map<string, SetRow[]>();
  for (const set of sets) {
    const list = bySession.get(set.sessionId);
    if (list) list.push(set);
    else bySession.set(set.sessionId, [set]);
  }
  return sessions.map((session) => ({
    id: session.id,
    date: session.date,
    name: session.name,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    durationMin: session.durationMin,
    note: session.note,
    createdAt: session.createdAt.toISOString(),
    kcal: session.kcal,
    sets: (bySession.get(session.id) ?? [])
      .toSorted((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
      .map(toExportSet),
  }));
}

export function toExportRoutine(row: RoutineRow) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    exercises: row.exercises,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toExportCustomExercise(row: CustomRow) {
  return {
    id: row.id,
    name: row.name,
    muscle: row.muscle,
    equipment: row.equipment,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `rows` are the sessions read for a page, `limit + 1` of them at most: the extra row only says there is a next page.
 * Returns the sessions of the page and the cursor of its last one (null on the last page).
 */
export function splitExportPage<T extends { date: string; createdAt: Date; id: string }>(
  rows: readonly T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeExportCursor({ date: last.date, createdAt: last.createdAt.getTime(), id: last.id }) : null;
  return { page, nextCursor };
}
