import { describe, expect, test } from "bun:test";

import { DEFAULT_GLOBAL_DAILY_CAP, DEFAULT_KCAL_BAND, DEFAULT_USER_DAILY_CAP, botConfig, parseBand, parseMode } from "./config";

describe("THREADS_BOT_MODE", () => {
  test("only review and auto turn the bot on; unset or anything else is off", () => {
    expect(parseMode(undefined)).toBe("off");
    expect(parseMode("")).toBe("off");
    expect(parseMode("on")).toBe("off");
    expect(parseMode("true")).toBe("off");
    expect(parseMode("review")).toBe("review");
    expect(parseMode(" AUTO ")).toBe("auto");
    expect(parseMode("off")).toBe("off");
  });
});

describe("botConfig", () => {
  test("defaults: off, 3 per user, 200 in total, ±20%", () => {
    const config = botConfig({});
    expect(config).toMatchObject({ mode: "off", userCap: 3, globalCap: 200, band: 0.2, signingSecrets: [] });
    expect([DEFAULT_USER_DAILY_CAP, DEFAULT_GLOBAL_DAILY_CAP, DEFAULT_KCAL_BAND]).toEqual([3, 200, 0.2]);
    expect(config.redirectUri).toBe("https://api.joyorogo.com/api/threads/callback");
    expect(config.siteUrl).toBe("https://joyorogo.com");
  });

  test("caps: garbage falls back, 0 is allowed (nobody answered), huge values are capped", () => {
    const caps = (user?: string, global?: string) => {
      const { userCap, globalCap } = botConfig({ THREADS_BOT_USER_DAILY_CAP: user, THREADS_BOT_DAILY_CAP: global });
      return [userCap, globalCap];
    };
    expect(caps("5", "50")).toEqual([5, 50]);
    expect(caps("0", "0")).toEqual([0, 0]);
    expect(caps("abc", "-1")).toEqual([3, 200]);
    expect(caps("2.5", "")).toEqual([3, 200]);
    expect(caps("999999999", "999999999")).toEqual([100_000, 100_000]);
  });

  test("band is clamped to 5% to 50%, garbage = 20%", () => {
    expect(parseBand("0.15")).toBe(0.15);
    expect(parseBand("0")).toBe(0.05);
    expect(parseBand("3")).toBe(0.5);
    expect(parseBand("x")).toBe(0.2);
    expect(parseBand(undefined)).toBe(0.2);
  });

  test("secrets and urls are trimmed; the redirect follows BETTER_AUTH_URL; signing keys list the Threads secret first", () => {
    const config = botConfig({ THREADS_APP_SECRET: " s1 ", THREADS_WEBHOOK_SECRET: "s2", THREADS_APP_ID: " 7 ", BETTER_AUTH_URL: "https://api.test/", THREADS_ACCESS_TOKEN: "  " });
    expect(config).toMatchObject({ appId: "7", appSecret: "s1", signingSecrets: ["s1", "s2"], redirectUri: "https://api.test/api/threads/callback" });
    expect(config.seedToken).toBeUndefined();
  });
});
