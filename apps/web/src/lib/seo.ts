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

export type PublicPath =
  | "/"
  | "/harga"
  | "/privasi"
  | "/syarat"
  | "/pengembalian-dana"
  | "/panduan/ai"
  | "/panduan/kalori"
  | "/koneksi/izin"
  | "/login"
  | "/pembayaran"
  | "/gabung"
  | "/u"
  | "/p";

export type PageMeta = {
  title: string;
  description: string;
  /** Share-card headline when it should differ from the search title. */
  ogTitle?: string;
  /** Transactional pages: keep out of search results. */
  noindex?: boolean;
  /** YYYY-MM-DD, written to the sitemap's lastmod; bump when the page's content changes. */
  lastmod?: string;
};

export const PAGES: Record<PublicPath, PageMeta> = {
  "/": {
    title: "JoyoRogo: Hitung Kalori dari Foto Makanan Indonesia",
    ogTitle: "JoyoRogo: Diet yang Paham Porsi Warteg",
    description:
      "Foto piringmu, AI menghitung kalorinya dalam beberapa detik. Tiap hari tahu berapa boleh makan, harus bakar, dan butuh tidur. Gratis, foto tidak disimpan.",
    lastmod: "2026-10-18",
  },
  "/harga": {
    title: "Harga | JoyoRogo",
    description:
      "Diary makan, olahraga, berat, dan tidur gratis selamanya, dengan jatah foto AI harian. Pro menambah jatah foto AI harian dan mendukung JoyoRogo.",
  },
  "/privasi": {
    title: "Privasi | JoyoRogo",
    description:
      "Data apa yang JoyoRogo simpan dan untuk apa. Foto makanan hanya dipakai untuk analisis lalu dibuang, data tidak dijual, dan semuanya bisa kamu hapus.",
    lastmod: "2026-10-18",
  },
  "/syarat": {
    title: "Syarat Layanan | JoyoRogo",
    description:
      "Syarat memakai JoyoRogo: akun, paket Pro, pembayaran rupiah di web, dan pembelian dolar AS lewat Polar (USD purchases).",
    lastmod: "2026-10-18",
  },
  "/pengembalian-dana": {
    title: "Pengembalian Dana | JoyoRogo",
    description:
      "Kebijakan pengembalian dana JoyoRogo Pro: pembayaran rupiah di web, pembelian toko aplikasi, dan pembelian dolar AS lewat Polar (USD purchases).",
    lastmod: "2026-10-18",
  },
  "/panduan/ai": {
    title: "Pakai Claude/ChatGPT dengan Data JoyoRogo | JoyoRogo",
    description:
      "Tanya Claude atau ChatGPT soal catatan makan, latihan, berat, dan tidurmu sendiri. Hanya membaca, butuh JoyoRogo Pro. Langkah penyambungan dan privasinya.",
    lastmod: "2026-10-18",
  },
  "/panduan/kalori": {
    title: "Cara Menghitung Target Makan: BMR, TDEE, Level Aktivitas | JoyoRogo",
    description:
      "Target makan JoyoRogo = BMR dikali pengali level aktivitasmu, dikurangi defisit. Penjelasan lima level, kenapa data jam atau HP hanya menambah, contoh hitungan, dan sumbernya.",
    lastmod: "2026-10-19",
  },
  "/koneksi/izin": {
    title: "Izinkan Akses | JoyoRogo",
    description: "Izinkan atau tolak akses aplikasi AI ke datamu di JoyoRogo.",
    noindex: true,
  },
  "/login": {
    title: "Masuk | JoyoRogo",
    description:
      "Masuk ke JoyoRogo dengan akun Google. Isi tinggi, berat, dan target, lalu angka harianmu muncul hari ini juga.",
  },
  "/pembayaran": {
    title: "Pembayaran | JoyoRogo",
    description: "Status pembayaran Pro JoyoRogo.",
    noindex: true,
  },
  // Capability invite links: one per group code, kept out of search results.
  "/gabung": {
    title: "Gabung Grup | JoyoRogo",
    description:
      "Kamu diundang ke grup JoyoRogo. Pantau kalori bareng, colek yang malas catat, dan intip perut lewat VAR.",
    noindex: true,
  },
  // Profil publik /u/<handle> dan postingan publik /p/<id>; detail dinamis
  // mengganti judulnya lewat meta di rutenya.
  "/u": {
    title: "Profil JoyoRogo",
    description:
      "Perjalanan menurunkan berat badan pengguna JoyoRogo: progres berat, makanan, dan latihan yang dibagikan.",
  },
  "/p": {
    title: "Postingan JoyoRogo",
    description:
      "Satu momen sehat dari pengguna JoyoRogo: makanan, latihan, atau progres berat yang dibagikan ke feed.",
  },
};

/** The landing renders an "install" button under this answer. */
export const IPHONE_FAQ_Q = "Ada versi iPhone?";

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
    q: "Hasil scan salah, bisa dikoreksi?",
    a: "Bisa. Di hasil scan, ketik atau ucapkan koreksinya, misalnya \"nasinya setengah aja\", \"itu rolade bukan perkedel\", atau \"cuma 2\" untuk makanan yang dihitung per potong. Daftar makanan diperbarui, dan koreksinya bisa diurungkan. Barcode produk yang belum terdaftar? Foto tabel Informasi Nilai Gizi di kemasannya, angkanya dibaca otomatis dan kamu cek dulu sebelum disimpan.",
  },
  {
    q: "Bagaimana target kalori dihitung?",
    a: "Dari usia, jenis kelamin, tinggi, berat, dan tingkat aktivitasmu (rumus Mifflin-St Jeor), lalu dikurangi defisit sesuai target berat dan tanggal yang kamu pilih. Kalau catatan makan dan timbanganmu cukup, target menyesuaikan pembakaran nyatamu, dibatasi 15% dari rumus.",
  },
  {
    q: IPHONE_FAQ_Q,
    a: "Ada. Aplikasi iPhone-nya sudah bisa dicoba lewat TestFlight (beta publik), dan versi App Store 1.0 sedang menunggu review Apple. Aplikasinya membaca Apple Health. Kalau mau yang langsung, buka joyorogo.com di Safari, tap Bagikan, lalu Tambah ke Layar Utama: JoyoRogo muncul sebagai ikon dan terbuka layar penuh, dengan akun dan data yang sama seperti di Android dan laptop. Notifikasi pengingat di versi web iPhone butuh iOS 16.4 ke atas.",
  },
  {
    q: "Latihan beban dicatat di mana?",
    a: "Di JoyoFit, aplikasi pendamping JoyoRogo: pencatat beban ala Hevy, rencana lari dan beban, pelatih harian, dan latihan dari jam tangan. JoyoRogo membaca hasilnya untuk angka bakar. Log beban lama di JoyoRogo tetap bisa dibaca.",
  },
  {
    q: "Bisa dipakai bersama Claude atau ChatGPT?",
    a: "Bisa, untuk pengguna Pro. Sambungkan lewat Koneksi AI di Profil, lalu tanyakan datamu sendiri: catatan makan, berat, latihan, dan tidur. Sifatnya hanya baca dan bisa kamu cabut kapan saja. Langkahnya ada di joyorogo.com/panduan/ai.",
  },
  {
    q: "Apakah ada mode untuk naik berat atau hamil?",
    a: "Ada dua. Naikin BB menghitung target makan sebagai kebutuhan harian ditambah surplus kecil. Hamil dan Menyusui tanpa defisit, dengan target menurut AKG 2019 dan pita kenaikan berat dari IOM. Keduanya perkiraan, bukan pengganti saran dokter atau ahli gizi.",
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
