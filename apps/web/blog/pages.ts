// Static <head> tags for the SPA's public pages, rendered at build time from
// src/lib/seo.ts so every URL ships its own title, canonical, and share card.
import { FAQ, OG_IMAGE, PAGES, SITE_NAME, type PublicPath } from "../src/lib/seo.ts";

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

function jsonLd(siteUrl: string): object[] {
  const org = {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: `${siteUrl}/`,
    logo: `${siteUrl}/icons/icon-512.png`,
    email: "dzulfikar@joyorogo.com",
    sameAs: [SOURCE_URL],
  };
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

/** Everything SEO-related in <head> for one public page, one tag per line. */
export function pageHeadTags(path: PublicPath, siteUrl: string): string {
  const page = PAGES[path];
  const url = `${siteUrl}${path}`;
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="id_ID" />`,
    `<meta property="og:title" content="${esc(page.ogTitle ?? page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...ogImageTags(siteUrl),
    ...(path === "/"
      ? jsonLd(siteUrl).map(
          (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
        )
      : []),
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
  return `<main id="seo-fallback" style="max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6">
        <h1>${esc(heading)}</h1>
        <p>${esc(page.description)}</p>
        <p><a href="/">JoyoRogo</a> · <a href="/blog/">Blog</a> · <a href="/privasi">Privasi</a></p>
      </main>`;
}
