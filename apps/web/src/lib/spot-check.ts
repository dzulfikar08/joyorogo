import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// "Cek sesekali" (spot-check mode, packages/api lib/spot-check): follows the account (rogo-prefs.ts
// "logging.spotCheck"). Off by default: only `true` is ever stored, so turning it off removes the key.
const STORE_KEY = "jrg-spot-check";

export function storedSpotCheck(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stores the choice without telling the account (it came from there); anything but `true` = back to the default. */
export function writeSpotCheckPref(value: unknown): void {
  try {
    if (value === true) localStorage.setItem(STORE_KEY, "1");
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Persistence is best-effort (private mode, quota); the account keeps the value.
  }
}

export function saveSpotCheck(on: boolean): void {
  writeSpotCheckPref(on);
  void notePrefChanged("logging.spotCheck", on);
}
