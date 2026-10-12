import * as SecureStore from "expo-secure-store";

const KEY = "joyorogo.theme";

export async function loadThemePref(): Promise<"light" | "dark" | "system" | undefined> {
  try {
    const value = await SecureStore.getItemAsync(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function saveThemePref(theme: "light" | "dark" | "system"): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, theme);
  } catch {
    // Persistence is best-effort; the session override still applies.
  }
}
