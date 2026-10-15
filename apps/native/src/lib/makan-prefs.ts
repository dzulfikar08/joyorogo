import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { parseFoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import * as SecureStore from "expo-secure-store";

// Last chosen Makan view and kind chip, kept on this device.
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

export async function saveMakanView(view: MakanView): Promise<void> {
  try {
    await SecureStore.setItemAsync(VIEW_KEY, view);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

export async function saveMakanKind(kind: FoodKindFilter): Promise<void> {
  try {
    await SecureStore.setItemAsync(KIND_KEY, kind);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}
