// Test fixture: the owner's diary rows named putih telur (fixtures/owner-putih-telur.json), oldest first.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HistoryRow } from "./portion-prior";

/** A saved row as the prior reads it, with its created_at in ms. */
export type SavedEggRow = HistoryRow & { at: number };

export const ownerPutihTelurRows = (): SavedEggRow[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "fixtures/owner-putih-telur.json"), "utf8")) as { rows: SavedEggRow[] }).rows;
