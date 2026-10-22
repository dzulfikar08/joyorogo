/**
 * Native Google Sign-In on Android (account picker from Google Play services, no Chrome Custom Tab).
 *
 * The browser flow can strand a person on devices where Chrome crashes in Google's account chooser (POCO / HyperOS),
 * so on Android the app asks Play services for a Google ID token and hands it to better-auth
 * (`signIn.social({ provider: "google", idToken })`), which verifies it against the web client id. The token's audience
 * is the web client id because that is what the app passes as `webClientId`; the Android OAuth clients in the Cloud
 * project only identify the app (package + signing SHA-1) to Google.
 *
 * This file is pure (no React Native imports) so the selection / fallback logic is unit-tested.
 */

/** Web OAuth client of the Cloud project `joyorogo`; equals the server's GOOGLE_CLIENT_ID. Public by nature. */
export const GOOGLE_WEB_CLIENT_ID = "915036968874-0ne1edkq0laljg6cdlnksor1hqpj9gfr.apps.googleusercontent.com";

/** ApiException.DEVELOPER_ERROR: package + signing SHA-1 are not registered as an Android OAuth client. */
export const DEVELOPER_ERROR_CODE = "10";

export type NativeGoogleToken =
  | { status: "ok"; idToken: string }
  | { status: "cancelled" }
  /** Native sign-in cannot work on this install (no Play services, signing key not registered yet). */
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

export type NativeGoogleOutcome =
  | { kind: "signed-in" }
  | { kind: "cancelled" }
  /** The caller should run the browser flow. */
  | { kind: "fallback"; reason: string }
  | { kind: "failed"; reason: string };

export type NativeStatusCodes = { SIGN_IN_CANCELLED: string; PLAY_SERVICES_NOT_AVAILABLE: string };

export type NativeGoogleDeps = {
  /** True only on an Android binary that contains the native module (an OTA on an older binary has none). */
  available: () => boolean;
  requestIdToken: () => Promise<NativeGoogleToken>;
  /** better-auth `signIn.social({ provider: "google", idToken: { token } })`. */
  exchange: (idToken: string) => Promise<{ error?: { message?: string } | null }>;
  log: (message: string) => void;
};

function errorCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null || !("code" in e)) return undefined;
  const code = (e as { code: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

function errorText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 160);
}

/** Maps what the native module throws to one of the token outcomes. */
export function classifyNativeGoogleError(e: unknown, codes?: NativeStatusCodes): NativeGoogleToken {
  const code = errorCode(e);
  const reason = `${code ?? "no code"} ${errorText(e)}`;
  if (codes && code === codes.SIGN_IN_CANCELLED) return { status: "cancelled" };
  if (code === DEVELOPER_ERROR_CODE) return { status: "unavailable", reason: `developer error: ${reason}` };
  if (codes && code === codes.PLAY_SERVICES_NOT_AVAILABLE) {
    return { status: "unavailable", reason: `Play services unavailable: ${reason}` };
  }
  return { status: "failed", reason };
}

/**
 * Runs the native sign-in. `fallback` means "use the browser flow" and is returned only when native sign-in cannot
 * work here; a cancelled sheet and any other failure never start the browser.
 */
export async function signInWithNativeGoogle(deps: NativeGoogleDeps): Promise<NativeGoogleOutcome> {
  if (!deps.available()) return { kind: "fallback", reason: "native module not in this build" };
  const token = await deps.requestIdToken();
  if (token.status === "cancelled") return { kind: "cancelled" };
  if (token.status === "unavailable") {
    deps.log(`[google] native sign-in unavailable, using the browser flow: ${token.reason}`);
    return { kind: "fallback", reason: token.reason };
  }
  if (token.status === "failed") {
    deps.log(`[google] native sign-in failed: ${token.reason}`);
    return { kind: "failed", reason: token.reason };
  }
  const { error } = await deps.exchange(token.idToken);
  if (error) {
    deps.log(`[google] server rejected the Google ID token: ${error.message ?? "no message"}`);
    return { kind: "failed", reason: error.message ?? "server rejected the token" };
  }
  return { kind: "signed-in" };
}
