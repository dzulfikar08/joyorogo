/** The widget actions that may fetch; deleted and click never reach the refresh. */
export type RefreshAction = "WIDGET_ADDED" | "WIDGET_UPDATE" | "WIDGET_RESIZED";

/**
 * How old the stored snapshot may be before a widget action fetches again. The launcher fires one headless run per
 * widget on the same 30 minute tick (and the app rewrites the snapshot whenever its own screens load), so most runs
 * find a snapshot that is seconds or minutes old: they repaint it and skip three more API calls and a radio wake-up.
 * A just-placed widget only skips when the snapshot is a couple of minutes old, so it never shows stale numbers.
 */
const FRESH_MS: Record<RefreshAction, number> = {
  WIDGET_ADDED: 2 * 60_000,
  WIDGET_UPDATE: 10 * 60_000,
  WIDGET_RESIZED: 10 * 60_000,
};

export function isRefreshAction(action: string): action is RefreshAction {
  return Object.hasOwn(FRESH_MS, action);
}

export function snapshotNeedsRefresh(
  action: RefreshAction,
  updatedAt: number,
  now: number,
): boolean {
  return now - updatedAt >= FRESH_MS[action];
}
