import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { parseFoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// Last chosen Makan view and kind chip; they follow the account (rogo-prefs.ts). The
// ?view= / ?kind= URL params win; these only fill in when the URL does not say.
const VIEW_KEY = "jrg-makan-view";
const KIND_KEY = "jrg-makan-kind";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a choice without telling the account (it came from there); undefined = back to the default. */
export function writeMakanPref(key: "view" | "kind", value: string | undefined): void {
  const storeKey = key === "view" ? VIEW_KEY : KIND_KEY;
  try {
    if (value === undefined) localStorage.removeItem(storeKey);
    else localStorage.setItem(storeKey, value);
  } catch {
    // Persistence is best-effort (private mode, quota); the URL still carries it.
  }
}

export const storedMakanView = (): MakanView | undefined => parseMakanView(read(VIEW_KEY));
export function saveMakanView(view: MakanView): void {
  writeMakanPref("view", view);
  void notePrefChanged("makan.view", view);
}
export const storedKind = (): FoodKindFilter | undefined => parseFoodKindFilter(read(KIND_KEY));
export function saveKind(kind: FoodKindFilter): void {
  writeMakanPref("kind", kind);
  void notePrefChanged("makan.kind", kind);
}
