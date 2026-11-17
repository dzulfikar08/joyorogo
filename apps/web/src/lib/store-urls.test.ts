import { describe, expect, test } from "bun:test";

import { APP_STORE_URL, PLAY_STORE_URL, appStoreUrl, playStoreUrl } from "./store-urls";

describe("store links", () => {
  test("defaults keep the evergreen campaign", () => {
    expect(PLAY_STORE_URL).toBe(
      "https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyorogo%26utm_medium%3Dreferral%26utm_campaign%3Devergreen-web",
    );
    expect(APP_STORE_URL).toBe("https://apps.apple.com/id/app/id6823222101?ct=joyorogo-evergreen-web");
  });

  test("a place ends the campaign, cleaned to a slug", () => {
    expect(playStoreUrl("hero")).toContain("utm_campaign%3Devergreen-web-hero");
    expect(appStoreUrl("SG Closing!")).toBe("https://apps.apple.com/id/app/id6823222101?ct=joyorogo-evergreen-web-sg-closing");
  });

  test("the provider token goes before ct when set", () => {
    expect(appStoreUrl("footer", "123456")).toBe(
      "https://apps.apple.com/id/app/id6823222101?pt=123456&ct=joyorogo-evergreen-web-footer",
    );
  });
});
