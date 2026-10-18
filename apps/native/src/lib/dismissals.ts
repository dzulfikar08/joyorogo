import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";

// Notices the person closed for good. They follow the account (rogo-prefs.ts), but this phone can hold several
// accounts, so the local key carries the user id; the synced key does not.
export type DismissalKey = "dismissed.handlePrompt" | "dismissed.stravaRetention7d" | "dismissed.addBackNotice2";

const LOCAL_KEYS: Record<DismissalKey, (userId: string) => string> = {
  "dismissed.handlePrompt": (userId) => `joyorogo.handlePrompt.${userId}`,
  "dismissed.stravaRetention7d": (userId) => `joyorogo.stravaRetention7d.${userId}`,
  "dismissed.addBackNotice2": (userId) => `joyorogo.addBackNotice2.${userId}`,
};

export const dismissalStoreKey = (key: DismissalKey, userId: string): string => LOCAL_KEYS[key](userId);

/** Stores the dismissal without telling the account (it came from there); false clears it. */
export async function writeDismissal(key: DismissalKey, userId: string, dismissed: boolean): Promise<void> {
  try {
    if (dismissed) await SecureStore.setItemAsync(dismissalStoreKey(key, userId), "1");
    else await SecureStore.deleteItemAsync(dismissalStoreKey(key, userId));
  } catch {
    // Best-effort: the notice only comes back.
  }
}

export async function readDismissal(key: DismissalKey, userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(dismissalStoreKey(key, userId))) === "1";
  } catch {
    return false;
  }
}

export async function saveDismissal(key: DismissalKey, userId: string): Promise<void> {
  await writeDismissal(key, userId, true);
  await notePrefChanged(key, true);
}
