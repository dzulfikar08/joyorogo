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

// Revklik only measures the marketing funnel: landing, blog, pricing, sign-up
// and payment pages — plus public community pages (/u/<handle> profiles,
// /p/<id> posts). In-app screens (Beranda, Makan, …) are not tracked.
// Conversions (`t: "c"`: onboarding_complete, founder_purchase) always pass,
// wherever they fire.
const TRACKED_PATHS = /^\/(?:$|harga|login|pembayaran|privasi|blog|u\/|p\/)/;

type TrackItem = { t?: string; p?: string };

// /gabung/<kode> is a capability link: whoever holds the code can join the
// group. /gabung pageviews are already dropped above; this also covers the
// pieces that survive (conversions fired on that page, /login?redirect=… and
// referrers that carry it, plain or URL-encoded) by cutting the code out of
// anything that leaves the page.
const INVITE_PATH = /(\/|%2F)gabung(?:\/|%2F)[A-Za-z0-9]+/gi;

export function scrubInviteCodes(json: string): string {
  return json.replace(INVITE_PATH, "$1gabung");
}

/**
 * The Revklik tag has no route exclusion, so filter its batches at the one
 * place they leave the page: its fetch to `/api/track`. Install before the
 * tag's first flush (it batches for 1 s after load).
 */
export function limitRevklikToPublicPages() {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("revklik.com/api/track") || typeof init?.body !== "string") {
      return original(input, init);
    }
    let batch: TrackItem[];
    try {
      batch = JSON.parse(init.body) as TrackItem[];
    } catch {
      return original(input, init);
    }
    const kept = batch.filter((item) => item.t === "c" || TRACKED_PATHS.test(item.p ?? ""));
    if (kept.length === 0) {
      return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    }
    return original(input, { ...init, body: scrubInviteCodes(JSON.stringify(kept)) });
  };
}
