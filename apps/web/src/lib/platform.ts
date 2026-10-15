import { useSyncExternalStore } from "react";

export type Os = "ios" | "android" | "desktop";

export type Platform = {
  os: Os;
  /** iOS browser engine is Safari itself (the only one that can install a web app on every iOS version). */
  isIosSafari: boolean;
  /** Running as an installed web app (home screen icon), not in a browser tab. */
  standalone: boolean;
};

/**
 * iOS browsers other than Safari and the webviews inside social apps. Chrome,
 * Firefox, Edge, and Opera on iOS all run WebKit, but their UA carries their
 * own token; webviews usually drop the `Safari/` token or add the host app's.
 */
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|BytedanceWebview|Twitter|Snapchat|LinkedInApp|Pinterest|WhatsApp|Telegram|MicroMessenger|Gojek|Shopee|Tokopedia/i;

export type PlatformInput = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
};

/** Pure so it can be tested with UA strings; `usePlatform` feeds it the real navigator. */
export function detectPlatform({
  userAgent,
  platform,
  maxTouchPoints,
  standalone,
}: PlatformInput): Platform {
  // iPadOS 13+ asks for the desktop site and reports as a Mac, but a Mac has no touch points.
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (ios) {
    return {
      os: "ios",
      isIosSafari: /Safari\//.test(userAgent) && !NOT_SAFARI.test(userAgent),
      standalone,
    };
  }
  return { os: /Android/i.test(userAgent) ? "android" : "desktop", isIosSafari: false, standalone };
}

/** Before hydration and on the server nobody knows the platform: render the neutral version. */
const NEUTRAL: Platform = { os: "desktop", isIosSafari: false, standalone: false };

let cached: Platform | undefined;

function readPlatform(): Platform {
  cached ??= detectPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      matchMedia("(display-mode: standalone)").matches,
  });
  return cached;
}

const subscribe = () => () => {};

/**
 * The visitor's platform. `useSyncExternalStore` renders `NEUTRAL` (what the
 * prerendered HTML shows: every option) during server rendering and hydration,
 * then re-renders once with the real value, so there is no hydration mismatch.
 * `ready` is false for that first neutral pass.
 */
export function usePlatform(): Platform & { ready: boolean } {
  const real = useSyncExternalStore(subscribe, readPlatform, () => NEUTRAL);
  return { ...real, ready: real !== NEUTRAL };
}
