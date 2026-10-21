// Two hosts, one bundle: joyorogo.com is the landing/marketing site, app.joyorogo.com is the signed-in app
// (docs/app-subdomain.md). The Worker (worker/index.ts) redirects at the edge; the router (routes/__root.tsx) applies
// the same rules to in-app navigation, so a Link to the wrong area never renders it on the wrong host. Pure on purpose:
// no DOM, no Workers types, shared by both.

/**
 * Which host a path belongs on.
 * - `app`: signed-in screens, login, payment return, MCP consent.
 * - `site`: landing, pricing, guides, blog, legal pages.
 * - `shared`: served on both hosts, because links to them already circulate (invite codes, profiles, posts) and the
 *   OG tags and canonical always point at the site. Anything unknown is shared too: it renders the SPA's 404.
 */
export type Area = "app" | "site" | "shared";

/** First path segment of every route under routes/_auth, plus the public routes that need a session. */
export const APP_SEGMENTS: readonly string[] = [
  "login",
  "onboarding",
  "beranda",
  "beranda-kartu",
  "berat",
  "feed",
  "founder",
  "grup",
  "inbox",
  "jam",
  "koneksi",
  "lainnya",
  "latihan",
  "makan",
  "olahraga",
  "pro",
  "profil",
  "rekap",
  "rencana-makan",
  "tidur",
  "pembayaran",
];

/** Marketing pages and the generated files that belong to them (blog, sitemap, llms.txt). `my` is the Malaysian landing, `sg` the Singapore one. */
export const SITE_SEGMENTS: readonly string[] = [
  "harga",
  "my",
  "sg",
  "panduan",
  "blog",
  "privasi",
  "syarat",
  "pengembalian-dana",
  "sitemap.xml",
  "llms.txt",
];

/** Public pages that work on either host. */
export const SHARED_SEGMENTS: readonly string[] = ["gabung", "u", "p"];

/** Where `/` goes on the app host. */
export const APP_HOME = "/beranda";

/**
 * 302, not 301: browsers cache a 301 for good, which would make the cut-over impossible to roll back. Once the split
 * has soaked, switching this to 301 is the only change needed.
 */
export const REDIRECT_STATUS = 302;

export function areaOf(pathname: string): Area {
  const segment = pathname.split("/")[1] ?? "";
  if (segment === "") return "site";
  if (APP_SEGMENTS.includes(segment)) return "app";
  if (SITE_SEGMENTS.includes(segment)) return "site";
  return "shared";
}

export type HostConfig = {
  siteOrigin: string;
  appOrigin: string;
  siteHost: string;
  appHost: string;
};

/**
 * Both origins or nothing: without an app origin (self-hosted, workers.dev, localhost) one host serves everything.
 * Origins are `https://host` with no path; a trailing slash is tolerated.
 */
export function hostConfig(siteUrl: string | undefined, appUrl: string | undefined): HostConfig | null {
  if (!siteUrl || !appUrl) return null;
  try {
    const site = new URL(siteUrl);
    const app = new URL(appUrl);
    if (site.host === app.host) return null;
    return { siteOrigin: site.origin, appOrigin: app.origin, siteHost: site.host, appHost: app.host };
  } catch {
    return null;
  }
}

/**
 * The URL a request for `host` + `pathname` must be sent to, or null when this host serves it. `search` and `hash`
 * are appended untouched (signed OAuth queries must not be re-encoded).
 */
export function hostRedirect(
  config: HostConfig | null,
  host: string,
  pathname: string,
  search = "",
  hash = "",
): string | null {
  if (!config) return null;
  const tail = `${search}${hash}`;
  if (host === config.appHost) {
    if (pathname === "/") return `${config.appOrigin}${APP_HOME}${tail}`;
    return areaOf(pathname) === "site" ? `${config.siteOrigin}${pathname}${tail}` : null;
  }
  if (host === config.siteHost && areaOf(pathname) === "app") return `${config.appOrigin}${pathname}${tail}`;
  return null;
}

/**
 * Whether the landing sends a signed-in visitor straight to Beranda. Only when the app shares the landing's host (one
 * host, self-hosted, workers.dev): with a separate app host the landing is a page people may want to read signed in, and
 * the way into the app is the "Masuk" button, which lands on app.joyorogo.com.
 */
export function landingSkipsForSignedIn(config: HostConfig | null): boolean {
  return config === null;
}

/**
 * Absolute link to an app path, for pages on the site host. Everywhere else (the app host itself, localhost, a
 * workers.dev preview, a self-hosted deploy) the path stays relative, so the router navigates without a reload.
 */
export function appHref(config: HostConfig | null, host: string, path: string): string {
  return config && host === config.siteHost ? `${config.appOrigin}${path}` : path;
}
