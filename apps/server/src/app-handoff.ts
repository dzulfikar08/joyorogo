/**
 * The page that hands a finished browser sign-in back to the Android app.
 *
 * Google, magic-link and verify-email endpoints end in a redirect to the app's own scheme (`joyofit:///?cookie=...`,
 * `joyorogo:///?cookie=...`, added by the Better Auth expo plugin). The apps open the browser as a Chrome Custom Tab
 * and wait for that redirect. Chrome only follows a redirect to another app on its own while the navigation chain
 * started with a user touch and is under 15 seconds old (RedirectHandler.NAVIGATION_CHAIN_TIMEOUT_MILLIS); otherwise it
 * leaves the tab on the blank redirect response, at most with a small "Continue to <app>" banner. The person sees a
 * page that never finishes loading and the session cookie never reaches the app.
 *
 * So on Android the redirect is answered with a real page instead: it tries to open the app at once, and it carries a
 * large button. A tap on that link is a user gesture, which Chrome always honours. iOS (ASWebAuthenticationSession)
 * and desktop browsers keep the plain redirect, as do https and loopback targets.
 *
 * The automatic attempt is a script navigation to the app's scheme. Chrome treats it as a launched external app and
 * navigates the tab back to the previous page (Google's account chooser) at once, whether or not the system really
 * brought the app forward. On a phone where the launch does not happen (a POCO on Android 16: the app never made a
 * request, the page lasted half a second and the person was back at the chooser) the button vanished before anyone
 * could tap it. A browser that came back to a hand-off it already got, or that is marked below, therefore gets the
 * same page without the automatic attempt: it stays, and the person's tap is the only launch.
 */

import { DEFAULT_LOCALE, matchAcceptLanguage } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

const APPS: Readonly<Record<string, string>> = { joyofit: "JoyoFit", joyorogo: "JoyoRogo" };

