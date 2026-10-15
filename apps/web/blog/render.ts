// Static blog: Markdown posts in ./posts rendered to plain HTML at build time,
// so crawlers and AI assistants read the full article without running the SPA.
// Numbers in posts come from TKPI 2019 through the ::tkpi / ::porsi directives,
// never typed by hand.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TKPI_2019, type Tkpi2019Row } from "@joyorogo/api/lib/tkpi2019-data";
import { TIPS, tipImagePath, type Tip } from "@joyorogo/api/lib/tips";
import { Marked } from "marked";

import { OG_IMAGE, PAGES } from "../src/lib/seo.ts";
import { ogImageTags, PUBLIC_PATHS } from "./pages.ts";
import { REVKLIK_GUARD } from "./revklik.ts";

export type BlogConfig = {
  /** Canonical origin, no trailing slash. */
  siteUrl: string;
  /** Hashed app stylesheet, e.g. /assets/index-abc.css. */
  cssHref: string;
  apkUrl: string;
  /** Revklik site id; no tag when unset (self-hosted builds). */
  analyticsSiteId?: string;
};

export type Post = {
  slug: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  date: string;
  updated: string;
  html: string;
  minutes: number;
  /** `featured: true` in frontmatter lists the post first (pillar pages). */
  featured: boolean;
};

const POSTS_DIR = join(import.meta.dirname, "posts");
const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";
const TKPI_NOTE =
  "Sumber angka: Tabel Komposisi Pangan Indonesia (TKPI) 2019, Kementerian Kesehatan RI. Nilai per 100 g bagian yang dapat dimakan. Berat porsi di artikel ini contoh, porsimu bisa berbeda.";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const TKPI = new Map<string, Tkpi2019Row>(TKPI_2019.map((row) => [row[0], row]));

function tkpiRow(code: string, file: string): Tkpi2019Row {
  const row = TKPI.get(code);
  if (!row) throw new Error(`${file}: kode TKPI tidak dikenal: ${code}`);
  return row;
}

function num(v: number | null): string {
  return v === null ? "-" : v.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

/** `::tkpi AP001 FP062` → per-100 g table. */
function tkpiTable(codes: string[], file: string): string {
  const lines = [
    "| Makanan | Energi (kkal) | Protein (g) | Lemak (g) | Karbohidrat (g) |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const code of codes) {
    const [, name, , kcal, protein, fat, carb] = tkpiRow(code, file);
    lines.push(`| ${name} | ${num(kcal)} | ${num(protein)} | ${num(fat)} | ${num(carb)} |`);
  }
  return lines.join("\n");
}

/**
 * `::porsi AP001 150 Nasi putih | FP062 80` → example portions of one meal,
 * with a total row. `::contoh` takes the same spec for side-by-side
 * alternatives, which must not be summed.
 */
function portionTable(spec: string, file: string, withTotal: boolean): string {
  const lines = ["| Makanan | Contoh berat | Energi (kkal) |", "| --- | ---: | ---: |"];
  let total = 0;
  for (const part of spec.split("|")) {
    const [code = "", grams = "", ...label] = part.trim().split(/\s+/);
    const g = Number(grams);
    if (!Number.isFinite(g) || g <= 0) throw new Error(`${file}: berat porsi salah: ${part}`);
    const [, name, , kcal] = tkpiRow(code, file);
    const kcalPortion = Math.round(((kcal ?? 0) * g) / 100);
    total += kcalPortion;
    lines.push(`| ${label.join(" ") || name} | ${g} g | ${kcalPortion} |`);
  }
  if (withTotal) lines.push(`| **Total** | | **${total}** |`);
  return lines.join("\n");
}

function expandDirectives(body: string, file: string): { md: string; usesTkpi: boolean } {
  let usesTkpi = false;
  const md = body.replace(/^::(tkpi|porsi|contoh)\s+(.+)$/gm, (_, kind: string, spec: string) => {
    usesTkpi = true;
    if (kind === "tkpi") return tkpiTable(spec.trim().split(/\s+/), file);
    return portionTable(spec, file, kind === "porsi");
  });
  return { md, usesTkpi };
}

function parseFrontmatter(
  raw: string,
  file: string,
): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) throw new Error(`${file}: frontmatter tidak ada`);
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ["title", "description", "date"]) {
    if (!meta[key]) throw new Error(`${file}: frontmatter "${key}" kosong`);
  }
  return { meta, body: raw.slice(match[0].length) };
}

const marked = new Marked({ gfm: true });

/** Markdown to HTML; tables get a wrapper that scrolls sideways on phones. */
function toHtml(md: string): string {
  return (marked.parse(md, { async: false }) as string)
    .replaceAll("<table>", '<div class="blog-table"><table>')
    .replaceAll("</table>", "</table></div>");
}

