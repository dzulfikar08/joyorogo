import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

// "Mode simpel" of the scan result screen (rogo-prefs.ts "scan.simple"). It follows the account; this is the copy on
// this phone. Off is the default and is never stored.
const SIMPLE_KEY = "joyorogo.scan.simple";

/** Whether the simple scan result is on (default off). */
export async function loadScanSimple(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SIMPLE_KEY)) === "1";
  } catch {
    return false;
  }
}

/** Stores the choice without telling the account (it came from there); undefined or false = back to the default. */
export async function writeScanSimple(value: unknown | undefined): Promise<void> {
  try {
    if (value === true) await SecureStore.setItemAsync(SIMPLE_KEY, "1");
    else await SecureStore.deleteItemAsync(SIMPLE_KEY);
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}

/** A user edit: stores it and queues it for the account. */
export async function saveScanSimple(value: boolean): Promise<void> {
  await writeScanSimple(value);
  await notePrefChanged("scan.simple", value);
}

/** The setting for a screen that reads it once on mount (false until the phone's copy is read). */
export function useScanSimple(): boolean | null {
  const [simple, setSimple] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void loadScanSimple().then((value) => {
      if (live) setSimple(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return simple;
}
