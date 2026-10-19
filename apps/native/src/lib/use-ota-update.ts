import * as Updates from "expo-updates";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

import {
  OTA_LAUNCH_TIMEOUT_MS,
  otaPercent,
  otaPhase,
  otaSource,
  raceTimeout,
} from "@/src/lib/ota-policy";

/** True in a release build that embeds expo-updates; false in dev clients, Expo Go and on the web. */
export const OTA_ENABLED = Platform.OS !== "web" && Updates.isEnabled;

/**
 * Asks the update server for a newer JS bundle and downloads it. The launch-time check is done by
 * expo-updates itself (`checkAutomatically: ON_LOAD`); this is for the manual button and the
 * foreground re-check. A downloaded update waits for the next cold start, or `restartOta()`.
 * Any failure leaves the running bundle (and the one already cached) untouched.
 */
export async function checkAndFetchOta(): Promise<void> {
  await checkAndFetchOtaReady();
}

let launchRefresh: Promise<void> | null = null;

/**
 * Cold start: if an OTA update exists for this runtime, download it and reload into it before the
 * app shows, so users never run a stale bundle. Gives up after OTA_LAUNCH_TIMEOUT_MS (the download
 * keeps going and surfaces as the usual "Mulai ulang" banner) and on any error. Runs once per process.
 */
export function refreshOtaAtLaunch(): Promise<void> {
  if (!OTA_ENABLED) return Promise.resolve();
  launchRefresh ??= (async () => {
    try {
      const result = await raceTimeout(checkAndFetchOtaReady(), OTA_LAUNCH_TIMEOUT_MS);
      if (!result.timedOut && result.value) await Updates.reloadAsync();
    } catch {
      // Offline or the server errored: the cached bundle is fine.
    }
  })();
  return launchRefresh;
}

/** True when a new bundle (or a rollback to the embedded one) is now downloaded and waiting. */
async function checkAndFetchOtaReady(): Promise<boolean> {
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable && !check.isRollBackToEmbedded) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

/** Reloads into the downloaded update (or the embedded bundle after a rollback). */
export async function restartOta(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // Reload refused (no pending update, updates disabled): the app just keeps running.
  }
}

/** OTA state for the Pembaruan card and the banner. Shares expo-updates' global state across callers. */
export function useOtaUpdate() {
  const state = Updates.useUpdates();
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    if (!OTA_ENABLED) return;
    setFailed(false);
    try {
      await checkAndFetchOta();
    } catch {
      setFailed(true);
    }
  }, []);

  const phase = otaPhase({
    enabled: OTA_ENABLED,
    isChecking: state.isChecking,
    isDownloading: state.isDownloading,
    isUpdatePending: state.isUpdatePending,
    hasError: failed || Boolean(state.checkError ?? state.downloadError),
  });
  const running = state.currentlyRunning;

  return {
    phase,
    percent: otaPercent(state.downloadProgress),
    source: otaSource(running.isEmbeddedLaunch, running.isEmergencyLaunch),
    updateId: running.updateId ?? null,
    createdAt: running.createdAt ?? null,
    runtimeVersion: running.runtimeVersion ?? null,
    channel: running.channel ?? null,
    check,
    restart: restartOta,
  };
}
