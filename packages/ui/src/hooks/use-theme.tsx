import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Minimal theme provider (class-on-<html>, system aware, localStorage).
 * Replaces next-themes, whose inline <script> makes React 19 log a
 * "Scripts inside React components" console error on every route. The
 * no-FOUC half lives as a blocking script in apps/web/index.html.
 *
 * Storage keeps next-themes' shape ("light" | "dark" | "system") so an
 * existing choice survives the swap.
 */

export type Theme = "light" | "dark" | "system";

/**
 * Dispatched on `window` after something other than `setTheme` rewrote the stored choice (the account's synced
 * preference arriving): the provider reads it again. Other tabs arrive through the native `storage` event.
 */
export const THEME_REREAD_EVENT = "jr-theme-reread";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
});

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  onThemeChange,
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  /** Called after the person picks a theme (not when the stored choice is re-read). */
  onThemeChange?: (theme: Theme) => void;
}) {
  const readStored = useCallback((): Theme => {
    try {
      return (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
    } catch {
      return defaultTheme;
    }
  }, [storageKey, defaultTheme]);
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    const reread = () => setThemeState(readStored());
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) reread();
    };
    window.addEventListener(THEME_REREAD_EVENT, reread);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_REREAD_EVENT, reread);
      window.removeEventListener("storage", onStorage);
    };
  }, [readStored, storageKey]);
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(systemTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Private mode: keep the choice for this session only.
      }
      onThemeChange?.(next);
    },
    [storageKey, onThemeChange],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
