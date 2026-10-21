import { Linking, Platform } from "react-native";

import {
  JOYOFIT_ANDROID_URL,
  JOYOFIT_APP_LINK,
  JOYOFIT_IOS_URL,
  JOYOFIT_SITE_URL,
  JOYOFIT_STRENGTH_LINK,
} from "@joyorogo/i18n/joyofit-links";

/** Store page for this platform, or the JoyoFit site elsewhere. */
export function joyofitInstallUrl(): string {
  if (Platform.OS === "android") return JOYOFIT_ANDROID_URL;
  if (Platform.OS === "ios") return JOYOFIT_IOS_URL;
  return JOYOFIT_SITE_URL;
}

export function installJoyoFit(): Promise<void> {
  return Linking.openURL(joyofitInstallUrl());
}

/**
 * Open JoyoFit's strength screen. canOpenURL is not used: Android 11+ hides
 * other apps' schemes without a manifest <queries> entry (native config is
 * frozen), so it would report "not installed" for an installed app. openURL
 * rejects when no app handles the scheme (iOS: unsupported URL, Android:
 * ActivityNotFoundException), so try the strength link, then the plain app
 * link, then the store. The strength link is `joyofit://?open=strength`, not
 * `joyofit://strength`: an open of an unknown route succeeds (JoyoFit shows
 * its own "Unmatched Route" page) and so never reaches the next target, while a
 * JoyoFit without the strength route just shows its home for the query form.
 * Resolves true when JoyoFit opened, false when it is not installed (the store
 * page was opened instead), so callers can show an install button only then.
 * `target: "home"` skips the strength link: for screens about scores, not training.
 */
export async function openJoyoFit(target: "strength" | "home" = "strength"): Promise<boolean> {
  for (const url of target === "home" ? [JOYOFIT_APP_LINK] : [JOYOFIT_STRENGTH_LINK, JOYOFIT_APP_LINK]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Not installed or no such route: try the next target.
    }
  }
  await installJoyoFit().catch(() => {});
  return false;
}
