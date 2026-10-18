import {
  ADD_BACK_PREF_KEYS,
  ADD_BACK_SANITIZERS,
  addBackSettings,
  type AddBackPrefKey,
  type AddBackSettings,
} from "@joyorogo/api/lib/exercise-credit";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";

// How much exercise Sisa adds back. The settings follow the account (rogo-prefs.ts, read by the server from the
// synced record); this is the copy on this phone that the settings screen shows. At the default nothing is stored.
const storeKey = (key: AddBackPrefKey) => `joyorogo.${key}`;

/** The stored value of one setting, or undefined when none (or a malformed one) is stored. */
export async function readAddBackPref(key: AddBackPrefKey): Promise<unknown | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(storeKey(key));
    return raw === null ? undefined : ADD_BACK_SANITIZERS[key](JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Stores a setting without telling the account (it came from there); undefined = back to the default. */
export async function writeAddBackPref(key: AddBackPrefKey, value: unknown | undefined): Promise<void> {
  try {
    if (value === undefined) await SecureStore.deleteItemAsync(storeKey(key));
    else await SecureStore.setItemAsync(storeKey(key), JSON.stringify(value));
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

/** All five settings, defaults filled in. */
export async function loadAddBackSettings(): Promise<AddBackSettings> {
  const entries = await Promise.all(ADD_BACK_PREF_KEYS.map(async (key) => [key, await readAddBackPref(key)] as const));
  return addBackSettings(Object.fromEntries(entries));
}

/** A user edit: stores it and queues it for the account. The caller then runs `syncPrefs()`. */
export async function saveAddBackPref(key: AddBackPrefKey, value: unknown): Promise<void> {
  await writeAddBackPref(key, value);
  await notePrefChanged(key, value);
}
