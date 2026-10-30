import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAMERA_WIDGET_URI, INBOX_WIDGET_URI, PROGRESS_WIDGET_URI, WIDGET_NAMES, isStaticWidget } from "./names";
import { mapNativeIntentPath } from "../native-intent-path";

const root = resolve(import.meta.dir, "../../..");

interface WidgetConfig {
  name: string;
  label: string;
  description: string;
  minWidth: string;
  minHeight: string;
  targetCellWidth: number;
  targetCellHeight: number;
  resizeMode?: string;
  previewImage?: string;
  updatePeriodMillis?: number;
}

// app.json carries whole-line // comments; none of its strings hold one.
const appJson = readFileSync(resolve(root, "app.json"), "utf8").replace(/^\s*\/\/.*$/gm, "");
const app = JSON.parse(appJson) as {
  expo: { plugins: unknown[] };
};
const plugin = app.expo.plugins.find(
  (p): p is [string, { widgets: WidgetConfig[] }] => Array.isArray(p) && p[0] === "react-native-android-widget",
);
const widgets = plugin?.[1].widgets ?? [];

describe("widget registration", () => {
  test("every widget in app.json is in the registry and vice versa", () => {
    expect(widgets.map((w) => w.name).sort()).toEqual(Object.keys(WIDGET_NAMES).sort());
  });

  test("every widget has a label, a description and an existing preview image", () => {
    for (const w of widgets) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
      expect(w.previewImage).toBeDefined();
      expect(existsSync(resolve(root, w.previewImage as string))).toBe(true);
    }
  });

  test("FotoMakanan is a fixed 1x1 tile", () => {
    const w = widgets.find((x) => x.name === "FotoMakanan");
    expect(w).toBeDefined();
    expect(w?.targetCellWidth).toBe(1);
    expect(w?.targetCellHeight).toBe(1);
    expect(w?.resizeMode).toBe("none");
    expect(w?.minWidth).toBe("40dp");
    expect(w?.minHeight).toBe("40dp");
    expect(w?.label).toBe("Scan Makanan");
  });

  test("FotoMakanan is static: no periodic update, no headless refresh", () => {
    const w = widgets.find((x) => x.name === "FotoMakanan");
    expect(w?.updatePeriodMillis).toBeUndefined();
    expect(isStaticWidget("FotoMakanan")).toBe(true);
    for (const name of ["ProgresHariIni", "KotakMasukGrup", "Ringkasan", "StreakCatat"]) {
      expect(isStaticWidget(name)).toBe(false);
    }
  });

  test("StreakCatat is a 2x2 tile that refreshes every 30 minutes (Android's floor, so Joyo's mood turns soon after 12:00, 17:00 and 21:00) and opens the scan camera", () => {
    const w = widgets.find((x) => x.name === "StreakCatat");
    expect(w).toBeDefined();
    expect(w?.targetCellWidth).toBe(2);
    expect(w?.targetCellHeight).toBe(2);
    expect(w?.updatePeriodMillis).toBe(1800000);
    expect(existsSync(resolve(root, "app/makan-ai.tsx"))).toBe(true);
  });

  test("the widget deep link uses the app scheme and resolves to the camera route", () => {
    const scheme = (app.expo as unknown as { scheme: string }).scheme;
    expect(CAMERA_WIDGET_URI.startsWith(`${scheme}://`)).toBe(true);
    expect(mapNativeIntentPath(CAMERA_WIDGET_URI)).toBe("/makan-ai");
    expect(existsSync(resolve(root, "app/makan-ai.tsx"))).toBe(true);
  });

  test("the progress and inbox widget links use the app scheme and resolve to existing screens", () => {
    const scheme = (app.expo as unknown as { scheme: string }).scheme;
    for (const [uri, file] of [
      [PROGRESS_WIDGET_URI, "app/(tabs)/makan.tsx"],
      [INBOX_WIDGET_URI, "app/inbox.tsx"],
    ] as const) {
      expect(uri.startsWith(`${scheme}://`)).toBe(true);
      expect(mapNativeIntentPath(uri)).toBe(uri);
      expect(existsSync(resolve(root, file))).toBe(true);
    }
  });
});
