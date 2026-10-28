/**
 * Bundle ids of the iOS apps that use this server's Apple features: each is a
 * valid audience of a native Sign in with Apple identity token (the audience is
 * the app's own bundle id), a valid `client_id` when that token is revoked on
 * account deletion, and a bundle whose App Store transactions and notifications
 * are credited (see packages/api/src/lib/apple.ts).
 */
export const JOYOROGO_APPLE_BUNDLE_ID = "com.joyodigitama.joyorogo";
export const JOYOFIT_APPLE_BUNDLE_ID = "com.joyodigitama.joyofit";

/**
 * The enabled bundle ids from `APPLE_BUNDLE_IDS` (comma-separated). Unset or
 * blank = both apps. The first one is the primary app (the default Sign in with
 * Apple client id).
 */
export function appleBundleIds(raw?: string): string[] {
  const ids = [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [JOYOROGO_APPLE_BUNDLE_ID, JOYOFIT_APPLE_BUNDLE_ID];
}
