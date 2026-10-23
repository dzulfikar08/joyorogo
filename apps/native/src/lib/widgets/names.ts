/** Widget registry. Names must match the config-plugin entries in app.json. */
export const WIDGET_NAMES = {
  ProgresHariIni: true,
  KotakMasukGrup: true,
  Ringkasan: true,
  FotoMakanan: true,
  StreakCatat: true,
} as const;

export type WidgetName = keyof typeof WIDGET_NAMES;

/**
 * Static launcher widgets that show no snapshot data: they paint once when
 * placed and never need the headless network refresh.
 */
const STATIC_WIDGETS: ReadonlySet<string> = new Set<WidgetName>(["FotoMakanan"]);

export function isStaticWidget(name: string): boolean {
  return STATIC_WIDGETS.has(name);
}

/**
 * Deep link behind the 1x1 "Foto makanan" widget. /makan-ai opens on its
 * camera phase; a signed-out user is sent to /login and returned to it.
 */
export const CAMERA_WIDGET_URI = "joyorogo://makan-ai";

/** Deep links behind the progress and inbox widgets: today's diary and the group inbox. */
export const PROGRESS_WIDGET_URI = "joyorogo://makan";
export const INBOX_WIDGET_URI = "joyorogo://inbox";
