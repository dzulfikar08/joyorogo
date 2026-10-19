import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// Notices the person closed for good. They follow the account (rogo-prefs.ts), but a browser can hold several
// accounts, so the local key carries the user id; the synced key does not.
export type DismissalKey = "dismissed.handlePrompt" | "dismissed.stravaRetention7d" | "dismissed.energyModel";

const LOCAL_KEYS: Record<DismissalKey, (userId: string) => string> = {
  "dismissed.handlePrompt": (userId) => `jrg-handle-prompt-${userId}`,
  "dismissed.stravaRetention7d": (userId) => `jrg-strava-7d-${userId}`,
  "dismissed.energyModel": (userId) => `jrg-energy-model-${userId}`,
};

export const dismissalStoreKey = (key: DismissalKey, userId: string): string => LOCAL_KEYS[key](userId);

/** Stores the dismissal without telling the account (it came from there); false clears it. */
export function writeDismissal(key: DismissalKey, userId: string, dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(dismissalStoreKey(key, userId), "1");
    else localStorage.removeItem(dismissalStoreKey(key, userId));
  } catch {
    // Storage blocked: the notice only comes back.
  }
}

export function saveDismissal(key: DismissalKey, userId: string): void {
  writeDismissal(key, userId, true);
  void notePrefChanged(key, true);
}
