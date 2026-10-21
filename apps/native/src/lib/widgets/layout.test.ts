import { describe, expect, test } from "bun:test";

import {
  CARD_PADDING,
  DEFAULT_WIDGET_HEIGHT,
  HERO_STACK_BELOW_WIDTH,
  ROW_HEIGHT,
  STALE_AFTER_MS,
  cameraTileLayout,
  inboxRowCount,
  progressRows,
  staleAgo,
} from "./layout";

const ALL = { contentWidth: 300, hasFasting: true, hasProtein: true, isStale: true } as const;
/** Height at which exactly the always-visible rows fit. */
const BASE = ROW_HEIGHT.caption + ROW_HEIGHT.hero + ROW_HEIGHT.bar + CARD_PADDING * 2;
const WITH_EATEN = BASE + ROW_HEIGHT.eaten;

describe("progressRows", () => {
  const none = { stacked: false, eaten: false, stale: false, fasting: false, protein: false };

  test("a short widget keeps only the heading, number and bar", () => {
    expect(progressRows({ ...ALL, height: BASE })).toEqual(none);
  });

  test("optional rows join in priority order: eaten line, stale cue, IF window, protein", () => {
    const note = ROW_HEIGHT.note;
    expect(progressRows({ ...ALL, height: WITH_EATEN })).toMatchObject({ eaten: true, stale: false, fasting: false, protein: false });
    expect(progressRows({ ...ALL, height: WITH_EATEN + note })).toMatchObject({ eaten: true, stale: true, fasting: false, protein: false });
    expect(progressRows({ ...ALL, height: WITH_EATEN + 2 * note })).toMatchObject({ stale: true, fasting: true, protein: false });
    expect(progressRows({ ...ALL, height: WITH_EATEN + 2 * note + ROW_HEIGHT.protein })).toMatchObject({
      eaten: true,
      stale: true,
      fasting: true,
      protein: true,
    });
  });

  test("protein still shows when the IF row and stale cue are absent", () => {
    const fresh = { ...ALL, hasFasting: false, isStale: false };
    expect(progressRows({ ...fresh, height: WITH_EATEN + ROW_HEIGHT.protein })).toMatchObject({ protein: true });
  });

  test("a row that is not wanted never shows, however tall the widget", () => {
    expect(progressRows({ ...ALL, height: 1000, hasFasting: false, hasProtein: false, isStale: false })).toEqual({
      ...none,
      eaten: true,
    });
  });

  test("a narrow panel stacks the unit label under the number and pays for the extra line", () => {
    const narrow = { ...ALL, contentWidth: HERO_STACK_BELOW_WIDTH - 1 };
    expect(progressRows({ ...narrow, height: BASE }).stacked).toBe(true);
    expect(progressRows({ ...narrow, height: WITH_EATEN })).toMatchObject({ eaten: false });
    expect(progressRows({ ...narrow, height: WITH_EATEN + ROW_HEIGHT.heroLabel })).toMatchObject({ stacked: true, eaten: true });
    expect(progressRows({ ...ALL, contentWidth: HERO_STACK_BELOW_WIDTH, height: BASE }).stacked).toBe(false);
  });

  test("an unreported height counts as the generous default", () => {
    expect(progressRows({ ...ALL, height: 0 })).toEqual(progressRows({ ...ALL, height: DEFAULT_WIDGET_HEIGHT }));
  });
});

describe("inboxRowCount", () => {
  test("shows at least one row and at most three", () => {
    expect(inboxRowCount(60, 3)).toBe(1);
    expect(inboxRowCount(1000, 3)).toBe(3);
  });

  test("rows follow the height left under the heading", () => {
    const h = (rows: number) => CARD_PADDING * 2 + ROW_HEIGHT.inboxHeader + rows * ROW_HEIGHT.inboxRow;
    expect(inboxRowCount(h(2), 3)).toBe(2);
    expect(inboxRowCount(h(2) - 1, 3)).toBe(1);
    expect(inboxRowCount(h(3), 3)).toBe(3);
  });

  test("the stale cue takes its line out of the row budget", () => {
    const h = CARD_PADDING * 2 + ROW_HEIGHT.inboxHeader + 3 * ROW_HEIGHT.inboxRow;
    expect(inboxRowCount(h, 3, false)).toBe(3);
    expect(inboxRowCount(h, 3, true)).toBe(2);
  });
});

describe("staleAgo", () => {
  const noon = new Date(2026, 9, 21, 12, 0, 0).getTime();

  test("a fresh snapshot, or none stored, shows no cue", () => {
    expect(staleAgo(0, noon)).toBeNull();
    expect(staleAgo(noon - 30 * 60_000, noon)).toBeNull();
    expect(staleAgo(noon - STALE_AFTER_MS + 1, noon)).toBeNull();
  });

  test("three hours old reads as a relative age", () => {
    expect(staleAgo(noon - STALE_AFTER_MS, noon)).toEqual(expect.any(String));
    expect(staleAgo(noon - STALE_AFTER_MS, noon)?.length).toBeGreaterThan(0);
  });

  test("a snapshot from yesterday is stale even minutes old", () => {
    const justAfterMidnight = new Date(2026, 9, 22, 0, 10, 0).getTime();
    const lateEvening = new Date(2026, 9, 21, 23, 55, 0).getTime();
    expect(staleAgo(lateEvening, justAfterMidnight)).not.toBeNull();
  });
});

describe("cameraTileLayout", () => {
  test("a roomy cell keeps the whole label on one line at 11 sp with a big icon", () => {
    const layout = cameraTileLayout("Scan makan", 98);
    expect(layout).toMatchObject({ fontSize: 11, singleLine: true });
    expect(layout.icon).toBeGreaterThanOrEqual(28);
  });

  test("a cell too narrow for one line wraps the label on two lines", () => {
    expect(cameraTileLayout("Scan makan", 56).singleLine).toBe(false);
  });

  test("the label never falls under 9 sp and the icon never under 16 dp", () => {
    for (const label of ["Scan makan", "Scan food", "Imbas makanan"]) {
      for (const side of [40, 48, 56, 64, 72, 84, 98, 120]) {
        const layout = cameraTileLayout(label, side);
        expect(layout.fontSize).toBeGreaterThanOrEqual(9);
        expect(layout.icon).toBeGreaterThanOrEqual(16);
        expect(layout.icon).toBeLessThanOrEqual(40);
      }
    }
  });

  test("the corner radius follows the cell up to the card radius", () => {
    expect(cameraTileLayout("Scan makan", 56).radius).toBe(17);
    expect(cameraTileLayout("Scan makan", 98).radius).toBe(24);
  });

  test("a launcher reporting no size gets the 72 dp layout", () => {
    expect(cameraTileLayout("Scan makan", 0)).toEqual(cameraTileLayout("Scan makan", 72));
  });
});
