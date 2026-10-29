// Revklik custom events. The tag (blog/revklik.ts, blog/plugin.ts) only exists in
// builds with VITE_REVKLIK_SITE_ID and skips localhost, so every call is a no-op
// without it. Which pages Revklik may hear about is decided by the inline filter
// that ships with the tag (blog/revklik.ts), not by this module.
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

/**
 * A goal reached, without revenue: money is forwarded by the server from the payment ledger (docs/revklik-forwarding.md),
 * and a client-side amount would count the same sale twice.
 */
export function trackConversion(name: string, props?: Props) {
  window.klikapa?.conversion(name, null, props);
}

/**
 * The tag's visitor and session ids, sent with a checkout so the server can attribute the sale to this visitor.
 * Empty when the tag is not loaded (self-host, localhost, blocked) or storage is unavailable.
 */
export function revklikIds(): { revklikVisitorId?: string; revklikSessionId?: string } {
  try {
    const visitor = localStorage.getItem("_kp_vid");
    const session = sessionStorage.getItem("_kp_sid");
    return { ...(visitor ? { revklikVisitorId: visitor } : {}), ...(session ? { revklikSessionId: session } : {}) };
  } catch {
    return {};
  }
}

// Visitors who come from fit.joyorogo.com carry ?from=joyofit on the pricing and
// sign-in links. The tag's own UTM memory lives in sessionStorage per origin and
// the OAuth round trip leaves the page, so the marker is kept in localStorage and
// attached to the sign-in and purchase conversions.
const FROM_KEY = "jrg-from";
const SIGNIN_KEY = "jrg-signin-pending";
const SIGNIN_MAX_AGE_MS = 30 * 60 * 1000;

/** Remembers `?from=joyofit` from the landing URL; any other value is ignored. */
export function captureFrom(search: string) {
  try {
    if (new URLSearchParams(search).get("from") === "joyofit") {
      localStorage.setItem(FROM_KEY, "joyofit");
    }
  } catch {
    // Storage blocked: attribution is simply lost.
  }
}

/** Props that mark a conversion as coming from JoyoFit, empty otherwise. */
export function fromProps(): Props {
  try {
    return localStorage.getItem(FROM_KEY) === "joyofit" ? { from: "joyofit" } : {};
  } catch {
    return {};
  }
}

/** Called when the Google button is pressed; the redirect leaves the page, so success is reported on return. */
export function markSignInStart() {
  try {
    localStorage.setItem(SIGNIN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the sign-in goal still counts the click.
  }
}

export function signInPending(): boolean {
  try {
    const startedAt = Number(localStorage.getItem(SIGNIN_KEY));
    return startedAt > 0 && Date.now() - startedAt < SIGNIN_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Reports `signin_success` once per Google button press, after a session exists. */
export function reportSignIn() {
  if (!signInPending()) return;
  try {
    localStorage.removeItem(SIGNIN_KEY);
  } catch {
    return;
  }
  trackConversion("signin_success", fromProps());
}
