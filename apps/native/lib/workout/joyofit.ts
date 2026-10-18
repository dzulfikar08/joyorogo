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
 * ActivityNotFoundException), so try strength link, then the app link
 * (older JoyoFit without the strength route), then the store.
 */
export async function openJoyoFit(): Promise<void> {
  for (const url of [JOYOFIT_STRENGTH_LINK, JOYOFIT_APP_LINK]) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Not installed or no such route: try the next target.
    }
  }
  await installJoyoFit().catch(() => {});
}
