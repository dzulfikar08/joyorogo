import { timeAgo } from "@joyorogo/i18n";

import { lightTheme } from "@/theme";

/**
 * Pure sizing and freshness rules behind widgets/ui.tsx. Kept free of
 * react-native-android-widget so bun can unit-test them.
 *
 * Widgets are Android LinearLayouts: a child that does not fit is clipped, and
 * Plus Jakarta Sans has tall line boxes (ascent + descent is 1.65 em), so the
 * heights below are conservative dp estimates per rendered row, measured against
 * a 520 dpi phone. They only decide which optional rows still fit; a launcher
 * that reports no height gets the generous default.
 */

/** Height assumed when the launcher reports none (roughly a 2-row widget). */
export const DEFAULT_WIDGET_HEIGHT = 220;

/** Card padding (dp), top and bottom each. */
export const CARD_PADDING = 14;

/** Estimated dp height of one row, margin included. */
export const ROW_HEIGHT = {
  caption: 19,
  /** Big number + unit label side by side. */
  hero: 49,
  /** Extra height when the unit label drops under the number (narrow panel). */
  heroLabel: 21,
  bar: 12,
  eaten: 25,
  /** One muted status line: IF window, "updated 5 h ago". */
  note: 25,
  protein: 37,
  inboxHeader: 24,
  inboxRow: 53,
} as const;

/** Narrower than this, the hero unit label wraps unless it moves under the number. */
export const HERO_STACK_BELOW_WIDTH = 150;

export function usableHeight(height: number): number {
  return (height > 0 ? height : DEFAULT_WIDGET_HEIGHT) - CARD_PADDING * 2;
}

export interface ProgressRows {
  stacked: boolean;
  /** The "eaten / target" line. */
  eaten: boolean;
  stale: boolean;
  fasting: boolean;
  protein: boolean;
}

/**
 * Which optional rows of the progress panel fit. The heading, the big number
 * and its bar always show; the rest is added in order of importance (eaten /
 * target line, stale cue, IF window, protein) while the height budget lasts.
 */
export function progressRows(args: {
  height: number;
  contentWidth: number;
  hasFasting: boolean;
  hasProtein: boolean;
  isStale: boolean;
}): ProgressRows {
  const stacked = args.contentWidth < HERO_STACK_BELOW_WIDTH;
  const budget = usableHeight(args.height);
  let used = ROW_HEIGHT.caption + ROW_HEIGHT.hero + ROW_HEIGHT.bar + (stacked ? ROW_HEIGHT.heroLabel : 0);
  const take = (wanted: boolean, cost: number): boolean => {
    if (!wanted || used + cost > budget) return false;
    used += cost;
    return true;
  };
  return {
    stacked,
    eaten: take(true, ROW_HEIGHT.eaten),
    stale: take(args.isStale, ROW_HEIGHT.note),
    fasting: take(args.hasFasting, ROW_HEIGHT.note),
    protein: take(args.hasProtein, ROW_HEIGHT.protein),
  };
}

/** How many unread rows fit under the inbox heading (at least one, at most three), leaving room for the stale cue when shown. */
export function inboxRowCount(height: number, unread: number, withStaleCue = false): number {
  const header = (unread > 0 ? ROW_HEIGHT.inboxHeader : ROW_HEIGHT.caption) + (withStaleCue ? ROW_HEIGHT.note : 0);
  const fit = Math.floor((usableHeight(height) - header) / ROW_HEIGHT.inboxRow);
  return Math.max(1, Math.min(3, fit));
}

/** Stale after this long without a refresh (the launcher normally redraws every 30 minutes). */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Relative age of the snapshot ("5 jam lalu") once it is old enough, or from
 * the next calendar day on (the day numbers then belong to yesterday); null
 * while fresh or when nothing was ever stored.
 */
export function staleAgo(updatedAt: number, now: number = Date.now()): string | null {
  if (!updatedAt) return null;
  const sameDay = new Date(updatedAt).toDateString() === new Date(now).toDateString();
  if (sameDay && now - updatedAt < STALE_AFTER_MS) return null;
  return timeAgo(new Date(updatedAt));
}

export interface CameraTileLayout {
  icon: number;
  /** Corner radius: the card radius, eased down on small cells so the tile stays a rounded square, not a pill. */
  radius: number;
  fontSize: number;
  lineHeight: number;
  /** Label stays one line; false wraps it onto two ("Scan" / "makan"). */
  singleLine: boolean;
}

/** Widest plausible glyph, as a fraction of the font size, for Plus Jakarta Sans ExtraBold. */
const GLYPH_EM = 0.62;
/** Android's sp scale on the reference phone; keeps the estimate on the safe side. */
const SP_SCALE = 1.13;
const TILE_PADDING = 4;
const TILE_RADIUS_RATIO = 0.3;
/** Height of one label line box relative to its lineHeight (see ROW_HEIGHT note). */
const LINE_BOX = 1.41;

/**
 * Icon and label sizes for the 1x1 camera tile on a launcher cell of `side` dp.
 * Prefers one line of 11 sp, then 10 sp, then a two-line label; the icon takes
 * whatever height is left. Falls back to the smallest two-line label.
 */
export function cameraTileLayout(label: string, side: number): CameraTileLayout {
  const s = side > 0 ? side : 72;
  const room = s - TILE_PADDING * 2;
  const longestWord = Math.max(...label.split(/\s+/).map((w) => w.length));
  const options: Array<{ fontSize: number; singleLine: boolean }> = [
    { fontSize: 11, singleLine: true },
    { fontSize: 10, singleLine: true },
    { fontSize: 10, singleLine: false },
    { fontSize: 9, singleLine: false },
  ];
  const chosen =
    options.find((o) => {
      const chars = o.singleLine ? label.length : longestWord;
      return chars * GLYPH_EM * o.fontSize * SP_SCALE <= room;
    }) ?? options[options.length - 1]!;
  const lineHeight = Math.round(chosen.fontSize * 1.2);
  const lines = chosen.singleLine ? 1 : 2;
  const labelBox = lines * lineHeight * LINE_BOX;
  const icon = Math.round(Math.max(16, Math.min(40, s - TILE_PADDING * 2 - labelBox - 2)));
  return {
    icon,
    radius: Math.min(lightTheme.radius.card, Math.round(s * TILE_RADIUS_RATIO)),
    fontSize: chosen.fontSize,
    lineHeight,
    singleLine: chosen.singleLine,
  };
}
