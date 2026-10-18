// The consent page's query is signed by the auth server, so it has to reach the consent call byte for byte.
// The router may re-serialize the search string while it loads the route, so main.tsx snapshots the browser's
// own copy first.

let captured: string | null = null;

/** Snapshot of the address bar's query when the app boots on the consent page. */
export function captureOAuthQuery(location: Pick<Location, "pathname" | "search">) {
  if (location.pathname.replace(/\/$/, "") === "/koneksi/izin") captured = location.search.replace(/^\?/, "");
}

/** The signed query exactly as the AI app's browser redirect delivered it (no leading "?"). */
export function readOAuthQuery(): string {
  return captured ?? window.location.search.replace(/^\?/, "");
}

export type OAuthRequest =
  | { ok: true; query: string; clientId: string; scopes: string[]; redirectHost: string }
  | { ok: false; reason: "invalid" | "expired" };

export function parseOAuthRequest(query: string, nowMs = Date.now()): OAuthRequest {
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri || !params.get("sig")) return { ok: false, reason: "invalid" };
  let redirectHost: string;
  try {
    const url = new URL(redirectUri);
    // Web redirects show the host; a custom scheme (native app) shows scheme://host so it is still identifiable.
    redirectHost =
      url.protocol === "https:" || url.protocol === "http:"
        ? url.host
        : `${url.protocol}//${url.host}`;
    if (!url.host && url.protocol.startsWith("http")) return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const exp = Number(params.get("exp"));
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, reason: "invalid" };
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  const scopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  return { ok: true, query, clientId, scopes, redirectHost };
}
