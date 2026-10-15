import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { parseFoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";

// Last chosen Makan view and kind chip, per device. The ?view= / ?kind= URL
// params win; these only fill in when the URL does not say.
const VIEW_KEY = "jrg-makan-view";
const KIND_KEY = "jrg-makan-kind";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort (private mode, quota); the URL still carries it.
  }
}

export const storedMakanView = (): MakanView | undefined => parseMakanView(read(VIEW_KEY));
export const saveMakanView = (view: MakanView): void => write(VIEW_KEY, view);
export const storedKind = (): FoodKindFilter | undefined => parseFoodKindFilter(read(KIND_KEY));
export const saveKind = (kind: FoodKindFilter): void => write(KIND_KEY, kind);
