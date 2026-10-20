// Static blog: Markdown posts in ./posts rendered to plain HTML at build time,
// so crawlers and AI assistants read the full article without running the SPA.
// Numbers in posts come from TKPI 2019 through the ::tkpi / ::porsi directives,
// never typed by hand.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TKPI_2019, type Tkpi2019Row } from "@joyorogo/api/lib/tkpi2019-data";
import { TIPS, localizeTip, tipImagePath, type LocalizedTip } from "@joyorogo/api/lib/tips";
import { Marked } from "marked";

import { OG_IMAGE, PAGES } from "../src/lib/seo.ts";
import { ANDROID_ROBOT_PATH, ANDROID_ROBOT_VIEWBOX } from "../src/lib/android-robot.ts";
import { APPLE_LOGO_PATH, APPLE_LOGO_VIEWBOX } from "../src/lib/apple-logo.ts";
import { ANDROID_ROBOT_CREDIT } from "../src/lib/credits.ts";
import { JOYOROGO_TESTFLIGHT_URL } from "../src/lib/testflight.ts";
import { ogImageTags, PUBLIC_PATHS, type ShareImage } from "./pages.ts";
import {
  CATEGORIES,
  CATEGORY_BLURB,
  categoryAnchor,
  categoryOf,
  relatedSlugs,
  topicsOf,
  type Category,
  type Linkable,
} from "./related.ts";
import { REVKLIK_GUARD } from "./revklik.ts";

export type BlogConfig = {
  /** Canonical origin, no trailing slash. */
  siteUrl: string;
  /** Origin of the signed-in app, no trailing slash; unset = the same host as the blog (self-hosted builds). */
  appUrl?: string;
  /** Hashed app stylesheet, e.g. /assets/index-abc.css. */
  cssHref: string;
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
  kind: "article" | "tip";
  category: Category;
  words: number;
  /** Slugs of related posts, best first; filled by loadPosts. */
  related: string[];
  /** Question/answer pairs from the post's FAQ section, for FAQPage JSON-LD. */
  faq: { q: string; a: string }[];
  /** Own share image (tips); articles fall back to the site card. */
  image?: ShareImage;
  /** Hero photo to preload (tips). */
  hero?: { src: string; srcset: string; sizes: string };
};

const POSTS_DIR = join(import.meta.dirname, "posts");
const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";
/** Inline icons for the static pages: the official Android robot head (src/lib/android-robot.ts) and the Apple logo (src/lib/apple-logo.ts). */
const ANDROID_ICON = `<svg viewBox="${ANDROID_ROBOT_VIEWBOX}" aria-hidden="true" focusable="false" class="size-4 shrink-0"><path fill="currentColor" fill-rule="evenodd" d="${ANDROID_ROBOT_PATH}"/></svg>`;
const APPLE_ICON = `<svg viewBox="${APPLE_LOGO_VIEWBOX}" aria-hidden="true" focusable="false" class="size-4 shrink-0"><path fill="currentColor" d="${APPLE_LOGO_PATH}"/></svg>`;
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

function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^\s*[-|>]\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FAQ pairs for FAQPage JSON-LD: under a `## Pertanyaan ...` (or FAQ / Tanya
 * jawab) heading, each `### Question` plus the text up to the next heading is
 * one pair. The same markdown renders on the page, so markup matches content.
 */
function extractFaq(body: string, file: string): { q: string; a: string }[] {
  const section = /^##\s+(?:pertanyaan|faq|tanya jawab)[^\n]*\n([\s\S]*?)(?=^##\s(?!#)|(?![\s\S]))/im.exec(
    body,
  );
  if (!section) return [];
  const pairs = [...(section[1] ?? "").matchAll(/^###\s+(.+)\n([\s\S]*?)(?=^###\s|(?![\s\S]))/gm)].map(
    (m) => ({ q: plain(m[1] ?? ""), a: plain(m[2] ?? "") }),
  );
  if (pairs.some((p) => !p.q || !p.a)) throw new Error(`${file}: FAQ ada pertanyaan atau jawaban kosong`);
  return pairs;
}

