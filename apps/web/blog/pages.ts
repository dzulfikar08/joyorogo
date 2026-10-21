// Static <head> tags for the SPA's public pages, rendered at build time from
// src/lib/seo.ts so every URL ships its own title, canonical, and share card.
import { FALLBACK_MS, FAQ_MS, FEATURE_LIST_MS } from "../src/lib/landing-ms.ts";
import { FALLBACK_SG, FAQ_SG, FEATURE_LIST_SG } from "../src/lib/landing-sg.ts";
import { inlineParts, LEGAL_DOCS, LEGAL_PEERS, type LegalDoc, type LegalPath } from "../src/lib/legal-my.ts";
import { FAQ, OG_IMAGE, OG_IMAGE_MY, OG_IMAGE_SG, PAGES, SITE_NAME, type PublicPath } from "../src/lib/seo.ts";

export const PUBLIC_PATHS = Object.keys(PAGES) as PublicPath[];

/** Placeholder in index.html that the head tags replace. */
export const HEAD_MARKER = "<!--seo-head-->";

const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type ShareImage = {
  path: string;
  width: number;
  height: number;
  alt: string;
  type: string;
};

/**
 * The landing exists in three markets (Indonesia, Malaysia, Singapore). Each landing page names all URLs (hreflang) so search engines serve the
 * right one, with "/" as the default for everyone else. Also read by the sitemap (render.ts).
 */
export const LANDING_ALTERNATES: ReadonlyArray<{ hreflang: string; path: PublicPath }> = [
  { hreflang: "id", path: "/" },
  { hreflang: "ms-MY", path: "/my" },
  { hreflang: "en-SG", path: "/sg" },
  { hreflang: "x-default", path: "/" },
];

const OG_LOCALE = { id: "id_ID", "ms-MY": "ms_MY", "en-MY": "en_MY", "en-SG": "en_SG" } as const;

/** The Indonesian page and its Malaysian counterparts in Malay and English, named to each other (hreflang). */
function noticeGroup(id: PublicPath, ms: PublicPath, en: PublicPath) {
  return [
    { hreflang: "id", path: id },
    { hreflang: "ms-MY", path: ms },
    { hreflang: "en-MY", path: en },
    { hreflang: "x-default", path: id },
  ] as const;
}

const LEGAL_ALTERNATE_GROUPS: ReadonlyArray<ReadonlyArray<{ hreflang: string; path: PublicPath }>> = [
  noticeGroup("/privasi", "/my/privasi", "/my/privacy"),
  noticeGroup("/syarat", "/my/syarat", "/my/terms"),
];

/** hreflang alternates of a public page, also read by the sitemap (render.ts); empty when it has no counterpart. */
export function alternatesFor(path: PublicPath): ReadonlyArray<{ hreflang: string; path: PublicPath }> {
  if (LANDING_ALTERNATES.some((alt) => alt.path === path)) return LANDING_ALTERNATES;
  return LEGAL_ALTERNATE_GROUPS.find((group) => group.some((alt) => alt.path === path)) ?? [];
}

