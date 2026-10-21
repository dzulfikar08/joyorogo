import { describe, expect, test } from "bun:test";

import {
  CAMERA_OUTER,
  CAMERA_RAISE,
  CAMERA_SIZE,
  TAB_BAR_CONTENT_GAP,
  TAB_BAR_GAP_BOTTOM,
  TAB_LABEL_MAX_SCALE,
  floatingTabBarFootprint,
  tabBarPillHeight,
  tabContentInset,
  tabItemHeight,
  tabLabelScale,
} from "./tab-bar-metrics";

describe("tab bar metrics", () => {
  test("items are at least 48 dp tall at every supported font scale", () => {
    for (const scale of [0.8, 1, 1.15, 1.3, 2, 4]) {
      expect(tabItemHeight(scale)).toBeGreaterThanOrEqual(48);
    }
  });

  test("the camera button fill is at least 56 dp", () => {
    expect(CAMERA_SIZE).toBeGreaterThanOrEqual(56);
    expect(CAMERA_OUTER).toBeGreaterThan(CAMERA_SIZE);
  });

  test("font scale is clamped to [1, max]; garbage falls back to 1", () => {
    expect(tabLabelScale(0.5)).toBe(1);
    expect(tabLabelScale(1.1)).toBe(1.1);
    expect(tabLabelScale(3)).toBe(TAB_LABEL_MAX_SCALE);
    expect(tabLabelScale(Number.NaN)).toBe(1);
    expect(tabItemHeight(3)).toBe(tabItemHeight(TAB_LABEL_MAX_SCALE));
  });

  test("footprint is the raised camera, the pill, the gap below and the bottom inset", () => {
    expect(floatingTabBarFootprint(1, 0)).toBe(CAMERA_RAISE + tabBarPillHeight(1) + TAB_BAR_GAP_BOTTOM);
    expect(floatingTabBarFootprint(1, 34) - floatingTabBarFootprint(1, 0)).toBe(34);
  });

  test("a bad inset counts as zero", () => {
    expect(floatingTabBarFootprint(1, -5)).toBe(floatingTabBarFootprint(1, 0));
    expect(floatingTabBarFootprint(1, Number.NaN)).toBe(floatingTabBarFootprint(1, 0));
  });

  test("content inset clears the footprint by the content gap", () => {
    expect(tabContentInset(1, 24)).toBe(floatingTabBarFootprint(1, 24) + TAB_BAR_CONTENT_GAP);
  });

  test("a larger font grows the footprint", () => {
    expect(floatingTabBarFootprint(1.3, 0)).toBeGreaterThan(floatingTabBarFootprint(1, 0));
  });
});
