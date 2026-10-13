/**
 * Tips nutrisi & fat-loss berbasis bukti. Konten statis dan sudah direview:
 * TIDAK ADA klaim kesehatan yang digenerate saat runtime. Dipakai bersama
 * oleh web (kartu feed, Beranda, dan halaman statis /blog/<slug> lewat
 * apps/web/blog/render.ts) dan native (kartu feed, Beranda, layar artikel).
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

export type Tip = {
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

const JEREMY_ETHIER = {
  label: "Gagasan di artikel ini terinspirasi video Jeremy Ethier (Built with Science)",
  url: "https://www.youtube.com/@JeremyEthier",
} as const;

export const TIPS: Tip[] = [
  {
    slug: "kenyang-dengan-porsi-banyak",
    image: {
      alt: "Mangkuk sup sayur bening dengan kuah jernih",
      credit: { author: null, page: "https://www.rawpixel.com/image/5924545/photo-image-public-domain-food-water", source: "Rawpixel" },
    },
    figure: {
      src: "kenyang-dengan-porsi-banyak-fig1.webp",
      alt: "Diagram batang kalori per 100 gram: bayam rebus 23, semangka 28, pepaya 46, nasi 180, kerupuk udang goreng 477 kkal.",
      caption: "Sayur dan buah berair mengenyangkan dengan kalori jauh lebih kecil daripada camilan padat. Sumber angka: TKPI 2019.",
    },
    title: "Kenyang dengan porsi banyak: trik volume eating",
    summary:
      "Porsi besar tanpa kalori besar: isi piring dengan makanan bervolume tinggi supaya defisit kalori tidak terasa seperti kelaparan.",
    icon: "salad",
    date: "2026-10-13",
    sections: [
      {
        heading: "Kalori rendah, volumenya besar",
        paragraphs: [
          "Dua mangkuk sayur bening bisa lebih sedikit kalorinya daripada segenggam kerupuk, tapi perut terasa sama penuhnya. Itu inti volume eating: pilih makanan yang banyak air dan seratnya, sehingga berat porsinya besar tapi kandungan kalorinya rendah.",
          "Ujiannya panjang. Dalam uji setahun di Penn State, kelompok yang diajari menekan kepadatan kalori makanannya (lebih banyak sayur dan buah, bukan sekadar memotong porsi) menurunkan berat badan lebih banyak dibanding kelompok yang hanya dilarang lemak. Rasa kenyangnya lebih terjaga karena jumlah makanan yang masuk tetap banyak.",
        ],
      },
      {
        heading: "Cocok dengan makanan Indonesia",
        paragraphs: [
          "Sayur bening, sop kuah bening, tumis sayur minim minyak, semangka, melon, pepaya, dan jambu biji adalah bahan bervolume tinggi. Putih telur rebus dan ayam tanpa kulit menambah protein tanpa banyak kalori. Buat ngemil, 20 gram popcorn polos sekitar 75 kkal.",
          "Yang jebakan justru pelunaknya: santan, minyak, kerupuk, dan bumbu kacang mengubah sayur berkalori rendah jadi tinggi kalori dalam sekejap. Sambal segar dan kuah bening aman; lodeh dan gado-gado berbumbu kacang tebal tidak.",
        ],
      },
    ],
    cobaIni: [
      "Mulai makan dengan satu mangkuk sayur bening atau sop.",
      "Isi setengah piring dengan sayur sebelum menambah nasi.",
      "Sedia buah berair (semangka, melon, pepaya) di kulkas untuk ngemil.",
      "Ganti camilan goreng dengan popcorn polos atau buah.",
      "Kurangi santan dan minyak di lauk sayur, bukan sayurnya.",
    ],
    sources: [
      {
        title: "Ello-Martin dkk. (2007), uji setahun kepadatan kalori, Am J Clin Nutr",
        url: "https://pubmed.ncbi.nlm.nih.gov/17556681/",
      },
    ],
    credit: JEREMY_ETHIER,
  },
  {
    slug: "protein-kenyang-jaga-otot",
    image: {
      alt: "Telur rebus tersusun di nampan",
      credit: { author: "Gary Lee Todd, Ph.D.", page: "https://www.flickr.com/photos/101561334@N08/34294440021", source: "Flickr" },
    },
    figure: {
      src: "protein-kenyang-jaga-otot-fig1.webp",
      alt: "Diagram batang protein per 100 gram: putih telur 10,8 g, tahu 10,9 g, telur ayam ras 12,4 g, ayam 18,2 g, tempe kedelai 20,8 g.",
      caption: "Protein cukup dapat dari bahan pasar: telur, tahu, tempe, dan ayam. Sumber angka: TKPI 2019.",
    },
    title: "Protein: kenyang lebih lama, otot tetap terjaga",
    summary:
      "Protein paling mengenyangkan di antara makronutrien dan membantu memastikan berat yang turun berasal dari lemak, bukan otot.",
    icon: "egg",
    date: "2026-10-13",
    sections: [
      {
        heading: "Kenapa protein juara saat diet",
        paragraphs: [
          "Di antara karbohidrat, lemak, dan protein, protein paling membuat kenyang. Review di American Journal of Clinical Nutrition menyimpulkan protein menambah rasa kenyang dan membantu pengelolaan berat badan. Praktisnya: sarapan telur membuat betah sampai siang, sementara makan manis-minyakan pagi hari sering bikin laper lagi jam 10.",
        ],
      },
      {
        heading: "Pelindung otot saat berat turun",
        paragraphs: [
          "Saat defisit kalori, tubuh bisa membakar otot juga. Pada atlet yang defisit, asupan protein sekitar 2,3 g per kg berat badan per hari mempertahankan massa otot, sementara protein rendah tidak. Studi lain yang lebih drastis menemukan protein 2,4 g/kg plus latihan beban membuat hampir semua penurunan berat berasal dari lemak.",
          "Rentang yang sering dipakai peneliti saat diet adalah sekitar 1,6-2,4 g per kg berat badan per hari. Untuk berat 70 kg, itu sekitar 112-168 g protein.",
        ],
      },
      {
        heading: "Sumbernya tidak harus mahal",
        paragraphs: [
          "Telur, ayam, ikan kembung, tempe, tahu, dan putih telur semuanya sah. Bakso juga masuk, tapi hitung kuah, saus, dan porsinya. Yang mengubah angka justru cara masak: rebus dan kukus menjaga protein tetap rendah kalori, digoreng tebal minyak tidak.",
        ],
      },
    ],
    cobaIni: [
      "Masukkan sumber protein di setiap makan besar, bukan cuma makan malam.",
      "Telur rebus atau tempe kukus sebagai camilan protein.",
      "Target kasar: sekitar 1,6-2,4 g protein per kg berat badan per hari.",
      "Pilih rebus, kukus, atau panggang daripada goreng tebal.",
    ],
    sources: [
      {
        title: "Paddon-Jones dkk. (2008), protein, pengelolaan berat, dan kenyang",
        url: "https://pubmed.ncbi.nlm.nih.gov/18469287/",
      },
      {
        title: "Mettler dkk. (2009), protein tinggi menjaga massa otot saat defisit",
        url: "https://pubmed.ncbi.nlm.nih.gov/19927027/",
      },
      {
        title: "Longland dkk. (2016), protein 2,4 g/kg + latihan beban saat defisit",
        url: "https://pubmed.ncbi.nlm.nih.gov/26817506/",
      },
    ],
    credit: JEREMY_ETHIER,
  },
  {
    slug: "protein-dibagi-empat-momen",
    image: {
      alt: "Potongan tempe goreng dari dekat",
      credit: { author: "ProjectManhattan", page: "https://commons.wikimedia.org/w/index.php?curid=29619858", source: "Wikimedia Commons" },
    },
    figure: {
      src: "protein-dibagi-empat-momen-fig1.webp",
      alt: "Diagram batang bertumpuk: pola merata 30-30-30-30 gram berbanding pola timpang 10-15-20-65 gram dengan total sama.",
      caption: "Total protein sama, tapi distribusi merata lebih merangsang sintesis protein otot (Mamerow dkk., 2014).",
    },
    title: "Bagi protein ke beberapa momen makan",
    summary:
      "Protein yang dibagi rata ke 3-4 makan lebih baik merangsang pemeliharaan otot daripada ditumpuk semua di makan malam.",
    icon: "beef",
    date: "2026-10-13",
    sections: [
      {
        heading: "Masalah pola timpang",
        paragraphs: [
          "Banyak orang hemat protein di pagi hari lalu membayarnya penuh di malam. Studi di Journal of Nutrition menemukan pola merata (sekitar 30 g di tiap makan) merangsang sintesis protein otot 24 jam lebih tinggi daripada pola timpang (10 g pagi, 65 g malam), padahal total proteinnya sama.",
        ],
      },
      {
        heading: "Sarapan protein juga menekan ngemil",
        paragraphs: [
          "Pada remaja yang biasa skip sarapan, sarapan tinggi protein (35 g) meningkatkan rasa kenyang dan menurunkan keinginan mengemil di malam hari dibanding sarapan protein normal. Ngemil malam yang tidak rencanakan itu sering sumber kalori terbesar.",
        ],
      },
    ],
    cobaIni: [
      "Sarapan: telur + susu, atau tahu/tempe sisa masakan kemarin.",
      "Siapkan putih telur rebus atau ayam suwir di kulkas.",
      "Kalau makannya sederhana, tambahkan satu telur rebus.",
      "Usahakan tiap makan besar punya ±25-40 g protein.",
    ],
    sources: [
      {
        title: "Mamerow dkk. (2014), distribusi protein dan sintesis otot 24 jam",
        url: "https://pubmed.ncbi.nlm.nih.gov/24477298/",
      },
      {
        title: "Leidy dkk. (2013), sarapan tinggi protein dan ngemil malam",
        url: "https://pubmed.ncbi.nlm.nih.gov/23446906/",
      },
    ],
  },
  {
    slug: "serat-kenyang-lama",
    image: {
      alt: "Stal sayur dan buah di pasar",
      credit: { author: "Kojotisko", page: "https://www.flickr.com/photos/98796230@N03/14167598168", source: "Flickr" },
    },
    figure: {
      src: "serat-kenyang-lama-fig1.webp",
      alt: "Panel statistik: tambahan sekitar 14 gram serat per hari dikaitkan dengan penurunan asupan energi sekitar 10 persen; contoh kandungan serat bayam, jambu biji, dan kacang hijau.",
      caption: "Tambahan serat sederhana sudah menggeser asupan. Sumber serat: TKPI 2019; efek: Howarth dkk. (2001).",
    },
    title: "Serat: murah, mengenyangkan, dan sering kurang",
    summary:
      "Serat memperlambat pencernaan dan memperpanjang rasa kenyang; tambahan sekitar 14 g per hari dikaitkan dengan asupan kalori yang turun.",
    icon: "wheat",
    date: "2026-10-13",
    sections: [
      {
        heading: "Cara kerjanya",
        paragraphs: [
          "Serat membuat makanan lebih lama dicerna dan volume di lambung bertahan lebih lama. Review di Nutrition Reviews memperkirakan tambahan sekitar 14 g serat per hari dikaitkan dengan penurunan asupan energi sekitar 10% dan penurunan berat badan, tanpa diet rumit lainnya.",
        ],
      },
      {
        heading: "Sumber lokal yang masuk akal",
        paragraphs: [
          "Sayur seperti bayam, kangkung, dan kacang panjang; buah seperti pepaya, jambu biji, dan pisang; kacang hijau rebus; oat; nasi merah. Sayur bening di dua makan plus dua buah sudah mendekati separuh kebutuhan harian yang umum disarankan (sekitar 25-30 g).",
          "Satu catatan: kacang tanah dan jembutnya enak tapi padat kalori. Seratnya bagus, porsinya yang dijaga.",
        ],
      },
    ],
    cobaIni: [
      "Sayur di setiap makan, bukan cuma di makan malam.",
      "Buah utuh daripada jus: seratnya utuh, kenyang lebih lama.",
      "Tukar sebagian nasi putih dengan nasi merah atau oat.",
      "Kacang hijau rebus sebagai camilan, jangan digoreng.",
    ],
    sources: [
      {
        title: "Howarth dkk. (2001), serat dan regulasi berat badan, Nutrition Reviews",
        url: "https://pubmed.ncbi.nlm.nih.gov/11396693/",
      },
    ],
  },
  {
    slug: "segelas-air-sebelum-makan",
    image: {
      alt: "Segelas air putih di atas meja",
      credit: { author: "Kurt Kaiser", page: "https://commons.wikimedia.org/w/index.php?curid=105399729", source: "Wikimedia Commons" },
    },
    figure: {
      src: "segelas-air-sebelum-makan-fig1.webp",
      alt: "Diagram batang: kelompok defisit dengan 500 ml air sebelum makan menurunkan berat 44 persen lebih banyak dalam 12 minggu.",
      caption: "Penurunan berat 44% lebih banyak dengan preload air (Dennis dkk., 2010; dewasa paruh baya-lansia).",
    },
    title: "Segelas air sebelum makan bantu porsi menyusut",
    summary:
      "RCT: 500 ml air sebelum tiap makan utama menghasilkan penurunan berat 44% lebih banyak dalam 12 minggu, pada dewasa paruh baya ke atas.",
    icon: "droplets",
    date: "2026-10-13",
    sections: [
      {
        heading: "Buktinya",
        paragraphs: [
          "Dalam uji acak terkontrol (Obesity, 2010), orang dewasa paruh baya dan lansia yang sedang defisit kalori dan minum 500 ml air sebelum tiga makan utama menurunkan berat badan 44% lebih banyak dalam 12 minggu dibanding yang defisit saja. Logikanya sederhana: lambung terisi sebagian sebelum makan, porsi ikut menyusut.",
        ],
      },
      {
        heading: "Catatan jujurnya",
        paragraphs: [
          "Peserta uji itu berusia 55-75 tahun; pada orang muda buktinya tidak sekuat itu. Air juga bukan pembakar lemak, efeknya murni lewat porsi. Tapi dari semua 'trik' diet, ini yang paling murah dan paling tanpa risiko.",
        ],
      },
    ],
    cobaIni: [
      "Minum 500 ml air 20-30 menit sebelum makan besar.",
      "Sediakan botol di meja makan supaya teringat.",
      "Ganti es teh manis di waktu makan dengan air putih atau es tawar.",
    ],
    sources: [
      {
        title: "Dennis dkk. (2010), preload air 500 ml sebelum makan, Obesity",
        url: "https://pubmed.ncbi.nlm.nih.gov/19661958/",
      },
    ],
  },
  {
    slug: "air-berkarbonasi-fakta",
    image: {
      alt: "Air berkarbonasi dengan irisan lemon",
      credit: { author: null, page: "https://www.rawpixel.com/image/5912059/image-public-domain-fruit-food", source: "Rawpixel" },
    },
    figure: {
      src: "air-berkarbonasi-fakta-fig1.webp",
      alt: "Diagram batang: es teh manis 60-100 kkal per gelas berbanding soda tanpa gula 0 kkal.",
      caption: "Soda polos menang karena nol kalori, bukan karena gasnya (es teh: takaran gula umum; bukti karbonasi: Eweis 2017, Harper 2007).",
    },
    title: "Air soda tanpa gula bantu diet? Jawaban jujurnya",
    summary:
      "Karbonasi bisa memberi rasa kenyang sesaat, tapi bukti soal penurunan berat masih tipis; nilai terbesarnya sebagai pengganti minuman manis.",
    icon: "glass-water",
    date: "2026-10-13",
    sections: [
      {
        heading: "Apa kata riset",
        paragraphs: [
          "Banyak orang merasa soda tanpa gula menahan keinginan ngemil. Tapi buktinya campur aduk. Studi pada tikus menemukan gas CO2 minuman berkarbonasi meningkatkan hormon ghrelin dan makan mereka. Pada manusia, perbandingan minuman berkarbonasi dengan minuman lain tidak menemukan pengurangan makan berikutnya. Belum ada bukti kuat bahwa air berkarbonasi sendiri menurunkan berat badan.",
        ],
      },
      {
        heading: "Di mana nilainya",
        paragraphs: [
          "Sebagai pengganti es teh manis atau soda manis, pilihannya jelas: nol kalori versus puluhan sampai ratusan kkal. Itu manfaat utamanya, bukan efek ajaib gasnya. Anggap ini jembatan, bukan tujuan akhir.",
        ],
      },
    ],
    cobaIni: [
      "Soda polos atau soda tanpa gula sebagai jembatan dari minuman manis.",
      "Peras jeruk nipis untuk rasa tanpa kalori.",
      "Jangan jadikan 'aku udah minum soda diet' alasan ngemil lebih.",
    ],
    sources: [
      {
        title: "Eweis dkk. (2017), CO2 berkarbonasi, ghrelin, dan makan (studi hewan)",
        url: "https://pubmed.ncbi.nlm.nih.gov/28228348/",
      },
      {
        title:
          "Harper dkk. (2007), kenyang sesaat minuman berkarbonasi, tanpa efek makan berikutnya",
        url: "https://pubmed.ncbi.nlm.nih.gov/17313721/",
      },
    ],
  },
  {
    slug: "makan-pelan-kenyang-cepat",
    image: {
      alt: "Piring nasi campur dengan lauk pauk",
      credit: { author: "The Bangsawan", page: "https://commons.wikimedia.org/w/index.php?curid=154805235", source: "Wikimedia Commons" },
    },
    figure: {
      src: "makan-pelan-kenyang-cepat-fig1.webp",
      alt: "Garis waktu 20 menit: sinyal kenyang baru tiba di otak sekitar menit kedua puluh sejak suapan pertama.",
      caption: "Kenyang butuh waktu; makan terburu-buru selesai sebelum sinyalnya tiba (±20 menit; Zhu & Hollis, 2014).",
    },
    title: "Makan pelan: kenyang datang sebelum porsi habis",
    summary:
      "Sinyal kenyang butuh waktu sekitar 20 menit; mengunyah lebih banyak terbukti mengecilkan porsi makan.",
    icon: "timer",
    date: "2026-10-13",
    sections: [
      {
        heading: "Sinyal kenyang itu lambat",
        paragraphs: [
          "Butuh sekitar 20 menit sebelum sinyal kenyang dari lambung dan hormon benar-benar sampai ke otak. Makan lima menit selesai sering habis sebelum sinyal itu muncul, jadi porsi jadi lebih besar dari yang dibutuhkan. Studi pada orang kurus, gemuk, dan obesitas menemukan menambah jumlah kunyah sebelum menelan mengurangi porsi makan di ketiga kelompok.",
        ],
      },
      {
        heading: "Kalau biasanya makan buru-buru",
        paragraphs: [
          "Bakso yang habis dalam lima menit itu biasa. Yang membantu bukan menghitung kunyah, tapi menambah gesekan kecil: duduk di meja, taruh sendok di antara suapan, minum di tengah makan, dan beri jeda lima menit sebelum menambah nasi. Kalau masih lapar setelah jeda itu, tambah sayur atau kuah, bukan nasi lagi.",
        ],
      },
    ],
    cobaIni: [
      "Letakkan sendok setiap selesai suapan.",
      "Target sederhana: makan besar minimal 15-20 menit.",
      "Minum air di tengah makan.",
      "Jeda lima menit sebelum menambah nasi kedua.",
    ],
    sources: [
      {
        title: "Zhu & Hollis (2014), jumlah kunyah dan ukuran porsi makan",
        url: "https://pubmed.ncbi.nlm.nih.gov/24215801/",
      },
    ],
  },
  {
    slug: "makanan-ultra-proses",
    image: {
      alt: "Blok mi instan mentah di kemasan",
      credit: { author: "Ninosan", page: "https://commons.wikimedia.org/w/index.php?curid=64565250", source: "Wikimedia Commons" },
    },
    figure: {
      src: "makanan-ultra-proses-fig1.webp",
      alt: "Diagram batang studi Hall 2019: menu ultra-proses menambah asupan sekitar 500 kkal per hari dan berat naik 0,9 kg; menu minim proses berat turun 0,9 kg.",
      caption: "Menu ultra-proses membuat peserta makan ±500 kkal lebih banyak per hari (Hall dkk., 2019).",
    },
    title: "Kenapa makanan kemasan bikin kalori bocor",
    summary:
      "RCT di ward metabolik NIH: menu ultra-proses membuat peserta makan sekitar 500 kkal lebih banyak per hari dan naik berat dalam dua minggu.",
    icon: "package",
    date: "2026-10-13",
    sections: [
      {
        heading: "Percobaan yang jadi omongan",
        paragraphs: [
          "Kevin Hall dkk. (2019) mengunci 20 dewasa di ward metabolik selama sebulan. Dua minggu mereka diberi menu ultra-proses, dua minggu menu minim proses; kedua menu sengaja dicocokkan komposisinya dan peserta bebas makan sepuasnya. Hasilnya: di fase ultra-proses mereka makan sekitar 500 kkal lebih banyak per hari, naik sekitar 0,9 kg. Di fase minim proses, turun sekitar 0,9 kg.",
        ],
      },
      {
        heading: "Kenapa bisa begitu",
        paragraphs: [
          "Makanan ultra-proses biasanya padat kalori, cepat habis dikunyah, dan rasanya dirancang susah berhenti. Bukan 'racun', tapi gampang membuat kalori berlebih tanpa sadar. Versi Indonesia-nya: snack kemasan, biskuit, roti manis, minuman kemasan manis, dan mie instan yang dimakan apa-apanya.",
        ],
      },
    ],
    cobaIni: [
      "Ganti satu snack kemasan per hari dengan buah atau telur rebus.",
      "Masak sederhana di rumah: telur, tempe, sayur, nasi.",
      "Belanja dengan daftar supaya baris snack tidak ikut masuk keranjang.",
      "Kalau beli kemasan, pindahkan ke mangkuk dulu, jangan makan dari bungkusnya.",
    ],
    sources: [
      {
        title: "Hall dkk. (2019), RCT diet ultra-proses vs minim proses, Cell Metabolism",
        url: "https://www.cell.com/cell-metabolism/fulltext/S1550-4131(19)30248-7",
      },
    ],
  },
  {
    slug: "kalori-cair-es-teh-kopi",
    image: {
      alt: "Segelas es teh manis dengan sedotan",
      credit: { author: "roland", page: "https://www.flickr.com/photos/35034347371@N01/79456295", source: "Flickr" },
    },
    figure: {
      src: "kalori-cair-es-teh-kopi-fig1.webp",
      alt: "Diagram batang kalori per gelas: es tawar 0, es teh manis 60-100 kkal, kopi susu gula aren 200-300 kkal.",
      caption: "Tiga gelas minuman manis bisa menghapus defisit harian tanpa terasa (kisaran takaran umum).",
    },
    title: "Kalori cair: es teh manis dan kopi susu gula aren",
    summary:
      "Kalori dari minuman kurang bikin kenyang; es teh manis dan kopi susu bisa menambah 100-300 kkal tanpa terasa.",
    icon: "cup-soda",
    date: "2026-10-13",
    tags: ["sugary-drink"],
    sections: [
      {
        heading: "Kenapa kalori cair licin",
        paragraphs: [
          "Studi klasik membandingkan soda cair dengan camilan padat berkalori sama. Kelompok soda tidak otomatis makan lebih sedikit kemudian, dan beratnya naik; kelompok camilan padat tidak. Meta-analisis besar juga mengaitkan minuman manis dengan kenaikan berat badan. Kalorinya masuk tanpa memberi rasa kenyang, jadi tidak ada kompensasi di makan berikutnya.",
        ],
      },
      {
        heading: "Versi Indonesia",
        paragraphs: [
          "Es teh manis sekitar 60-100 kkal per gelas tergantung takaran gulanya. Kopi susu gula aren gampang melewati 200 kkal. Tiga gelas sehari, dan defisit kalorimu hilang diam-diam tanpa pernah merasa makan banyak.",
        ],
      },
    ],
    cobaIni: [
      "Default minum: es tawar atau air putih; manis jadi pengecualian.",
      "Minta gula setengah takaran, lalu separuhnya lagi minggu depan.",
      "Kopi: susu tanpa gula aren, atau ukur takarannya.",
      "Minuman manis kekinian simpan untuk acara, bukan rutinitas.",
    ],
    sources: [
      {
        title: "DiMeglio & Mattes (2000), kalori cair vs padat",
        url: "https://pubmed.ncbi.nlm.nih.gov/10878689/",
      },
      {
        title: "Malik dkk. (2013), meta-analisis minuman manis dan berat badan",
        url: "https://pubmed.ncbi.nlm.nih.gov/23966427/",
      },
    ],
  },
  {
    slug: "saus-minyak-porsi-kecil",
    image: {
      alt: "Nasi putih dengan sambal kerang dan tauge",
      credit: { author: "Wiki Farazi", page: "https://commons.wikimedia.org/w/index.php?curid=158552419", source: "Wikimedia Commons" },
    },
    figure: {
      src: "saus-minyak-porsi-kecil-fig1.webp",
      alt: "Diagram batang kalori per sendok makan: minyak goreng sekitar 115 kkal, mayones sekitar 90 kkal, sambal segar sekitar 15 kkal.",
      caption: "Dua-tiga sendok minyak ekstra plus saus bisa menambah 300-400 kkal tak terasa (minyak: TKPI 2019).",
    },
    title: "Saus dan minyak: porsi kecil, kalori besar",
    summary:
      "Satu sdm minyak sekitar 120 kkal, satu sdm mayones sekitar 90 kkal; bumbu dan pelengkap sering jadi kalori tersembunyi terbesar.",
    icon: "utensils",
    date: "2026-10-13",
    tags: ["sauce", "fried"],
    sections: [
      {
        heading: "Angka yang jarang dihitung",
        paragraphs: [
          "Lemak mengandung sekitar 9 kkal per gram. Satu sdm minyak goreng sekitar 120 kkal, satu sdm mayones sekitar 90 kkal, dan saus manis botolan beberapa puluh kkal per sdm dari gulanya. Dua-tiga sendok minyak ekstra saat menggoreng, plus saus, bisa menambah 300-400 kkal yang tidak pernah kamu rasakan.",
        ],
      },
      {
        heading: "Di piring Indonesia",
        paragraphs: [
          "Ayam geprek plus sambal mayo, gorengan nyemplung saus, karedok dengan bumbu kacang tebal, martabak keju mentega. Lauknya terlihat biasa, tapi yang mendongkrak kalorinya justru saus dan minyaknya. Sambal segar tanpa minyak dan acar pilihan paling ringan.",
        ],
      },
    ],
    cobaIni: [
      "Ukur minyak dengan sendok, jangan tuang langsung dari botol.",
      "Sajikan saus dan mayo di wadah kecil, celup sedikit.",
      "Sambal segar atau acar sebagai pelengkap default.",
      "Kuah bening daripada kuah santan kalau targetnya defisit.",
    ],
    sources: [
      {
        title: "USDA FoodData Central, nilai gizi minyak dan mayones",
        url: "https://fdc.nal.usda.gov/",
      },
    ],
  },
  {
    slug: "tidur-cukup-lapar-turun",
    image: {
      alt: "Orang tidur nyenyak di tempat tidur",
      credit: { author: "elizabeth lies", page: "https://stocksnap.io/photo/sleeping-bed-843D85B223", source: "StockSnap" },
    },
    figure: {
      src: "tidur-cukup-lapar-turun-fig1.webp",
      alt: "Diagram batang studi Nedeltcheva 2010: pada tidur 5,5 jam, porsi penurunan berat dari lemak turun 55 persen dan kehilangan massa tanpa lemak naik 60 persen.",
      caption: "Begadang mengubah komposisi penurunan berat: lebih sedikit lemak, lebih banyak otot yang terkorban (Nedeltcheva dkk., 2010).",
    },
    title: "Kurang tidur, lapar besoknya",
    summary:
      "Tidur singkat menaikkan hormon lapar dan menurunkan hormon kenyang; saat defisit, kurang tidur membuat berat yang turun lebih banyak dari otot.",
    icon: "moon",
    date: "2026-10-13",
    sections: [
      {
        heading: "Hormon lapar ikut begadang",
        paragraphs: [
          "Dalam eksperimen pembatasan tidur, leptin (hormon yang memberi tahu kenyang) turun, ghrelin (hormon lapar) naik, dan rasa lapar meningkat. Tidak heran hari setelah begadang biasanya dimulai dengan ngidam yang aneh-aneh.",
        ],
      },
      {
        heading: "Defisit plus begadang, komposisinya buruk",
        paragraphs: [
          "RCT di Annals of Internal Medicine membatasi tidur orang yang sedang defisit kalori ke 5,5 jam vs 8,5 jam per malam. Total berat yang turun mirip, tapi komposisinya beda jauh: di kelompok kurang tidur, proporsi penurunan berat yang berasal dari lemak turun 55%, dan kehilangan massa tanpa lemak naik 60%. Defisitnya sama, hasilnya lebih buruk.",
        ],
      },
    ],
    cobaIni: [
      "Setel jam tidur dan bangun yang konsisten, target 7-9 jam.",
      "Kurangi kafein setelah sore.",
      "Sadari: ngidam tengah malam biasanya efek begadang, bukan lapar.",
      "Kalau begadang tak terhindarkan, jaga protein dan jangan kejar defisit besar hari itu.",
    ],
    sources: [
      {
        title: "Spiegel dkk. (2004), tidur singkat, leptin, ghrelin, dan lapar",
        url: "https://pubmed.ncbi.nlm.nih.gov/15618932/",
      },
      {
        title: "Nedeltcheva dkk. (2010), tidur kurang menggagalkan penurunan lemak",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2951287/",
      },
    ],
  },
  {
    slug: "langkah-harian-neat",
    image: {
      alt: "Kaki yang sedang berjalan di trotoar",
      credit: { author: null, page: "https://www.rawpixel.com/image/5968947/walking-feet", source: "Rawpixel" },
    },
    figure: {
      src: "langkah-harian-neat-fig1.webp",
      alt: "Panel statistik: 6.000 langkah harian setara sekitar 300 kkal dengan saran menambah langkah sederhana.",
      caption: "Perkiraan kasar untuk berat badan sedang; NEAT berbeda antar orang (Levine dkk., 1999).",
    },
    title: "Langkah harian: kalori yang tidak terasa seperti olahraga",
    summary:
      "NEAT, semua gerakan di luar olahraga, berbeda besar antar orang dan ikut menentukan siapa yang gampang naik berat.",
    icon: "footprints",
    date: "2026-10-13",
    sections: [
      {
        heading: "NEAT itu apa",
        paragraphs: [
          "NEAT (non-exercise activity thermogenesis) adalah semua gerakan di luar olahraga: jalan ke warung, naik tangga, jemur pakaian, mondar-mandir sambil telepon. Studi klasik di Science menggelembungkan asupan 16 orang sekitar 1.000 kkal per hari selama 8 minggu; perubahan NEAT mereka menjelaskan sebagian besar perbedaan siapa yang menambah banyak lemak dan yang hampir tidak.",
        ],
      },
      {
        heading: "Kenapa langkah lebih tahan lama",
        paragraphs: [
          "300 kkal di treadmill terasa berat; 300 kkal dari 6.000 langkah yang tersebar seharian hampir tidak terasa. Defisit dari gerakan harian lebih gampang dijaga daripada defisit yang hanya datang dari sesi olahraga.",
        ],
      },
    ],
    cobaIni: [
      "Turun satu halte lebih awal, atau parkir lebih jauh.",
      "Jalan 5-10 menit setelah makan besar.",
      "Tangga daripada lift kalau cuma satu-dua lantai.",
      "Tambah 1.000 langkah dari biasanya dulu; 8.000-10.000 itu arah, bukan syarat.",
    ],
    sources: [
      {
        title: "Levine dkk. (1999), NEAT dan resistensi terhadap penambahan lemak, Science",
        url: "https://pubmed.ncbi.nlm.nih.gov/9880251/",
      },
    ],
  },
  {
    slug: "angkat-beban-saat-diet",
    image: {
      alt: "Dumbel dan piring beban di gym",
      credit: { author: null, page: "https://www.rawpixel.com/image/5944299/free-public-domain-cc0-photo", source: "Rawpixel" },
    },
    figure: {
      src: "angkat-beban-saat-diet-fig1.webp",
      alt: "Panel statistik: target protein saat defisit 1,6-2,4 gram per kg berat badan per hari; contoh 70 kg sama dengan 112-168 gram.",
      caption: "Rentang yang dipakai penelitian defisit (Longland dkk., 2016; Mettler dkk., 2009).",
    },
    title: "Saat defisit, angkat beban",
    summary:
      "Latihan beban plus protein yang cukup membuat berat yang turun datang dari lemak, bukan otot.",
    icon: "dumbbell",
    date: "2026-10-13",
    sections: [
      {
        heading: "Masalah diet tanpa latihan",
        paragraphs: [
          "Defisit kalori saja memang menurunkan berat, tapi sebagian berat itu otot. Otot yang hilang membuat harianmu membakar lebih sedikit dan penampilan berubah kurang sesuai harapan. Tubuh menjaga apa yang dipakai; kalau otot tidak pernah diberi beban, tubuh anggap stok cadangan.",
        ],
      },
      {
        heading: "Bukti dari laboratorium",
        paragraphs: [
          "Pada atlet yang defisit, protein tinggi plus latihan beban mempertahankan massa otot. Studi yang lebih menarik lagi: defisit kalori besar, protein 2,4 g/kg, dan latihan beban enam hari seminggu membuat hampir semua penurunan berat berasal dari lemak, malah massa tanpa lemaknya sedikit naik. Programnya ekstrem; poin utamanya bukan jadwalnya, tapi sinyalnya: otot ini masih dipakai.",
        ],
      },
    ],
    cobaIni: [
      "Dua-tiga sesi beban per minggu, gerakan dasar cukup.",
      "Jangan potong protein di hari latihan.",
      "Mulai dari rutinitas sederhana, naikkan beban bertahap.",
      "Berat timbangan bisa melambat saat mulai beban; itu normal, cek lingkar dan cermin.",
    ],
    sources: [
      {
        title: "Mettler dkk. (2009), protein tinggi dan massa otot saat defisit",
        url: "https://pubmed.ncbi.nlm.nih.gov/19927027/",
      },
      {
        title: "Longland dkk. (2016), defisit + protein tinggi + latihan beban",
        url: "https://pubmed.ncbi.nlm.nih.gov/26817506/",
      },
    ],
  },
  {
    slug: "jeda-diet-yang-terencana",
    image: {
      alt: "Piring makan lengkap dengan lauk dan telur",
      credit: { author: "roland", page: "https://www.flickr.com/photos/35034347371@N01/228858019", source: "Flickr" },
    },
    figure: {
      src: "jeda-diet-yang-terencana-fig1.webp",
      alt: "Garis waktu studi MATADOR: blok defisit dua minggu diselingi jeda pemeliharaan dua minggu berulang selama 30 minggu.",
      caption: "Jeda terencana 2 minggu di level pemeliharaan (Byrne dkk., 2018; masih perlu penelitian lanjutan).",
    },
    title: "Diet break: jeda dua minggu yang justru membantu",
    summary:
      "Studi MATADOR: defisit dua minggu lalu jeda dua minggu menurunkan berat lebih banyak daripada defisit terus-menerus dengan durasi sama.",
    icon: "calendar",
    date: "2026-10-13",
    sections: [
      {
        heading: "Studi MATADOR",
        paragraphs: [
          "Peneliti Australia membagi 51 pria dewasa dengan obesitas jadi dua: defisit 16 minggu tanpa henti, atau defisit 2 minggu diselingi makan normal 2 minggu, berulang sampai total 30 minggu. Kelompok yang menyelingi jeda menurunkan berat lebih banyak dan efisiensi penurunannya lebih baik. Dugaannya: jeda mengurangi adaptasi metabolik dan kelelahan diet.",
        ],
      },
      {
        heading: "Baca sebelum mencoba",
        paragraphs: [
          "Ini satu studi, pada pria dengan obesitas, dan hasilnya masih perlu pengulangan. Jeda di sini artinya makan di level pemeliharaan, bukan makan sepuasnya seminggu penuh. Kalau disalahpahami, diet break cepat berubah jadi alasan.",
        ],
      },
    ],
    cobaIni: [
      "Jadwalkan jeda di momen yang memang ramai (lebaran, liburan) supaya tidak merasa gagal.",
      "Selama jeda, makan di level pemeliharaan dan tetap catat.",
      "Setelah jeda, berat bisa naik sedikit karena air; itu bukan kegagalan.",
      "Kalau tidak mau jeda dua minggu, mulai dari satu-dua hari pemeliharaan.",
    ],
    sources: [
      {
        title: "Byrne dkk. (2018), studi MATADOR, International Journal of Obesity",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5803575",
      },
    ],
  },
  {
    slug: "timbangan-naik-turun-normal",
    image: {
      alt: "Kaki di atas timbangan badan",
      credit: { author: null, page: "https://www.rawpixel.com/image/5920157/photo-image-background-public-domain-person", source: "Rawpixel" },
    },
    figure: {
      src: "timbangan-naik-turun-normal-fig1.webp",
      alt: "Grafik garis ilustrasi: titik-titik timbangan harian naik-turun dengan garis tren mingguan yang menurun.",
      caption: "Ilustrasi pola umum; penimbangan rutin terkait hasil lebih baik tanpa efek psikologis buruk (Zheng dkk., 2015).",
    },
    title: "Timbangan naik 1 kg dalam sehari? Cek trennya",
    summary:
      "Berat harian naik-turun karena air, garam, dan isi perut; tren rata-rata mingguan yang jujur.",
    icon: "scale",
    date: "2026-10-13",
    sections: [
      {
        heading: "Kenapa angka harian berisik",
        paragraphs: [
          "Makanan asin, porsi karbohidrat yang lebih besar, latihan berat, siklus haid, dan buang air semuanya menggeser berat lewat air. Satu kilogram lemak butuh surplus sekitar 7.700 kkal; naik 1 kg dalam sehari hampir pasti bukan lemak. Yang membunuh semangat biasanya bukan timbangannya, tapi salah baca timbangannya.",
        ],
      },
      {
        heading: "Timbang, tapi baca trennya",
        paragraphs: [
          "Tinjauan 17 studi menemukan penimbangan rutin terkait dengan penurunan berat yang lebih banyak, tanpa efek psikologis buruk. Kuncinya dua: kondisi timbang yang sama tiap hari, dan penilaian lewat rata-rata mingguan, bukan satu angka.",
        ],
      },
    ],
    cobaIni: [
      "Timbang tiap pagi, setelah ke toilet, sebelum makan dan minum.",
      "Bandingkan rata-rata 7 hari minggu ini dengan minggu lalu.",
      "JoyoRogo menilai tren, bukan angka harian; biarkan aplikasi yang menghitung.",
      "Satu angka aneh: catat, jangan panik, lanjut.",
    ],
    sources: [
      {
        title: "Zheng dkk. (2015), tinjauan penimbangan rutin dalam pengelolaan berat",
        url: "https://pubmed.ncbi.nlm.nih.gov/25521523/",
      },
    ],
  },
  {
    slug: "sup-bening-pembuka",
    image: {
      alt: "Semangkuk soto ayam dari kedai",
      credit: { author: "LintasGiat", page: "https://commons.wikimedia.org/w/index.php?curid=154777741", source: "Wikimedia Commons" },
    },
    figure: {
      src: "sup-bening-pembuka-fig1.webp",
      alt: "Diagram batang: makan dengan sup pembuka menurunkan total asupan sekitar 20 persen dibanding tanpa sup.",
      caption: "Sup pembuka menurunkan total asupan makan ±20% di makan itu (Flood & Rolls, 2007).",
    },
    title: "Mulai makan dengan sup bening",
    summary:
      "Sup pembuka menurunkan total makan sekitar 20% di makan itu, dan cocok banget dengan sayur bening kita.",
    icon: "soup",
    date: "2026-10-13",
    sections: [
      {
        heading: "Efek sup pembuka",
        paragraphs: [
          "Di Penn State, peserta yang mendapat sup sebelum makan utama makan total sekitar 20% lebih sedikit di makan itu dibanding tanpa sup, dan efeknya muncul di berbagai bentuk sup: kaldu bening sampai sup potongan. Air murni dengan volume sama tidak seefektif itu; tekstur dan rasa sup ikut membuat kenyang.",
        ],
      },
      {
        heading: "Versi Indonesia",
        paragraphs: [
          "Sayur bening bayam-jagung, sop kuah bening, atau kaldu ayam dengan sayuran. Bakso juga bisa: kuah bening, sayur, dan porsi nasi yang dikecilkan. Yang menggugurkan manfaatnya justru versi santan seperti lodeh, karena santan mengubah kalorinya sepenuhnya.",
        ],
      },
    ],
    cobaIni: [
      "Sajikan sup bening sebagai gelombang pertama makan malam.",
      "Masak bening tanpa santan; garam dan bawang sudah cukup.",
      "Bakso: kuah bening plus sayur, nasi kecil.",
      "Sup pembuka jangan diganti minuman manis; itu kalori cair.",
    ],
    sources: [
      {
        title: "Flood & Rolls (2007), sup pembuka menurunkan asupan makan",
        url: "https://pubmed.ncbi.nlm.nih.gov/17574705/",
      },
    ],
  },
  {
    slug: "defisit-fleksibel-8020",
    image: {
      alt: "Martabak manis di atas meja",
      credit: { author: "Muhranoff", page: "https://commons.wikimedia.org/w/index.php?curid=142507539", source: "Wikimedia Commons" },
    },
    figure: {
      src: "defisit-fleksibel-8020-fig1.webp",
      alt: "Diagram donat 80/20: sekitar 80 persen makanan mendukung target dan 20 persen ruang untuk makanan favorit.",
      caption: "Pandangan praktis 80/20; restriksi kaku berhubungan dengan pola makan terganggu (Westenhoeffer dkk., 1999).",
    },
    title: "Restriksi fleksibel mengalahkan diet kaku",
    summary:
      "Diet all-or-nothing rawan berakhir makan berlebih; pendekatan fleksibel memberi ruang untuk makanan favorit tanpa merusak hasil.",
    icon: "heart",
    date: "2026-10-13",
    sections: [
      {
        heading: "Kaku versus fleksibel",
        paragraphs: [
          "Peneliti membedakan dua gaya menahan makan: restriksi kaku (daftar makanan haram, aturan mutlak) dan restriksi fleksibel (total asupan dijaga, tapi ada ruang). Restriksi kaku berhubungan dengan pola makan yang terganggu dan makan berlebih setelah 'keliru', sementara fleksibel tidak. Satu kue lewat batas, lalu seluruh hari dianggap gagal: pola pikir kaku seperti itu yang paling merusak.",
        ],
      },
      {
        heading: "Praktik 80/20",
        paragraphs: [
          "Perkiraan yang sehat: sekitar 80% makanan mendukung targetmu (nasi, lauk, sayur, buah, telur), 20% ruang untuk favorit seperti martabak atau es teh manis, asal masuk hitungan. Defisit kalori adalah hasil total mingguan, bukan kesucian tiap suapan.",
        ],
      },
    ],
    cobaIni: [
      "Tidak ada makanan haram; yang ada porsi dan frekuensi.",
      "Rencanakan makanan favorit satu-dua kali seminggu, masukkan ke hitungan.",
      "Setelah makan besar, kembali normal di makan berikutnya, bukan 'besok mulai lagi'.",
      "Kalau hari penuh acara, jalankan sisanya minggu dengan defisit santai.",
    ],
    sources: [
      {
        title: "Westenhoefer dkk. (1999), validasi restriksi fleksibel dan kaku",
        url: "https://pubmed.ncbi.nlm.nih.gov/10349584/",
      },
    ],
  },
];

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
