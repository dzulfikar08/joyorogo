// Copy for the Malaysian landing (/my), Bahasa Melayu as written in Malaysia. Plain data on purpose: blog/pages.ts
// imports it at build time (FAQ structured data, no-JS fallback), so nothing here may touch React or the DOM.
// Facts mirror the Indonesian landing (routes/index.tsx); prices and quotas are never typed here, they come from
// /api/config (see components/landing/my-pricing.tsx).

import { CONTACT_EMAIL, WHATSAPP_DISPLAY, WHATSAPP_MESSAGE_MS, whatsappUrl } from "./contact.ts";

/** Static FAQ: also the FAQPage structured data on /my. Config-dependent answers live in my-pricing.tsx. */
export const FAQ_MS = [
  {
    q: "Apa beza kcal dengan kalori?",
    a: "Dalam amalan tiada beza. Kalori yang disebut dalam diet dan pada label makanan ialah kilokalori, ditulis kcal. JoyoRogo menulis kcal supaya sama dengan label di Malaysia.",
  },
  {
    q: "Adakah hidangan tempatan dikenali, dan dari mana angka kcalnya?",
    a: "Apabila aplikasi dalam Bahasa Melayu atau anda berada di Malaysia, aplikasi memberitahu AI cara mengira hidangan kedai mamak dan gerai seperti nasi lemak, roti canai, teh tarik, mee goreng mamak, char kuey teow, nasi kandar, laksa, satay dan kuih. Nilai kcal kemudian dicari dahulu dalam jadual hidangan yang dibina daripada pangkalan data SG FoodID Health Promotion Board (HPB) Singapura, yang mengukur banyak hidangan Malaysia seperti dijual di Singapura, kemudian dalam TKPI 2019 (Indonesia). Tidak semua hidangan ada dalam jadual dan AI boleh tersilap, jadi hasilnya anggaran. Sebelum menyimpan, anda boleh menukar saiz hidangan, memadam item yang salah atau menambah yang tertinggal.",
  },
  {
    q: "Hasil imbasan salah, boleh dibetulkan?",
    a: 'Boleh. Di hasil imbasan, taip pembetulannya, contohnya "nasi separuh sahaja" atau "cuma 2" untuk makanan yang dikira per keping. Senarai dikemas kini dan pembetulan boleh dibatalkan. Produk berbungkus yang belum berdaftar? Foto jadual maklumat pemakanan pada bungkusnya, angkanya dibaca automatik dan anda semak dahulu sebelum menyimpan.',
  },
  {
    q: "Adakah foto saya disimpan?",
    a: "Tidak. Foto hanya digunakan untuk analisis lalu dibuang. Yang disimpan hanyalah nama makanan dan angka yang anda sahkan, dan semuanya boleh anda padam dari halaman Profil.",
  },
  {
    q: "Adakah JoyoRogo mensijilkan atau melabel makanan sebagai halal?",
    a: "Tidak. JoyoRogo hanya menganggar kalori dan zat makanan. Ia tidak menyemak, mensijilkan atau melabel status halal sesuatu hidangan atau produk. Untuk status halal, rujuk pensijilan rasmi di premis atau pada bungkusan.",
  },
  {
    q: "Bagaimana dengan privasi dan PDPA?",
    a: "Janji privasinya: foto dibuang selepas dianalisis, tiada iklan, dan satu butang memadam semua data anda. Notis privasi dalam Bahasa Melayu dan English ada di halaman Privasi (/my/privasi dan /my/privacy). Ia ditulis dengan Akta Perlindungan Data Peribadi 2010 (PDPA) di fikiran: pengawal data, tujuan, data sensitif dan persetujuan, pemproses, pemindahan merentas sempadan, hak anda dan cara membuat aduan. Halaman ini tidak mendakwa pematuhan penuh PDPA dan bukan nasihat undang-undang.",
  },
  {
    q: "Telefon apa yang boleh digunakan?",
    a: "Android 8 ke atas melalui Google Play. iPhone dengan iOS 16.4 ke atas melalui App Store. Atau buka joyorogo.com di pelayar dan pilih Tambah ke Skrin Utama: JoyoRogo muncul sebagai ikon dan dibuka skrin penuh, dengan akaun dan data yang sama.",
  },
  {
    q: "Adakah aplikasinya dalam Bahasa Melayu?",
    a: "Ada, tetapi terjemahannya masih draf terjemahan mesin yang belum disemak penutur asli, jadi ada ayat yang mungkin kedengaran janggal. Laman ini, Privasi dan Syarat ditulis dalam Bahasa Melayu untuk pembaca Malaysia (Privacy dan Terms ada juga dalam English). Blog masih dalam Bahasa Indonesia.",
  },
  {
    q: "Adakah ini nasihat perubatan?",
    a: "Bukan. Kalori dan sasaran harian ialah anggaran, bukan pengganti nasihat doktor atau pakar pemakanan. JoyoRogo tidak sesuai untuk sesiapa yang mempunyai sejarah gangguan pemakanan, yang berumur di bawah 18 tahun atau yang memerlukan diet di bawah penyeliaan perubatan.",
  },
  {
    q: "Adakah JoyoRogo sumber terbuka?",
    a: "Ya. Kodnya terbuka di GitHub dengan lesen AGPL-3.0: cara kalori dikira, data yang digunakan, sampai apa yang disimpan daripada foto anda. Ada yang salah? Buka isu atau hantar pembetulan.",
  },
] as const;