function linkable(p: Post, pinned: string[], text: string): Linkable & { post: Post } {
  return {
    post: p,
    slug: p.slug,
    kind: p.kind,
    category: p.category,
    topics: topicsOf(`${p.slug} ${text}`),
    date: p.date,
    pinned,
  };
}

export function loadPosts(): Post[] {
  const items: (Linkable & { post: Post })[] = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const { meta, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, file), "utf8"), file);
      const { md, usesTkpi } = expandDirectives(body, file);
      const html = toHtml(md) + (usesTkpi ? `<p class="blog-source">${esc(TKPI_NOTE)}</p>` : "");
      const words = body.split(/\s+/).filter(Boolean).length;
      const slug = file.replace(/\.md$/, "");
      const text = `${meta.title} ${meta.description} ${meta.tags ?? ""}`;
      const post: Post = {
        slug,
        title: meta.title ?? "",
        description: meta.description ?? "",
        date: meta.date ?? "",
        updated: meta.updated ?? meta.date ?? "",
        html,
        minutes: Math.max(1, Math.round(words / 200)),
        featured: meta.featured === "true",
        kind: "article",
        category: categoryOf(slug, text, meta.category),
        words,
        related: [],
        faq: extractFaq(body, file),
      };
      const pinned = (meta.related ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return linkable(post, pinned, text);
    });
  items.push(
    ...TIPS.map((meta) => {
      // The static blog is Indonesian-only.
      const tip = localizeTip(meta, "id");
      const post = tipToPost(tip);
      return linkable(post, [], `${tip.title} ${tip.summary}`);
    }),
  );
  const slugs = new Set(items.map((i) => i.slug));
  for (const item of items) {
    for (const s of item.pinned) {
      if (!slugs.has(s)) throw new Error(`${item.slug}: related "${s}" tidak ada`);
    }
    item.post.related = relatedSlugs(item, items);
  }
  return items
    .map((i) => i.post)
    .sort(
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
function tipToPost(tip: LocalizedTip): Post {
  const sectionsMd = tip.sections
    .flatMap((section) => [`## ${section.heading}`, section.paragraphs.join("\n\n")])
    .join("\n\n");
  const heroSrc = tipImagePath(`${tip.slug}.webp`);
  const heroSrcset = `${tipImagePath(`${tip.slug}.webp`, "sm")} 600w, ${heroSrc} 1200w`;
  const heroSizes = "(max-width: 768px) 100vw, 768px";
  const hero = tip.image
    ? `<figure>
        <img src="${heroSrc}" srcset="${heroSrcset}" sizes="${heroSizes}" alt="${esc(tip.image.alt)}" width="1200" height="800" fetchpriority="high" decoding="async" class="w-full rounded-3xl" />
        <figcaption class="mt-2 text-xs text-muted-foreground">Foto${tip.image.credit.author ? `: ${esc(tip.image.credit.author)}` : ""} · ${esc(tip.image.credit.source)} · ${esc(tip.image.credit.page)}</figcaption>
      </figure>`
    : "";
  const figure = tip.figure
    ? `<figure>
        <img src="${tipImagePath(tip.figure.src)}" alt="${esc(tip.figure.alt)}" width="1200" height="675" loading="lazy" decoding="async" class="w-full rounded-3xl border border-border/60" />
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
    kind: "tip",
    category: "Tips",
    words,
    related: [],
    faq: [],
    ...(tip.image && {
      image: {
        path: heroSrc,
        width: 1200,
        height: 800,
        alt: tip.image.alt,
        type: "image/webp",
      },
      hero: { src: heroSrc, srcset: heroSrcset, sizes: heroSizes },
    }),
  };
}

const THEME_SCRIPT = `try{var t=localStorage.getItem("vite-ui-theme")||"system";document.documentElement.classList.toggle("dark",t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))}catch(e){}`;

/** Same rules as detectPlatform() in src/lib/platform.ts (kept in step by platform.test.ts). */
export const PLATFORM_SCRIPT = `try{var u=navigator.userAgent;document.documentElement.dataset.os=/iPhone|iPad|iPod/.test(u)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)?"ios":/Android/i.test(u)?"android":"desktop"}catch(e){}`;

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
  ogImage?: ShareImage;
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
    ${ogImageTags(cfg.siteUrl, opts.ogImage).join("\n    ")}${opts.extraHead ?? ""}
    <link rel="stylesheet" href="${cfg.cssHref}" />
    <script>${THEME_SCRIPT}</script>
    <script>${PLATFORM_SCRIPT}</script>${cfg.analyticsSiteId ? `\n    ${analyticsTag(cfg.analyticsSiteId)}` : ""}
${opts.jsonLd.map((data) => `    <script type="application/ld+json">${JSON.stringify(data)}</script>`).join("\n")}
  </head>
  <body class="min-h-dvh bg-background text-foreground antialiased">
    <header class="border-b border-border/70">
      <div class="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4 md:h-16">
        <a href="/" aria-label="JoyoRogo, ke halaman utama" class="flex items-center gap-2 rounded-full ${FOCUS}">
          <img src="/brand/logo-mark.svg" alt="" width="25" height="28" class="h-7 w-auto" />
          <span class="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </a>
        <nav aria-label="Utama" class="flex items-center gap-1">
          <a href="/blog/" class="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground ${FOCUS}">Blog</a>
          <a href="${cfg.appUrl ?? ""}/login" class="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${FOCUS}">Masuk</a>
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
          <a href="/#tester" class="inline-flex min-h-11 items-center gap-1.5 hover:text-primary">${ANDROID_ICON}Android (tes Google Play)</a>
          <a href="${JOYOROGO_TESTFLIGHT_URL}" class="inline-flex min-h-11 items-center gap-1.5 hover:text-primary">${APPLE_ICON}iPhone (TestFlight)</a>
          <a href="${SOURCE_URL}" class="inline-flex min-h-11 items-center hover:text-primary">Kode sumber</a>
        </nav>
        <p class="text-muted-foreground">Artikel di blog ini informasi umum, bukan pengganti saran dokter atau ahli gizi.</p>
        <p class="text-xs leading-relaxed text-muted-foreground">${ANDROID_ROBOT_CREDIT}</p>
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

/**
 * The page is static, so the CTA row is prerendered neutral (iPhone and
 * Android options both visible, as on desktop) and PLATFORM_SCRIPT tags <html>
 * with data-os before first paint. These variants key off that attribute.
 */
const ON_ANDROID_HIDE = "[html[data-os=android]_&]:hidden";
const ON_IOS_SECONDARY =
  "[html[data-os=ios]_&]:bg-transparent [html[data-os=ios]_&]:px-2 [html[data-os=ios]_&]:text-muted-foreground [html[data-os=ios]_&]:underline [html[data-os=ios]_&]:underline-offset-4 [html[data-os=ios]_&]:hover:bg-transparent";

function ctaCard(cfg: BlogConfig): string {
  return `      <aside class="mt-12 rounded-3xl bg-makan-soft p-6" aria-labelledby="cta-title">
        <h2 id="cta-title" class="text-lg font-bold tracking-tight text-makan-ink">Malas menghitung sendiri?</h2>
        <p class="mt-2 leading-relaxed">Foto piringmu atau ceritakan apa yang kamu makan. JoyoRogo menghitung kalorinya dan bilang berapa lagi yang boleh kamu makan hari ini.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="${cfg.appUrl ?? ""}/login" data-revklik-goal="signup_click" data-revklik-goal-location="blog" class="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${FOCUS}">Coba gratis</a>
          <a href="/#coba" data-revklik-goal="try_scan_click" data-revklik-goal-location="blog" class="inline-flex min-h-11 items-center rounded-full bg-card px-5 text-sm font-semibold hover:bg-muted ${FOCUS}">Coba scan tanpa daftar</a>
          <a href="/?pasang=iphone" data-revklik-goal="ios_cta_click" data-revklik-goal-location="blog" class="${ON_ANDROID_HIDE} inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-5 text-sm font-semibold hover:bg-muted ${FOCUS}">${APPLE_ICON}Buka di iPhone</a>
          <a href="/#tester" data-revklik-goal="tester_cta_click" data-revklik-goal-location="blog" class="${ON_IOS_SECONDARY} inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-5 text-sm font-semibold hover:bg-muted ${FOCUS}">${ANDROID_ICON}Gabung tester Android</a>
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

