import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { i18n } from "@joyorogo/i18n";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { IS_PLAY_BUILD } from "@/src/distribution";
import { ENV } from "@/src/env";

/** Manifest served at GET /downloads/latest-apk.json (written by build-release-apk.sh). */
export type ApkUpdate = {
  versionCode: number;
  versionName: string;
  size: number;
  sha256: string;
  /** Checked natively (streamed) when present; hashing a ~50 MB APK in JS failed on device. */
  md5?: string;
};

/**
 * One finished check. "error" is a network/HTTP/malformed-response failure,
 * deliberately distinct from "up-to-date" so Profil never paints a failed
 * check as current.
 */
export type ApkCheckResult =
  | { state: "up-to-date" }
  | { state: "available"; update: ApkUpdate }
  | { state: "error"; message: string };

/** What useApkUpdate gives the UI; result is null while a check is running. */
export type ApkUpdateState = {
  result: ApkCheckResult | null;
  /** Manual re-check: bypasses the shared cache and the 6h throttle. */
  refresh: () => Promise<void>;
  refreshing: boolean;
};

// Re-check at most every 6 hours: the check on app start must stay cheap and
// silent, not a request on every launch.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "apk-update-checked-at";

/** Sideload Android builds only: Google Play builds update through Play and never fetch. */
const UPDATER_ENABLED = Platform.OS === "android" && !IS_PLAY_BUILD;

/** Server origin, same contract as utils/orpc.ts: ENV is the source of truth. */
const SERVER_ORIGIN = ENV.EXPO_PUBLIC_SERVER_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

/**
 * Resolves only with a valid manifest; throws a localized message on
 * network, HTTP or malformed-body failures. Callers decide whether the
 * failure stays silent (app start) or is surfaced (manual check).
 */
async function fetchLatestApk(): Promise<ApkUpdate> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_ORIGIN}/downloads/latest-apk.json`);
  } catch {
    throw new Error(i18n.t("settings:update.error.offline"));
  }
  if (!res.ok) throw new Error(i18n.t("settings:update.error.rejected", { status: res.status }));
  let body: ApkUpdate;
  try {
    body = (await res.json()) as ApkUpdate;
  } catch {
    throw new Error(i18n.t("settings:update.error.invalidResponse"));
  }
  if (typeof body.versionCode !== "number" || typeof body.sha256 !== "string") {
    throw new Error(i18n.t("settings:update.error.invalidResponse"));
  }
  return body;
}

function installedVersionCode(): number {
  const native = Application.nativeBuildVersion;
  const parsed = native ? Number.parseInt(native, 10) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Installed version for the Profil section; Android builds always carry both. */
export function installedAppVersion(): { versionName: string; versionCode: number } {
  return {
    versionName: Application.nativeApplicationVersion ?? "-",
    versionCode: installedVersionCode(),
  };
}

/**
 * Shared update state so the silent app-start check and the Profil screen see
 * the same result without refetching.
 */
let cached: ApkCheckResult | undefined;
let inFlight: Promise<ApkCheckResult> | null;

/** Fetch + compare, storing the outcome — including errors — in the cache. */
async function runCheck(): Promise<ApkCheckResult> {
  let result: ApkCheckResult;
  try {
    const update = await fetchLatestApk();
    result =
      update.versionCode > installedVersionCode()
        ? { state: "available", update }
        : { state: "up-to-date" };
  } catch (e) {
    result = {
      state: "error",
      message:
        e instanceof Error && e.message ? e.message : i18n.t("settings:update.error.checkFailed"),
    };
  }
  cached = result;
  void SecureStore.setItemAsync(LAST_CHECK_KEY, String(Date.now())).catch(() => {});
  return result;
}

/**
 * Automatic check. Unforced callers (app start) reuse the cache and honour
 * the 6h throttle; forced callers (Profil mount) always fetch. Never throws.
 */
async function autoCheck(force: boolean): Promise<ApkCheckResult> {
  if (!force && cached !== undefined) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!force) {
      const last = await SecureStore.getItemAsync(LAST_CHECK_KEY).catch(() => null);
      if (last && Date.now() - Number(last) < CHECK_THROTTLE_MS) {
        const result: ApkCheckResult = cached ?? { state: "up-to-date" };
        cached = result;
        return result;
      }
    }
    return runCheck();
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Sideload-Android-only update check. iOS, web and the Play build never fetch
 * the manifest and get null so the UI renders nothing. On Android the state starts as "checking"
 * (result null) and settles into one ApkCheckResult.
 */
export function useApkUpdate(force = false): ApkUpdateState | null {
  const [result, setResult] = useState<ApkCheckResult | null>(
    UPDATER_ENABLED && cached !== undefined ? cached : null,
  );
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!UPDATER_ENABLED) return;
    let live = true;
    void autoCheck(force).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [force]);

  const refresh = useCallback(async () => {
    if (!UPDATER_ENABLED) return;
    setRefreshing(true);
    try {
      setResult(await runCheck());
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (!UPDATER_ENABLED) return null;
  return { result, refresh, refreshing };
}

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Download the APK into cache with progress (0-100), verify its sha256, then
 * hand it to the system installer. Throws with a localized message on
 * failure; if the user has not allowed installs from this app, Android shows
 * its own prompt and the promise resolves normally.
 */
export async function downloadAndInstallApk(
  update: ApkUpdate,
  onProgress: (percent: number) => void,
): Promise<void> {
  const destination = new File(Paths.cache, "joyorogo-update.apk");
  if (destination.exists) destination.delete();

  const task = File.createDownloadTask(`${SERVER_ORIGIN}/downloads/latest-apk`, destination, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(Math.round((bytesWritten / totalBytes) * 100));
    },
  });
  let file: File | null;
  try {
    file = await task.downloadAsync();
  } catch {
    file = null;
  }
  if (!file) throw new Error(i18n.t("settings:update.error.downloadFailed"));

  // Native streamed MD5: hashing the whole APK as a JS ArrayBuffer (sha256 via
  // expo-crypto) failed on device. HTTPS already covers tampering; this check
  // only catches truncated/corrupt downloads.
  let ok = false;
  try {
    if (update.md5) {
      ok = file.info({ md5: true }).md5?.toLowerCase() === update.md5.toLowerCase();
    } else {
      const digest = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        await file.arrayBuffer(),
      );
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      ok = hex === update.sha256;
    }
  } catch {
    throw new Error(i18n.t("settings:update.error.verifyFailed"));
  }
  if (!ok) {
    file.delete();
    throw new Error(i18n.t("settings:update.error.invalidFile"));
  }

  // ActivityAction only lists settings screens; the installer is a plain VIEW.
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
