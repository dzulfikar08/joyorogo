import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";

// EXPO_PUBLIC_SERVER_URL is the source of truth; on web it can come back
// empty when the env injection layer is unavailable (metro web dev), so fall
// back to same-origin instead of an invalid base URL.
function authBaseUrl(): string {
  if (ENV.EXPO_PUBLIC_SERVER_URL) return ENV.EXPO_PUBLIC_SERVER_URL;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: authBaseUrl(),
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
  ],
});
