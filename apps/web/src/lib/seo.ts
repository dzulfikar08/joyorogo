// Per-URL search and share metadata. The build (blog/plugin.ts) writes these
// into each public page's static HTML so crawlers and link previews see them
// without running JS; routes reuse the titles so client navigation matches.
// Plain data only: this module is also imported by Node at build time.

export const SITE_NAME = "JoyoRogo";

export const OG_IMAGE = {
  path: "/og.png",
  width: 1200,
  height: 630,
  alt: "JoyoRogo: diet yang paham porsi warteg. Tiga angka harian: boleh makan, harus bakar, butuh tidur.",
} as const;

export type PublicPath = "/" | "/harga" | "/privasi" | "/login" | "/pembayaran" | "/gabung";

export type PageMeta = {
  title: string;
  description: string;
  /** Share-card headline when it should differ from the search title. */
  ogTitle?: string;
  /** Transactional pages: keep out of search results. */
  noindex?: boolean;
};

export const PAGES: Record<PublicPath, PageMeta> = {
  "/": {
    title: "JoyoRogo: Hitung Kalori dari Foto Makanan Indonesia",
    ogTitle: "JoyoRogo: Diet yang Paham Porsi Warteg",
    description:
      "Foto piringmu, AI menghitung kalorinya dalam beberapa detik. Tiap hari tahu berapa boleh makan, harus bakar, dan butuh tidur. Gratis, foto tidak disimpan.",
  },
  "/harga": {
    title: "Harga | JoyoRogo",
    description:
      "Diary makan, olahraga, berat, dan tidur gratis selamanya, dengan jatah foto AI harian. Founder menambah jatah foto AI harian dan mendukung JoyoRogo.",
  },
  "/privasi": {
    title: "Privasi | JoyoRogo",
    description:
      "Data apa yang JoyoRogo simpan dan untuk apa. Foto makanan hanya dipakai untuk analisis lalu dibuang, data tidak dijual, dan semuanya bisa kamu hapus.",
  },
  "/login": {
    title: "Masuk | JoyoRogo",
    description:
      "Masuk ke JoyoRogo dengan akun Google. Isi tinggi, berat, dan target, lalu angka harianmu muncul hari ini juga.",
  },
  "/pembayaran": {
    title: "Pembayaran | JoyoRogo",
    description: "Status pembayaran Founder JoyoRogo.",
    noindex: true,
  },
  // Capability invite links: one per group code, kept out of search results.
  "/gabung": {
    title: "Gabung Grup | JoyoRogo",
    description:
      "Kamu diundang ke grup JoyoRogo. Pantau kalori bareng, colek yang malas catat, dan intip perut lewat VAR.",
    noindex: true,
  },
};

/** Landing FAQ; also emitted as FAQPage structured data on "/". */
export const FAQ = [
  {
    q: "Seberapa akurat kalori dari foto?",
    a: "AI mengenali tiap makanan di piring lalu memperkirakan porsi dan kalorinya. Hasilnya perkiraan, jadi sebelum disimpan kamu bisa mengubah porsi, menghapus, atau menambah item.",
  },
  {
    q: "Apakah fotoku disimpan?",
    a: "Tidak. Foto hanya dipakai untuk analisis lalu dibuang. Yang tersimpan cuma nama makanan dan angka yang kamu konfirmasi, dan semuanya bisa kamu hapus dari halaman Profil.",
  },
  {
    q: "Bagaimana target kalori dihitung?",
    a: "Dari usia, jenis kelamin, tinggi, berat, dan tingkat aktivitasmu (rumus Mifflin-St Jeor), lalu dikurangi defisit sesuai target berat dan tanggal yang kamu pilih. Kalau catatan makan dan timbanganmu cukup, target menyesuaikan pembakaran nyatamu, dibatasi 15% dari rumus.",
  },
  {
    q: "Bisa dipakai di iPhone?",
    a: "Bisa lewat browser. JoyoRogo jalan di web untuk HP dan laptop. Aplikasi Android tersedia sebagai APK dan bisa membaca langkah, olahraga, dan tidur dari Health Connect.",
  },
  {
    q: "Apakah JoyoRogo open source?",
    a: "Ya. Kodenya terbuka di GitHub dengan lisensi AGPL-3.0. Mau server sendiri untuk keluarga, klinik, atau gym? Deploy lewat CloudAgni, atau jalankan di akun Cloudflare-mu.",
  },
] as const;

/** TanStack Router `head` for a public page; descriptions stay in the static HTML. */
export function pageHead(path: PublicPath) {
  return { meta: [{ title: PAGES[path].title }] };
}
