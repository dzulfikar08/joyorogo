// The "Piring saya" rows of one user and what a photo scan does with them (docs/dishware.md).
import { asc, eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dishware } from "@joyorogo/db/schema/dishware";

import { cardOutcome, matchDishware, MAX_DISHWARE, referenceInstruction } from "./dishware";
import type { DishwareKind } from "./dishware";
import type { CardAnswer } from "./vision";

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

/** A card lay next to the food and the model was told its size as a hint ("Kartu terlihat ..., petunjuk saja"). Absent = nothing to say. */
export type CardScanNote = { status: "used" };

/** What the ledger keeps of the card question (usage_json.card): the model's own detection, and whether it counted. */
export type CardLedger = { seen: boolean; used: boolean; confidence: number };

export type ScanReference = {
  plates: DishwareRow[];
  /** The prompt block (lib/dishware.ts): the card reference, then the plates; no image is sent for either. */
  instruction: string;
  /** Turns the model's `plate` answer into what the result carries; undefined when the user has no plates (nothing was asked). */
  plateNote: (answer: string | null | undefined) => DishwareScanNote | undefined;
  /** The model's `card` answer: what the result says (only a card that counted) and what the ledger keeps. */
  cardNote: (answer: CardAnswer | undefined) => { note: CardScanNote | undefined; ledger: CardLedger };
};

/**
 * What a scan of this user adds to the prompt: null for a user outside the allowlist, so everyone else is
 * scanned exactly as before. An allowlisted user always gets the card reference, and their plates too when
 * they have registered any. A failed plate read is the card alone, never a failed scan.
 */
export async function loadScanReference(
  db: Database,
  env: { DISHWARE_USER_IDS?: string },
  userId: string,
): Promise<ScanReference | null> {
  if (!dishwareEnabled(env, userId)) return null;
  let plates: DishwareRow[] = [];
  try {
    plates = await loadDishware(db, userId);
  } catch (error) {
    console.error("[ai] dishware read failed", error);
  }
  const instruction = referenceInstruction(plates, true);
  if (instruction === null) return null;
  return {
    plates,
    instruction,
    plateNote: (answer) => {
      if (plates.length === 0) return undefined;
      const match = matchDishware(answer, plates);
      if (match.status === "none") return { status: "none" };
      const { id, name, kind, diameterCm, widthCm } = match.plate;
      return { status: "matched", id, name, kind, diameterCm, widthCm };
    },
    cardNote: (answer) => {
      const outcome = cardOutcome(answer);
      return { note: outcome.used ? { status: "used" } : undefined, ledger: outcome };
    },
  };
}
