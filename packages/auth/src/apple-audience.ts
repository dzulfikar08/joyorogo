/**
 * Bundle ids of the iOS apps that sign in with Apple against this server. The
 * identity token's audience is the app's own bundle id, so each one is accepted
 * as an audience, and each one is a valid `client_id` when the Sign in with
 * Apple token is revoked on account deletion.
 */
export const JOYOFIT_APPLE_BUNDLE_ID = "com.joyodigitama.joyofit";

/** Token audiences for native Sign in with Apple: JoyoRogo's own bundle id first, then JoyoFit's. */
export function appleAudiences(appleBundleId: string): string[] {
  return [appleBundleId, JOYOFIT_APPLE_BUNDLE_ID];
}