export const FEATURE_LIST_MS = [
  "Foto makanan dianalisis AI dan kalorinya dianggar",
  "Ceritakan makanan melalui teks",
  "Tiga angka harian: boleh makan, perlu bakar, perlu tidur",
  "Langkah, senaman dan tidur daripada Health Connect dan Apple Health",
  "Hasil imbasan boleh disunting sebelum disimpan",
  "Foto asal tidak disimpan kecuali pengguna memilih menyimpannya",
] as const;

/** No-JS content for /my (blog/pages.ts pageFallback): headings and paragraphs only. */
export const FALLBACK_MS = {
  paragraphs: [
    "JoyoRogo menganggar kalori setiap item di atas pinggan anda daripada sekeping foto, dari nasi lemak dan roti canai sampai teh tarik. Anda boleh menyunting hasilnya sebelum menyimpan, dan foto tidak disimpan.",
    "Setiap hari ada tiga angka: berapa kcal boleh dimakan, berapa kcal perlu dibakar, dan berapa jam tidur diperlukan.",
    "Halaman ini memerlukan JavaScript untuk memaparkan contoh imbasan, harga dan soalan lazim penuh.",
  ],
  links: [
    { href: "/", label: "Bahasa Indonesia" },
    { href: "/blog/", label: "Blog (Bahasa Indonesia)" },
    { href: "/my/privasi", label: "Privasi" },
    { href: "/my/privacy", label: "Privacy notice (English)" },
    { href: "/my/syarat", label: "Syarat" },
    { href: `mailto:${CONTACT_EMAIL}`, label: "E-mel" },
    { href: whatsappUrl(WHATSAPP_MESSAGE_MS), label: `WhatsApp ${WHATSAPP_DISPLAY}` },
  ],
} as const;

/** The three daily numbers, as on the Indonesian landing. The figures are the landing's own illustration. */
export const TIGA_ANGKA = [
  {
    metric: "makan",
    value: 1240,
    max: 1650,
    center: "1,650",
    unit: "kcal",
    title: "Boleh makan",
    body: "Keperluan harian anda (BMR didarab pengali tahap aktiviti yang anda pilih) ditolak defisit yang sesuai untuk sasaran berat dan tarikh anda. Data jam tangan atau telefon hanya menambah jatah, tidak pernah mengurangkannya.",
  },
  {
    metric: "bakar",
    value: 120,
    max: 300,
    center: "300",
    unit: "kcal",
    title: "Perlu bakar",
    body: "Daripada langkah dan senaman. Di Android dibaca automatik daripada Health Connect, di iPhone daripada Apple Health. Catatan manual juga boleh.",
  },
  {
    metric: "tidur",
    value: 7.5,
    max: 8,
    center: "8",
    unit: "jam",
    title: "Perlu tidur",
    body: "Sasaran jam tidur setiap malam. Tempoh tidur anda turut dibaca daripada Health Connect di Android atau Apple Health di iPhone.",
  },
] as const;

/** How the scan counts a Malaysian plate: what the region prompt tells the AI (packages/api/src/lib/region-prompt.ts). */
export const CARA_KIRA = [
  {
    dish: "Nasi lemak",
    rule: "Bungkus daun pisang atau pinggan, nasi lemak dengan sambal, telur, ikan bilis dan kacang dikira satu item. Ayam goreng, rendang atau sambal sotong di sebelahnya jadi item sendiri.",
  },
  {
    dish: "Nasi kandar",
    rule: "Nasi putih satu item, setiap lauk item sendiri, dan kuah campur ikut lauknya.",
  },
  {
    dish: "Roti canai",
    rule: "Satu keping satu item. Kuah dal atau kari berasingan. Roti telur, roti bom, roti tisu dan murtabak juga dikira per keping.",
  },
  {
    dish: "Satay",
    rule: "Dikira per cucuk, dan kuah kacang jadi item sendiri.",
  },
  {
    dish: "Mee goreng mamak, char kuey teow, laksa",
    rule: "Satu pinggan atau satu mangkuk dikira satu item.",
  },
  {
    dish: "Kuih",
    rule: "Dikira per biji.",
  },
  {
    dish: "Teh tarik, kopi, Milo ais",
    rule: 'Susu pekat dan gula sudah termasuk dalam kcal minuman. "Kurang manis" mengurangkan gula, "kosong" bermaksud tanpa gula dan tanpa susu.',
  },
] as const;

export const CERITA_CONTOH = "tadi makan nasi lemak telur dengan teh tarik";

/** Privacy promises, the Indonesian landing's PROMISES in Malay. Icons are chosen in the component. */
export const JANJI = [
  {
    key: "foto",
    title: "Foto tidak disimpan",
    body: "Foto dianalisis lalu dibuang. Disimpan hanya jika anda yang memilihnya.",
  },
  {
    key: "iklan",
    title: "Tiada iklan",
    body: "Tiada iklan dan tiada suapan tanpa penghujung. Catat, tutup, hidup anda diteruskan.",
  },
  {
    key: "padam",
    title: "Padam bila-bila masa",
    body: "Satu butang di halaman Profil memadam semua data anda, kekal.",
  },
] as const;

export const ANDROID_LANGKAH = [
  "Buka JoyoRogo di Google Play pada telefon Android anda (Android 8 ke atas).",
  "Ketik Pasang. Percuma dimuat turun.",
  "Buka JoyoRogo dan log masuk dengan akaun yang sama seperti di web. Diari anda turut berpindah.",
] as const;

export const IOS_LANGKAH = [
  "Buka JoyoRogo di App Store pada iPhone anda.",
  "Ketik Dapatkan untuk memasangnya. Percuma dimuat turun.",
  "Buka JoyoRogo, kemudian log masuk dengan akaun yang sama seperti di web. Diari anda turut berpindah. Di iPhone, JoyoRogo membaca Apple Health.",
] as const;
