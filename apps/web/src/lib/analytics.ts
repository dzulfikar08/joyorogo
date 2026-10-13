// Revklik custom events. The tag (blog/plugin.ts) only exists in builds with
// VITE_REVKLIK_SITE_ID and skips localhost, so every call is a no-op without it.
// Click goals on links and buttons use data-revklik-goal attributes instead;
// scroll funnels come from data-section markers.

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    klikapa?: {
      track(name: string, props?: Props, revenue?: number): void;
      conversion(name: string, revenue?: number | null, props?: Props): void;
    };
  }
}

export function trackEvent(name: string, props?: Props) {
  window.klikapa?.track(name, props);
}

/** A goal reached; `revenueIdr` puts it in Revklik's revenue panels. */
export function trackConversion(name: string, revenueIdr?: number, props?: Props) {
  window.klikapa?.conversion(name, revenueIdr ?? null, props);
}