const COPY = {
  id: {
    title: (app: string) => `Kembali ke ${app}`,
    body: (app: string) => `${app} akan terbuka sebentar lagi. Kalau tidak terbuka, ketuk tombol di bawah.`,
    manualBody: (app: string) => `Ketuk tombol di bawah untuk membuka ${app}.`,
    button: (app: string) => `Buka ${app}`,
    alt: "Belum terbuka? Coba cara lain",
  },
  en: {
    title: (app: string) => `Back to ${app}`,
    body: (app: string) => `${app} should open in a moment. If it does not, tap the button below.`,
    manualBody: (app: string) => `Tap the button below to open ${app}.`,
    button: (app: string) => `Open ${app}`,
    alt: "Not opening? Try another way",
  },
  ms: {
    title: (app: string) => `Kembali ke ${app}`,
    body: (app: string) => `${app} akan dibuka sebentar lagi. Jika tidak dibuka, ketik butang di bawah.`,
    manualBody: (app: string) => `Ketik butang di bawah untuk membuka ${app}.`,
    button: (app: string) => `Buka ${app}`,
    alt: "Belum dibuka? Cuba cara lain",
  },
} as const satisfies Record<Locale, unknown>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The target as a JS string literal that cannot close the surrounding script element. */
function scriptString(text: string): string {
  return JSON.stringify(text).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function appScheme(location: string): string | null {
  try {
    const { protocol } = new URL(location);
    if (protocol === "http:" || protocol === "https:") return null;
    return protocol.slice(0, -1);
  } catch {
    return null;
  }
}

/** Android package of each app scheme, for the `intent:` form of the link. */
const PACKAGES: Readonly<Record<string, string>> = {
  joyofit: "com.joyodigitama.joyofit",
  joyorogo: "com.joyodigitama.joyorogo",
};

/**
 * The same target as an Android `intent:` link naming the app's package. Chrome starts that one as an explicit intent
 * for the package instead of resolving the scheme, a second way to reach the app when the plain link does nothing.
 * Null for a scheme without a known package, or a target with a fragment.
 */
function intentLink(target: string): string | null {
  const scheme = appScheme(target);
  const pkg = scheme ? PACKAGES[scheme] : undefined;
  if (!scheme || !pkg) return null;
  const rest = target.slice(scheme.length + 1);
  if (rest.includes("#")) return null;
  return `intent:${rest}#Intent;scheme=${scheme};package=${pkg};end`;
}

/**
 * The hand-off page for `target` (a URL in the app's own scheme). `auto` adds the script that opens the app at once;
 * without it the page only waits for the tap and offers the `intent:` link as a second way.
 */
export function handoffHtml(target: string, language: Locale, auto = true): string {
  const scheme = appScheme(target) ?? "";
  const copy = COPY[language];
  const app = APPS[scheme] ?? (language === "en" ? "the app" : "aplikasi");
  const alt = auto ? null : intentLink(target);
  return (
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="referrer" content="no-referrer"><title>${escapeHtml(copy.title(app))}</title>` +
    `<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
    `font-family:system-ui,sans-serif;background:#0f1112;color:#f3f4f4;text-align:center}` +
    `main{padding:32px;max-width:380px}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 28px;line-height:1.5;color:#b7bcbd}` +
    `a{display:block;padding:16px 20px;border-radius:999px;background:#7bbf86;color:#0f1112;font-weight:700;` +
    `font-size:17px;text-decoration:none}a.alt{margin-top:20px;padding:12px;background:none;color:#b7bcbd;` +
    `font-weight:400;font-size:15px;text-decoration:underline}</style></head><body><main>` +
    `<h1>${escapeHtml(copy.title(app))}</h1><p>${escapeHtml(auto ? copy.body(app) : copy.manualBody(app))}</p>` +
    `<a id="open" href="${escapeHtml(target)}">${escapeHtml(copy.button(app))}</a>` +
    (alt ? `<a class="alt" id="alt" href="${escapeHtml(alt)}">${escapeHtml(copy.alt)}</a>` : "") +
    `</main>` +
    (auto ? `<script>setTimeout(function(){location.replace(${scriptString(target)})},50)</script>` : "") +
    `</body></html>`
  );
}

/**
 * A sign-in callback URL works once: Better Auth deletes the state row when the first load succeeds. Chrome loads it
 * again when the person goes back to Google's chooser and picks the account again, reloads the tab, or restores the
 * tab after the system dropped it, and that second load ends on Better Auth's "Something went wrong, CODE:
 * state_mismatch" page while the session of the first load exists and the app never got its cookie (the person
 * retries; one phone made 70 sessions that way). The hand-off page therefore leaves a short-lived signed cookie with
 * its target next to the session cookie, and a failed state check on the same browser shows the page again.
 *
 * A second load also means the first hand-off did not take the person into the app (they are back at the callback), so
 * the response to it sets `joyo_handoff_manual` for a month: this browser's hand-off pages then come without the
 * automatic attempt and stay on screen for the tap (see the top of this file).
 */
const REPLAY_COOKIE = "joyo_handoff";
const REPLAY_SECONDS = 600;
const REPLAY_PATH = "/api/auth/callback";
const MANUAL_COOKIE = "joyo_handoff_manual";
const MANUAL_SECONDS = 30 * 24 * 3600;
const STATE_ERROR = /[?&]error=(?:state_mismatch|state_not_found|state_invalid)(?:&|$)/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${REPLAY_COOKIE}:${value}`))));
}

/** `<target as base64url>.<signature>`: the target is a URL, so ASCII, and the signature keeps anyone else from choosing it. */
async function replayCookieValue(target: string, secret: string): Promise<string> {
  const value = base64url(new TextEncoder().encode(target));
  return `${value}.${await signature(value, secret)}`;
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function replayTarget(request: Request, secret: string): Promise<string | null> {
  const raw = cookieValue(request, REPLAY_COOKIE);
  const dot = raw?.indexOf(".") ?? -1;
  if (!raw || dot < 1) return null;
  const value = raw.slice(0, dot);
  if ((await signature(value, secret)) !== raw.slice(dot + 1)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const target = new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
    return appScheme(target) === null ? null : target;
  } catch {
    return null;
  }
}

function handoffResponse(target: string, request: Request, headers: Headers, auto: boolean): Response {
  const language = matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;
  headers.delete("location");
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  );
  return new Response(handoffHtml(target, language, auto), { status: 200, headers });
}

/**
 * Turns the redirect of a browser sign-in callback into the hand-off page when it points at an app scheme and the
 * browser is Chrome on Android, and answers a repeated load of a used callback (state error redirect) with the same
 * page when this browser got one a moment ago. `secret` signs the replay cookie. Returns null for everything else,
 * so the caller sends the original response.
 */
export async function androidAppHandoff(request: Request, response: Response, secret: string): Promise<Response | null> {
  if (request.method !== "GET" || !REDIRECTS.has(response.status)) return null;
  if (!/\bAndroid\b/i.test(request.headers.get("user-agent") ?? "")) return null;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/auth/")) return null;
  const location = response.headers.get("location");
  if (!location) return null;

  if (appScheme(location) !== null) {
    const headers = new Headers(response.headers);
    if (pathname.startsWith(`${REPLAY_PATH}/`)) {
      headers.append(
        "set-cookie",
        `${REPLAY_COOKIE}=${await replayCookieValue(location, secret)}; Max-Age=${REPLAY_SECONDS}; Path=${REPLAY_PATH}; HttpOnly; Secure; SameSite=Lax`,
      );
    }
    return handoffResponse(location, request, headers, cookieValue(request, MANUAL_COOKIE) === undefined);
  }

  if (pathname.startsWith(`${REPLAY_PATH}/`) && STATE_ERROR.test(location)) {
    const target = await replayTarget(request, secret);
    console.warn(`auth callback ${location.split("error=")[1]?.split("&")[0]}: ${target ? "replayed hand-off page" : "no hand-off cookie"}`);
    if (target) {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        `${MANUAL_COOKIE}=1; Max-Age=${MANUAL_SECONDS}; Path=${REPLAY_PATH}; HttpOnly; Secure; SameSite=Lax`,
      );
      return handoffResponse(target, request, headers, false);
    }
  }
  return null;
}
