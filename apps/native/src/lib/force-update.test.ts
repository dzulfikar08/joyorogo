import { describe, expect, test } from "bun:test";

import {
  ANDROID_TESTING_URL,
  CONFIG_TTL_MS,
  RESUME_THROTTLE_MS,
  decideGate,
  isCacheFresh,
  parseCache,
  parseVersionConfig,
  resolveConfig,
  shouldRefetch,
  storeLinks,
} from "./force-update";

const config = parseVersionConfig({
  android: { minBuild: 100, latestBuild: 120, storeUrl: "https://play.google.com/x" },
  ios: { minBuild: 10, latestBuild: 12, storeUrl: "https://testflight.apple.com/join/abc123" },
});

describe("decideGate", () => {
  test("blocks below min, banners below latest, otherwise none", () => {
    expect(decideGate(config, 99, "android")).toBe("block");
    expect(decideGate(config, 100, "android")).toBe("banner");
    expect(decideGate(config, 119, "android")).toBe("banner");
    expect(decideGate(config, 120, "android")).toBe("none");
    expect(decideGate(config, 9, "ios")).toBe("block");
    expect(decideGate(config, 11, "ios")).toBe("banner");
    expect(decideGate(config, 12, "ios")).toBe("none");
  });

  test("platforms are independent", () => {
    const androidOnly = parseVersionConfig({ android: { minBuild: 100 } });
    expect(decideGate(androidOnly, 5, "ios")).toBe("none");
    expect(decideGate(androidOnly, 5, "android")).toBe("block");
  });

  test("default config (min 0) never gates", () => {
    expect(decideGate(parseVersionConfig({}), 1, "android")).toBe("none");
    expect(decideGate(parseVersionConfig(undefined), 1, "ios")).toBe("none");
  });

  test("fails open: no config, unknown build, web", () => {
    expect(decideGate(null, 1, "android")).toBe("none");
    expect(decideGate(config, 0, "android")).toBe("none");
    expect(decideGate(config, Number.NaN, "android")).toBe("none");
    expect(decideGate(config, 1, "web")).toBe("none");
  });
});

describe("parseVersionConfig", () => {
  test("garbage fields become 0 and latest never sits below min", () => {
    const parsed = parseVersionConfig({
      android: { minBuild: "100", latestBuild: -1, storeUrl: "http://x" },
      ios: { minBuild: 8, latestBuild: 3 },
      message: "  Perbaikan penting  ",
    });
    expect(parsed.android).toEqual({ minBuild: 0, latestBuild: 0, storeUrl: "" });
    expect(parsed.ios.latestBuild).toBe(8);
    expect(parsed.message).toBe("Perbaikan penting");
  });
});

describe("cache", () => {
  const now = 1_000_000_000;
  test("fresh within the TTL only", () => {
    expect(isCacheFresh({ at: now - CONFIG_TTL_MS + 1, config }, now)).toBe(true);
    expect(isCacheFresh({ at: now - CONFIG_TTL_MS, config }, now)).toBe(false);
    expect(isCacheFresh({ at: now + 5, config }, now)).toBe(false);
    expect(isCacheFresh(null, now)).toBe(false);
  });

  test("resolveConfig: fetched beats cache, stale cache and no network fail open", () => {
    const fresh = { at: now - 1000, config };
    const stale = { at: now - CONFIG_TTL_MS - 1, config };
    const off = parseVersionConfig({});
    expect(resolveConfig(off, fresh, now)).toBe(off);
    expect(resolveConfig(null, fresh, now)).toBe(config);
    expect(resolveConfig(null, stale, now)).toBeNull();
    expect(resolveConfig(null, null, now)).toBeNull();
  });

  test("parseCache round-trips and rejects junk", () => {
    expect(parseCache(JSON.stringify({ at: 5, config }))?.config.android.minBuild).toBe(100);
    expect(parseCache("nope")).toBeNull();
    expect(parseCache(JSON.stringify({ config }))).toBeNull();
    expect(parseCache(null)).toBeNull();
  });
});

describe("shouldRefetch", () => {
  test("cold start, throttle window, clock moved back", () => {
    expect(shouldRefetch(null, 1000)).toBe(true);
    expect(shouldRefetch(1000, 1000 + RESUME_THROTTLE_MS - 1)).toBe(false);
    expect(shouldRefetch(1000, 1000 + RESUME_THROTTLE_MS)).toBe(true);
    expect(shouldRefetch(5000, 1000)).toBe(true);
  });
});

describe("storeLinks", () => {
  test("android: market first, https fallback, testing opt-in", () => {
    expect(storeLinks("android", "https://play.google.com/x")).toEqual({
      primary: ["market://details?id=com.joyodigitama.joyorogo", "https://play.google.com/x"],
      testing: ANDROID_TESTING_URL,
    });
  });

  test("ios: TestFlight app link first, https fallback; App Store url as is", () => {
    expect(storeLinks("ios", "https://testflight.apple.com/join/abc123").primary).toEqual([
      "itms-beta://testflight.apple.com/join/abc123",
      "https://testflight.apple.com/join/abc123",
    ]);
    expect(storeLinks("ios", "https://apps.apple.com/app/id1")).toEqual({
      primary: ["https://apps.apple.com/app/id1"],
    });
  });
});
