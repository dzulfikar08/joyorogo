import { describe, expect, test } from "bun:test";

import { DEFAULT_ANDROID_STORE_URL, DEFAULT_IOS_STORE_URL, appVersionConfig, parseBuild } from "./app-version";

describe("appVersionConfig", () => {
  test("defaults to the gate off", () => {
    expect(appVersionConfig({})).toEqual({
      android: { minBuild: 0, latestBuild: 0, storeUrl: DEFAULT_ANDROID_STORE_URL },
      ios: { minBuild: 0, latestBuild: 0, storeUrl: DEFAULT_IOS_STORE_URL },
    });
  });

  test("reads per-platform builds and message", () => {
    const config = appVersionConfig({
      MIN_BUILD_ANDROID: "1500000",
      LATEST_BUILD_ANDROID: "1500100",
      MIN_BUILD_IOS: "12",
      UPDATE_MESSAGE: " Perbaikan penting. ",
    });
    expect(config.android.minBuild).toBe(1500000);
    expect(config.android.latestBuild).toBe(1500100);
    expect(config.ios.minBuild).toBe(12);
    expect(config.ios.latestBuild).toBe(12);
    expect(config.message).toBe("Perbaikan penting.");
  });

  test("garbage counts as 0 and only https store urls override", () => {
    expect(parseBuild("abc")).toBe(0);
    expect(parseBuild("-4")).toBe(0);
    expect(parseBuild("1.5")).toBe(0);
    const config = appVersionConfig({ IOS_STORE_URL: "http://x", ANDROID_STORE_URL: "https://play.google.com/x" });
    expect(config.ios.storeUrl).toBe(DEFAULT_IOS_STORE_URL);
    expect(config.android.storeUrl).toBe("https://play.google.com/x");
  });
});
