import { DEFAULT_LOCALE, getActiveLocale, resources } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

/**
 * Tips nutrisi & fat-loss berbasis bukti. Konten statis dan sudah direview:
 * TIDAK ADA klaim kesehatan yang digenerate saat runtime. Dipakai bersama
 * oleh web (kartu feed, Beranda, dan halaman statis /blog/<slug> lewat
 * apps/web/blog/render.ts) dan native (kartu feed, Beranda, layar artikel).
 *
 * Struktur (slug, ikon, tanggal, tautan sumber, kredit foto) ada di TIPS;
 * semua teks ada di namespace `tips` (locales/<locale>/tips.json, kunci
 * `items.<slug>`). `localizeTip` menggabungkan keduanya: blog statis memakai
 * "id", klien memakai bahasa aktif.
 *
 * Angka gizi kasar (per 100 g / per sendok) mengikuti TKPI 2019 Kemenkes RI
 * dan USDA FoodData Central; klaim lainnya punya tautan sumber langsung.
 */

export type TipIcon =
  | "salad"
  | "egg"
  | "beef"
  | "wheat"
  | "droplets"
  | "glass-water"
  | "timer"
  | "package"
  | "cup-soda"
  | "utensils"
  | "moon"
  | "footprints"
  | "dumbbell"
  | "calendar"
  | "scale"
  | "soup"
  | "heart";

export type TipTag = "sugary-drink" | "sauce" | "fried";

export type TipSource = { title: string; url: string };

export type TipSection = { heading: string; paragraphs: string[] };

/**
 * Foto hero tip. Berkasnya dilayani web dari /tips-img/<slug>.webp
 * (1200x800) dan <slug>-600.webp (600x400); native membangun URL absolut
 * dari origin web. Semua foto CC0 / domain publik: komersial boleh tanpa
 * atribusi; kreditnya goodwill.
 */
export type TipImage = {
  alt: string;
  credit: { author: string | null; page: string; source: string };
};

/** Infografis 1200x675 dari angka yang disitasi di artikel. */
export type TipFigure = {
  /** Nama berkas di /tips-img/, misal "<slug>-fig1.webp". */
  src: string;
  alt: string;
  caption: string;
};

/** Tip siap tampil: struktur dari TIPS + teks dalam satu bahasa (lihat `localizeTip`). */
export type LocalizedTip = {
  slug: string;
  title: string;
  /** Satu baris untuk kartu ringkas di feed dan Beranda. */
  summary: string;
  icon: TipIcon;
  /** YYYY-MM-DD */
  date: string;
  /** Foto hero + infografis; opsional supaya tip baru tetap valid. */
  image?: TipImage;
  figure?: TipFigure;
  sections: TipSection[];
  /** Langkah praktis "Coba ini". */
  cobaIni: string[];
  sources: TipSource[];
  /** Kredit inspirasi konten, hanya bila kontennya spesifik dipakai. */
  credit?: { label: string; url: string };
  /** Pemicu kontekstual, misal hasil scan dengan minuman manis atau saus. */
  tags?: TipTag[];
};

/** Satu entri TIPS: bagian tip yang tidak bergantung bahasa. */
export type Tip = {
  slug: string;
  icon: TipIcon;
  date: string;
  image?: { credit: TipImage["credit"] };
  /** Nama berkas infografis. */
  figure?: string;
  /** Tautan sumber, urutannya sama dengan `sources` di tips.json. */
  sources: string[];
  credit?: "jeremyEthier";
  tags?: TipTag[];
};

type TipText = {
  title: string;
  summary: string;
  image?: { alt: string };
  figure?: { alt: string; caption: string };
  sections: TipSection[];
  cobaIni: string[];
  sources: string[];
};

const CREDIT_URL = { jeremyEthier: "https://www.youtube.com/@JeremyEthier" } as const;