const AUTHOR = { "@type": "Person", name: "Dzulfikar", url: "https://joyorogo.com/" };

/** Social/JSON-LD image: the tip's own photo, else the shared card. */
function shareImage(post: Post): ShareImage {
  return post.image ?? { ...OG_IMAGE, type: "image/png" };
}

/** Preload for the hero photo (the LCP element on tips); articles have none. */
function heroPreload(post: Post): string {
  if (!post.hero) return "";
  const { src, srcset, sizes } = post.hero;
  return `\n    <link rel="preload" as="image" href="${esc(src)}" imagesrcset="${esc(srcset)}" imagesizes="${esc(sizes)}" fetchpriority="high" />`;
}

export function renderPost(post: Post, all: Post[], cfg: BlogConfig): string {
  const path = `/blog/${post.slug}/`;
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const related = post.related.flatMap((slug) => bySlug.get(slug) ?? []);
  const image = shareImage(post);
  const main = `      <nav aria-label="Remah roti" class="text-sm text-muted-foreground">
        <a href="/blog/" class="inline-flex min-h-11 items-center font-semibold hover:text-foreground">Blog</a>
        <span aria-hidden="true">/</span>
        <a href="/blog/#${categoryAnchor(post.category)}" class="inline-flex min-h-11 items-center font-semibold hover:text-foreground">${post.category}</a>
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
        <h2 id="more-title" class="text-lg font-bold tracking-tight">Artikel terkait</h2>
        <ul class="mt-4 space-y-3">
        ${related.map((p) => postCard(p, "h3")).join("\n        ")}
        </ul>
      </section>`;
  return shell({
    cfg,
    path,
    title: post.title.length + 11 <= 65 ? `${post.title} | JoyoRogo` : post.title,
    description: post.description,
    ogType: "article",
    ogImage: image,
    extraHead: `
    <meta name="robots" content="max-image-preview:large" />
    <meta property="article:published_time" content="${post.date}" />
    <meta property="article:modified_time" content="${post.updated}" />
    <meta property="article:section" content="${post.category}" />${heroPreload(post)}`,
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
        image: {
          "@type": "ImageObject",
          url: `${cfg.siteUrl}${image.path}`,
          width: image.width,
          height: image.height,
        },
        articleSection: post.category,
        wordCount: post.words,
        author: AUTHOR,
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
      ...(post.faq.length > 0
        ? [
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: post.faq.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            },
          ]
        : []),
    ],
    main,
  });
}

