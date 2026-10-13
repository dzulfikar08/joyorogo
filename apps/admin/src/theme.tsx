import { ThemeProvider as UiThemeProvider, type Theme } from "@joyorogo/ui/hooks/use-theme";

export { useTheme } from "@joyorogo/ui/hooks/use-theme";
export type { Theme };

/**
 * App-wide theme: class on <html>, follows the system until the user picks,
 * stored under the same key the pre-paint script in index.html reads.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <UiThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      {children}
    </UiThemeProvider>
  );
}
