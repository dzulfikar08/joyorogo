// Static <head> tags for the SPA's public pages, rendered at build time from
// src/lib/seo.ts so every URL ships its own title, canonical, and share card.
import { FALLBACK_MS, FAQ_MS, FEATURE_LIST_MS } from "../src/lib/landing-ms.ts";
import { FAQ, OG_IMAGE, OG_IMAGE_MY, PAGES, SITE_NAME, type PublicPath } from "../src/lib/seo.ts";

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
 * The landing exists in two languages. Each landing page names both URLs (hreflang) so search engines serve the
 * right one, with "/" as the default for everyone else. Also read by the sitemap (render.ts).
 */
export const LANDING_ALTERNATES: ReadonlyArray<{ hreflang: string; path: PublicPath }> = [
  { hreflang: "id", path: "/" },
  { hreflang: "ms-MY", path: "/my" },
  { hreflang: "x-default", path: "/" },
];

const MY_SHARE_IMAGE: ShareImage = { ...OG_IMAGE_MY, type: "image/png" };
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

/** Everything SEO-related in <head> for one public page, one tag per line. */
export function pageHeadTags(path: PublicPath, siteUrl: string): string {
  const page = PAGES[path];
  const url = `${siteUrl}${path}`;
  const malay = path === "/my";
  const alternates = path === "/" || malay ? LANDING_ALTERNATES : [];
  const data = path === "/" ? jsonLd(siteUrl) : malay ? jsonLdMy(siteUrl) : [];
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
    `<meta property="og:locale" content="${malay ? "ms_MY" : "id_ID"}" />`,
    ...(alternates.length > 0
      ? [`<meta property="og:locale:alternate" content="${malay ? "id_ID" : "ms_MY"}" />`]
      : []),
    `<meta property="og:title" content="${esc(page.ogTitle ?? page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...ogImageTags(siteUrl, malay ? MY_SHARE_IMAGE : DEFAULT_SHARE_IMAGE),
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
