/**
 * Minimum native build per platform, served in GET /api/config (`app`) so the
 * launch-time update gate in the native app can block builds that predate a fix.
 * Everything is a Worker var, so the gate is tuned with a `wrangler deploy`, no code change.
 * A build number is the native versionCode (Android) / CFBundleVersion (iOS).
 * Unset, empty or invalid = 0 = the gate is off for that platform.
 */
export type AppVersionEnv = {
  MIN_BUILD_ANDROID?: string;
  LATEST_BUILD_ANDROID?: string;
  MIN_BUILD_IOS?: string;
  LATEST_BUILD_IOS?: string;
  /** Overrides the default store page of each platform. */
  ANDROID_STORE_URL?: string;
  IOS_STORE_URL?: string;
  /** Optional one-line reason shown on the blocking screen instead of the app's own text. */
  UPDATE_MESSAGE?: string;
};

export type PlatformBuild = { minBuild: number; latestBuild: number; storeUrl: string };
export type AppVersionConfig = {
  android: PlatformBuild;
  ios: PlatformBuild;
  message?: string;
};

export const DEFAULT_ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo";
/** Public TestFlight link; swap for the App Store URL (IOS_STORE_URL) once 1.0 is live. */
export const DEFAULT_IOS_STORE_URL = "https://testflight.apple.com/join/gD8dPxW3";

/** Positive integer, else 0. */
export function parseBuild(raw: string | undefined): number {
  const value = Number((raw ?? "").trim());
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function platform(minRaw: string | undefined, latestRaw: string | undefined, url: string | undefined, fallback: string): PlatformBuild {
  const minBuild = parseBuild(minRaw);
  // "Latest" can never sit below the minimum.
  const latestBuild = Math.max(parseBuild(latestRaw), minBuild);
  const trimmed = url?.trim() ?? "";
  return { minBuild, latestBuild, storeUrl: /^https:\/\//.test(trimmed) ? trimmed : fallback };
}

export function appVersionConfig(env: AppVersionEnv): AppVersionConfig {
  const message = env.UPDATE_MESSAGE?.trim().slice(0, 200);
  return {
    android: platform(env.MIN_BUILD_ANDROID, env.LATEST_BUILD_ANDROID, env.ANDROID_STORE_URL, DEFAULT_ANDROID_STORE_URL),
    ios: platform(env.MIN_BUILD_IOS, env.LATEST_BUILD_IOS, env.IOS_STORE_URL, DEFAULT_IOS_STORE_URL),
    ...(message ? { message } : {}),
  };
}
