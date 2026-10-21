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
  tabBarBottomOffset,
  tabBarStripHeight,
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

  test("bottom offset: iOS tucks the pill toward the home indicator", () => {
    expect(tabBarBottomOffset(34, "ios")).toBe(22);
    expect(tabBarBottomOffset(20, "ios")).toBe(TAB_BAR_GAP_BOTTOM);
  });

  test("bottom offset: Android is the inset plus the gap", () => {
    expect(tabBarBottomOffset(16, "android")).toBe(16 + TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(48, "android")).toBe(48 + TAB_BAR_GAP_BOTTOM);
  });

  test("bottom offset: no inset gives the minimum gap on both", () => {
    expect(tabBarBottomOffset(0, "ios")).toBe(TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(0, "android")).toBe(TAB_BAR_GAP_BOTTOM);
  });

  test("a bad inset counts as zero", () => {
    expect(tabBarBottomOffset(-5, "ios")).toBe(TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(Number.NaN, "android")).toBe(TAB_BAR_GAP_BOTTOM);
  });

  test("footprint is the strip plus the same offset the bar is placed at", () => {
    expect(floatingTabBarFootprint(1, 0, "android")).toBe(CAMERA_RAISE + tabBarPillHeight(1) + TAB_BAR_GAP_BOTTOM);
    expect(floatingTabBarFootprint(1, 34, "ios")).toBe(tabBarStripHeight(1) + 22);
    expect(floatingTabBarFootprint(1, 34, "android")).toBe(tabBarStripHeight(1) + 34 + TAB_BAR_GAP_BOTTOM);
  });

  test("content inset clears the footprint by the content gap", () => {
    expect(tabContentInset(1, 24, "android")).toBe(floatingTabBarFootprint(1, 24, "android") + TAB_BAR_CONTENT_GAP);
    expect(tabContentInset(1, 34, "ios")).toBe(floatingTabBarFootprint(1, 34, "ios") + TAB_BAR_CONTENT_GAP);
  });

  test("a larger font grows the footprint", () => {
    expect(floatingTabBarFootprint(1.3, 0, "ios")).toBeGreaterThan(floatingTabBarFootprint(1, 0, "ios"));
  });
});
