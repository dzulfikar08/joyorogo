import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { appConfigQuery } from "@/components/billing";
import {
  type VersionConfig,
  decideGate,
  parseCache,
  parseVersionConfig,
  resolveConfig,
  shouldRefetch,
  storeLinks,
} from "@/src/lib/force-update";
import { refreshOtaAtLaunch } from "@/src/lib/use-ota-update";
import { isDismissed, parseTimestamp, parseVersionCode } from "@/src/lib/update-policy";
import { queryClient } from "@/utils/orpc";

const CACHE_KEY = "force-update-config";
const BANNER_DISMISSED_KEY = "force-update-banner-dismissed-at";

async function readCache() {
  return parseCache(await SecureStore.getItemAsync(CACHE_KEY).catch(() => null));
}

/** Opens the first link that works; true when one opened. */
export async function openStore(links: string[]): Promise<boolean> {
  for (const link of links) {
    try {
      await Linking.openURL(link);
      return true;
    } catch {
      // Scheme not handled (no Play Store / TestFlight): try the https fallback.
    }
  }
  return false;
}

/**
 * Launch-time update gate state: the OTA freshness step, then the minimum-build decision.
 * Fetches /api/config (public, so signed-out users are gated too) on cold start and, throttled,
 * on resume. The last answer is cached for an hour; no network and no fresh cache means no gate.
 */
export function useForceUpdate() {
  const platform = Platform.OS;
  const build = parseVersionCode(Application.nativeBuildVersion);
  const [config, setConfig] = useState<VersionConfig | null>(null);
  const [checking, setChecking] = useState(false);
  const [otaBusy, setOtaBusy] = useState(true);
  const [bannerDismissedAt, setBannerDismissedAt] = useState<number | null>(null);
  const lastFetchedAt = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    void refreshOtaAtLaunch().finally(() => {
      if (live) setOtaBusy(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setChecking(true);
    let fetched: VersionConfig | null = null;
    try {
      const data = await queryClient.fetchQuery({ ...appConfigQuery(), staleTime: 0 });
      fetched = parseVersionConfig(data.app);
    } catch {
      // Offline or server error: fall back to the cache, else no gate.
    }
    const now = Date.now();
    if (fetched) {
      lastFetchedAt.current = now;
      void SecureStore.setItemAsync(CACHE_KEY, JSON.stringify({ at: now, config: fetched })).catch(() => {});
    }
    setConfig(resolveConfig(fetched, await readCache(), now));
    setChecking(false);
  }, []);

  useEffect(() => {
    if (platform !== "android" && platform !== "ios") return;
    void SecureStore.getItemAsync(BANNER_DISMISSED_KEY)
      .then((raw) => setBannerDismissedAt(parseTimestamp(raw)))
      .catch(() => {});
    // A fresh cache decides immediately, before the network answers.
    void readCache().then((cache) => setConfig((current) => current ?? resolveConfig(null, cache, Date.now())));
    void refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && shouldRefetch(lastFetchedAt.current, Date.now())) void refresh();
    });
    return () => sub.remove();
  }, [platform, refresh]);

  const decision = decideGate(config, build, platform);
  const target = platform === "android" || platform === "ios" ? config?.[platform] : undefined;

  const dismissBanner = useCallback(() => {
    const now = Date.now();
    setBannerDismissedAt(now);
    void SecureStore.setItemAsync(BANNER_DISMISSED_KEY, String(now)).catch(() => {});
  }, []);

  return {
    otaBusy,
    decision,
    checking,
    recheck: refresh,
    message: config?.message,
    links: storeLinks(platform, target?.storeUrl ?? ""),
    // Banner: only iOS. Android already gets Play's own in-app update banner (use-app-update.ts).
    showBanner:
      decision === "banner" && platform === "ios" && !isDismissed(bannerDismissedAt, Date.now()),
    dismissBanner,
  };
}
