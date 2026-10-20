// The "Piring saya" rows of one user and what a photo scan does with them (docs/dishware.md).
import { asc, eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dishware } from "@joyorogo/db/schema/dishware";

import { dishwareInstruction, matchDishware, MAX_DISHWARE } from "./dishware";
import type { DishwareKind } from "./dishware";

export type DishwareRow = typeof dishware.$inferSelect;

/**
 * `DISHWARE_USER_IDS` is a comma-separated user id allowlist (owner and QA); empty or unset = nobody.
 * Everyone else keeps scanning exactly as before and never sees the screen.
 */
export function dishwareEnabled(env: { DISHWARE_USER_IDS?: string }, userId: string): boolean {
  return (env.DISHWARE_USER_IDS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === userId);
}

/** The user's plates, oldest first (the order the scan prompt labels them P1, P2, ...). */
export async function loadDishware(db: Database, userId: string): Promise<DishwareRow[]> {
  return db
    .select()
    .from(dishware)
    .where(eq(dishware.userId, userId))
    .orderBy(asc(dishware.createdAt), asc(dishware.id))
    .limit(MAX_DISHWARE);
}

/** What the scan result tells the user about their plates. Absent from the result = nothing was asked. */
export type DishwareScanNote =
  | { status: "matched"; id: string; name: string; kind: DishwareKind; diameterCm: number; widthCm: number | null }
  | { status: "none" };

export type ScanDishware = {
  plates: DishwareRow[];
  /** The prompt block (lib/dishware.ts); one scan, one string, nothing per plate sent as an image. */
  instruction: string;
  /** Turns the model's `plate` answer into what the result carries. */
  note: (answer: string | null | undefined) => DishwareScanNote;
};

/**
 * The plates a scan of this user should be told about: null for a user outside the allowlist, with no
 * plates, or when the read fails (a failed read is an ordinary scan, never a failed one).
 */
export async function loadScanDishware(
  db: Database,
  env: { DISHWARE_USER_IDS?: string },
  userId: string,
): Promise<ScanDishware | null> {
  if (!dishwareEnabled(env, userId)) return null;
  let plates: DishwareRow[];
  try {
    plates = await loadDishware(db, userId);
  } catch (error) {
    console.error("[ai] dishware read failed", error);
    return null;
  }
  const instruction = dishwareInstruction(plates);
  if (instruction === null) return null;
  return {
    plates,
    instruction,
    note: (answer) => {
      const match = matchDishware(answer, plates);
      if (match.status === "none") return { status: "none" };
      const { id, name, kind, diameterCm, widthCm } = match.plate;
      return { status: "matched", id, name, kind, diameterCm, widthCm };
    },
  };
}