const INDEX_TITLE = "Blog JoyoRogo: kalori makanan Indonesia dan diet yang masuk akal";
const INDEX_DESCRIPTION =
  "Kalori makanan Indonesia menurut TKPI, menu Ramadan, dan tips diet dengan studi yang disitasi. Ditulis untuk porsi dan kebiasaan makan Indonesia.";

export function renderIndex(posts: Post[], cfg: BlogConfig): string {
  const groups = CATEGORIES.map((category) => ({
    category,
    posts: posts.filter((p) => p.category === category),
  })).filter((g) => g.posts.length > 0);
  const chips = groups
    .map(
      (g) =>
        `<a href="#${categoryAnchor(g.category)}" class="inline-flex min-h-11 items-center rounded-full bg-card px-4 text-sm font-semibold hover:bg-muted ${FOCUS}">${g.category} <span class="ml-1.5 text-muted-foreground">${g.posts.length}</span></a>`,
    )
    .join("\n        ");
  const sections = groups
    .map(
      (g) => `      <section id="${categoryAnchor(g.category)}" class="mt-10 scroll-mt-4" aria-labelledby="${categoryAnchor(g.category)}-title">
        <h2 id="${categoryAnchor(g.category)}-title" class="text-2xl font-extrabold tracking-tight">${g.category}</h2>
        <p class="mt-1 text-muted-foreground">${esc(CATEGORY_BLURB[g.category])}</p>
        <ul class="mt-4 space-y-3">
        ${g.posts.map((p) => postCard(p, "h3")).join("\n        ")}
        </ul>
      </section>`,
    )
    .join("\n");
  const main = `      <h1 class="text-3xl font-extrabold tracking-tight md:text-4xl">Blog</h1>
      <p class="mt-3 max-w-xl leading-relaxed text-muted-foreground">Kalori makanan sehari-hari menurut data resmi, dan cara menurunkan berat badan tanpa menebak-nebak.</p>
      <nav aria-label="Kategori" class="mt-5 flex flex-wrap gap-2">
        ${chips}
      </nav>
${sections}
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
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "JoyoRogo", item: `${cfg.siteUrl}/` },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${cfg.siteUrl}/blog/` },
        ],
      },
    ],
    main,
  });
}

