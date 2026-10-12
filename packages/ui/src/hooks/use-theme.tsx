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
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
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
    },
    [storageKey],
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
