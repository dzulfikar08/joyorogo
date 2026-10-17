import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { loadStoredLocale, setLocale } from "@/src/lib/i18n";
import { refreshSnapshotFromApi } from "@/src/lib/widgets/refresh";
import { readSnapshot } from "@/src/lib/widgets/snapshot";
import { buildWidgetElement } from "@/src/lib/widgets/ui";

/**
 * Actions that should attempt a fresh fetch: the launcher's own periodic
 * update (app.json sets 30 min) plus add/resize events. WIDGET_CLICK never
 * reaches this handler (taps use native OPEN_APP / deep link URIs) and
 * WIDGET_DELETED needs no cleanup — there are no background tasks to stop.
 */
const SHOULD_REFRESH: Record<WidgetTaskHandlerProps["widgetAction"], true | undefined> = {
  WIDGET_ADDED: true,
  WIDGET_UPDATE: true,
  WIDGET_RESIZED: true,
  WIDGET_DELETED: undefined,
  WIDGET_CLICK: undefined,
};

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetAction, widgetInfo, renderWidget } = props;
  if (!SHOULD_REFRESH[widgetAction]) return;

  // The headless run starts before the UI applies the saved language.
  const stored = await loadStoredLocale();
  if (stored) await setLocale(stored, { remember: false });

  // Paint the stored snapshot first so the widget never blanks while
  // the (optional, timeout-bounded) headless fetch runs.
  const snapshot = await readSnapshot();
  const element = buildWidgetElement(widgetInfo.widgetName, snapshot, widgetInfo);
  if (!element) return;
  renderWidget(element);

  const fresh = await refreshSnapshotFromApi(snapshot);
  if (fresh === null || fresh === snapshot) return;
  const freshElement = buildWidgetElement(widgetInfo.widgetName, fresh, widgetInfo);
  if (freshElement) renderWidget(freshElement);
}
