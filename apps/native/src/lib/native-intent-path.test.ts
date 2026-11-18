import { describe, expect, test } from "bun:test";

import { CAMERA_WIDGET_URI } from "./widgets/names";
import { mapNativeIntentPath } from "./native-intent-path";

describe("mapNativeIntentPath", () => {
  test("the camera widget link opens the scan camera route", () => {
    expect(mapNativeIntentPath(CAMERA_WIDGET_URI)).toBe("/makan-ai");
  });

  test("camera link variants (cold start URI, warm start path, trailing slash) all land on /makan-ai", () => {
    expect(mapNativeIntentPath("joyorogo://makan-ai/")).toBe("/makan-ai");
    expect(mapNativeIntentPath("/makan-ai")).toBe("/makan-ai");
    expect(mapNativeIntentPath("makan-ai")).toBe("/makan-ai");
  });

  test("the camera link keeps a forwarded ?date=", () => {
    expect(mapNativeIntentPath("joyorogo://makan-ai?date=2026-05-01")).toBe("/makan-ai?date=2026-05-01");
  });

  test("lookalike routes are not captured by the camera rule", () => {
    expect(mapNativeIntentPath("/makan-ai-lain")).toBe("/makan-ai-lain");
    expect(mapNativeIntentPath("joyorogo://makan-barcode")).toBe("joyorogo://makan-barcode");
  });

  test("invite links land on the join screen", () => {
    expect(mapNativeIntentPath("joyorogo://gabung/AB12cd")).toBe("/gabung/AB12cd");
    expect(mapNativeIntentPath("https://joyorogo.com/gabung/XYZ9")).toBe("/gabung/XYZ9");
  });

  test("Joyo Keluarga invite links land on the household invite screen", () => {
    expect(mapNativeIntentPath("joyorogo://keluarga/AB12cd34")).toBe("/keluarga/AB12cd34");
    expect(mapNativeIntentPath("https://joyorogo.com/keluarga/XYZ98765?utm_source=app-share")).toBe("/keluarga/XYZ98765");
  });

  test("JoyoFit's monitoring invites are not taken for Keluarga seats", () => {
    expect(mapNativeIntentPath("https://fit.joyorogo.com/keluarga/AB12cd34")).toBe("https://fit.joyorogo.com/keluarga/AB12cd34");
  });

  test("removed strength screens fall back to the archive", () => {
    expect(mapNativeIntentPath("/latihan/aktif")).toBe("/latihan");
    expect(mapNativeIntentPath("/latihan/rutinitas")).toBe("/latihan");
  });

  test("the Strava redirect goes to the Strava settings screen", () => {
    expect(mapNativeIntentPath("joyorogo://joyorogo.com/strava?code=abc")).toBe("/profil/strava");
  });

  test("the COROS redirect goes to the COROS settings screen", () => {
    expect(mapNativeIntentPath("joyorogo://joyorogo.com/coros?code=abc&state=xyz")).toBe("/profil/coros");
  });

  test("other paths pass through untouched", () => {
    expect(mapNativeIntentPath("joyorogo://inbox")).toBe("joyorogo://inbox");
    expect(mapNativeIntentPath("/")).toBe("/");
  });
});
