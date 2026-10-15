// The web app's Worker. Static assets are served straight from the asset
// store; only the three public share routes come through here so their link
// previews carry real tags. WhatsApp, Instagram, X and Facebook read the
// first HTML response without running JavaScript, so the SPA's own head (a
// useEffect after load) never reaches them.
import { groupTags, postTags, profileTags, type OgTags } from "./og";
import type { GroupOg, PostOg, ProfileOg } from "./og";

type Env = {
  ASSETS: Fetcher;
  /** API origin, no trailing slash (also hosts /post-photo). */
  API_URL: string;
  /** Canonical site origin for og:url. */
  SITE_URL: string;
};

type Kind = "gabung" | "p" | "u";

const ROUTE = /^\/(gabung|p|u)\/([^/]+)\/?$/;
const CODE = /^[A-Za-z0-9]{4,20}$/;
const POST_ID = /^[a-f0-9-]{36}$/;
const HANDLE = /^(?:[a-z0-9_]{3,20}|jr-[0-9a-f]{8})$/;

/** Crawlers will not wait for a slow API; the page is still fine with generic tags. */
const API_TIMEOUT_MS = 1500;
const CACHE_SECONDS = 60;

/** Data JSON from the API, cached briefly per URL; null = nothing to show or API trouble. */
async function loadOg<T>(env: Env, ctx: ExecutionContext, path: string): Promise<T | null> {
  const key = new Request(`${env.API_URL}${path}`);
  const cache = caches.default;
  let res = await cache.match(key);
  if (!res) {
    try {
      const live = await fetch(key, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (live.status !== 200 && live.status !== 404) return null;
      res = new Response(live.body, {
        status: live.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
    } catch {
      return null;
    }
  }
  return res.status === 200 ? ((await res.json()) as T) : null;
}

async function tagsFor(
  kind: Kind,
  param: string,
  pageUrl: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<OgTags | null> {
  if (kind === "gabung") {
    if (!CODE.test(param)) return null;
    const data = await loadOg<GroupOg>(env, ctx, `/og/gabung/${param}`);
    return data && groupTags(data, pageUrl);
  }
  if (kind === "p") {
    if (!POST_ID.test(param)) return null;
    const data = await loadOg<PostOg>(env, ctx, `/og/p/${param}`);
    return data && postTags(data, pageUrl, param, env.API_URL);
  }
  const handle = param.toLowerCase();
  if (!HANDLE.test(handle)) return null;
  const data = await loadOg<ProfileOg>(env, ctx, `/og/u/${handle}`);
  return data && profileTags(data, handle, pageUrl);
}

// setAttribute escapes quotes only. User-chosen text (group names, captions)
// must not smuggle entities or tags into an attribute, so & < > go out as entities.
const attrSafe = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const setAttr = (name: string, value: string) => ({
  element: (el: Element) => void el.setAttribute(name, attrSafe(value)),
});
const drop = { element: (el: Element) => void el.remove() };

function rewrite(page: Response, tags: OgTags): Response {
  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(tags.title) })
    .on('meta[name="description"]', setAttr("content", tags.description))
    .on('link[rel="canonical"]', setAttr("href", tags.url))
    .on('meta[property="og:url"]', setAttr("content", tags.url))
    .on('meta[property="og:title"]', setAttr("content", tags.ogTitle))
    .on('meta[property="og:description"]', setAttr("content", tags.description));
  if (tags.image) {
    const { url, alt, card } = tags.image;
    rewriter
      .on('meta[property="og:image"]', setAttr("content", url))
      .on('meta[property="og:image:alt"]', setAttr("content", alt))
      // The default card's size and type do not describe someone's photo.
      .on('meta[property="og:image:type"]', drop)
      .on('meta[property="og:image:width"]', drop)
      .on('meta[property="og:image:height"]', drop)
      .on('meta[name="twitter:card"]', setAttr("content", card))
      .on('meta[name="twitter:image"]', setAttr("content", url))
      .on('meta[name="twitter:image:alt"]', setAttr("content", alt));
  }
  const out = rewriter.transform(page);
  const headers = new Headers(out.headers);
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  return new Response(out.body, { status: out.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTE.exec(url.pathname);
    if (!route || (request.method !== "GET" && request.method !== "HEAD")) {
      return env.ASSETS.fetch(request);
    }
    const kind = route[1] as Kind;
    let param: string;
    try {
      param = decodeURIComponent(route[2]!);
    } catch {
      return env.ASSETS.fetch(request);
    }

    // The prerendered /gabung, /p, /u pages already carry the right generic
    // head; start from those instead of the home page the SPA fallback returns.
    const headers = new Headers(request.headers);
    headers.delete("If-None-Match");
    headers.delete("If-Modified-Since");
    const page = await env.ASSETS.fetch(new Request(new URL(`/${kind}`, url), { headers }));
    if (!page.ok) return env.ASSETS.fetch(request);

    // The URL itself is the only place the code appears: og:url/canonical must
    // be per-link or WhatsApp would show one group's card for every invite.
    const pageUrl = `${env.SITE_URL}${url.pathname.replace(/\/$/, "")}`;
    const tags = await tagsFor(kind, param, pageUrl, env, ctx).catch(() => null);
    return tags ? rewrite(page, tags) : page;
  },
};
