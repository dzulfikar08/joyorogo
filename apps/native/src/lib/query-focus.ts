import type { QueryClientConfig } from "@tanstack/react-query";

/** The part of `react-native`'s `AppState` the binding reads. */
export type AppStateSource = {
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

/** The part of TanStack's `focusManager` the binding drives. */
export type FocusTarget = {
  setEventListener(setup: (setFocused: (focused?: boolean) => void) => () => void): void;
};

/**
 * React Query refetches on "window focus", and a phone has no window: the browser event never fires in React Native, so
 * a screen kept alive in the background (the Beranda tab, an open Olahraga) showed what it fetched before the user left
 * until something unmounted it. Data another app pushed meanwhile (JoyoFit sending the watch's workouts and its all-day
 * energy to the diary) stayed invisible. Returning to the app is the focus event here.
 */
export function bindAppStateFocus(focus: FocusTarget, appState: AppStateSource): void {
  focus.setEventListener((setFocused) => {
    const subscription = appState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => subscription.remove();
  });
}

/**
 * Query defaults of the app. A query is stale after 2 minutes; coming back to the app refetches the mounted stale ones
 * (`refetchOnWindowFocus: true` means "when stale"), so a quick switch to another app costs nothing.
 */
export const APP_QUERY_DEFAULTS = {
  staleTime: 2 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: true,
  retry: 1,
} satisfies NonNullable<QueryClientConfig["defaultOptions"]>["queries"];
