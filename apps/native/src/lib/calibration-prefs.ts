import {
  CALIBRATION_PREF_KEY,
  CALIBRATION_SEEN_PREF_KEY,
  DEFAULT_CALIBRATION_ENABLED,
  sanitizeSeenKcal,
} from "@joyorogo/api/lib/calibration";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";

// Automatic calibration of the eat target. Both settings follow the account (rogo-prefs.ts, the server reads the
// switch from the synced record); this is the copy on this phone. At the default (switch on, nothing acknowledged)
// nothing is stored.
export type CalibrationPrefKey = typeof CALIBRATION_PREF_KEY | typeof CALIBRATION_SEEN_PREF_KEY;

const storeKey = (key: CalibrationPrefKey) => `joyorogo.${key}`;

const sanitize = (key: CalibrationPrefKey, value: unknown): unknown | undefined =>
  key === CALIBRATION_PREF_KEY ? (value === false ? false : undefined) : sanitizeSeenKcal(value);

/** The stored value of one setting, or undefined when none (or a malformed one) is stored. */
export async function readCalibrationPref(key: CalibrationPrefKey): Promise<unknown | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(storeKey(key));
    return raw === null ? undefined : sanitize(key, JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Stores a setting without telling the account (it came from there); undefined = back to the default. */
export async function writeCalibrationPref(key: CalibrationPrefKey, value: unknown | undefined): Promise<void> {
  try {
    const clean = value === undefined ? undefined : sanitize(key, value);
    if (clean === undefined) await SecureStore.deleteItemAsync(storeKey(key));
    else await SecureStore.setItemAsync(storeKey(key), JSON.stringify(clean));
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

/** Whether calibration is on for this account (default on). */
export async function loadCalibrationEnabled(): Promise<boolean> {
  return (await readCalibrationPref(CALIBRATION_PREF_KEY)) === false ? false : DEFAULT_CALIBRATION_ENABLED;
}

/** A user edit: stores it and queues it for the account. The caller then runs `syncPrefs()`. */
export async function saveCalibrationPref(key: CalibrationPrefKey, value: unknown): Promise<void> {
  await writeCalibrationPref(key, value);
  await notePrefChanged(key, value);
}
