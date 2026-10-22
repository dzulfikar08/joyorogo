import * as SecureStore from "expo-secure-store";

import { parseHealthLastSync, type HealthLastSync } from "@/src/lib/health-last-sync";
import type { HealthSyncResult } from "@/src/lib/health-sync";

// Local to the device on purpose: the import itself happens here, and the server never sees it.
const KEY = "joyorogo.healthSync.last";

export async function recordHealthSync(
  result: HealthSyncResult,
  now: number = Date.now(),
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify({ ...result, at: now } satisfies HealthLastSync),
    );
  } catch {
    // Best-effort: the sources page just shows no time until the next import.
  }
}

export async function readHealthLastSync(): Promise<HealthLastSync | null> {
  try {
    return parseHealthLastSync(await SecureStore.getItemAsync(KEY));
  } catch {
    return null;
  }
}
