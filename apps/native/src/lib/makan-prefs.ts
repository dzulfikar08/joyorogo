import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { parseFoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";

// Last chosen Makan view and kind chip. They follow the account (rogo-prefs.ts); this is the copy on this phone.
const VIEW_KEY = "joyorogo.makan.view";
const KIND_KEY = "joyorogo.makan.kind";

export async function loadMakanPrefs(): Promise<{ view?: MakanView; kind?: FoodKindFilter }> {
  try {
    const [view, kind] = await Promise.all([
      SecureStore.getItemAsync(VIEW_KEY),
      SecureStore.getItemAsync(KIND_KEY),
    ]);
    return { view: parseMakanView(view), kind: parseFoodKindFilter(kind) };
  } catch {
    return {};
  }
}

/** Stores a choice without telling the account (it came from there); undefined = back to the default. */
export async function writeMakanPref(key: "view" | "kind", value: string | undefined): Promise<void> {
  const storeKey = key === "view" ? VIEW_KEY : KIND_KEY;
  try {
    if (value === undefined) await SecureStore.deleteItemAsync(storeKey);
    else await SecureStore.setItemAsync(storeKey, value);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

export async function saveMakanView(view: MakanView): Promise<void> {
  await writeMakanPref("view", view);
  await notePrefChanged("makan.view", view);
}

export async function saveMakanKind(kind: FoodKindFilter): Promise<void> {
  await writeMakanPref("kind", kind);
  await notePrefChanged("makan.kind", kind);
}
