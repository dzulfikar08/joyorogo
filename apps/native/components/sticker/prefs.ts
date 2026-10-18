import * as SecureStore from "expo-secure-store";

/** Sticker options kept on this device. Defaults are the privacy-safe ones. */
export type StickerPrefsState = {
  hideNumbers: boolean;
  showName: boolean;
  watermark: boolean;
};

export const DEFAULT_STICKER_PREFS: StickerPrefsState = {
  hideNumbers: true,
  showName: false,
  watermark: true,
};

const KEY = "joyorogo.sticker.prefs";

export async function loadStickerPrefs(): Promise<StickerPrefsState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_STICKER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return DEFAULT_STICKER_PREFS;
    const read = (key: keyof StickerPrefsState) => {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "boolean" ? value : DEFAULT_STICKER_PREFS[key];
    };
    return { hideNumbers: read("hideNumbers"), showName: read("showName"), watermark: read("watermark") };
  } catch {
    return DEFAULT_STICKER_PREFS;
  }
}

export async function saveStickerPrefs(prefs: StickerPrefsState): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort: the session keeps the choice either way.
  }
}
