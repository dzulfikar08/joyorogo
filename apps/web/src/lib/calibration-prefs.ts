import {
  CALIBRATION_PREF_KEY,
  CALIBRATION_SEEN_PREF_KEY,
  sanitizeSeenKcal,
} from "@joyorogo/api/lib/calibration";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";

// Automatic calibration of the eat target; follows the account (rogo-prefs.ts). Stored as JSON; a key that is absent
// means the default (on; no acknowledged figure), so a reset removes it. Only `false` is ever stored for the switch.
export type CalibrationPrefKey = typeof CALIBRATION_PREF_KEY | typeof CALIBRATION_SEEN_PREF_KEY;

const STORE_KEYS: Record<CalibrationPrefKey, string> = {
  [CALIBRATION_PREF_KEY]: "jrg-calibration-enabled",
  [CALIBRATION_SEEN_PREF_KEY]: "jrg-calibration-seen",
};

function sanitize(key: CalibrationPrefKey, value: unknown): boolean | number | undefined {
  if (key === CALIBRATION_PREF_KEY) return value === false ? false : undefined;
  return sanitizeSeenKcal(value);
}

/** The stored value, or undefined when none is stored or it is not one this build accepts. */
export function readCalibrationPref(key: CalibrationPrefKey): boolean | number | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEYS[key]);
    if (raw === null) return undefined;
    return sanitize(key, JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Stores a value without telling the account (it came from there); undefined = back to the default. */
export function writeCalibrationPref(key: CalibrationPrefKey, value: unknown): void {
  try {
    const clean = sanitize(key, value);
    if (clean === undefined) localStorage.removeItem(STORE_KEYS[key]);
    else localStorage.setItem(STORE_KEYS[key], JSON.stringify(clean));
  } catch {
    // Persistence is best-effort (private mode, quota); the account keeps the value.
  }
}

export function storedCalibrationEnabled(): boolean {
  return readCalibrationPref(CALIBRATION_PREF_KEY) !== false;
}

/**
 * A user edit: stores it and queues it for the account. The account gets the raw value (the server's sanitizer decides:
 * `true` is the default, so it becomes a tombstone that undoes an earlier `false` on every device).
 */
export function saveCalibrationPref(key: CalibrationPrefKey, value: unknown): void {
  writeCalibrationPref(key, value);
  void notePrefChanged(key, value);
}
