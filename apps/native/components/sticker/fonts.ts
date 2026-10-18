import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import * as Font from "expo-font";

import { NATIVE_FAMILIES } from "@joyorogo/sticker";

/**
 * Fonts a sticker needs. Plus Jakarta Sans is already loaded by the root layout; the
 * receipt mono (IBM Plex Mono, bundled in assets/fonts, so it also ships over the air)
 * is loaded on first use. The share sheet waits on this before it lets anything capture.
 */
const SOURCES: Record<string, number | string> = {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  IBMPlexMono_400Regular: require("../../assets/fonts/IBMPlexMono_400Regular.ttf"),
  IBMPlexMono_500Medium: require("../../assets/fonts/IBMPlexMono_500Medium.ttf"),
  IBMPlexMono_700Bold: require("../../assets/fonts/IBMPlexMono_700Bold.ttf"),
};

let pending: Promise<void> | undefined;

export function ensureStickerFonts(): Promise<void> {
  const missing = NATIVE_FAMILIES.filter((family) => !Font.isLoaded(family));
  if (missing.length === 0) return Promise.resolve();
  pending ??= Font.loadAsync(
    Object.fromEntries(missing.map((family) => [family, SOURCES[family]!])) as Record<string, number>,
  ).finally(() => {
    pending = undefined;
  });
  return pending;
}
