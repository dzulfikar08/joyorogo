import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import { ThemeProvider as UiThemeProvider, type Theme } from "@joyorogo/ui/hooks/use-theme";

export { useTheme } from "@joyorogo/ui/hooks/use-theme";
export type { Theme };

/** The storage key the pre-paint script in index.html reads (also where the synced theme is written). */
export const THEME_STORAGE_KEY = "vite-ui-theme";

const noteTheme = (theme: Theme) => void notePrefChanged("theme", theme);

/**
 * App-wide theme: class on <html>, follows the system until the user picks,
 * stored under the same key the pre-paint script in index.html reads. A pick
 * follows the account to other devices (lib/prefs-sync.ts).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <UiThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY} onThemeChange={noteTheme}>
      {children}
    </UiThemeProvider>
  );
}