export const TIPS: Tip[] = [
  {
    slug: "kenyang-dengan-porsi-banyak",
    image: {
      credit: { author: null, page: "https://www.rawpixel.com/image/5924545/photo-image-public-domain-food-water", source: "Rawpixel" },
    },
    figure: "kenyang-dengan-porsi-banyak-fig1.webp",
    icon: "salad",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/17556681/"],
    credit: "jeremyEthier",
  },
  {
    slug: "protein-kenyang-jaga-otot",
    image: {
      credit: { author: "Gary Lee Todd, Ph.D.", page: "https://www.flickr.com/photos/101561334@N08/34294440021", source: "Flickr" },
    },
    figure: "protein-kenyang-jaga-otot-fig1.webp",
    icon: "egg",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/18469287/", "https://pubmed.ncbi.nlm.nih.gov/19927027/", "https://pubmed.ncbi.nlm.nih.gov/26817506/"],
    credit: "jeremyEthier",
  },
  {
    slug: "protein-dibagi-empat-momen",
    image: {
      credit: { author: "ProjectManhattan", page: "https://commons.wikimedia.org/w/index.php?curid=29619858", source: "Wikimedia Commons" },
    },
    figure: "protein-dibagi-empat-momen-fig1.webp",
    icon: "beef",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/24477298/", "https://pubmed.ncbi.nlm.nih.gov/23446906/"],
  },
  {
    slug: "serat-kenyang-lama",
    image: {
      credit: { author: "Kojotisko", page: "https://www.flickr.com/photos/98796230@N03/14167598168", source: "Flickr" },
    },
    figure: "serat-kenyang-lama-fig1.webp",
    icon: "wheat",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/11396693/"],
  },
  {
    slug: "segelas-air-sebelum-makan",
    image: {
      credit: { author: "Kurt Kaiser", page: "https://commons.wikimedia.org/w/index.php?curid=105399729", source: "Wikimedia Commons" },
    },
    figure: "segelas-air-sebelum-makan-fig1.webp",
    icon: "droplets",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/19661958/"],
  },
  {
    slug: "air-berkarbonasi-fakta",
    image: {
      credit: { author: null, page: "https://www.rawpixel.com/image/5912059/image-public-domain-fruit-food", source: "Rawpixel" },
    },
    figure: "air-berkarbonasi-fakta-fig1.webp",
    icon: "glass-water",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/28228348/", "https://pubmed.ncbi.nlm.nih.gov/17313721/"],
  },
  {
    slug: "makan-pelan-kenyang-cepat",
    image: {
      credit: { author: "The Bangsawan", page: "https://commons.wikimedia.org/w/index.php?curid=154805235", source: "Wikimedia Commons" },
    },
    figure: "makan-pelan-kenyang-cepat-fig1.webp",
    icon: "timer",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/24215801/"],
  },
  {
    slug: "makanan-ultra-proses",
    image: {
      credit: { author: "Ninosan", page: "https://commons.wikimedia.org/w/index.php?curid=64565250", source: "Wikimedia Commons" },
    },
    figure: "makanan-ultra-proses-fig1.webp",
    icon: "package",
    date: "2026-10-13",
    sources: ["https://www.cell.com/cell-metabolism/fulltext/S1550-4131(19)30248-7"],
  },
  {
    slug: "kalori-cair-es-teh-kopi",
    image: {
      credit: { author: "roland", page: "https://www.flickr.com/photos/35034347371@N01/79456295", source: "Flickr" },
    },
    figure: "kalori-cair-es-teh-kopi-fig1.webp",
    icon: "cup-soda",
    date: "2026-10-13",
    tags: ["sugary-drink"],
    sources: ["https://pubmed.ncbi.nlm.nih.gov/10878689/", "https://pubmed.ncbi.nlm.nih.gov/23966427/"],
  },
  {
    slug: "saus-minyak-porsi-kecil",
    image: {
      credit: { author: "Wiki Farazi", page: "https://commons.wikimedia.org/w/index.php?curid=158552419", source: "Wikimedia Commons" },
    },
    figure: "saus-minyak-porsi-kecil-fig1.webp",
    icon: "utensils",
    date: "2026-10-13",
    tags: ["sauce", "fried"],
    sources: ["https://fdc.nal.usda.gov/"],
  },
  {
    slug: "tidur-cukup-lapar-turun",
    image: {
      credit: { author: "elizabeth lies", page: "https://stocksnap.io/photo/sleeping-bed-843D85B223", source: "StockSnap" },
    },
    figure: "tidur-cukup-lapar-turun-fig1.webp",
    icon: "moon",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/15618932/", "https://pmc.ncbi.nlm.nih.gov/articles/PMC2951287/"],
  },
  {
    slug: "langkah-harian-neat",
    image: {
      credit: { author: null, page: "https://www.rawpixel.com/image/5968947/walking-feet", source: "Rawpixel" },
    },
    figure: "langkah-harian-neat-fig1.webp",
    icon: "footprints",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/9880251/"],
  },
  {
    slug: "angkat-beban-saat-diet",
    image: {
      credit: { author: null, page: "https://www.rawpixel.com/image/5944299/free-public-domain-cc0-photo", source: "Rawpixel" },
    },
    figure: "angkat-beban-saat-diet-fig1.webp",
    icon: "dumbbell",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/19927027/", "https://pubmed.ncbi.nlm.nih.gov/26817506/"],
  },
  {
    slug: "jeda-diet-yang-terencana",
    image: {
      credit: { author: "roland", page: "https://www.flickr.com/photos/35034347371@N01/228858019", source: "Flickr" },
    },
    figure: "jeda-diet-yang-terencana-fig1.webp",
    icon: "calendar",
    date: "2026-10-13",
    sources: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC5803575"],
  },
  {
    slug: "timbangan-naik-turun-normal",
    image: {
      credit: { author: null, page: "https://www.rawpixel.com/image/5920157/photo-image-background-public-domain-person", source: "Rawpixel" },
    },
    figure: "timbangan-naik-turun-normal-fig1.webp",
    icon: "scale",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/25521523/"],
  },
  {
    slug: "sup-bening-pembuka",
    image: {
      credit: { author: "LintasGiat", page: "https://commons.wikimedia.org/w/index.php?curid=154777741", source: "Wikimedia Commons" },
    },
    figure: "sup-bening-pembuka-fig1.webp",
    icon: "soup",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/17574705/"],
  },
  {
    slug: "defisit-fleksibel-8020",
    image: {
      credit: { author: "Muhranoff", page: "https://commons.wikimedia.org/w/index.php?curid=142507539", source: "Wikimedia Commons" },
    },
    figure: "defisit-fleksibel-8020-fig1.webp",
    icon: "heart",
    date: "2026-10-13",
    sources: ["https://pubmed.ncbi.nlm.nih.gov/10349584/"],
  },
];

