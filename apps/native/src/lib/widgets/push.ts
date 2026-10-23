import { requestWidgetUpdate } from "react-native-android-widget";

import { mirrorStreakToIosWidget } from "./ios-streak-store";
import { buildWidgetElement } from "./ui";
import type { WidgetName } from "./ui";
import { readSnapshot, writeSnapshot } from "./snapshot";
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
  const snapshot = await writeSnapshot(patch);
  // The iPhone streak widget cannot render JS: it reads the same facts from the App Group (ios-streak-store.ts).
  mirrorStreakToIosWidget(snapshot);
  await refreshWidgets(PROGRESS_WIDGETS, snapshot);
}

/**
 * The session is gone (sign out, deleted account, expired session): every widget flips to its signed-out tile now instead
 * of keeping the last person's numbers on the home screen. The iPhone widget has no headless refresh to notice it later,
 * and the Android widgets would otherwise wait for their next launcher update. Cheap when nothing changes, so a screen
 * may call it on every anonymous render.
 */
export async function pushSignedOutSnapshot(): Promise<void> {
  const current = await readSnapshot();
  const snapshot = current.signedIn ? await writeSnapshot({ signedIn: false, day: null, fasting: null, inbox: null }) : current;
  mirrorStreakToIosWidget(snapshot);
  if (!current.signedIn) return;
  // Sign-out must go on if a launcher refuses the update.
  await refreshWidgets([...new Set([...PROGRESS_WIDGETS, ...INBOX_WIDGETS])], snapshot).catch(() => {});
}

/** Widgets only show unread rows; pass the full (read + unread) inbox list. */
export async function pushInboxSnapshot(all: WidgetInboxItem[]): Promise<void> {
  const items = all.filter((item) => item.readAt === null);
  await refreshWidgets(
    INBOX_WIDGETS,
    await writeSnapshot({ signedIn: true, inbox: { unread: items.length, items: items.slice(0, 3) } }),
  );
}
