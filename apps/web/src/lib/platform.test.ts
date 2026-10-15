import { describe, expect, test } from "bun:test";

import { PLATFORM_SCRIPT } from "../../blog/render.ts";
import { detectPlatform } from "./platform";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 330.0.0.30.109 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 600456578)";
const IPHONE_TIKTOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.0.0 BytedanceWebview/d8a21c6";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI = IPAD_DESKTOP_UA;
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type Case = { name: string; userAgent: string; platform: string; touch: number };

const CASES: Case[] = [
  { name: "iPhone Safari", userAgent: IPHONE_SAFARI, platform: "iPhone", touch: 5 },
  { name: "Instagram webview", userAgent: IPHONE_INSTAGRAM, platform: "iPhone", touch: 5 },
  { name: "TikTok webview", userAgent: IPHONE_TIKTOK, platform: "iPhone", touch: 5 },
  { name: "Chrome on iOS", userAgent: IPHONE_CHROME, platform: "iPhone", touch: 5 },
  { name: "iPad with desktop UA", userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", touch: 5 },
  { name: "Android Chrome", userAgent: ANDROID_CHROME, platform: "Linux armv81", touch: 5 },
  { name: "Mac Safari", userAgent: MAC_SAFARI, platform: "MacIntel", touch: 0 },
  { name: "Windows Chrome", userAgent: WINDOWS_CHROME, platform: "Win32", touch: 0 },
];

function detect(c: Case) {
  return detectPlatform({
    userAgent: c.userAgent,
    platform: c.platform,
    maxTouchPoints: c.touch,
    standalone: false,
  });
}

describe("detectPlatform", () => {
  test("classifies the OS", () => {
    expect(CASES.map((c) => [c.name, detect(c).os])).toEqual([
      ["iPhone Safari", "ios"],
      ["Instagram webview", "ios"],
      ["TikTok webview", "ios"],
      ["Chrome on iOS", "ios"],
      ["iPad with desktop UA", "ios"],
      ["Android Chrome", "android"],
      ["Mac Safari", "desktop"],
      ["Windows Chrome", "desktop"],
    ]);
  });

  test("only real Safari counts as Safari on iOS", () => {
    expect(detect(CASES[0]!).isIosSafari).toBe(true);
    expect(detect(CASES[4]!).isIosSafari).toBe(true);
    for (const i of [1, 2, 3]) expect(detect(CASES[i]!).isIosSafari).toBe(false);
  });

  test("passes standalone through", () => {
    const base = { userAgent: IPHONE_SAFARI, platform: "iPhone", maxTouchPoints: 5 };
    expect(detectPlatform({ ...base, standalone: true }).standalone).toBe(true);
  });
});

describe("blog PLATFORM_SCRIPT", () => {
  test("agrees with detectPlatform on the OS", () => {
    for (const c of CASES) {
      const doc = { documentElement: { dataset: {} as Record<string, string> } };
      new Function("document", "navigator", PLATFORM_SCRIPT)(doc, {
        userAgent: c.userAgent,
        platform: c.platform,
        maxTouchPoints: c.touch,
      });
      expect([c.name, doc.documentElement.dataset.os]).toEqual([c.name, detect(c).os]);
    }
  });
});