/** Teks tip dalam `locale`; tanpa argumen mengikuti bahasa aktif klien. */
export function localizeTip(meta: Tip, locale: Locale = getActiveLocale()): LocalizedTip {
  const texts = (r: (typeof resources)[Locale]) => r.tips.items as unknown as Record<string, TipText>;
  const text = texts(resources[locale])[meta.slug] ?? texts(resources[DEFAULT_LOCALE])[meta.slug]!;
  return {
    slug: meta.slug,
    title: text.title,
    summary: text.summary,
    icon: meta.icon,
    date: meta.date,
    ...(meta.image && text.image && { image: { alt: text.image.alt, credit: meta.image.credit } }),
    ...(meta.figure &&
      text.figure && { figure: { src: meta.figure, alt: text.figure.alt, caption: text.figure.caption } }),
    sections: text.sections,
    cobaIni: text.cobaIni,
    sources: meta.sources.map((url, i) => ({ title: text.sources[i] ?? url, url })),
    ...(meta.credit && {
      credit: { label: resources[locale].tips.credit[meta.credit], url: CREDIT_URL[meta.credit] },
    }),
    ...(meta.tags && { tags: meta.tags }),
  };
}

function jakartaDayKey(now: Date): number {
  // "2026-10-13" → 20261013; rotasi ganti tiap ganti hari Asia/Jakarta.
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
  return Number(iso.replaceAll("-", ""));
}

/** Offset rotasi kartu tips di feed, sama untuk web dan native per hari. */
export function tipRotationOffset(now: Date = new Date()): number {
  return jakartaDayKey(now) % TIPS.length;
}

/** Tip harian untuk kartu "Tips hari ini" di Beranda; deterministik per hari. */
export function dailyTip(now: Date = new Date()): Tip {
  return TIPS[tipRotationOffset(now) % TIPS.length] ?? TIPS[0]!;
}

/**
 * Jalur publik berkas gambar tips; dilayani web dari /tips-img/. Variant
 * "sm" adalah varian 600px untuk kartu.
 */
export function tipImagePath(file: string, variant: "lg" | "sm" = "lg"): string {
  return variant === "sm" ? `/tips-img/${file.replace(/\.webp$/, "-600.webp")}` : `/tips-img/${file}`;
}

/**
 * Tip ke-n untuk kartu di antara postingan feed, diratai tiap `EVERY` post.
 * Dipakai web dan native supaya kartu yang muncul di hari yang sama sama.
 */
export const FEED_TIP_EVERY = 6;

export function feedTipIndex(n: number, offset: number = tipRotationOffset()): number {
  return (offset + n) % TIPS.length;
}
