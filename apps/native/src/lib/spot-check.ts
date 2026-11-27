import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

// "Cek sesekali" (spot-check mode, packages/api lib/spot-check; rogo-prefs.ts "logging.spotCheck"). It follows the
// account; this is the copy on this phone. Off is the default and is never stored. While on, the phone schedules no
// meal or Naikin BB evening reminders (lib/notifications) and Beranda shows no "days without a log".
const SPOT_CHECK_KEY = "joyorogo.logging.spotCheck";

const listeners = new Set<(on: boolean) => void>();

/** Whether spot-check mode is on (default off). */
export async function loadSpotCheck(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SPOT_CHECK_KEY)) === "1";
  } catch {
    return false;
  }
}

/** Stores the choice without telling the account (it came from there); undefined or false = back to the default. */
export async function writeSpotCheck(value: unknown | undefined): Promise<void> {
  const on = value === true;
  try {
    if (on) await SecureStore.setItemAsync(SPOT_CHECK_KEY, "1");
    else await SecureStore.deleteItemAsync(SPOT_CHECK_KEY);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
  for (const listener of listeners) listener(on);
}

/** A user edit: stores it and queues it for the account. */
export async function saveSpotCheck(value: boolean): Promise<void> {
  await writeSpotCheck(value);
  await notePrefChanged("logging.spotCheck", value);
}

/** The setting, kept current while mounted (null until the phone's copy is read). */
export function useSpotCheck(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const listener = (value: boolean) => {
      if (live) setOn(value);
    };
    listeners.add(listener);
    void loadSpotCheck().then(listener);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return on;
}
