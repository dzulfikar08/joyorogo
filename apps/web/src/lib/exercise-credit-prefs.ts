import {
  ADD_BACK_PREF_KEYS,
  ADD_BACK_SANITIZERS,
  addBackSettings,
  type AddBackPrefKey,
  type AddBackSettings,
} from "@joyorogo/api/lib/exercise-credit";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// How much recorded exercise Sisa adds back; follows the account (rogo-prefs.ts). Stored as JSON per key; a key that
// is absent means the default, so a reset removes it.
const STORE_KEYS: Record<AddBackPrefKey, string> = {
  "exercise.addBack.enabled": "jrg-addback-enabled",
  "exercise.addBack.pct": "jrg-addback-pct",
  "exercise.addBack.source": "jrg-addback-source",
  "exercise.addBack.stepThreshold": "jrg-addback-step-threshold",
  "exercise.addBack.cap": "jrg-addback-cap",
};

/** The stored value, or undefined when none is stored or it is not one this build accepts. */
export function readAddBackPref(key: AddBackPrefKey): unknown | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEYS[key]);
    if (raw === null) return undefined;
    return ADD_BACK_SANITIZERS[key](JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Stores a value without telling the account (it came from there); undefined = back to the default. */
export function writeAddBackPref(key: AddBackPrefKey, value: unknown | undefined): void {
  try {
    const clean = ADD_BACK_SANITIZERS[key](value);
    if (clean === undefined) localStorage.removeItem(STORE_KEYS[key]);
    else localStorage.setItem(STORE_KEYS[key], JSON.stringify(clean));
  } catch {
    // Persistence is best-effort (private mode, quota); the account keeps the value.
  }
}

export function storedAddBackSettings(): AddBackSettings {
  const values: Partial<Record<AddBackPrefKey, unknown>> = {};
  for (const key of ADD_BACK_PREF_KEYS) values[key] = readAddBackPref(key);
  return addBackSettings(values);
}

/** A user edit: stores it and queues it for the account. */
export function saveAddBackPref(key: AddBackPrefKey, value: unknown): void {
  writeAddBackPref(key, value);
  void notePrefChanged(key, value);
}
