import { requestWidgetUpdate } from "react-native-android-widget";

import { buildWidgetElement } from "./ui";
import type { WidgetName } from "./ui";
import { writeSnapshot } from "./snapshot";
import type { WidgetInboxItem, WidgetSnapshot } from "./snapshot";

/** Widgets that show day data: progress (the combined one too) and the streak, which the day summary also carries. */
const PROGRESS_WIDGETS: WidgetName[] = ["ProgresHariIni", "Ringkasan", "StreakCatat"];
/** Widgets that show the group inbox. */
const INBOX_WIDGETS: WidgetName[] = ["KotakMasukGrup", "Ringkasan"];

async function refreshWidgets(widgets: WidgetName[], snapshot: WidgetSnapshot): Promise<void> {
  await Promise.all(
    widgets.map((widgetName) =>
      requestWidgetUpdate({
        widgetName,
        renderWidget: (info) => buildWidgetElement(widgetName, snapshot, info),
      }),
    ),
  );
}

/**
 * App-side snapshot push. Called from the screens whenever the day summary
 * or the inbox query resolves, so widgets always show the freshest data the
 * app itself just loaded.
 *
 * `fasting` follows the day data: null clears the IF line (IF off / Ramadan),
 * undefined (IF query still pending) keeps whatever the snapshot already shows.
 */
export async function pushDaySnapshot(
  day: NonNullable<WidgetSnapshot["day"]>,
  fasting?: WidgetSnapshot["fasting"],
): Promise<void> {
  // Screens only render behind the session gate, so a push implies signed in.
  const patch: Partial<Omit<WidgetSnapshot, "updatedAt">> = { signedIn: true, day };
  if (fasting !== undefined) patch.fasting = fasting;
  await refreshWidgets(PROGRESS_WIDGETS, await writeSnapshot(patch));
}

/** Widgets only show unread rows; pass the full (read + unread) inbox list. */
export async function pushInboxSnapshot(all: WidgetInboxItem[]): Promise<void> {
  const items = all.filter((item) => item.readAt === null);
  await refreshWidgets(
    INBOX_WIDGETS,
    await writeSnapshot({ signedIn: true, inbox: { unread: items.length, items: items.slice(0, 3) } }),
  );
}
