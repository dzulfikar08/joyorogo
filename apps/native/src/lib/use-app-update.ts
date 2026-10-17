import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { IS_PLAY_BUILD } from "@/src/distribution";
import { APK_URL, downloadAndInstallApk, installedAppVersion, useApkUpdate } from "@/src/lib/apk-update";
import { playUpdates } from "@/src/lib/play-update";
import {
  isDismissed,
  isPlayInstaller,
  parseTimestamp,
  shouldCheck,
} from "@/src/lib/update-policy";

/**
 * Which update path this install uses:
 * - "play": installed by the Play Store (any track): Play In-App Updates, flexible flow.
 * - "apk": sideload build installed outside Play: compare latest-apk.json, install the APK.
 * - null: iOS and web (TestFlight/App Store already notify), or a Play-flavoured build
 *   that was installed some other way (its APK could not update over the signed-by-Play one).
 */
type Channel = "play" | "apk";

/** What the banner renders. */
export type UpdateBannerModel =
  | { kind: "available"; channel: Channel; versionName: string | null; failed: boolean }
  | { kind: "downloading"; percent: number | null }
  | { kind: "ready" };

type PlayPhase =
  | { step: "idle" }
  | { step: "available"; failed: boolean }
  | { step: "downloading"; percent: number | null }
  | { step: "ready" };

const DISMISSED_KEY = "app-update-dismissed-at";

async function resolveChannel(): Promise<Channel | null> {
  if (Platform.OS !== "android") return null;
  if (playUpdates && isPlayInstaller(await playUpdates.installer())) return "play";
  return IS_PLAY_BUILD ? null : "apk";
}

/**
 * Drives the in-app update banner. Checks on cold start and again when the app
 * returns to the foreground, at most once per 6 hours. "Nanti" hides the
 * banner for 24 hours.
 */
export function useAppUpdate() {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [playPhase, setPlayPhase] = useState<PlayPhase>({ step: "idle" });
  const [readyHidden, setReadyHidden] = useState(false);
  const [apkProgress, setApkProgress] = useState<number | null>(null);
  const lastCheckedAt = useRef<number | null>(null);

  const apk = useApkUpdate();
  const apkResult = channel === "apk" ? (apk?.result ?? null) : null;
  const apkUpdate = apkResult?.state === "available" ? apkResult.update : null;
  const refreshApk = apk?.refresh;

  useEffect(() => {
    let live = true;
    void (async () => {
      const [resolved, stored] = await Promise.all([
        resolveChannel(),
        SecureStore.getItemAsync(DISMISSED_KEY).catch(() => null),
      ]);
      if (!live) return;
      setDismissedAt(parseTimestamp(stored));
      setChannel(resolved);
    })();
    return () => {
      live = false;
    };
  }, []);

  const checkPlay = useCallback(async () => {
    if (!playUpdates) return;
    lastCheckedAt.current = Date.now();
    try {
      const res = await playUpdates.check(installedAppVersion().versionCode);
      setPlayPhase((current) => {
        // Never knock a running download or a ready restart back to "available".
        if (current.step === "downloading" || current.step === "ready") return current;
        if (res.state === "available") return { step: "available", failed: false };
        // Accepted before the process restarted: either still downloading or done. Start at
        // "ready"; a status event flips it to "downloading" if bytes are still coming in.
        if (res.state === "pending") return { step: "ready" };
        return { step: "idle" };
      });
    } catch {
      // Play not reachable or an old Play Store: stay silent, the next check retries.
    }
  }, []);

  // Cold start.
  useEffect(() => {
    if (channel === "play") void checkPlay();
    if (channel === "apk") lastCheckedAt.current = Date.now();
  }, [channel, checkPlay]);

  // Play status events (download progress, finished, declined, failed).
  useEffect(() => {
    if (channel !== "play" || !playUpdates) return;
    return playUpdates.subscribe((event) => {
      if (event.type === "downloading") {
        setPlayPhase({ step: "downloading", percent: event.percent });
      } else if (event.type === "downloaded") {
        setReadyHidden(false);
        setPlayPhase({ step: "ready" });
      } else if (event.type === "failed") {
        setPlayPhase({ step: "available", failed: true });
      } else {
        const now = Date.now();
        setDismissedAt(now);
        void SecureStore.setItemAsync(DISMISSED_KEY, String(now)).catch(() => {});
        setPlayPhase({ step: "available", failed: false });
      }
    });
  }, [channel]);

  // Resume, throttled.
  useEffect(() => {
    if (channel === null) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !shouldCheck(lastCheckedAt.current, Date.now())) return;
      lastCheckedAt.current = Date.now();
      if (channel === "play") void checkPlay();
      else void refreshApk?.();
    });
    return () => sub.remove();
  }, [channel, checkPlay, refreshApk]);

  const dismiss = useCallback(() => {
    if (playPhase.step === "ready") {
      setReadyHidden(true);
      return;
    }
    const now = Date.now();
    setDismissedAt(now);
    void SecureStore.setItemAsync(DISMISSED_KEY, String(now)).catch(() => {});
  }, [playPhase.step]);

  const update = useCallback(async () => {
    if (channel === "play" && playUpdates) {
      setPlayPhase({ step: "downloading", percent: null });
      try {
        await playUpdates.startFlexible();
      } catch {
        setPlayPhase({ step: "available", failed: true });
      }
      return;
    }
    if (channel === "apk" && apkUpdate) {
      setApkProgress(0);
      try {
        await downloadAndInstallApk(apkUpdate, setApkProgress);
      } catch {
        // The in-app installer could not run (blocked, offline, bad file): hand the APK to the browser.
        await Linking.openURL(APK_URL).catch(() => {});
      } finally {
        setApkProgress(null);
      }
    }
  }, [channel, apkUpdate]);

  const restart = useCallback(() => {
    playUpdates?.restart();
  }, []);

  let banner: UpdateBannerModel | null = null;
  if (channel === "play") {
    if (playPhase.step === "downloading") {
      banner = { kind: "downloading", percent: playPhase.percent };
    } else if (playPhase.step === "ready") {
      banner = readyHidden ? null : { kind: "ready" };
    } else if (playPhase.step === "available" && !isDismissed(dismissedAt, Date.now())) {
      banner = { kind: "available", channel, versionName: null, failed: playPhase.failed };
    }
  } else if (channel === "apk") {
    if (apkProgress !== null) {
      banner = { kind: "downloading", percent: apkProgress };
    } else if (apkUpdate && !isDismissed(dismissedAt, Date.now())) {
      banner = { kind: "available", channel, versionName: apkUpdate.versionName, failed: false };
    }
  }

  return { banner, update, restart, dismiss };
}
