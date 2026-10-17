import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";

import { darkTheme } from "@/theme";

import { feedKey } from "./i18n-keys";
import { defaultPalette, type AnalysisMapTheme, type AnalysisPalette } from "./theme";
import type { AnalysisT } from "./text";

/** JoyoRogo theme mapped onto the analysis palette; chart hues stay the shared JoyoFit ones. */
export function useAnalysisPalette(): AnalysisPalette {
  const { theme } = useUnistyles();
  const isDark = theme.colors.background === darkTheme.colors.background;
  return useMemo(
    () => ({
      ...defaultPalette(isDark),
      background: theme.colors.background,
      surface: theme.colors.card,
      surfaceAlt: theme.colors.muted,
      text: theme.colors.foreground,
      textMuted: theme.colors.mutedForeground,
      border: theme.colors.hairline,
      accent: theme.colors.primary,
      positive: theme.colors.makan,
      negative: theme.colors.destructive,
      fonts: { regular: theme.fonts.regular, bold: theme.fonts.bold },
    }),
    [theme, isDark],
  );
}

export function useAnalysisMapTheme(): AnalysisMapTheme {
  const { theme } = useUnistyles();
  return theme.colors.background === darkTheme.colors.background ? "dark" : "light";
}

/** Analysis strings from the `feed` namespace; vars go straight to i18next (`{{name}}`). */
export function useAnalysisT(): AnalysisT {
  const { t } = useTranslation("feed");
  return useMemo(() => {
    // Keys come from the pure map in i18n-keys.ts, so the typed-key check cannot see them.
    const translate = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
    return (key, vars) => translate(feedKey(key), vars);
  }, [t]);
}
