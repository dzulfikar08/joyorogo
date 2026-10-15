// Every link the web app hands to someone else's chat or story goes through
// here, so visits from shares show up in Revklik under one source.
//
// Invite links (/gabung/<kode>) get UTM too. That does not make them tracked:
// limitRevklikToPublicPages (analytics.ts) still drops /gabung pageviews and
// strips the code from anything else that mentions it.

export const SITE_ORIGIN = "https://joyorogo.com";

/** What is being shared; becomes utm_medium. */
export type ShareMedium = "meal" | "workout" | "progress" | "recap" | "invite" | "profile";

/** `path` is a site path, e.g. "/" or "/gabung/ABCD2345". */
export function shareUrl(path: string, medium: ShareMedium): string {
  const params = new URLSearchParams({
    utm_source: "app-share",
    utm_medium: medium,
    utm_campaign: "share-web",
  });
  return `${SITE_ORIGIN}${path}?${params}`;
}
