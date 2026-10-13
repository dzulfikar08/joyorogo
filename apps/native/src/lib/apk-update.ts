import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { ENV } from "@/src/env";

/** Manifest served at GET /downloads/latest-apk.json (written by build-release-apk.sh). */
export type ApkUpdate = {
  versionCode: number;
  versionName: string;
  size: number;
  sha256: string;
};

// Re-check at most every 6 hours: the check on app start must stay cheap and
// silent, not a request on every launch.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "apk-update-checked-at";

/** Server origin, same contract as utils/orpc.ts: ENV is the source of truth. */
const SERVER_ORIGIN = ENV.EXPO_PUBLIC_SERVER_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

async function fetchLatestApk(): Promise<ApkUpdate | null> {
  try {
    const res = await fetch(`${SERVER_ORIGIN}/downloads/latest-apk.json`);
    if (!res.ok) return null;
    const body = (await res.json()) as ApkUpdate;
    if (typeof body.versionCode !== "number" || typeof body.sha256 !== "string") return null;
    return body;
  } catch {
    // Silent by design: the updater must never block or nag on network errors.
    return null;
  }
}

function installedVersionCode(): number {
  const native = Application.nativeBuildVersion;
  const parsed = native ? Number.parseInt(native, 10) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Shared update state so the silent app-start check and the Profil screen see
 * the same result without refetching.
 */
let cached: ApkUpdate | null | undefined;
let inFlight: Promise<ApkUpdate | null> | null;

async function check(force: boolean): Promise<ApkUpdate | null> {
  if (cached !== undefined && !force) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!force) {
      const last = await SecureStore.getItemAsync(LAST_CHECK_KEY);
      if (last && Date.now() - Number(last) < CHECK_THROTTLE_MS) {
        cached = null;
        return null;
      }
    }
    const update = await fetchLatestApk();
    await SecureStore.setItemAsync(LAST_CHECK_KEY, String(Date.now()));
    cached = update && update.versionCode > installedVersionCode() ? update : null;
    return cached;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Android-only update check. iOS and web never fetch the manifest and always
 * report "no update".
 */
export function useApkUpdate(force = false): ApkUpdate | null {
  const [update, setUpdate] = useState<ApkUpdate | null>(
    Platform.OS === "android" && cached !== undefined ? cached : null,
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let live = true;
    void check(force).then((result) => {
      if (live) setUpdate(result);
    });
    return () => {
      live = false;
    };
  }, [force]);

  return update;
}

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Download the APK into cache with progress (0-100), verify its sha256, then
 * hand it to the system installer. Throws with an Indonesian message on
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
  if (!file) throw new Error("Unduhan gagal. Periksa koneksi internetmu lalu coba lagi.");

  let digestHex = "";
  try {
    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      await file.arrayBuffer(),
    );
    digestHex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new Error("Gagal memeriksa berkas yang diunduh. Coba lagi.");
  }
  if (digestHex !== update.sha256) {
    file.delete();
    throw new Error("Berkas yang diunduh tidak valid. Coba lagi.");
  }

  // ActivityAction only lists settings screens; the installer is a plain VIEW.
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
