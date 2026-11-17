/**
 * Store listings with the UTM convention from docs/utm.md (Play via `referrer`, App Store via `ct`). Dependency-free so
 * the blog renderer (apps/web/blog) can import it too.
 *
 * Every button names where it sits (`hero`, `footer`, `harga`, `blog`, ...), so Play Console's acquisition report and
 * App Store Connect's campaign report show which place on joyorogo.com brought the install. Store sales carry no web
 * visitor (docs/revklik-forwarding.md), so these reports are the only per-place view of store installs.
 */

const PLAY_PACKAGE = "com.joyodigitama.joyorogo";
const APP_STORE_ID = "6823222101";

/**
 * App Store Connect counts a campaign link only when it carries the team's provider token (`pt`) next to `ct`
 * (App Store Connect Help, "View campaign data"). It is not secret: it shows in every campaign link the generator in
 * App Store Connect > Analytics makes. Empty = links keep `ct` only, which App Store Connect does not report.
 */
export const APP_STORE_PROVIDER_TOKEN = "";

/** Place names become part of the campaign: lowercase letters, digits and hyphens only. */
function slug(place: string): string {
  return place
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Google Play listing; the place is the end of `utm_campaign` (`evergreen-web-hero`). */
export function playStoreUrl(place?: string): string {
  const campaign = place ? `evergreen-web-${slug(place)}` : "evergreen-web";
  const referrer = `utm_source=joyorogo&utm_medium=referral&utm_campaign=${campaign}`;
  return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}&referrer=${encodeURIComponent(referrer)}`;
}

/** App Store listing; the place is the end of the campaign token (`joyorogo-evergreen-web-hero`). */
export function appStoreUrl(place?: string, providerToken: string = APP_STORE_PROVIDER_TOKEN): string {
  const ct = place ? `joyorogo-evergreen-web-${slug(place)}` : "joyorogo-evergreen-web";
  const pt = providerToken ? `pt=${encodeURIComponent(providerToken)}&` : "";
  return `https://apps.apple.com/id/app/id${APP_STORE_ID}?${pt}ct=${ct}`;
}

export const PLAY_STORE_URL = playStoreUrl();
export const APP_STORE_URL = appStoreUrl();