/** Real, no-JS content of a Malaysian legal page (the whole notice, not a teaser): the same data the route renders. */
function legalFallback(doc: LegalDoc): string {
  const inline = (source: string) =>
    inlineParts(source)
      .map((part) => {
        if ("text" in part) return esc(part.text);
        if ("bold" in part) return `<strong>${esc(part.bold)}</strong>`;
        return `<a href="${esc(part.href)}">${esc(part.label)}</a>`;
      })
      .join("");
  const block = (b: LegalDoc["sections"][number]["blocks"][number]) =>
    typeof b === "string"
      ? `<p>${inline(b)}</p>`
      : "note" in b
        ? `<p><small>${inline(b.note)}</small></p>`
        : `<ul>${b.list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
  const peer = LEGAL_DOCS[LEGAL_PEERS[doc.path]];
  return `<main id="seo-fallback" lang="${doc.lang}" style="max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6">
        <h1>${esc(doc.title)}</h1>
        <p>${esc(doc.intro)}</p>
        <p><small>${esc(doc.version)}</small></p>
        <p><a href="${peer.path}" lang="${peer.lang}" hreflang="${peer.lang}">${peer.lang === "en" ? "Read this in English" : "Baca dalam Bahasa Melayu"}</a> · <a href="/my">JoyoRogo</a></p>
        ${doc.sections
          .map(
            (section) =>
              `<section${section.id ? ` id="${esc(section.id)}"` : ""}${section.lang ? ` lang="${section.lang}"` : ""}>
          <h2>${esc(section.title)}</h2>
          ${section.blocks.map(block).join("\n          ")}
        </section>`,
          )
          .join("\n        ")}
      </main>`;
}

const MY_SHARE_IMAGE: ShareImage = { ...OG_IMAGE_MY, type: "image/png" };
const SG_SHARE_IMAGE: ShareImage = { ...OG_IMAGE_SG, type: "image/png" };
const DEFAULT_SHARE_IMAGE: ShareImage = { ...OG_IMAGE, type: "image/png" };

/** Share image tags; large card so previews show the image, not a thumbnail. */
export function ogImageTags(siteUrl: string, image: ShareImage = DEFAULT_SHARE_IMAGE): string[] {
  const src = `${siteUrl}${image.path}`;
  return [
    `<meta property="og:image" content="${src}" />`,
    `<meta property="og:image:type" content="${image.type}" />`,
    `<meta property="og:image:width" content="${image.width}" />`,
    `<meta property="og:image:height" content="${image.height}" />`,
    `<meta property="og:image:alt" content="${esc(image.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${src}" />`,
    `<meta name="twitter:image:alt" content="${esc(image.alt)}" />`,
  ];
}

function organization(siteUrl: string) {
  return {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: `${siteUrl}/`,
    logo: `${siteUrl}/icons/icon-512.png`,
    email: "dzulfikar@joyorogo.com",
    sameAs: [SOURCE_URL],
  };
}

function jsonLd(siteUrl: string): object[] {
  const org = organization(siteUrl);
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        org,
        {
          "@type": "WebSite",
          "@id": `${siteUrl}/#website`,
          name: SITE_NAME,
          url: `${siteUrl}/`,
          inLanguage: "id",
          publisher: { "@id": org["@id"] },
        },
        {
          "@type": "WebApplication",
          name: SITE_NAME,
          url: `${siteUrl}/`,
          image: `${siteUrl}${OG_IMAGE.path}`,
          applicationCategory: "HealthApplication",
          operatingSystem: "Web, Android, iOS",
          inLanguage: "id",
          isAccessibleForFree: true,
          description: PAGES["/"].description,
          offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
          publisher: { "@id": org["@id"] },
          featureList: [
            "Foto makanan dianalisis AI dan dihitung kalorinya",
            "Ceritakan makanan lewat teks atau suara",
            "Tiga angka harian: boleh makan, harus bakar, butuh tidur",
            "Langkah, olahraga, dan tidur dari Health Connect dan Strava",
            "Tren berat badan dan perkiraan tanggal sampai target",
            "Foto asli tidak disimpan, kecuali pengguna menyalakan Simpan foto asli",
          ],
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

/** Malaysian landing: free to use (no Pro price is stated in the page source, prices come from /api/config at runtime). */
function jsonLdMy(siteUrl: string): object[] {
  const org = organization(siteUrl);
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        org,
        {
          "@type": "WebApplication",
          name: SITE_NAME,
          url: `${siteUrl}/my`,
          image: `${siteUrl}${OG_IMAGE_MY.path}`,
          applicationCategory: "HealthApplication",
          operatingSystem: "Web, Android, iOS",
          inLanguage: "ms",
          isAccessibleForFree: true,
          description: PAGES["/my"].description,
          offers: { "@type": "Offer", price: "0", priceCurrency: "MYR" },
          publisher: { "@id": org["@id"] },
          featureList: [...FEATURE_LIST_MS],
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: "ms",
      mainEntity: FAQ_MS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

/** Singapore landing: free to use (no Pro price is stated in the page source, prices come from /api/config at runtime). */
function jsonLdSg(siteUrl: string): object[] {
  const org = organization(siteUrl);
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        org,
        {
          "@type": "WebApplication",
          name: SITE_NAME,
          url: `${siteUrl}/sg`,
          image: `${siteUrl}${OG_IMAGE_SG.path}`,
          applicationCategory: "HealthApplication",
          operatingSystem: "Web, Android, iOS",
          inLanguage: "en-SG",
          isAccessibleForFree: true,
          description: PAGES["/sg"].description,
          offers: { "@type": "Offer", price: "0", priceCurrency: "SGD" },
          publisher: { "@id": org["@id"] },
          featureList: [...FEATURE_LIST_SG],
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: "en-SG",
      mainEntity: FAQ_SG.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

/** Everything SEO-related in <head> for one public page, one tag per line. */
export function pageHeadTags(path: PublicPath, siteUrl: string): string {
  const page = PAGES[path];
  const url = `${siteUrl}${path}`;
  const malay = path === "/my";
  const alternates = alternatesFor(path);
  const ownHreflang =
    page.lang === "en-SG" ? "en-SG" : page.lang === "en" ? "en-MY" : page.lang === "ms" || malay ? "ms-MY" : "id";
  const data = path === "/" ? jsonLd(siteUrl) : malay ? jsonLdMy(siteUrl) : path === "/sg" ? jsonLdSg(siteUrl) : [];
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<link rel="canonical" href="${url}" />`,
    ...alternates.map(
      (alt) => `<link rel="alternate" hreflang="${alt.hreflang}" href="${siteUrl}${alt.path}" />`,
    ),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[ownHreflang]}" />`,
    ...alternates
      .filter((alt) => alt.hreflang !== ownHreflang && alt.hreflang in OG_LOCALE)
      .map((alt) => `<meta property="og:locale:alternate" content="${OG_LOCALE[alt.hreflang as keyof typeof OG_LOCALE]}" />`),
    `<meta property="og:title" content="${esc(page.ogTitle ?? page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...ogImageTags(siteUrl, ownHreflang === "id" ? DEFAULT_SHARE_IMAGE : ownHreflang === "en-SG" ? SG_SHARE_IMAGE : MY_SHARE_IMAGE),
    ...data.map((entry) => `<script type="application/ld+json">${JSON.stringify(entry)}</script>`),
  ];
  return tags.filter(Boolean).join("\n    ");
}

/**
 * No-JS content for a public page other than "/", in place of the landing
 * copy index.html carries; users never see it (the boot script hides it).
 */
export function pageFallback(path: PublicPath): string {
  const page = PAGES[path];
  const heading = page.title.replace(/ \| JoyoRogo$/, "");
  if (path in LEGAL_DOCS) return legalFallback(LEGAL_DOCS[path as LegalPath]);
  if (path === "/sg") {
    return `<main id="seo-fallback" lang="en-SG" style="max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6">
        <h1>${esc(heading)}</h1>
        <p>${esc(page.description)}</p>
        ${FALLBACK_SG.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n        ")}
        <p>${FALLBACK_SG.links.map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join(" · ")}</p>
      </main>`;
  }
  if (path === "/my") {
    return `<main id="seo-fallback" lang="ms" style="max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6">
        <h1>${esc(heading)}</h1>
        <p>${esc(page.description)}</p>
        ${FALLBACK_MS.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n        ")}
        <p>${FALLBACK_MS.links.map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join(" · ")}</p>
      </main>`;
  }
  return `<main id="seo-fallback" style="max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6">
        <h1>${esc(heading)}</h1>
        <p>${esc(page.description)}</p>
        <p><a href="/">JoyoRogo</a> · <a href="/blog/">Blog</a> · <a href="/privasi">Privasi</a></p>
      </main>`;
}
