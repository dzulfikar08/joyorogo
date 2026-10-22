import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { loadStoredLocale, setLocale } from "@/src/lib/i18n";
import { isStaticWidget } from "@/src/lib/widgets/names";
import { refreshSnapshotFromApi } from "@/src/lib/widgets/refresh";
import { isRefreshAction, snapshotNeedsRefresh } from "@/src/lib/widgets/refresh-policy";
import { readSnapshot } from "@/src/lib/widgets/snapshot";
import { buildWidgetElement } from "@/src/lib/widgets/ui";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetAction, widgetInfo, renderWidget } = props;
  // Only the launcher's own periodic update (app.json sets 30 min) and add/resize events paint and fetch.
  // WIDGET_CLICK never reaches this handler (taps use native OPEN_APP / deep link URIs) and WIDGET_DELETED needs no
  // cleanup: there are no background tasks to stop.
  if (!isRefreshAction(widgetAction)) return;

  // The headless run starts before the UI applies the saved language.
  const stored = await loadStoredLocale();
  if (stored) await setLocale(stored, { remember: false });

  // Paint the stored snapshot first so the widget never blanks while
  // the (optional, timeout-bounded) headless fetch runs.
  const snapshot = await readSnapshot();
  const element = buildWidgetElement(widgetInfo.widgetName, snapshot, widgetInfo);
  if (!element) return;
  renderWidget(element);

  // Shortcut widgets show no data: nothing to fetch. Neither does a snapshot another widget's run (or the app)
  // wrote minutes ago.
  if (isStaticWidget(widgetInfo.widgetName)) return;
  if (!snapshotNeedsRefresh(widgetAction, snapshot.updatedAt, Date.now())) return;

  const fresh = await refreshSnapshotFromApi(snapshot);
  if (fresh === null || fresh === snapshot) return;
  const freshElement = buildWidgetElement(widgetInfo.widgetName, fresh, widgetInfo);
  if (freshElement) renderWidget(freshElement);
}
