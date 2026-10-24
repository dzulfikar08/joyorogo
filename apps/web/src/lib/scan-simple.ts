import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// "Mode simpel" for the scan result screen; follows the account (rogo-prefs.ts "scan.simple"). Off by default: only
// `true` is ever stored, so turning it off removes the key.
const STORE_KEY = "jrg-scan-simple";

export function storedScanSimple(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stores the choice without telling the account (it came from there); anything but `true` = back to the default. */
export function writeScanSimplePref(value: unknown): void {
  try {
    if (value === true) localStorage.setItem(STORE_KEY, "1");
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Persistence is best-effort (private mode, quota); the account keeps the value.
  }
}

export function saveScanSimple(on: boolean): void {
  writeScanSimplePref(on);
  void notePrefChanged("scan.simple", on);
}
