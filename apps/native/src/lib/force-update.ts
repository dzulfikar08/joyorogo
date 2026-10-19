/**
 * Pure rules of the launch-time update gate, free of React Native imports so `bun test` can run
 * them. use-force-update.ts feeds these the fetched config, the persisted cache and the clock.
 *
 * The server (GET /api/config, field `app`) names a minimum and a latest native build per platform.
 * A build number is the native versionCode / CFBundleVersion (`expo-application` nativeBuildVersion).
 * minBuild 0 means the gate is off, and every failure path (no network, bad payload, unknown
 * installed build) resolves to "none": the gate never blocks on doubt.
 */

export interface PlatformBuild {
  minBuild: number;
  latestBuild: number;
  storeUrl: string;
}

export interface VersionConfig {
  android: PlatformBuild;
  ios: PlatformBuild;
  message?: string;
}

export type GateDecision = "block" | "banner" | "none";

/** A cached answer counts for one hour; older than that and a failed fetch means "no gate". */
export const CONFIG_TTL_MS = 60 * 60 * 1000;

/** Resume re-fetches at most every 15 minutes; a cold start always fetches. */
export const RESUME_THROTTLE_MS = 15 * 60 * 1000;

export const ANDROID_PACKAGE = "com.joyodigitama.joyorogo";
export const ANDROID_TESTING_URL = `https://play.google.com/apps/testing/${ANDROID_PACKAGE}`;

const OFF: PlatformBuild = { minBuild: 0, latestBuild: 0, storeUrl: "" };

function parseBuild(raw: unknown): number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

function parsePlatform(raw: unknown): PlatformBuild {
  if (typeof raw !== "object" || raw === null) return OFF;
  const r = raw as Record<string, unknown>;
  const minBuild = parseBuild(r.minBuild);
  return {
    minBuild,
    latestBuild: Math.max(parseBuild(r.latestBuild), minBuild),
    storeUrl: typeof r.storeUrl === "string" && r.storeUrl.startsWith("https://") ? r.storeUrl : "",
  };
}

/** Turns the `app` field of /api/config into a config; anything unusable (older server) is "gate off". */
export function parseVersionConfig(raw: unknown): VersionConfig {
  if (typeof raw !== "object" || raw === null) return { android: OFF, ios: OFF };
  const r = raw as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim().slice(0, 200) : "";
  return {
    android: parsePlatform(r.android),
    ios: parsePlatform(r.ios),
    ...(message ? { message } : {}),
  };
}

/** The build's decision. `build` 0 (unknown) and platforms other than Android/iOS never gate. */
export function decideGate(
  config: VersionConfig | null,
  build: number,
  platform: string,
): GateDecision {
  if (!config || !Number.isSafeInteger(build) || build <= 0) return "none";
  if (platform !== "android" && platform !== "ios") return "none";
  const target = config[platform];
  if (target.minBuild > 0 && build < target.minBuild) return "block";
  if (target.latestBuild > 0 && build < target.latestBuild) return "banner";
  return "none";
}

export interface ConfigCache {
  at: number;
  config: VersionConfig;
}

/** Parses the persisted cache; anything off counts as no cache. */
export function parseCache(raw: string | null | undefined): ConfigCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { at?: unknown; config?: unknown };
    if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
    return { at: value.at, config: parseVersionConfig(value.config) };
  } catch {
    return null;
  }
}

/** A cache is usable while it is younger than the TTL; a timestamp in the future (clock moved back) is not. */
export function isCacheFresh(cache: ConfigCache | null, now: number): cache is ConfigCache {
  return cache !== null && cache.at <= now && now - cache.at < CONFIG_TTL_MS;
}

/** The config to act on: the fresh answer, else a fresh cache, else null (= fail open). */
export function resolveConfig(
  fetched: VersionConfig | null,
  cache: ConfigCache | null,
  now: number,
): VersionConfig | null {
  if (fetched) return fetched;
  return isCacheFresh(cache, now) ? cache.config : null;
}

/** Cold start (no previous fetch) always fetches; resume is throttled. */
export function shouldRefetch(lastFetchedAt: number | null, now: number): boolean {
  if (lastFetchedAt === null || lastFetchedAt > now) return true;
  return now - lastFetchedAt >= RESUME_THROTTLE_MS;
}

export interface StoreLinks {
  /** Tried in order until one opens. */
  primary: string[];
  /** Android only: the closed-testing opt-in page, for testers who are not on the track yet. */
  testing?: string;
}

const TESTFLIGHT_JOIN = /^https:\/\/testflight\.apple\.com\/join\/([A-Za-z0-9]+)$/;

/** Where the "Update" button goes. */
export function storeLinks(platform: string, storeUrl: string): StoreLinks {
  const https = storeUrl.startsWith("https://") ? [storeUrl] : [];
  if (platform === "android") {
    return {
      primary: [`market://details?id=${ANDROID_PACKAGE}`, ...https],
      testing: ANDROID_TESTING_URL,
    };
  }
  const code = TESTFLIGHT_JOIN.exec(storeUrl)?.[1];
  return { primary: code ? [`itms-beta://testflight.apple.com/join/${code}`, ...https] : https };
}
