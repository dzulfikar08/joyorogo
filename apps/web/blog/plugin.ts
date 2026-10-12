import type { Plugin } from "vite";
import { loadEnv } from "vite";

import { renderBlog, type BlogConfig } from "./render.ts";

const DEFAULT_SITE_URL = "https://joyorogo.dzulfikar.com";

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Request path → key in renderBlog()'s file map. */
function fileFor(url: string): string | undefined {
  const path = url.split("?")[0] ?? "";
  if (path === "/sitemap.xml") return "sitemap.xml";
  if (path === "/blog/rss.xml") return "blog/rss.xml";
  if (path === "/blog" || path === "/blog/") return "blog/index.html";
  const slug = /^\/blog\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
  return slug ? `blog/${slug}/index.html` : undefined;
}

/**
 * Emits the static blog (/blog/, posts, RSS) and the site sitemap into the
 * build output, styled by the app's own hashed stylesheet. In dev it serves
 * the same pages on request so posts can be previewed while writing.
 *
 * VITE_SITE_URL sets the canonical origin (defaults to the hosted site);
 * VITE_SERVER_URL locates the APK download, like the app does.
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
        apkUrl: `${trimSlash(env.VITE_SERVER_URL ?? "")}/downloads/latest-apk`,
      };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = fileFor(req.url ?? "");
        if (!key) return next();
        const body = renderBlog({ ...cfg, cssHref: "/src/index.css" }).get(key);
        if (!body) return next();
        res.setHeader("Content-Type", key.endsWith(".html") ? "text/html" : "application/xml");
        res.end(body);
      });
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.isEntry && file.viteMetadata?.importedCss.size,
      );
      const css = entry?.type === "chunk" ? [...(entry.viteMetadata?.importedCss ?? [])][0] : "";
      if (!css) this.error("blog: app stylesheet not found in the bundle");
      for (const [fileName, source] of renderBlog({ ...cfg, cssHref: `${base}${css}` })) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}
