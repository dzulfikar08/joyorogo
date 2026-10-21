/**
 * Size budget of the floating tab bar, in dp. Pure so the footprint can be unit tested.
 *
 * The bar is a solid rounded pill inset from the screen edges and lifted above the bottom inset (gesture area, 3-button bar,
 * iOS home indicator). It floats over the screens: content scrolls underneath, so every tab screen pads the end of its content
 * by `floatingTabBarFootprint` + `TAB_BAR_CONTENT_GAP`. The camera button is raised out of the pill by `CAMERA_RAISE` and
 * counts toward the footprint.
 */

/** Padding around an item's icon and label inside the item. */
export const TAB_ITEM_PADDING = 6;
export const TAB_ICON_SIZE = 24;
export const TAB_LABEL_SIZE = 11;
/** Fixed label line so the budget does not depend on the font's own metrics. */
export const TAB_LABEL_LINE = 14;
/** Above this the labels no longer fit a phone's width; the bar stays readable rather than growing with the setting. */
export const TAB_LABEL_MAX_SCALE = 1.3;

/** Space between the pill's border and the items. */
export const TAB_BAR_PADDING = 6;
export const TAB_BAR_BORDER = 1;
/** Gap between the pill and each side of the screen. */
export const TAB_BAR_MARGIN_X = 16;
/** Gap between the pill and the bottom inset (Android), and the least distance from the screen's bottom edge on iOS. */
export const TAB_BAR_GAP_BOTTOM = 8;
/** iOS: how far the pill dips into the home indicator's safe area; the indicator is a thin line, so the full inset leaves an empty band. */
export const TAB_BAR_IOS_INSET_TUCK = 12;

/** Camera button: filled circle (the 56 dp primary target) inside a ring in the pill's colour that notches the pill. */
export const CAMERA_SIZE = 56;
export const CAMERA_RING = 4;
export const CAMERA_OUTER = CAMERA_SIZE + CAMERA_RING * 2;
/** How far the camera button rises above the pill's top edge. */
export const CAMERA_RAISE = 20;
/** Width the centre slot reserves in the pill for the camera button, with breathing room either side. */
export const CAMERA_SLOT = CAMERA_OUTER + 8;

/** Space between the bar's top (camera included) and the last item of a screen's content. */
export const TAB_BAR_CONTENT_GAP = 12;

/** The system font scale the label is drawn at, and so the one the bar is sized for: within [1, max]. */
export function tabLabelScale(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return 1;
  return Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
}

/** Height of one item: padding, icon, label line, padding. */
export function tabItemHeight(fontScale: number): number {
  return Math.ceil(TAB_ITEM_PADDING * 2 + TAB_ICON_SIZE + TAB_LABEL_LINE * tabLabelScale(fontScale));
}

/** Height of the pill itself: its border and padding around one item. */
export function tabBarPillHeight(fontScale: number): number {
  return tabItemHeight(fontScale) + (TAB_BAR_PADDING + TAB_BAR_BORDER) * 2;
}

/** Height of the strip holding the pill and the camera rising out of it. */
export function tabBarStripHeight(fontScale: number): number {
  return CAMERA_RAISE + tabBarPillHeight(fontScale);
}

function safeInset(bottomInset: number): number {
  return Math.max(0, Number.isFinite(bottomInset) ? bottomInset : 0);
}

/**
 * Distance from the screen's bottom edge to the pill. Android: the inset plus the gap. iOS: the inset minus a tuck so the pill
 * sits close to the home indicator, never nearer the edge than the gap (devices without a home indicator).
 */
export function tabBarBottomOffset(bottomInset: number, os: string): number {
  const inset = safeInset(bottomInset);
  if (os === "ios") return Math.max(inset - TAB_BAR_IOS_INSET_TUCK, TAB_BAR_GAP_BOTTOM);
  return inset + TAB_BAR_GAP_BOTTOM;
}

/** Total height the bar covers at the bottom of the screen: strip and the offset below it. */
export function floatingTabBarFootprint(fontScale: number, bottomInset: number, os: string): number {
  return tabBarStripHeight(fontScale) + tabBarBottomOffset(bottomInset, os);
}

/** Bottom padding for the content of a tab screen: the footprint plus a gap, so the last item scrolls fully clear of the bar. */
export function tabContentInset(fontScale: number, bottomInset: number, os: string): number {
  return floatingTabBarFootprint(fontScale, bottomInset, os) + TAB_BAR_CONTENT_GAP;
}