export function loadPosts(): Post[] {
  const filePosts: Post[] = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const { meta, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, file), "utf8"), file);
      const { md, usesTkpi } = expandDirectives(body, file);
      const html = toHtml(md) + (usesTkpi ? `<p class="blog-source">${esc(TKPI_NOTE)}</p>` : "");
      const words = body.split(/\s+/).filter(Boolean).length;
      return {
        slug: file.replace(/\.md$/, ""),
        title: meta.title ?? "",
        description: meta.description ?? "",
        date: meta.date ?? "",
        updated: meta.updated ?? meta.date ?? "",
        html,
        minutes: Math.max(1, Math.round(words / 200)),
        featured: meta.featured === "true",
      };
    });
  return [...filePosts, ...TIPS.map(tipToPost)].sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) ||
      b.date.localeCompare(a.date) ||
      a.slug.localeCompare(b.slug),
  );
}

/**
 * Tips statis dari @joyorogo/api dirender jadi postingan blog yang sama,
 * supaya web dan native memakai satu sumber konten tanpa duplikasi.
 */
function tipToPost(tip: Tip): Post {
  const sectionsMd = tip.sections
    .flatMap((section) => [`## ${section.heading}`, section.paragraphs.join("\n\n")])
    .join("\n\n");
  const hero = tip.image
    ? `<figure>
        <img src="${tipImagePath(`${tip.slug}.webp`)}" srcset="${tipImagePath(`${tip.slug}.webp`, "sm")} 600w, ${tipImagePath(`${tip.slug}.webp`)} 1200w" sizes="(max-width: 768px) 100vw, 768px" alt="${esc(tip.image.alt)}" width="1200" height="800" class="w-full rounded-3xl" />
        <figcaption class="mt-2 text-xs text-muted-foreground">Foto${tip.image.credit.author ? `: ${esc(tip.image.credit.author)}` : ""} · ${esc(tip.image.credit.source)} · ${esc(tip.image.credit.page)}</figcaption>
      </figure>`
    : "";
  const figure = tip.figure
    ? `<figure>
        <img src="${tipImagePath(tip.figure.src)}" alt="${esc(tip.figure.alt)}" width="1200" height="675" loading="lazy" class="w-full rounded-3xl border border-border/60" />
        <figcaption class="mt-2 text-sm text-muted-foreground">${esc(tip.figure.caption)}</figcaption>
      </figure>`
    : "";
  const tailMd = [
    "## Coba ini",
    tip.cobaIni.map((item) => `- ${item}`).join("\n"),
    "## Sumber",
    tip.sources.map((s) => `- [${s.title}](${s.url})`).join("\n"),
  ].join("\n\n");
  const credit = tip.credit
    ? `\n\n<p class="blog-source">${esc(tip.credit.label)}: <a href="${esc(tip.credit.url)}" rel="noopener" target="_blank">${esc(tip.credit.url)}</a></p>`
    : "";
  const words = `${sectionsMd} ${tailMd}`.split(/\s+/).filter(Boolean).length;
  return {
    slug: tip.slug,
    title: tip.title,
    description: tip.summary,
    date: tip.date,
    updated: tip.date,
    html: hero + toHtml(sectionsMd) + figure + toHtml(tailMd) + credit,
    minutes: Math.max(1, Math.round(words / 200)),
    featured: false,
  };
}

const THEME_SCRIPT = `try{var t=localStorage.getItem("vite-ui-theme")||"system";document.documentElement.classList.toggle("dark",t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))}catch(e){}`;

/**
 * Revklik pageview script (tracks SPA navigation itself), preceded by the
 * inline filter that keeps in-app paths out of its batches (./revklik.ts). The
 * filter must come first: the tag batches for 1 s after load, and a page whose
 * bundle never runs still has the tag.
 */
export function analyticsTag(siteId: string): string {
  return `<script>${REVKLIK_GUARD}</script>\n    <script defer data-site-id="${esc(siteId)}" src="https://app.revklik.com/klikapa.js"></script>`;
}

