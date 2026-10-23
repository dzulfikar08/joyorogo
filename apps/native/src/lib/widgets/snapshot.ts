import { File, Paths } from "expo-file-system";

import type { StreakStamp } from "@joyorogo/api/lib/streak";
import type { DayZone } from "@joyorogo/i18n";

/**
 * Plain-data snapshot the home-screen widgets render from.
 *
 * The app refreshes it whenever the day summary or the inbox query resolves
 * (see widgets/push.ts), and the widget task handler refreshes it headlessly
 * on the launcher's periodic update (see widgets/refresh.ts). Stored as one
 * JSON file in the app documents directory so both the app and the headless
 * widget renderer read the exact same bytes.
 */
export type WidgetDaySnapshot = {
  date: string;
  /** The person's day zone (an IANA name served by the app): the streak widget cuts today in it. Absent in old snapshots. */
  zone?: DayZone;
  eatenKcal: number;
  eatKcal: number;
  proteinEatenG: number | null;
  proteinTargetG: number | null;
  streakDays: number;
  /**
   * The logging streak as the server counted it on `date`: the live run and the last counted day. The widget ages it
   * on the phone's own date (api lib/streak `streakAt`), so a lit flame turns "at risk" at midnight without a fetch.
   * Null in Hamil / Menyusui (no streak pressure); absent in snapshots written before the streak widget.
   */
  streak?: StreakStamp | null;
  /** Hamil / Menyusui: no "left/over" budget wording, the day is a need to meet. Absent in old snapshots. */
  maternal?: boolean;
  /** Naikin BB: "Kurang X kkal lagi" instead of left/over, ring never red. Absent in old snapshots. */
  gain?: boolean;
};

/**
 * Intermittent-fasting state for the widget status line. Null when IF is off,
 * inactive (no profile), or Ramadan owns the day. Times are absolute 'HH:MM'
 * in the person's day zone — widgets redraw every 30 minutes, so no live countdowns here.
 */
export type WidgetFasting = {
  state: "puasa" | "jendela_makan";
  windowOpen: string;
  windowClose: string;
};

/** Minimal inbox row a widget row needs (poke accent vs note text). */
export type WidgetInboxItem = {
  id: string;
  kind: "poke" | "note";
  senderName: string;
  message: string | null;
  groupName: string;
  // The orpc client types timestamps as Date; JSON.stringify stores ISO strings.
  createdAt: string | Date;
  readAt: string | Date | null;
};

export type WidgetSnapshot = {
  updatedAt: number;
  signedIn: boolean;
  day: WidgetDaySnapshot | null;
  fasting: WidgetFasting | null;
  inbox: { unread: number; items: WidgetInboxItem[] } | null;
};

export const EMPTY_WIDGET_SNAPSHOT: WidgetSnapshot = {
  updatedAt: 0,
  signedIn: false,
  day: null,
  fasting: null,
  inbox: null,
};

const SNAPSHOT_FILE = "widget-snapshot.json";

export async function readSnapshot(): Promise<WidgetSnapshot> {
  try {
    const file = new File(Paths.document, SNAPSHOT_FILE);
    if (!file.exists) return EMPTY_WIDGET_SNAPSHOT;
    return { ...EMPTY_WIDGET_SNAPSHOT, ...JSON.parse(await file.text()) };
  } catch {
    // Corrupt or unreadable snapshot: widgets fall back to the empty state.
    return EMPTY_WIDGET_SNAPSHOT;
  }
}

export async function writeSnapshot(
  patch: Partial<Omit<WidgetSnapshot, "updatedAt">>,
): Promise<WidgetSnapshot> {
  const next: WidgetSnapshot = {
    ...(await readSnapshot()),
    ...patch,
    updatedAt: Date.now(),
  };
  try {
    new File(Paths.document, SNAPSHOT_FILE).write(JSON.stringify(next));
  } catch {
    // Storage failure leaves the currently drawn widget untouched.
  }
  return next;
}
