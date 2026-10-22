import { Platform, TurboModuleRegistry } from "react-native";

import {
  GOOGLE_WEB_CLIENT_ID,
  type NativeGoogleToken,
  classifyNativeGoogleError,
  type NativeStatusCodes,
} from "./google-native";

/**
 * The native module is autolinked into store builds that contain it. An OTA update on an older binary has no
 * `RNGoogleSignin` TurboModule, and the library throws on import, so it is checked first and imported lazily.
 */
export function nativeGoogleAvailable(): boolean {
  return Platform.OS === "android" && TurboModuleRegistry.get("RNGoogleSignin") != null;
}

/** Shows Google's account picker and returns the ID token (audience = web client id). Never throws. */
export async function requestGoogleIdToken(): Promise<NativeGoogleToken> {
  let codes: NativeStatusCodes | undefined;
  try {
    const { GoogleSignin, statusCodes } = await import("@react-native-google-signin/google-signin");
    codes = statusCodes;
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the previously chosen account so the picker always opens.
    await GoogleSignin.signOut().catch(() => undefined);
    const result = await GoogleSignin.signIn();
    if (result.type === "cancelled") return { status: "cancelled" };
    const idToken = result.data.idToken;
    return idToken ? { status: "ok", idToken } : { status: "failed", reason: "Google returned no ID token" };
  } catch (e) {
    return classifyNativeGoogleError(e, codes);
  }
}
