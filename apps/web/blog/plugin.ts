import type { Plugin } from "vite";
import { loadEnv } from "vite";

import { HEAD_MARKER, pageFallback, pageHeadTags, PUBLIC_PATHS } from "./pages.ts";
import { analyticsTag, renderBlog, type BlogConfig } from "./render.ts";

const DEFAULT_SITE_URL = "https://joyorogo.com";
const FALLBACK_RE = /<main\s+id="seo-fallback"[\s\S]*?<\/main>/;

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Request path → key in renderBlog()'s file map. */
function fileFor(url: string): string | undefined {
  const path = url.split("?")[0] ?? "";
  if (path === "/sitemap.xml") return "sitemap.xml";
  if (path === "/llms.txt") return "llms.txt";
  if (path === "/blog/rss.xml") return "blog/rss.xml";
  if (path === "/blog" || path === "/blog/") return "blog/index.html";
  const slug = /^\/blog\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
  return slug ? `blog/${slug}/index.html` : undefined;
}

/**
 * Emits the static blog (/blog/, posts, RSS), the site sitemap, and one HTML
 * file per public SPA page (harga.html, privasi.html, ...) carrying that
 * page's title, canonical, and share card, all styled by the app's own
 * hashed stylesheet. In dev it serves the same pages on request so posts can
 * be previewed while writing.
 *
 * VITE_SITE_URL sets the canonical origin (defaults to the hosted site); VITE_APP_URL the origin the sign-in
 * buttons point to (unset: same host, docs/app-subdomain.md). When
 * VITE_REVKLIK_SITE_ID is set, the Revklik tag and the inline filter that
 * limits it to public pages (revklik.ts) go into the app's
 * index.html and every blog page; self-hosted builds leave it unset.
 */
export function blogPlugin(): Plugin {
  let cfg: Omit<BlogConfig, "cssHref">;
  let base = "/";
  return {
    name: "joyorogo-blog",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || config.root, "VITE_");
      base = config.base;
      cfg = {
        siteUrl: trimSlash(env.VITE_SITE_URL || DEFAULT_SITE_URL),
        appUrl: env.VITE_APP_URL ? trimSlash(env.VITE_APP_URL) : undefined,
        analyticsSiteId: env.VITE_REVKLIK_SITE_ID || undefined,
      };
    },
    transformIndexHtml(html, ctx) {
      if (!html.includes(HEAD_MARKER)) throw new Error(`index.html: ${HEAD_MARKER} missing`);
      // Dev serves index.html for every route, so match the head to the URL
      // (app routes share "/"); the build renders "/" here and the other
      // pages in generateBundle.
      const url = ctx.server ? ctx.originalUrl?.split("?")[0]?.replace(/(.)\/$/, "$1") : "/";
      const path = PUBLIC_PATHS.find((p) => p === url) ?? "/";
      const out = html.replace(HEAD_MARKER, pageHeadTags(path, cfg.siteUrl));
      const siteId = cfg.analyticsSiteId;
      if (!siteId) return out;
      // A replacer function: the filter script holds `$` sequences that
      // String.replace would otherwise expand.
      return out.replace("</head>", () => `    ${analyticsTag(siteId)}\n  </head>`);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = fileFor(req.url ?? "");
        if (!key) return next();
        const body = renderBlog({ ...cfg, cssHref: "/src/index.css" }).get(key);
        if (!body) return next();
        res.setHeader(
          "Content-Type",
          key.endsWith(".html")
            ? "text/html"
            : key.endsWith(".txt")
              ? "text/plain; charset=utf-8"
              : "application/xml",
        );
        res.end(body);
      });
    },
    generateBundle: {
      // Vite emits index.html in its own generateBundle; read it afterwards.
      order: "post",
      handler(_options, bundle) {
        const entry = Object.values(bundle).find(
          (file) => file.type === "chunk" && file.isEntry && file.viteMetadata?.importedCss.size,
        );
        const css = entry?.type === "chunk" ? [...(entry.viteMetadata?.importedCss ?? [])][0] : "";
        if (!css) this.error("blog: app stylesheet not found in the bundle");
        for (const [fileName, source] of renderBlog({ ...cfg, cssHref: `${base}${css}` })) {
          this.emitFile({ type: "asset", fileName, source });
        }

        // `/harga` → harga.html under the assets' auto-trailing-slash handling.
        const index = bundle["index.html"];
        if (index?.type !== "asset") this.error("blog: index.html not found in the bundle");
        const html = String(index.source);
        const homeHead = pageHeadTags("/", cfg.siteUrl);
        if (!html.includes(homeHead) || !FALLBACK_RE.test(html)) {
          this.error("blog: index.html head or #seo-fallback not where expected");
        }
        for (const path of PUBLIC_PATHS.filter((p) => p !== "/")) {
          const source = html
            .replace(homeHead, pageHeadTags(path, cfg.siteUrl))
            .replace(FALLBACK_RE, pageFallback(path));
          this.emitFile({ type: "asset", fileName: `${path.slice(1)}.html`, source });
        }
      },
    },
  };
}