export function renderRss(posts: Post[], cfg: BlogConfig): string {
  const byDate = [...posts].sort(
    (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
  );
  const newest = byDate.reduce((max, p) => (p.updated > max ? p.updated : max), "");
  const items = byDate
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${cfg.siteUrl}/blog/${p.slug}/</link>
      <guid>${cfg.siteUrl}/blog/${p.slug}/</guid>
      <pubDate>${new Date(`${p.date}T00:00:00+07:00`).toUTCString()}</pubDate>
      <dc:creator>Dzulfikar</dc:creator>
      <category>${p.category}</category>
      <description>${esc(p.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Blog JoyoRogo</title>
    <link>${cfg.siteUrl}/blog/</link>
    <atom:link href="${cfg.siteUrl}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>${esc(INDEX_DESCRIPTION)}</description>
    <language>id</language>
    <lastBuildDate>${new Date(`${newest}T00:00:00+07:00`).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/** Whole-site sitemap: public app pages plus every post. */
export function renderSitemap(posts: Post[], cfg: BlogConfig): string {
  const newest = posts.reduce((max, p) => (p.updated > max ? p.updated : max), "");
  const urls = [
    ...PUBLIC_PATHS.filter((p) => !PAGES[p].noindex).map((loc) => ({ loc, lastmod: PAGES[loc].lastmod ?? "" })),
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
  files.set("llms.txt", renderLlms(posts, cfg));
  for (const post of posts) files.set(`blog/${post.slug}/index.html`, renderPost(post, posts, cfg));
  return files;
}

/**
 * llms.txt: the hand-written intro (./llms-intro.txt) plus every post grouped
 * by category, generated so it never drifts from the posts and tips.
 */
export function renderLlms(posts: Post[], cfg: BlogConfig): string {
  const intro = readFileSync(join(import.meta.dirname, "llms-intro.txt"), "utf8").trimEnd();
  const sections = CATEGORIES.flatMap((category) => {
    const inCategory = posts.filter((p) => p.category === category);
    if (inCategory.length === 0) return [];
    const lines = inCategory.map(
      (p) => `- [${p.title}](${cfg.siteUrl}/blog/${p.slug}/): ${p.description}`,
    );
    return [`## Blog: ${category}\n\n${lines.join("\n")}`];
  });
  return `${intro}\n\n${sections.join("\n\n")}\n`;
}
