import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";

/**
 * The browser door to the JoyoFit cloud API (`joyofit-api`, api.fit.joyorogo.com) for the JoyoFit web app (docs/fit-web.md).
 *
 * The session cookie of this server is host-only (`api.joyorogo.com`, sameSite none), so a browser never sends it to
 * `api.fit.joyorogo.com`. The web app therefore calls these routes on this host, where the cookie travels, and the Worker
 * repeats the call to the JoyoFit API with the same session cookies (server to server, no CORS, no cookie
 * domain change for every other client). The JoyoFit API still verifies the session and the Pro rule itself.
 *
 * - `GET /api/fit/sleep?from&to`
 * - `GET|POST /api/fit/watchfaces`, `DELETE /api/fit/watchfaces/:id`, `GET /api/fit/watchfaces/:id/file`
 *
 * Nothing else is forwarded, so this is not an open relay.
 */
const ROUTES: readonly { method: string; path: RegExp }[] = [
  { method: "GET", path: /^sleep$/ },
  { method: "GET", path: /^watchfaces$/ },
  { method: "POST", path: /^watchfaces$/ },
  { method: "DELETE", path: /^watchfaces\/[A-Za-z0-9-]{8,64}$/ },
  { method: "GET", path: /^watchfaces\/[A-Za-z0-9-]{8,64}\/file$/ },
];

const PREFIX = "/api/fit/";
/** The most a watch face upload may weigh: the JoyoFit API's own limit (watch-fit server/src/limits.ts, 8 MiB). Checked here, before one byte is forwarded. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Response headers worth passing back: the body's description and a download's name. Everything else (CORS, cookies) is this server's. */
const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
] as const;

type Deps = {
  createAuth: () => Promise<JoyoAuth>;
  /** Origins of the web apps allowed to change things (the server's CORS_ORIGIN list). */
  allowedOrigins: readonly string[];
  /** Origin of the JoyoFit API, no trailing slash. */
  baseUrl: () => string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
};

/** Only better-auth's session cookies go along: nothing else the browser sent to this host is any business of the other API. */
export function sessionCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((pair) => /^[^=]*session_(token|data)=/.test(pair));
  return kept.length > 0 ? kept.join("; ") : null;
}

export function registerFitProxy(app: Hono, deps: Deps) {
  app.all(`${PREFIX}*`, async (c) => {
    const path = c.req.path.slice(PREFIX.length);
    const method = c.req.method;
    if (!ROUTES.some((route) => route.method === method && route.path.test(path)))
      return c.json({ error: "not_found" }, 404);

    // The session cookie is SameSite=None, so a page on any site can make the browser send it with a POST or DELETE. Reads are
    // harmless (the answer is unreadable cross-site without CORS), but a state change must come from one of our own web apps:
    // its Origin must be in the allowlist. A browser always sends Origin on these methods; no Origin is not a browser of ours.
    if (method !== "GET") {
      const origin = c.req.header("origin");
      if (!origin || !deps.allowedOrigins.includes(origin))
        return c.json({ error: "forbidden_origin" }, 403);
    }

    const auth = await deps.createAuth();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const cookie = sessionCookieHeader(c.req.header("cookie") ?? null);
    if (!session?.user || !cookie) return c.json({ error: "unauthorized" }, 401);

    // Built from scratch, never copied from the request: hop-by-hop headers (connection, transfer-encoding, upgrade, host, ...)
    // and everything else the browser sent stay behind. Only what the JoyoFit API reads is set.
    const headers = new Headers({ cookie, accept: "application/json, application/octet-stream" });
    if (method === "POST") {
      // A stream needs its size up front (the JoyoFit API streams to R2), and an oversized one must not be forwarded at all.
      const declared = c.req.header("content-length");
      const length = declared === undefined ? NaN : Number(declared);
      if (!Number.isInteger(length) || length < 0)
        return c.json({ error: "content_length_required" }, 411);
      if (length > MAX_UPLOAD_BYTES)
        return c.json({ error: "too_large", maxBytes: MAX_UPLOAD_BYTES }, 413);
      // Not a type a plain cross-site form can send: it makes the browser preflight first, which only our origins pass.
      if (
        c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/octet-stream"
      ) {
        return c.json({ error: "unsupported_media_type" }, 415);
      }
      headers.set("content-length", String(length));
      headers.set("content-type", "application/octet-stream");
    }

    const target = `${deps.baseUrl()}/v1/${path}${new URL(c.req.url).search}`;
    let upstream: Response;
    try {
      upstream = await (deps.fetch ?? fetch)(target, {
        method,
        headers,
        body: method === "POST" ? c.req.raw.body : undefined,
        // @ts-expect-error `duplex` is required by the Workers runtime to stream a request body; lib.dom's RequestInit omits it.
        duplex: "half",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "fit_proxy_unreachable",
          path,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json({ error: "fit_api_unreachable" }, 502);
    }

    const out = new Headers();
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  });
}