const FOCUS = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function shell(opts: {
  cfg: BlogConfig;
  path: string;
  title: string;
  description: string;
  ogType: "website" | "article";
  jsonLd: object[];
  extraHead?: string;
  main: string;
}): string {
  const { cfg } = opts;
  const url = `${cfg.siteUrl}${opts.path}`;
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${esc(opts.title)}</title>
    <meta name="description" content="${esc(opts.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f5f0" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141311" />
    <link rel="icon" type="image/svg+xml" href="/brand/logo-mark.svg" />
    <link rel="icon" href="/favicon.png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="alternate" type="application/rss+xml" title="Blog JoyoRogo" href="/blog/rss.xml" />
    <meta property="og:type" content="${opts.ogType}" />
    <meta property="og:site_name" content="JoyoRogo" />
    <meta property="og:locale" content="id_ID" />
    <meta property="og:title" content="${esc(opts.title)}" />
    <meta property="og:description" content="${esc(opts.description)}" />
    <meta property="og:url" content="${url}" />
    ${ogImageTags(cfg.siteUrl).join("\n    ")}${opts.extraHead ?? ""}
    <link rel="stylesheet" href="${cfg.cssHref}" />
    <script>${THEME_SCRIPT}</script>${cfg.analyticsSiteId ? `\n    ${analyticsTag(cfg.analyticsSiteId)}` : ""}
${opts.jsonLd.map((data) => `    <script type="application/ld+json">${JSON.stringify(data)}</script>`).join("\n")}
  </head>
  <body class="min-h-dvh bg-background text-foreground antialiased">
    <header class="border-b border-border/70">
      <div class="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4 md:h-16">
        <a href="/" aria-label="JoyoRogo, ke halaman utama" class="flex items-center gap-2 rounded-full ${FOCUS}">
          <img src="/brand/logo-mark.svg" alt="" class="h-7 w-auto" />
          <span class="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </a>
        <nav aria-label="Utama" class="flex items-center gap-1">
          <a href="/blog/" class="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground ${FOCUS}">Blog</a>
          <a href="/login" class="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${FOCUS}">Masuk</a>
        </nav>
      </div>
    </header>
    <main class="mx-auto w-full max-w-3xl px-4 pt-8 pb-16 md:pt-12">
${opts.main}
    </main>
    <footer class="border-t border-border/70">
      <div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8 text-sm">
        <nav aria-label="Tautan" class="flex flex-wrap gap-x-6 font-semibold">
          <a href="/" class="inline-flex min-h-11 items-center hover:text-primary">JoyoRogo</a>
          <a href="/blog/" class="inline-flex min-h-11 items-center hover:text-primary">Blog</a>
          <a href="/privasi" class="inline-flex min-h-11 items-center hover:text-primary">Privasi</a>
          <a href="${esc(cfg.apkUrl)}" class="inline-flex min-h-11 items-center hover:text-primary">Unduh Android</a>
          <a href="${SOURCE_URL}" class="inline-flex min-h-11 items-center hover:text-primary">Kode sumber</a>
        </nav>
        <p class="text-muted-foreground">Artikel di blog ini informasi umum, bukan pengganti saran dokter atau ahli gizi.</p>
      </div>
    </footer>
  </body>
</html>
`;
}

const PUBLISHER = (cfg: BlogConfig) => ({
  "@type": "Organization",
  name: "JoyoRogo",
  url: cfg.siteUrl,
  logo: { "@type": "ImageObject", url: `${cfg.siteUrl}/icons/apple-touch-icon.png` },
});

function ctaCard(cfg: BlogConfig): string {
  return `      <aside class="mt-12 rounded-3xl bg-makan-soft p-6" aria-labelledby="cta-title">
        <h2 id="cta-title" class="text-lg font-bold tracking-tight text-makan-ink">Malas menghitung sendiri?</h2>
        <p class="mt-2 leading-relaxed">Foto piringmu atau ceritakan apa yang kamu makan. JoyoRogo menghitung kalorinya dan bilang berapa lagi yang boleh kamu makan hari ini.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="/login" data-revklik-goal="signup_click" data-revklik-goal-location="blog" class="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${FOCUS}">Coba gratis</a>
          <a href="/#coba" data-revklik-goal="try_scan_click" data-revklik-goal-location="blog" class="inline-flex min-h-11 items-center rounded-full bg-card px-5 text-sm font-semibold hover:bg-muted ${FOCUS}">Coba scan tanpa daftar</a>
          <a href="${esc(cfg.apkUrl)}" data-revklik-goal="apk_download" data-revklik-goal-location="blog" class="inline-flex min-h-11 items-center rounded-full bg-card px-5 text-sm font-semibold hover:bg-muted ${FOCUS}">Unduh untuk Android</a>
        </div>
      </aside>`;
}

function postCard(post: Post, heading: "h2" | "h3"): string {
  return `<li>
          <a href="/blog/${post.slug}/" class="block rounded-3xl bg-card p-5 transition-colors hover:bg-muted/60 ${FOCUS}">
            <${heading} class="text-lg font-bold leading-snug tracking-tight">${esc(post.title)}</${heading}>
            <p class="mt-1.5 leading-relaxed text-muted-foreground">${esc(post.description)}</p>
            <p class="mt-2 text-sm text-muted-foreground"><time datetime="${post.date}">${fmtDate(post.date)}</time> · ${post.minutes} menit baca</p>
          </a>
        </li>`;
}

export function renderPost(post: Post, all: Post[], cfg: BlogConfig): string {
  const path = `/blog/${post.slug}/`;
  const related = all.filter((p) => p.slug !== post.slug).slice(0, 3);
  const main = `      <nav aria-label="Remah roti" class="text-sm text-muted-foreground">
        <a href="/blog/" class="inline-flex min-h-11 items-center font-semibold hover:text-foreground">Blog</a>
      </nav>
      <article>
        <header>
          <h1 class="text-3xl font-extrabold leading-tight tracking-tight text-balance md:text-4xl">${esc(post.title)}</h1>
          <p class="mt-3 text-sm text-muted-foreground">Oleh Dzulfikar · <time datetime="${post.updated}">Diperbarui ${fmtDate(post.updated)}</time> · ${post.minutes} menit baca</p>
        </header>
        <div class="blog-prose mt-8">
${post.html}
        </div>
      </article>
${ctaCard(cfg)}
      <section class="mt-12" aria-labelledby="more-title">
        <h2 id="more-title" class="text-lg font-bold tracking-tight">Baca juga</h2>
        <ul class="mt-4 space-y-3">
        ${related.map((p) => postCard(p, "h3")).join("\n        ")}
        </ul>
      </section>`;
  return shell({
    cfg,
    path,
    title: `${post.title} | JoyoRogo`,
    description: post.description,
    ogType: "article",
    extraHead: `
    <meta property="article:published_time" content="${post.date}" />
    <meta property="article:modified_time" content="${post.updated}" />`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.updated,
        inLanguage: "id",
        mainEntityOfPage: `${cfg.siteUrl}${path}`,
        image: `${cfg.siteUrl}${OG_IMAGE.path}`,
        author: { "@type": "Person", name: "Dzulfikar" },
        publisher: PUBLISHER(cfg),
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "JoyoRogo", item: `${cfg.siteUrl}/` },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${cfg.siteUrl}/blog/` },
          { "@type": "ListItem", position: 3, name: post.title, item: `${cfg.siteUrl}${path}` },
        ],
      },
    ],
    main,
  });
}

