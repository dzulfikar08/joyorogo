import { useTheme } from "@joyorogo/ui/hooks/use-theme";
import { useSyncExternalStore } from "react";

/**
 * The color palette of the web app: JoyoFit's own teal, or one of the app's pastel and Sogan themes (`palettes.css`).
 * Kept in this browser (the JoyoFit phone app's choice lives in its own cloud preferences, which the web cannot read), under a
 * key of its own. `data-palette` on <html> selects the palette; `index.html` sets it before the first paint.
 *
 * Peach, Strawberry Milk and Matcha Latte are always light and Rose Gold always dark, like in the app: choosing one sets
 * Terang or Gelap to match, and leaving it puts back what was chosen before.
 */

export type PaletteId =
  | "default"
  | "sogan"
  | "sakura"
  | "lavender"
  | "peach"
  | "rosegold"
  | "strawberry"
  | "matcha"
  | "titik";

export interface PaletteInfo {
  id: PaletteId;
  /** Proper names of the app's themes; `default` and `titik` (Titik / Dot) are named by the screen (they are translated). */
  name: string | null;
  /** The scheme the palette is drawn in always, or null when it follows the Terang/Gelap choice. */
  pin: "light" | "dark" | null;
  /** The canvas and the primary color of the palette as drawn first (light, or the pinned scheme), for the swatch. */
  canvas: string;
  primary: string;
}

export const PALETTES: readonly PaletteInfo[] = [
  { id: "default", name: null, pin: null, canvas: "#F9F6F1", primary: "#0A6580" },
  { id: "sogan", name: "Sogan", pin: null, canvas: "#F2E8D5", primary: "#7B3F14" },
  { id: "sakura", name: "Sakura", pin: null, canvas: "#FFF3F6", primary: "#A8305E" },
  { id: "lavender", name: "Lavender", pin: null, canvas: "#F6F3FC", primary: "#6E3FA3" },
  { id: "peach", name: "Peach", pin: "light", canvas: "#FFF1E8", primary: "#C8402A" },
  { id: "rosegold", name: "Rose Gold", pin: "dark", canvas: "#1A1213", primary: "#E8A598" },
  { id: "strawberry", name: "Strawberry Milk", pin: "light", canvas: "#FFEFEF", primary: "#C8283F" },
  { id: "matcha", name: "Matcha Latte", pin: "light", canvas: "#F1F4E4", primary: "#4F7A2A" },
  { id: "titik", name: null, pin: null, canvas: "#F2F2F0", primary: "#D71921" },
];

const PALETTE_KEY = "joyofit-web:palette";
/** The Terang/Gelap/Ikut perangkat choice from before a pinned palette took over. */
const BEFORE_PIN_KEY = "joyofit-web:scheme-before-pin";

const listeners = new Set<() => void>();

function read(): PaletteId {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    return PALETTES.some((p) => p.id === stored) ? (stored as PaletteId) : "default";
  } catch {
    return "default";
  }
}

function apply(id: PaletteId) {
  if (id === "default") delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PALETTE_KEY) return;
    apply(read());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current palette, and `choose` to change it (which also pins or releases the light/dark choice). */
export function usePalette() {
  const id = useSyncExternalStore(subscribe, read, () => "default" as const);
  const { theme, setTheme } = useTheme();
  const info = PALETTES.find((p) => p.id === id) ?? (PALETTES[0] as PaletteInfo);

  const choose = (next: PaletteId) => {
    const target = PALETTES.find((p) => p.id === next) as PaletteInfo;
    try {
      localStorage.setItem(PALETTE_KEY, next);
      if (target.pin) {
        // Remember the choice once, when the first pinned palette takes over.
        if (!info.pin) localStorage.setItem(BEFORE_PIN_KEY, theme);
      } else if (info.pin) {
        const before = localStorage.getItem(BEFORE_PIN_KEY);
        localStorage.removeItem(BEFORE_PIN_KEY);
        if (before === "light" || before === "dark" || before === "system") setTheme(before);
      }
    } catch {
      // Private mode: the palette still applies for this visit.
    }
    apply(next);
    for (const listener of listeners) listener();
    if (target.pin) setTheme(target.pin);
  };

  return { id, info, choose };
}
