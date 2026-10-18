import { createTableMetrics, nearestWeight, type FontMap, type FontMetrics, type FontPaint, type FontTable } from "../core/text";
import type { FontRole } from "../core/scene";
import { MONO, SANS } from "./metrics";

/**
 * JoyoRogo fonts: Plus Jakarta Sans (display + body, 500-800) and IBM Plex Mono
 * (receipt style, 400/500/700). Metrics are the generated advance tables; the paint
 * side differs per host: native encodes the weight in the family name, web uses one
 * family and a numeric weight.
 */

const cache = new Map<string, FontMetrics>();

function metricsFor(role: FontRole, weight: number): FontMetrics {
  const tables: Record<number, FontTable> = role === "mono" ? MONO : SANS;
  const table = nearestWeight(tables, weight);
  const key = `${role === "mono" ? "m" : "s"}${Object.keys(tables).find((k) => tables[Number(k)] === table)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = createTableMetrics(table);
    cache.set(key, hit);
  }
  return hit;
}

const NATIVE_SANS: Record<number, string> = {
  500: "PlusJakartaSans_500Medium",
  600: "PlusJakartaSans_600SemiBold",
  700: "PlusJakartaSans_700Bold",
  800: "PlusJakartaSans_800ExtraBold",
};

const NATIVE_MONO: Record<number, string> = {
  400: "IBMPlexMono_400Regular",
  500: "IBMPlexMono_500Medium",
  700: "IBMPlexMono_700Bold",
};

function nearestKey(table: Record<number, string>, weight: number): number {
  let best = 0;
  let delta = Infinity;
  for (const key of Object.keys(table)) {
    const d = Math.abs(Number(key) - weight);
    if (d < delta) {
      delta = d;
      best = Number(key);
    }
  }
  return best;
}

/** Family names that expo-font registers (`@expo-google-fonts/*`). */
export const NATIVE_FAMILIES = [...Object.values(NATIVE_SANS), ...Object.values(NATIVE_MONO)];

export const rogoNativeFonts: FontMap = {
  metrics: metricsFor,
  paint(role, weight): FontPaint {
    const table = role === "mono" ? NATIVE_MONO : NATIVE_SANS;
    return { family: table[nearestKey(table, weight)]! };
  },
};

export const WEB_SANS_FAMILY = "Plus Jakarta Sans Variable";
export const WEB_MONO_FAMILY = "IBM Plex Mono";

export const rogoWebFonts: FontMap = {
  metrics: metricsFor,
  paint(role, weight): FontPaint {
    if (role === "mono") return { family: WEB_MONO_FAMILY, weight: nearestKey(NATIVE_MONO, weight) };
    return { family: WEB_SANS_FAMILY, weight: nearestKey(NATIVE_SANS, weight) };
  },
};