const INDEX_TITLE = "Blog JoyoRogo: kalori makanan Indonesia dan diet yang masuk akal";
const INDEX_DESCRIPTION =
  "Kalori nasi padang, gorengan, mie, dan telur menurut TKPI, cara menghitung defisit kalori, dan diet saat puasa. Ditulis untuk porsi dan kebiasaan makan Indonesia.";

export function renderIndex(posts: Post[], cfg: BlogConfig): string {
  const main = `      <h1 class="text-3xl font-extrabold tracking-tight md:text-4xl">Blog</h1>
      <p class="mt-3 max-w-xl leading-relaxed text-muted-foreground">Kalori makanan sehari-hari menurut data resmi, dan cara menurunkan berat badan tanpa menebak-nebak.</p>
      <ul class="mt-8 space-y-3">
        ${posts.map((p) => postCard(p, "h2")).join("\n        ")}
      </ul>
${ctaCard(cfg)}`;
  return shell({
    cfg,
    path: "/blog/",
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    ogType: "website",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Blog JoyoRogo",
        url: `${cfg.siteUrl}/blog/`,
        inLanguage: "id",
        publisher: PUBLISHER(cfg),
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          url: `${cfg.siteUrl}/blog/${p.slug}/`,
          datePublished: p.date,
        })),
      },
    ],
    main,
  });
}

export function renderRss(posts: Post[], cfg: BlogConfig): string {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${cfg.siteUrl}/blog/${p.slug}/</link>
      <guid>${cfg.siteUrl}/blog/${p.slug}/</guid>
      <pubDate>${new Date(`${p.date}T00:00:00+07:00`).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog JoyoRogo</title>
    <link>${cfg.siteUrl}/blog/</link>
    <description>${esc(INDEX_DESCRIPTION)}</description>
    <language>id</language>
${items}
  </channel>
</rss>
`;
}

/** Whole-site sitemap: public app pages plus every post. */
export function renderSitemap(posts: Post[], cfg: BlogConfig): string {
  const newest = posts.reduce((max, p) => (p.updated > max ? p.updated : max), "");
  const urls = [
    ...PUBLIC_PATHS.filter((p) => !PAGES[p].noindex).map((loc) => ({ loc, lastmod: "" })),
    { loc: "/blog/", lastmod: newest },
    ...posts.map((p) => ({ loc: `/blog/${p.slug}/`, lastmod: p.updated })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${cfg.siteUrl}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`;
}

/** Every file the blog adds to the build output, keyed by path under dist/. */
export function renderBlog(cfg: BlogConfig): Map<string, string> {
  const posts = loadPosts();
  const files = new Map<string, string>();
  files.set("blog/index.html", renderIndex(posts, cfg));
  files.set("blog/rss.xml", renderRss(posts, cfg));
  files.set("sitemap.xml", renderSitemap(posts, cfg));
  for (const post of posts) files.set(`blog/${post.slug}/index.html`, renderPost(post, posts, cfg));
  return files;
}
