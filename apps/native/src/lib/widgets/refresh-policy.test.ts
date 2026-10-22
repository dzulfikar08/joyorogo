import { describe, expect, test } from "bun:test";

import { isRefreshAction, snapshotNeedsRefresh } from "./refresh-policy";

const NOW = Date.UTC(2026, 9, 23, 6, 8, 34);
const ago = (ms: number) => NOW - ms;

describe("periodic update (every 30 minutes, one run per widget)", () => {
  test("the run right behind the one that just fetched repaints only", () => {
    expect(snapshotNeedsRefresh("WIDGET_UPDATE", ago(2_000), NOW)).toBe(false);
  });

  test("the app wrote the snapshot a few minutes ago", () => {
    expect(snapshotNeedsRefresh("WIDGET_UPDATE", ago(9 * 60_000), NOW)).toBe(false);
  });

  test("the tick after the last fetch fetches again", () => {
    expect(snapshotNeedsRefresh("WIDGET_UPDATE", ago(30 * 60_000), NOW)).toBe(true);
  });

  test("ten minutes is the line", () => {
    expect(snapshotNeedsRefresh("WIDGET_UPDATE", ago(10 * 60_000), NOW)).toBe(true);
  });

  test("a snapshot that was never written fetches", () => {
    expect(snapshotNeedsRefresh("WIDGET_UPDATE", 0, NOW)).toBe(true);
  });
});

describe("a widget placed or resized", () => {
  test("a new widget does not trust a snapshot older than two minutes", () => {
    expect(snapshotNeedsRefresh("WIDGET_ADDED", ago(3 * 60_000), NOW)).toBe(true);
    expect(snapshotNeedsRefresh("WIDGET_ADDED", ago(30_000), NOW)).toBe(false);
  });

  test("a resize behaves like a periodic update", () => {
    expect(snapshotNeedsRefresh("WIDGET_RESIZED", ago(5 * 60_000), NOW)).toBe(false);
    expect(snapshotNeedsRefresh("WIDGET_RESIZED", ago(15 * 60_000), NOW)).toBe(true);
  });
});

describe("which actions paint and fetch", () => {
  test("add, periodic update and resize do; delete and click do not", () => {
    expect(["WIDGET_ADDED", "WIDGET_UPDATE", "WIDGET_RESIZED"].every(isRefreshAction)).toBe(true);
    expect(["WIDGET_DELETED", "WIDGET_CLICK", "toString"].some(isRefreshAction)).toBe(false);
  });
});
