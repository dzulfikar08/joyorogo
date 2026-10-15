import { Platform } from "react-native";

// Every link the app hands to someone else's chat or story goes through here,
// so visits from shares show up in Revklik under one source. Mirror of
// apps/web/src/lib/share-links.ts; only the campaign differs (share-android).
//
// Invite links (/gabung/<kode>) carry UTM too: the web app drops /gabung
// pageviews and strips the code from anything else it sends to analytics
// (apps/web/src/lib/analytics.ts), so this does not make them tracked.

export const SITE_ORIGIN = "https://joyorogo.com";

/** What is being shared; becomes utm_medium. */
export type ShareMedium = "meal" | "workout" | "progress" | "recap" | "invite" | "profile";

/** `path` is a site path, e.g. "/" or "/gabung/ABCD2345". */
export function shareUrl(path: string, medium: ShareMedium): string {
  const params = new URLSearchParams({
    utm_source: "app-share",
    utm_medium: medium,
    utm_campaign: `share-${Platform.OS}`,
  });
  return `${SITE_ORIGIN}${path}?${params.toString()}`;
}
