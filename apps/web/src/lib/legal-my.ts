// Privacy notice and terms for Malaysian visitors, in Bahasa Melayu and English (PDPA 2010 s.7(3) asks for both).
// Plain data on purpose: blog/pages.ts imports it at build time for the no-JS content, and the routes render the
// same objects. Every data practice below is taken from routes/privasi.tsx and routes/syarat.tsx (Indonesian), the
// original wording; nothing is added except the PDPA blocks (controller, rights, complaints), which state how we
// handle requests. Inline links are written as [label](href).
import {
  COMPANY_ADDRESS,
  COMPANY_NAME,
  COMPANY_REGION,
  CONTACT_EMAIL,
  WHATSAPP_DISPLAY,
} from "./contact.ts";

export type LegalBlock = string | { list: readonly string[] } | { note: string };

export type LegalSection = {
  id?: string;
  title: string;
  /** Section is in English inside a Malay page (the USD purchases clause). */
  lang?: "en";
  blocks: readonly LegalBlock[];
};

export type LegalPath = "/my/privasi" | "/my/privacy" | "/my/syarat" | "/my/terms";

export type LegalDoc = {
  path: LegalPath;
  lang: "ms" | "en";
  title: string;
  intro: string;
  /** Shown under the intro. */
  version: string;
  sections: readonly LegalSection[];
};

export const LEGAL_VERSION = "2026-10-21";

/** Complaints body named in the notice (docs/marketing/malaysia-plan.md section 6). */
export const PDP_EMAIL = "aduan@pdp.gov.my";
export const PDP_PHONE = "03-7456 3888";

/** Where each language version lives; the two notices and the two terms point at each other. */
export const LEGAL_PEERS: Record<LegalPath, LegalPath> = {
  "/my/privasi": "/my/privacy",
  "/my/privacy": "/my/privasi",
  "/my/syarat": "/my/terms",
  "/my/terms": "/my/syarat",
};

/** The Indonesian page each Malaysian page is a counterpart of (hreflang id). */
export const LEGAL_ID_PAGE: Record<LegalPath, "/privasi" | "/syarat"> = {
  "/my/privasi": "/privasi",
  "/my/privacy": "/privasi",
  "/my/syarat": "/syarat",
  "/my/terms": "/syarat",
};

const address = COMPANY_ADDRESS ? ` ${COMPANY_ADDRESS},` : "";
const contactLineMs = `E-mel ${CONTACT_EMAIL}, WhatsApp ${WHATSAPP_DISPLAY}`;
const contactLineEn = `Email ${CONTACT_EMAIL}, WhatsApp ${WHATSAPP_DISPLAY}`;

// ---------------------------------------------------------------------------------------------------------------
// Privacy notice, Bahasa Melayu
// ---------------------------------------------------------------------------------------------------------------

const PRIVACY_MS: LegalDoc = {
  path: "/my/privasi",
  lang: "ms",
  title: "Notis Privasi",
  intro:
    "Ringkas dan jujur: data apa yang disimpan, apa yang tidak, siapa yang memprosesnya dan cara memadamnya. Notis ini untuk pengguna di Malaysia dan ditulis dengan Akta Perlindungan Data Peribadi 2010 (Akta 709, seperti dipinda 2024) di fikiran.",
  version: `Versi ${LEGAL_VERSION}`,
  sections: [
    {
      id: "pengawal",
      title: "Siapa kami (pengawal data)",
      blocks: [
        `Pengawal data bagi data peribadi anda ialah ${COMPANY_NAME},${address} ${COMPANY_REGION}. Kami membuat dan menjalankan JoyoRogo (aplikasi, web dan JoyoFit).`,
        `Hubungi kami: ${contactLineMs}. Lihat bahagian Hubungi di bawah.`,
        "Notis ini terpakai pada joyorogo.com, aplikasi JoyoRogo di Android dan iPhone, dan ciri JoyoRogo dalam JoyoFit.",
      ],
    },
    {
      id: "umur",
      title: "Umur: 18 tahun ke atas",
      blocks: [
        "JoyoRogo untuk pengguna berumur 18 tahun ke atas. Jika kami tahu kami memegang data seseorang yang berumur di bawah 18 tahun, kami memadam akaun dan datanya.",
      ],
    },
    {
      id: "tujuan",
      title: "Tujuan kami memproses data anda",
      blocks: [
        { list: [
          "Menyediakan akaun anda dan log masuk (Google atau Apple).",
          "Mengira sasaran harian makan, bakar dan tidur daripada data diri anda, dan memaparkan kemajuan anda.",
          "Menganggar kalori daripada foto, cerita teks atau suara, dan daripada imbasan kod bar atau label pemakanan.",
          "Menyegerakkan senaman, langkah dan tidur (Health Connect, Apple Health, Strava, JoyoFit) atas pilihan anda.",
          "Ciri komuniti (suapan, kumpulan, cabaran) bila anda memilih untuk menyiarkan sesuatu.",
          "Pembayaran Pro, membuktikan langganan dan menghantar resit ke e-mel anda.",
          "Menghantar pemberitahuan tolak (push) yang anda benarkan, bukan iklan.",
          "Mengukur dan memperbaiki ketepatan AI, dan mencegah penyalahgunaan.",
          "Memahami halaman dan butang yang digunakan, melalui analitik tanpa kuki (Revklik): tanpa nama, e-mel atau catatan kesihatan anda.",
          "Menjawab permintaan dan aduan anda.",
        ] },
        "Kami tidak menjual data anda, tidak menggunakannya untuk iklan, dan tidak menggunakannya untuk melatih model AI.",
      ],
    },
    {
      id: "wajib-sukarela",
      title: "Data yang wajib dan yang sukarela",
      blocks: [
        { list: [
          "Wajib untuk membuat akaun: nama dan e-mel daripada Google atau Apple (e-mel boleh berupa alamat geganti Apple). Tanpa ini kami tidak dapat menyediakan akaun. JoyoRogo tidak menyimpan kata laluan.",
          "Diperlukan untuk sasaran harian: tahun lahir, jantina, tinggi dan berat badan. Tanpa ini kami tidak dapat mengira sasaran anda.",
          "Sukarela: foto makanan, cerita, rekod berat, senaman, tidur, air, lokasi tempat makan, Health Connect, Apple Health, Strava, JoyoFit awan, Keluarga, wawasan tidur, pemberitahuan, siaran komuniti dan Sambungan AI. Semuanya mati sehingga anda sendiri menghidupkannya atau menggunakannya, dan anda boleh mematikannya bila-bila masa.",
        ] },
      ],
    },
    {
      id: "sensitif",
      title: "Data peribadi sensitif dan persetujuan nyata",
      blocks: [
        "Beberapa data yang anda masukkan ialah data peribadi sensitif menurut PDPA, kerana ia berkaitan kesihatan atau badan anda: berat dan tinggi badan, makanan, senaman, tidur, kadar denyutan jantung, tahap oksigen (SpO2) dan data kitaran (haid) serta mod kehamilan atau penyusuan jika anda menggunakannya.",
        "Kami memproses data sensitif hanya dengan persetujuan nyata anda. Anda memberi persetujuan itu apabila anda memasukkan data tersebut atau menghidupkan ciri pilihan yang berkenaan, untuk tujuan di atas sahaja. Data kitaran (haid) hanya mengikut akaun Pro dan mempunyai suis sendiri (Segerak data kitaran).",
        "Anda boleh menarik balik persetujuan bila-bila masa: matikan ciri itu, padam data di Profil, atau hubungi kami. Menarik balik persetujuan mungkin bermakna ciri berkenaan tidak lagi berfungsi.",
      ],
    },
    {
      id: "data",
      title: "Data yang kami simpan",
      blocks: [
        { list: [
          "Akaun: nama, e-mel dan foto profil daripada akaun Google yang anda gunakan untuk log masuk. Jika anda log masuk dengan Apple di aplikasi iPhone, kami menyimpan nama (jika Apple memberikannya) dan e-mel, yang boleh berupa alamat geganti Apple. JoyoRogo tidak menyimpan kata laluan.",
          "Data diri: tahun lahir, jantina, tinggi dan berat badan.",
          "Rekod harian: berat timbangan, makanan, senaman, tidur dan air minuman.",
          "Pelan harian: sasaran makan, bakar dan tidur yang dikira daripada data diri anda.",
        ] },
        { note: "Satu akaun = satu data. Kami tidak menyimpan apa-apa yang tidak anda masukkan sendiri." },
        { note: "Semua yang dihantar antara aplikasi atau pelayar dan pelayan JoyoRogo menggunakan HTTPS (TLS)." },
      ],
    },
    {
      title: "Kamera, galeri dan kod bar",
      blocks: [
        "Kamera hanya digunakan apabila anda memotret makanan untuk dikira kalorinya, mengimbas kod bar bungkusan, atau memotret jadual \"Maklumat Pemakanan\" pada bungkusan. Galeri hanya untuk foto yang anda pilih sendiri (foto makanan, foto label, foto profil, foto cerita). Kami tidak membaca isi galeri anda di luar foto yang anda pilih. Untuk kod bar, hanya nombor kod bar dihantar melalui pelayan kami dan pangkalan data produk luar, seperti Open Food Facts (pangkalan data produk terbuka), untuk mendapatkan maklumat pemakanan. Nombor itu tidak disertakan dengan nama atau e-mel anda.",
        "Jika anda memotret label pemakanan produk, foto jadual pemakanan itu (dan foto depan bungkusan, jika anda mengambilnya) dihantar sekali ke pelayan kami untuk dibaca oleh AI, kemudian dibuang: foto itu tidak disimpan dan tidak ditahan. Yang disimpan hanyalah nama produk dan angka pemakanan yang anda taip atau sahkan sendiri dalam borang. Data produk itu dikongsi dengan semua pengguna JoyoRogo supaya mereka boleh mengimbas produk yang sama. Sumbangan anda kekal dikaitkan dengan akaun anda supaya kami boleh mengira berapa orang yang mengesahkan angka itu dan menghadkan penyalahgunaan, tetapi nama anda tidak dipaparkan kepada pengguna lain.",
        "Ada satu pengecualian, dan hanya jika anda menghidupkannya: pada skrin foto label terdapat pilihan \"Guna foto depan sebagai pelekat makanan\", yang sentiasa mati dan hanya muncul selepas anda mengambil foto depan bungkusan. Jika dihidupkan, pelayan memotong foto depan itu (tanpa latar) dan menyimpan potongannya sahaja, melalui alamat rawak yang tidak boleh diteka, sebagai pelekat makanan yang anda catat daripada produk itu. Foto asal dan foto jadual pemakanan tetap dibuang. Potongan itu tidak dimasukkan ke dalam data produk yang dikongsi. Padam catatan makanan itu dan pelekatnya turut terpadam, begitu juga apabila anda memadam akaun atau semua data. Jika anda tidak mencatat makanan itu, potongan itu dipadam secara automatik dalam kira-kira 2 hari. Jika pilihan itu mati, produk daripada label tidak mendapat pelekat daripada foto anda.",
      ],
    },
    {
      title: "Foto makanan",
      blocks: [
        "Foto yang anda hantar diteruskan kepada AI (Cloudflare Workers AI) untuk mengira kalori dan kandungan zat, dan tidak digunakan untuk melatih model. Foto itu ditahan sementara di pelayan supaya butang \"Kira semula\" boleh menggunakan foto yang sama, kemudian dipadam secara automatik dalam kira-kira 2 hari (pemadaman automatik boleh lewat sedikit). Foto asal tidak disimpan kekal. Yang kami simpan hanyalah potongan setiap makanan (tanpa latar) sebagai pelekat diari, melalui alamat rawak yang tidak boleh diteka. Padam catatan makanan itu dan pelekatnya turut terpadam.",
        "Jika anda menilai hasil imbasan \"Kurang tepat\" atau \"Salah\", ada kotak pilihan yang tidak ditanda: \"Boleh simpan foto ini untuk bantu memperbaiki AI\". Hanya jika anda menandanya, foto itu disimpan bersama catatan anda, senarai makanan daripada AI dan hasil yang anda simpan. Isinya digunakan hanya untuk menguji dan memperbaiki AI JoyoRogo, boleh dipadam atas permintaan, dan turut terpadam apabila anda memadam akaun atau semua data. Tanpa tanda, foto tidak disimpan di luar tempoh sementara tadi.",
        "Untuk setiap imbasan foto, teks jawapan AI (senarai makanan, anggaran berat, kalori dan zat, tanpa fotonya) kami simpan bersama hasil akhir yang anda catat. Tujuannya mengukur dan memperbaiki ketepatan AI. Teks itu turut terpadam apabila anda memadam akaun atau semua data.",
        "Jika anda menghidupkan \"Simpan foto asal\" di Profil, foto asal (versi kecil) daripada imbasan yang anda simpan turut disimpan supaya boleh dilihat semula di diari. Foto itu hanya boleh dibuka melalui akaun anda. Mematikan tetapan itu, atau memadam semua data, memadam semua foto asal yang tersimpan.",
        "Satu pengecualian: akaun yang menyertai set data ketepatan dalaman (setakat ini hanya akaun milik pembuat JoyoRogo sendiri) menyimpan foto imbasan, jawapan AI, pembetulan dan hasil akhir yang disimpan, untuk menilai model. Foto itu tidak digunakan untuk melatih model, dan boleh dipadam atas permintaan. Akaun lain tidak terjejas.",
      ],
    },
    {
      title: "Lokasi tempat makan",
      blocks: [
        "Lokasi mati secara lalai. Jika anda menghidupkan \"Simpan lokasi tempat makan\" semasa mencatat pinggan dengan nama tempat, kami menyimpan titik tempat itu dibundarkan kepada kira-kira 100 meter, bukan titik tepat. Lokasi hanya digunakan untuk peta dan susunan \"Terdekat\" di tab Tempat, hanya boleh dilihat oleh akaun anda, dan tidak pernah muncul di profil awam atau suapan.",
        "Lokasi boleh dipadam satu tempat atau semuanya sekali gus dari tab Tempat tanpa mengubah catatan makan anda. Memadam semua data juga memadam semua lokasi yang tersimpan.",
      ],
    },
    {
      title: "Cerita dan rakaman suara",
      blocks: [
        "Apabila anda menceritakan makanan anda, teks atau rakaman suara anda diteruskan kepada AI (Cloudflare Workers AI) untuk ditukar menjadi teks dan dikira kalorinya. Rakaman suara tidak disimpan dan tidak digunakan untuk melatih model. Yang disimpan hanyalah makanan yang anda pilih untuk dicatat.",
      ],
    },
    {
      title: "Health Connect (Android)",
      blocks: [
        "Jika anda menyambungkan Health Connect di aplikasi Android, anda memilih sendiri data yang dibenarkan, dan kebenaran itu boleh ditarik balik bila-bila masa dari Health Connect. JoyoRogo membaca sesi senaman, langkah, jarak, kalori aktif dan sesi tidur 7 hari terakhir, hanya apabila aplikasi dibuka, dan tidak membaca di latar belakang.",
        { list: [
          "Dibaca: sesi senaman, langkah, jarak, kalori aktif dan tidur.",
          "Disimpan di akaun anda: setiap senaman (nama, tempoh, kalori), ringkasan harian (langkah, jarak, kalori aktif) dan waktu tidur setiap malam, supaya sasaran harian anda boleh dikira.",
          "Ditulis ke Health Connect: makanan yang anda catat (nama, kalori, protein, karbohidrat, lemak, serat, jenis waktu makan), supaya aplikasi kesihatan lain yang anda benarkan boleh membacanya.",
        ] },
        { note: "Data Health Connect tidak dijual, tidak digunakan untuk iklan atau penentuan profil iklan, dan tidak dikongsi dengan pihak ketiga. Data itu digunakan hanya untuk mengira dan memaparkan kemajuan anda. Memadam semua data di Profil memadam semua catatan yang sudah tersimpan di akaun anda; data yang sudah kami tulis ke Health Connect dipadam melalui aplikasi Health Connect." },
      ],
    },
    {
      id: "apple-health",
      title: "Apple Health (iPhone)",
      blocks: [
        "Jika anda menyambungkan Apple Health di aplikasi iPhone, iOS meminta kebenaran anda melalui dialog Apple Health sendiri, dan kebenaran itu boleh ditarik balik bila-bila masa di aplikasi Kesihatan atau Tetapan iPhone. JoyoRogo hanya membaca; aplikasi tidak menulis apa-apa ke Apple Health. Yang dibaca ialah data 7 hari terakhir, semasa anda menjalankan segerak dari Profil, dan selepas itu apabila aplikasi dibuka. Tiada pembacaan di latar belakang.",
        { list: [
          "Dibaca: senaman (jenis, waktu mula dan tamat, kalori), langkah, jarak berjalan dan berlari, kalori aktif dan tidur.",
          "Disimpan di akaun anda: setiap senaman (nama, jenis, tempoh, kalori), ringkasan harian (langkah, jarak, kalori aktif, minit senaman) dan waktu tidur setiap malam, supaya sasaran harian anda boleh dikira.",
          "Tidak dibaca: denyutan jantung, laluan GPS, berat badan, atau data kesihatan lain di luar senarai di atas.",
        ] },
        { note: "Data Apple Health tidak dijual, tidak digunakan untuk iklan atau penentuan profil iklan, dan tidak dikongsi dengan pihak ketiga. Data itu digunakan hanya untuk mengira dan memaparkan kemajuan anda. Memadam semua data di Profil memadam semua catatan yang sudah tersimpan di akaun anda." },
      ],
    },
    {
      id: "strava",
      title: "Strava (pilihan)",
      blocks: [
        "Jika anda menyambungkan Strava, JoyoRogo meminta kebenaran membaca aktiviti anda (read dan activity:read_all) untuk menukarnya menjadi kalori terbakar di diari anda. Apabila anda menekan Segerak di Profil atau Senaman, JoyoRogo mengambil 30 aktiviti terakhir anda.",
        { list: [
          "Dibaca daripada setiap aktiviti: jenis, nama, waktu mula, waktu bergerak dan kalori. Jika Strava tidak merekod kalori, kami menganggarkannya daripada jenis senaman, tempoh dan berat anda.",
          "Disimpan di akaun anda sebagai senaman, dengan nombor aktiviti Strava supaya tidak dicatat dua kali. Senaman daripada Strava hanya kelihatan kepada anda: tidak dikira dalam kumpulan, cabaran dan suapan, dan tidak digunakan untuk melaraskan sasaran anda.",
          "Token akses dan ID atlet Strava disimpan dalam pangkalan data JoyoRogo. JoyoRogo dan JoyoFit menggunakan satu aplikasi Strava, jadi sambungan itu dikongsi; senaman yang dimuat naik JoyoFit ke Strava tidak diimport lagi oleh JoyoRogo supaya tidak berganda.",
          "Senaman daripada Strava hanya disimpan 7 hari sejak aktivitinya, mengikut Dasar API Strava (bahagian 6.2: data Strava tidak boleh disimpan dalam cache lebih daripada tujuh hari). Selepas itu seluruh barisnya, termasuk kalori, dipadam secara automatik setiap beberapa minit, jadi kalori terbakar untuk hari yang lebih lama tidak lagi menyertakannya. Aktiviti yang sudah melepasi 7 hari tidak diimport langsung. Untuk kalori yang kekal tersimpan, gunakan Health Connect (Android) atau Apple Health (iPhone).",
        ] },
        { note: "Memutuskan Strava di JoyoRogo memadam senaman yang diimport daripada Strava lebih awal. Kebenarannya ditarik balik di Strava hanya jika JoyoFit juga tidak menggunakannya; jika masih digunakan, sambungan JoyoFit terus berjalan. Jika anda menarik balik aplikasi di strava.com (Tetapan, Aplikasi Saya), semua token dan semua senaman hasil import Strava turut terpadam. Memadam data atau akaun anda menarik balik kebenaran Strava sepenuhnya. JoyoRogo tidak menggunakan data Strava untuk iklan atau analitik, dan tidak menjualnya." },
      ],
    },
    {
      id: "coros",
      title: "COROS (pilihan)",
      blocks: [
        "Jika anda menyambungkan COROS, JoyoRogo meminta kebenaran melalui pelayan MCP rasmi COROS (openid mcp.tools offline_access) untuk membaca senaman daripada jam anda dan menukarnya menjadi kalori terbakar di diari anda. Data dibaca apabila anda menekan Segerak atau membuka halaman COROS di Profil.",
        { list: [
          "Dibaca daripada setiap senaman: jenis sukan, hari, tempoh dan kalori. Jika COROS tidak menghantar kalori, kami menganggarkannya daripada jenis senaman, tempoh dan berat anda.",
          "Disimpan di akaun anda sebagai senaman, dengan nombor aktiviti COROS supaya tidak dicatat dua kali. Senaman yang sama daripada Health Connect, Apple Health atau Strava tidak dikira dua kali.",
          "Token akses dan token penyegar COROS disimpan dalam pangkalan data JoyoRogo. Senaman daripada COROS digunakan seperti senaman lain di diari anda, termasuk untuk Joyo AI dan sasaran kalori anda.",
        ] },
        { note: "Memutuskan COROS di JoyoRogo memadam token dan semua senaman yang diimport daripada COROS. Memadam data atau akaun anda juga memadamkannya. Anda juga boleh menarik balik kebenaran JoyoRogo dalam aplikasi COROS. JoyoRogo tidak menggunakan data COROS untuk iklan dan tidak menjualnya." },
      ],
    },
    {
      id: "latihan-joyofit",
      title: "Latihan JoyoFit di awan (Pro)",
      blocks: [
        "Jika akaun anda Pro dan anda log masuk ke JoyoRogo di aplikasi JoyoFit, latihan yang dirakam JoyoFit disimpan di akaun anda supaya boleh dipulihkan di telefon baru dan dilihat di halaman Latihan JoyoFit di web. Akaun Free dan akaun yang belum log masuk di JoyoFit tidak memuat naik apa-apa; latihannya kekal hanya di telefon anda.",
        { list: [
          "Disimpan: ringkasan latihan, laluan GPS, denyutan jantung, ketinggian, kelajuan, irama langkah atau kayuhan, kuasa, dan analisis terbitan (jarak, masa bergerak, pendakian, zon, split).",
          "Tempat: storan Cloudflare milik JoyoRogo, dikaitkan dengan akaun anda dan tidak boleh dibuka tanpa log masuk.",
          "Siapa yang boleh melihat: hanya anda. Latihan yang anda kongsi ke suapan atau kumpulan ialah salinan berasingan yang sudah ditapis (contohnya tanpa laluan atau denyutan jantung jika anda menyembunyikannya), bukan data awan ini. Lihat bahagian Komuniti.",
          "Tidak digunakan untuk iklan atau melatih model, dan tidak dijual.",
        ] },
        { note: "Padam satu latihan atau semuanya dari halaman Latihan JoyoFit di web, atau melalui Settings, Health Connect and cloud (di iPhone: Apple Health and cloud), bahagian Segerak awan, Delete cloud data, di aplikasi. Memadam latihan juga memadamnya daripada telefon yang menyegerakkannya pada segerak berikutnya. Memadam semua data atau akaun juga memadam semua latihan awan. Jika Pro tamat, latihan yang sudah tersimpan masih boleh dibaca dan dipadam; latihan baru tidak dimuat naik sehingga Pro aktif semula." },
      ],
    },
    {
      id: "riwayat-beban",
      title: "Sejarah latihan beban lama",
      blocks: [
        "Latihan beban kini dicatat di JoyoFit. Sejarah lama di JoyoRogo masih boleh dilihat, tidak boleh diubah. Sejarah yang anda bawa ke JoyoFit disimpan di JoyoFit (di telefon anda, dan di awan JoyoFit untuk Pro). Memadam data di JoyoRogo tidak memadam salinan itu.",
      ],
    },
    {
      id: "joyo-ai-rogo",
      title: "Joyo AI dalam JoyoRogo (Pro)",
      blocks: [
        "Joyo AI menjawab soalan tentang makanan dalam web dan aplikasi telefon JoyoRogo: tentang catatan makanan anda sendiri, atau membandingkan makanan sebelum anda makan. Ia untuk akaun Pro dan pengguna berumur 18 tahun ke atas. Joyo AI bukan doktor atau pakar pemakanan, dan jawapannya boleh tersilap dan bukan nasihat perubatan.",
        { list: [
          "Tiada apa-apa dihantar sebelum anda bersetuju dengan notis sekali sahaja di awal. Notis itu menyenaraikan data yang dihantar.",
          "Dihantar apabila anda bertanya: mesej yang anda taip dan sehingga 12 mesej terakhir dalam perbualan itu; umur, jantina, tinggi dan matlamat anda; sasaran harian anda (kcal, protein, karbohidrat, lemak, serat, serta berat dan tarikh sasaran); catatan hari ini (jumlah makan, baki sasaran, nama, berat dan kcal setiap makanan, air minuman, dan status puasa); tujuh hari terakhir (kcal, protein, serat dan air); dan berat badan terkini beserta perubahannya. Jika AI memintanya, catatan makanan dan berat sehingga 90 hari ke belakang turut dibacakan, hanya dibaca dan tidak pernah diubah.",
          "Ia dihantar melalui pelayan JoyoRogo kepada penyedia AI kami, iaitu Cloudflare Workers AI, hanya untuk menjawab soalan anda, dan tidak digunakan untuk melatih model.",
          "Tidak pernah dihantar: nama, e-mel, foto, lokasi atau GPS, data kitaran haid, mod hamil atau menyusu, data Strava dan ID peranti. Jika anda sendiri menulis dalam mesej bahawa anda hamil atau menyusu, Joyo AI menjawab dengan lebih berhati-hati, tetapi itu tidak pernah dibaca daripada akaun anda.",
          "Mesej dan jawapan tidak disimpan di pelayan kami. Yang dicatat hanyalah bilangan soalan sehari (untuk had harian) dan penggunaan token.",
          "Perbualan disimpan pada peranti anda sahaja: dalam pelayar untuk web, dalam telefon untuk aplikasi. Perbualan tidak disegerakkan ke akaun anda atau peranti lain. Di web, Padam semua perbualan dalam sejarah Joyo AI memadamkannya, begitu juga memadam data laman dalam pelayar, yang sekali gus menarik balik persetujuan anda.",
          "Mesej yang menyebut kecederaan, sakit, gejala, ubat atau gangguan pemakanan dijawab dengan saranan berjumpa doktor atau pakar pemakanan, tanpa petua diet. Joyo AI tidak tersedia untuk pengguna di bawah 18 tahun.",
        ] },
        "Dalam aplikasi telefon, Joyo AI juga boleh menggunakan kunci API anda sendiri tanpa Pro. Laluan itu berasingan: telefon anda menghantar terus kepada penyedia pilihan anda (OpenRouter, OpenAI, Anthropic atau Google Gemini), tidak melalui pelayan JoyoRogo, dan kunci itu kekal dalam storan selamat telefon anda. Selepas data sampai kepada penyedia itu, peraturan privasi penyedia itu pula yang terpakai. Data daripada Health Connect atau Apple Health (langkah, senaman, tidur, degupan jantung) tidak pernah dihantar melalui laluan ini. Web tidak menyokong kunci sendiri.",
      ],
    },
    {
      id: "coach-joyofit",
      title: "Coach JoyoFit (Pro)",
      blocks: [
        "Coach di aplikasi JoyoFit mempunyai dua bahagian yang menyentuh pelayan: dokumen pelan dan ciri Tanya coach. Kedua-duanya hanya untuk akaun Pro. Coach bukan doktor dan jawapannya bukan nasihat perubatan.",
        { list: [
          "Dokumen pelan: pilihan pelan latihan anda (jenis, tahap, hari, tarikh mula), sesi yang anda tanda atau langkau, dan ulangan serta beban yang anda catat. Disimpan dalam pangkalan data JoyoRogo, dikaitkan dengan akaun anda, supaya sama di semua telefon anda dan boleh dipulihkan. Hanya anda yang boleh membacanya. Dipadam apabila anda menggunakan Padam semua data saya atau memadam akaun.",
          "Tanya coach: mesej yang anda taip, ringkasan data kecergasan daripada telefon anda (kesiapan, tidur, beban latihan, latihan terakhir, pelan), dan sedikit data akaun anda (profil, berat terakhir, ringkasan makan) dihantar kepada penyedia AI, iaitu Cloudflare Workers AI, untuk dijawab.",
          "Mesej dan jawapan Tanya coach tidak disimpan di pelayan kami. Yang dicatat hanyalah bilangan mesej sehari (untuk had harian) dan penggunaan token.",
          "Mesej yang menyebut kecederaan, sakit, gejala, ubat atau gangguan pemakanan dijawab dengan saranan berjumpa doktor atau ahli fisioterapi, tanpa saranan latihan atau diet.",
          "Tidak digunakan untuk iklan atau melatih model, dan tidak dijual.",
        ] },
      ],
    },
    {
      id: "beberapa-telefon",
      title: "Tetapan di semua telefon anda",
      blocks: [
        "Supaya dua atau tiga telefon (Android dan iPhone) memaparkan perkara yang sama, pilihan kecil yang anda tetapkan disimpan di akaun anda dan turut ke telefon lain selepas anda log masuk. Ini terpakai untuk semua akaun di JoyoRogo; di JoyoFit hanya untuk akaun Pro.",
        { list: [
          "JoyoRogo (semua akaun): tema, peringatan (waktu dan hari), paparan dan penapis di tab Makan, pilihan privasi pelekat (sembunyikan angka, paparkan nama, tera air), dan pengumuman yang sudah anda tutup. Bahasa disimpan dalam profil anda.",
          "JoyoFit (Pro): tetapan yang mengikut akaun (profil, sasaran harian, tema, bahasa, unit suhu dan nama bandar cuaca, suis kitaran dan peringatannya, laporan tidur), templat pelekat buatan anda, laluan yang anda simpan, HRV, skor tidur, metrik kesihatan yang dilaporkan jam, serta langkah dan tidur 90 hari terakhir untuk dipulihkan di telefon baru.",
          "Data kitaran (haid dan catatan harian) ialah data kesihatan. Ia hanya mengikut akaun Pro dan mempunyai suis sendiri, Segerak data kitaran, yang hidup secara lalai. Mematikannya memadam salinan kitaran di awan.",
          "Tidak mengikut akaun: kebenaran pemberitahuan, suis lokasi, sambungan Health Connect atau Apple Health, pilihan kamera, selang denyutan mentah, dan kunci pasangan jam. Jam mesti dipasangkan sendiri di setiap telefon.",
          "Data Health Connect (Android) dan Apple Health (iPhone) tidak pernah dicampur. Jika dua telefon melaporkan hari yang sama, angka langkah tidak turun dan tidur yang lebih panjang digunakan, dan senaman yang sama tidak dicatat dua kali.",
        ] },
        { note: "Disimpan dalam pangkalan data JoyoRogo, dikaitkan dengan akaun anda, dan hanya anda yang boleh membacanya. Tidak digunakan untuk iklan atau melatih model, dan tidak dijual. Dipadam apabila anda menggunakan Padam semua data saya atau memadam akaun, dan di JoyoFit melalui Delete cloud data." },
      ],
    },
    {
      id: "wawasan-tidur",
      title: "Wawasan tidur (pilihan)",
      blocks: [
        "Wawasan tidur mati secara lalai. Hanya selepas anda menghidupkannya (di JoyoRogo atau di JoyoFit, satu suis yang sama), JoyoFit menghantar satu ringkasan setiap malam ke akaun anda. Isinya:",
        { list: [
          "Waktu mula tidur dan waktu bangun, serta perbezaan zon waktu telefon anda.",
          "Tempoh tidur, tempoh terjaga dan berapa kali anda terjaga.",
          "Jumlah peringkat tidur (dalam, REM, ringan) jika jam tangan anda mengukurnya.",
          "Skor tidur daripada jam tangan, HRV malam dan denyutan jantung rehat malam.",
          "Tidur siang (waktu mula dan tamat).",
          "Jika anda memasang termometer bilik di JoyoFit: purata, terendah dan tertinggi suhu dan kelembapan bilik semasa tidur (bukan bacaan seminit).",
        ] },
        "JoyoRogo menyelaraskan ringkasan itu dengan catatan makan dan senaman anda untuk menggambarkan corak, contohnya bila makan malam terakhir atau hari anda bersenam. Teks AI hanya melihat bilangan dan purata, tidak pernah malam demi malam atau nama makanan. Kafein dan alkohol hanya dikira daripada catatan makan anda yang sudah ada, dan tiada data senaman baru dihantar daripada JoyoFit.",
        "Disimpan paling banyak 90 malam terakhir. Mematikan suis serta-merta memadam semua malam yang tersimpan, begitu juga Padam semua data saya dan memadam akaun. Data ini tidak dikongsi dengan kumpulan, suapan, keluarga atau penyambung MCP, tidak digunakan untuk iklan atau penjejakan, dan tidak dijual. Wawasan tidur bukan nasihat perubatan; jika tidur anda terus terganggu, berbincanglah dengan pakar kesihatan.",
        "Di catatan makan ada juga ruang pilihan \"waktu makan\". Waktu itu disimpan bersama entri makanannya, digunakan untuk wawasan berasaskan waktu, dan dipadam bersama catatan makan anda.",
      ],
    },
    {
      title: "Komuniti: suapan dan kumpulan",
      blocks: [
        "Tiada apa-apa yang dikongsi secara automatik. Hanya perkara yang anda pilih untuk disiarkan (makanan, latihan, berat atau cerita, dengan foto dan keterangan yang anda tulis) yang kelihatan kepada orang lain: kepada ahli kumpulan anda, atau kepada semua orang jika anda memilih awam dan menghidupkan profil awam. Nama, foto profil, nama pengguna (handle) dan bio turut dipaparkan bersama siaran anda. Siaran awam dan komen boleh dilaporkan, dan pengguna boleh menyekat pengguna lain. Anda boleh memadam siaran anda bila-bila masa.",
        "Latihan daripada jam yang anda siarkan melalui JoyoFit (Share to JoyoRogo) boleh membawa laluan GPS, graf denyutan jantung dan analisis latihan, mengikut suis yang anda pilih semasa menyiarkan. Ringkasan latihan kelihatan kepada khalayak yang anda pilih (kumpulan atau awam); butirannya (peta, graf, split, zon) kelihatan kepada anda dan ahli JoyoRogo Pro. Siaran itu salinan berasingan: memadam latihan di telefon atau di awan tidak memadam siarannya, dan memadam siaran memadam kudos, komen, laluan dan grafnya. Siaran dan komen disimpan sehingga anda memadamnya atau akaun anda dipadam.",
        "Menyertai cabaran kumpulan bermakna ahli kumpulan itu boleh melihat sama ada sasaran anda tercapai setiap hari, streak anda, dan angka langkah, strain, tidur atau bilangan latihan anda untuk cabaran tersebut. Angka makanan anda (kalori dan protein) hanya kelihatan kepada anda, rakan hanya melihat tercapai atau tidak. Anda boleh keluar daripada cabaran bila-bila masa dan data anda di papan kedudukannya turut hilang.",
        "Papan konsistensi mingguan (pilihan, mati secara lalai). Jika anda menyertainya, orang lain melihat nama atau nama samaran pilihan anda, bilangan hari anda mencatat, hari senaman, hari protein dan streak anda pada minggu itu. Berat badan dan data badan tidak pernah dipaparkan, dan papan tidak pernah disusun mengikut berat. Papan tidak tersedia semasa hamil atau menyusu. Keluar daripada papan serta-merta memadam data anda di papan, dan Padam semua data atau memadam akaun turut memadam lencana dan data papan anda. Lencana dikira daripada catatan anda; pada profil awam, lencana hanya kelihatan jika profil awam anda dihidupkan.",
      ],
    },
    {
      id: "keluarga",
      title: "Keluarga di JoyoFit (pilihan)",
      blocks: [
        "Di aplikasi JoyoFit ada ciri Keluarga yang mati sehingga orang yang dipantau menerima jemputan. Pemantau perlu log masuk dengan akaun JoyoRogo, dan nama JoyoRogo setiap orang dipaparkan kepada orang yang terhubung dengannya.",
        { list: [
          "Yang dihantar hanyalah ringkasan harian: langkah, denyutan jantung rehat, tidur semalam, tahap oksigen (SpO2) jika dihidupkan, serta bila jam terakhir bersambung dan bateri jam. Tidak pernah dihantar: lokasi, laluan, denyutan jantung seminit, makanan dan foto.",
          "Tempat: pelayan awan JoyoFit di akaun Cloudflare pembangun, berasingan daripada pangkalan data JoyoRogo dan dikaitkan dengan ID akaun JoyoRogo anda. Sejarah ringkasan disimpan 30 hari untuk pemantau Percuma dan 90 hari untuk pemantau Pro, kemudian dipadam secara automatik.",
          "Orang yang dipantau menetapkan setiap kategori, boleh menjeda atau berhenti bila-bila masa (pemantau serta-merta tidak dapat melihat apa-apa dan ringkasan yang terhantar dipadam), dan sentiasa boleh melihat siapa yang memantau.",
          "Memadam akaun JoyoRogo memadam semua pautan Keluarga, ringkasan dan token push, sebagai orang yang dipantau mahupun sebagai pemantau.",
        ] },
        { note: "Butiran lengkap ada di [fit.joyorogo.com/privasi](https://fit.joyorogo.com/privasi#keluarga) (Bahasa Indonesia)." },
      ],
    },
    {
      id: "notifikasi",
      title: "Pemberitahuan push",
      blocks: [
        "Pemberitahuan mati sehingga anda sendiri membenarkannya. Ada dua jenis, dan kedua-duanya hanya digunakan untuk memberitahu anda, bukan untuk iklan.",
        { list: [
          "Di pelayar (web): jika anda membenarkan pemberitahuan, kami menyimpan langganan push pelayar anda (alamat endpoint dan kunci penyulitannya) untuk peringatan puasa, kudos dan komen di suapan, dan colek kumpulan. Pemberitahuan dihantar melalui perkhidmatan push milik pelayar anda. Langganan yang sudah tidak sah dipadam secara automatik, dan memadam semua data atau akaun juga memadamnya.",
          "Di aplikasi JoyoFit (Keluarga): token push telefon anda (token Expo) disimpan di pelayan JoyoFit dan digunakan untuk memberitahu pemantau apabila data kelihatan luar biasa. Pemberitahuan dihantar melalui perkhidmatan push Expo, kemudian Google Firebase Cloud Messaging (Android) atau Apple Push Notification service (iPhone). Token dipadam apabila anda log keluar di JoyoFit dan apabila akaun dipadam.",
        ] },
      ],
    },
    {
      id: "pembayaran",
      title: "Pembayaran",
      blocks: [
        "Di web, Pro dibayar sekali bagi satu tempoh melalui halaman pembayaran di pelayar: QRIS melalui Pakasir atau pindahan bank melalui DOKU (kaedah rupiah). Kami menyimpan nombor pesanan, jumlah, status dan waktu pembayaran. DOKU menerima nama dan e-mel anda untuk membuat halaman pembayaran. Kami tidak menyimpan nombor kad, akaun bank atau data dompet digital anda; itu dikendalikan penyedia pembayaran. Bukti pembayaran dihantar ke e-mel anda.",
        "Pembelian dalam dolar AS (USD) di web diproses oleh Polar (polar.sh, Polar Software Inc.), merchant of record bagi transaksi itu. Polar mengumpul data kad, nama, e-mel, negara atau alamat bil, dan nombor cukai (jika ada) untuk mengira cukai dan menyemak penipuan. JoyoRogo menerima nombor pesanan, jumlah, status, status langganan dan ID pelanggan Polar. JoyoRogo tidak pernah melihat nombor kad anda. Dasar privasi Polar: [polar.sh/legal/privacy](https://polar.sh/legal/privacy).",
        "Di aplikasi, Pro ialah langganan automatik melalui App Store (iPhone) atau Google Play (Android). Pembayarannya dikendalikan Apple atau Google; kami tidak menerima nombor kad atau data pembayaran anda. Yang kami simpan untuk mengaitkan langganan dengan akaun anda dan memperbaharui atau menarik balik Pro apabila Apple atau Google memberi khabar (pembaharuan, pembatalan, bayaran balik):",
        { list: [
          "App Store: ID transaksi asal, ID produk, persekitaran (Sandbox atau Production), status langganan, tarikh tamat, dan token rawak yang digunakan aplikasi semasa membeli.",
          "Google Play: token pembelian, ID produk dan pelan asas, status langganan, dan ID pesanan terakhir.",
          "Catatan setiap transaksi: nombor transaksi atau pesanan, jumlah dalam rupiah, bilangan bulan, status dan waktu.",
        ] },
        { note: "Langganan diurus dan dibatalkan di tetapan Apple atau Google, bukan di JoyoRogo." },
        { note: "Syarat pembelian ada di [Syarat Perkhidmatan](/my/syarat) dan [Pengembalian Dana](/pengembalian-dana) (Bahasa Indonesia)." },
      ],
    },
    {
      id: "masuk-apple",
      title: "Log masuk dengan Apple",
      blocks: [
        "Di aplikasi iPhone anda boleh log masuk dengan Apple, selain dengan Google. Apple menghantar token identiti kepada aplikasi, kemudian JoyoRogo menyemaknya dengan Apple. Yang kami terima dan simpan: ID pengguna Apple untuk akaun anda, e-mel (alamat geganti peribadi Apple jika anda memilih Sembunyikan E-mel Saya), dan nama jika Apple menghantarnya. Jika tiada nama, kami menggunakan \"Pengguna\". Kami tidak menerima kata laluan Apple ID anda.",
        "Apabila anda memadam akaun dari aplikasi, JoyoRogo menarik balik token Sign in with Apple milik akaun anda di Apple terlebih dahulu. Untuk itu aplikasi meminta anda log masuk semula dengan Apple, dan jika penarikan balik gagal, akaun anda belum dipadam dan boleh dicuba lagi.",
      ],
    },
    {
      id: "tidak-dilakukan",
      title: "Yang tidak kami lakukan",
      blocks: [
        { list: [
          "Tidak menjual data anda kepada sesiapa.",
          "Tidak mengongsi data anda dengan pihak ketiga selain pemproses yang disenaraikan di bahagian Pemproses dan pihak ketiga, hanya setakat yang perlu untuk ciri yang anda gunakan.",
          "Tidak menggunakan data anda untuk iklan.",
        ] },
        { note: "Data yang boleh dilihat orang lain hanyalah halaman kemajuan awam dan siaran yang anda kongsi sendiri ke suapan atau kumpulan (lihat bahagian Komuniti). Halaman kemajuan awam hanya aktif jika anda menghidupkannya di Profil, berisi berat awal hingga berat sekarang sahaja, tanpa e-mel dan tanpa catatan makan." },
        { note: "Untuk tahu halaman dan butang mana yang digunakan, kami menggunakan analitik tanpa kuki (Revklik): halaman yang dibuka, sumber lawatan, jenis peranti, dan langkah seperti daftar atau pembayaran Pro. Tanpa nama, e-mel atau catatan kesihatan anda." },
      ],
    },
    {
      id: "koneksi-ai",
      title: "Sambungan AI (Claude dan ChatGPT)",
      blocks: [
        "Ciri JoyoRogo Pro ini membenarkan aplikasi AI pilihan anda, contohnya Claude daripada Anthropic atau ChatGPT daripada OpenAI, membaca data anda. Tiada apa-apa yang bersambung kecuali anda sendiri menambah penyambungnya di aplikasi AI itu, log masuk ke JoyoRogo, dan menekan Benarkan pada skrin kebenaran yang menyebut data apa yang diminta.",
        { list: [
          "Yang dikongsi: hanya data yang kebenarannya anda setujui (profil dan sasaran, catatan makan, berat badan, latihan, tidur dan pemulihan), dan hanya dibaca. Aplikasi AI tidak boleh mencatat, mengubah atau memadam apa-apa di akaun anda.",
          "Bila dan kepada siapa: data dihantar daripada JoyoRogo kepada aplikasi AI itu dan penyedianya, dan hanya apabila anda mengemukakan soalan di akaun anda di sana. JoyoRogo tidak menghantar data anda ke mana-mana atas inisiatif sendiri melalui sambungan ini.",
          "Selepas sampai di penyedia AI, peraturan privasi, penyimpanan dan tetapan latihan model mereka yang terpakai. JoyoRogo tidak dapat mengawalnya, jadi semak tetapan di akaun anda di sana.",
          "Log audit: kami mencatat alat yang digunakan dan julat tarikhnya (bukan isi datanya), disimpan 90 hari, dan boleh anda lihat di Sambungan AI.",
          "Penarikan balik: anda boleh memutuskan aplikasi bila-bila masa di Sambungan AI dan aksesnya berhenti serta-merta. Memadam data anda di JoyoRogo memutuskan semua aplikasi yang bersambung.",
          "Penyimpanan token: token akses sah satu jam, dan token penyegarnya sehingga 30 hari atau sehingga anda memutuskan aplikasinya, mana-mana yang lebih awal.",
          "Tidak pernah dikongsi: laluan GPS dan data yang diimport daripada Strava.",
        ] },
        { note: "Data kesihatan di sini bukan nasihat perubatan, dan jawapan AI boleh tersilap." },
        "Langkah menyambungkan dan butirannya ada di [panduan Claude dan ChatGPT](/panduan/ai) (Bahasa Indonesia).",
      ],
    },
    {
      id: "hapus-akun",
      title: "Padam akaun dan data",
      blocks: [
        "Anda boleh memadam seluruh catatan (profil, berat, makanan, senaman, tidur, siaran suapan, foto, lokasi, langganan pemberitahuan pelayar, latihan JoyoFit di awan, dokumen pelan Coach, dan malam tidur untuk wawasan tidur) secara kekal melalui butang **Padam semua data saya** di halaman Profil. Akaun anda masih boleh digunakan, jadi anda boleh bermula semula dari kosong bila-bila masa. Butang ini tidak memadam akaunnya: sejarah pembayaran dan status Pro kekal.",
        "Di aplikasi iPhone dan Android, butang **Padam akaun** di Profil memadam akaun itu sendiri: seluruh catatan, foto, lokasi dan latihan awan di atas, sambungan Strava (kebenarannya ditarik balik di Strava), pautan log masuk Google dan Apple, sesi, nama, e-mel dan sejarah pembayaran. Pro tidak boleh dipulihkan selepas itu. Langganan App Store atau Google Play tetap perlu anda batalkan sendiri di tetapan Apple atau Google.",
        "Di aplikasi JoyoFit, butang **Delete JoyoRogo account** (Settings, Health Connect and cloud, atau Apple Health and cloud di iPhone, bahagian Segerak awan) memadam akaun JoyoRogo yang sama beserta data JoyoFit-nya, termasuk latihan awan, pautan Keluarga dan token push. Butirannya ada di [fit.joyorogo.com/privasi](https://fit.joyorogo.com/privasi#hapus) (Bahasa Indonesia).",
        `Dari web, atau jika anda tidak mempunyai aplikasinya, hantar e-mel dari alamat akaun yang anda gunakan ke [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}?subject=Padam%20akaun%20JoyoRogo) dengan subjek **Padam akaun JoyoRogo**. Kami memadam akaun beserta seluruh datanya dan mengesahkan melalui e-mel selepas selesai. Halaman ini juga alamat permintaan pemadaman akaun untuk aplikasi JoyoRogo di Google Play.`,
      ],
    },
    {
      id: "pemproses",
      title: "Pemproses dan pihak ketiga",
      blocks: [
        "Kami tidak menjual data anda. Kami mengongsinya hanya dengan kelas pihak ketiga dan pemproses berikut, setakat yang perlu untuk ciri yang anda gunakan, seperti diterangkan di bahagian di atas:",
        { list: [
          "Penyedia infrastruktur dan AI: Cloudflare (Workers AI untuk foto, cerita dan Coach; storan dan pelayan, termasuk pelayan awan JoyoFit).",
          "Pembayaran: Polar (Polar Software Inc.) untuk pembelian USD; DOKU dan Pakasir untuk pembayaran rupiah; Apple (App Store) dan Google (Google Play) untuk langganan dalam aplikasi.",
          "Log masuk: Google dan Apple.",
          "Penyegerakan kesihatan dan senaman atas pilihan anda: Google (Health Connect), Apple (Apple Health) dan Strava.",
          "Pangkalan data produk untuk kod bar: Open Food Facts dan pangkalan data produk luar yang serupa (hanya nombor kod bar).",
          "Pemberitahuan push: Expo, Google Firebase Cloud Messaging (Android), Apple Push Notification service (iPhone), dan perkhidmatan push milik pelayar anda.",
          "Analitik tanpa kuki: Revklik.",
          "Aplikasi AI yang anda sendiri sambungkan melalui Sambungan AI, contohnya Anthropic (Claude) atau OpenAI (ChatGPT): hanya atas pilihan dan permintaan anda.",
        ] },
        "Pihak lain yang melihat data anda ialah pengguna lain, hanya untuk perkara yang anda pilih untuk disiarkan.",
      ],
    },
    {
      id: "merentas-sempadan",
      title: "Pemindahan merentas sempadan",
      blocks: [
        `Data anda diproses oleh kami di Indonesia (${COMPANY_REGION}) dan oleh pemproses di atas, yang boleh berada di negara lain di luar Malaysia dan Indonesia. Kami memindahkan data hanya setakat yang perlu untuk menyediakan ciri yang anda gunakan, dengan persetujuan anda apabila anda menggunakan ciri itu, dan tertakluk kepada syarat dan dasar privasi setiap pemproses.`,
        "Jika anda tidak bersetuju dengan pemindahan ini, jangan gunakan ciri yang berkenaan, atau padam akaun anda.",
      ],
    },
    {
      id: "pengekalan",
      title: "Berapa lama data disimpan",
      blocks: [
        { list: [
          "Akaun dan catatan harian: sehingga anda memadamnya (Padam semua data saya) atau memadam akaun. Padam semua data tidak memadam sejarah pembayaran dan status Pro; memadam akaun memadamnya.",
          "Foto makanan: ditahan sementara kira-kira 2 hari, kemudian dipadam. Foto label pemakanan dan rakaman suara tidak disimpan. Foto depan bungkusan juga tidak, kecuali anda menghidupkan pilihan pelekat: hanya potongannya disimpan, bersama catatan makanan itu.",
          "Senaman daripada Strava: 7 hari sejak aktivitinya.",
          "Wawasan tidur: paling banyak 90 malam terakhir.",
          "Ringkasan Keluarga: 30 hari (pemantau Percuma) atau 90 hari (pemantau Pro).",
          "Log audit Sambungan AI: 90 hari. Token akses sah satu jam, token penyegar sehingga 30 hari.",
          "Siaran dan komen komuniti: sehingga anda memadamnya atau akaun anda dipadam.",
          "Foto yang anda benarkan disimpan untuk memperbaiki AI: sehingga anda meminta pemadaman, atau anda memadam akaun atau semua data.",
        ] },
      ],
    },
    {
      id: "hak",
      title: "Hak anda dan cara membuat permintaan",
      blocks: [
        "Di bawah PDPA anda berhak:",
        { list: [
          "Mengakses data peribadi anda yang kami pegang.",
          "Meminta pembetulan data yang tidak tepat (anda juga boleh membetulkannya sendiri dalam aplikasi).",
          "Menarik balik persetujuan, termasuk persetujuan bagi data sensitif.",
          "Meminta pemadaman. Pemadaman sendiri sudah ada dalam aplikasi: Padam semua data saya, dan Padam akaun (lihat bahagian Padam akaun dan data).",
          "Meminta salinan data anda diberikan kepada anda atau kepada pengawal data lain, setakat yang dibenarkan Akta.",
        ] },
        `Cara membuat permintaan: ${contactLineMs}. Hantar dari alamat akaun yang anda gunakan supaya kami dapat mengesahkan anda. Sasaran kami ialah menjawab dalam masa 21 hari. Jika kami tidak dapat memenuhi permintaan sepenuhnya, kami akan menyatakan sebabnya.`,
      ],
    },
    {
      id: "pelanggaran",
      title: "Jika berlaku pelanggaran data",
      blocks: [
        "Jika berlaku pelanggaran data peribadi yang mungkin menyebabkan kemudaratan ketara, kami komited memberitahu Pesuruhjaya Perlindungan Data Peribadi dan pengguna yang terjejas mengikut tempoh yang ditetapkan PDPA.",
      ],
    },
    {
      id: "aduan",
      title: "Aduan",
      blocks: [
        `Hubungi kami dahulu supaya kami dapat membetulkannya. Anda juga berhak membuat aduan kepada Pesuruhjaya Perlindungan Data Peribadi Malaysia (Jabatan Perlindungan Data Peribadi): e-mel ${PDP_EMAIL}, telefon ${PDP_PHONE}.`,
      ],
    },
    {
      id: "bahasa",
      title: "Bahasa notis ini",
      blocks: [
        "Notis ini ada dalam Bahasa Melayu dan English, dan kedua-duanya sama sah. Jika ada bahagian yang tidak jelas atau kelihatan berbeza, hubungi kami dan kami akan menjelaskannya. Halaman Privasi asal dalam Bahasa Indonesia ada di [joyorogo.com/privasi](/privasi).",
        "Jika notis ini berubah, versi dan tarikh di atas ikut berubah.",
      ],
    },
    {
      id: "hubungi",
      title: "Hubungi",
      blocks: [
        `Ada soalan tentang data anda? ${COMPANY_NAME},${address} ${COMPANY_REGION}. [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}), WhatsApp [${WHATSAPP_DISPLAY}](https://wa.me/6289680839591).`,
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Privacy notice, English
// ---------------------------------------------------------------------------------------------------------------

const PRIVACY_EN: LegalDoc = {
  path: "/my/privacy",
  lang: "en",
  title: "Privacy Notice",
  intro:
    "Short and honest: what data is stored, what is not, who processes it, and how to delete it. This notice is for users in Malaysia and is written with the Personal Data Protection Act 2010 (Act 709, as amended in 2024) in mind.",
  version: `Version ${LEGAL_VERSION}`,
  sections: [
    {
      id: "controller",
      title: "Who we are (data controller)",
      blocks: [
        `The data controller for your personal data is ${COMPANY_NAME},${address} ${COMPANY_REGION}. We make and run JoyoRogo (the app, the web app and JoyoFit).`,
        `Contact: ${contactLineEn}. See the Contact section below.`,
        "This notice applies to joyorogo.com, the JoyoRogo apps on Android and iPhone, and the JoyoRogo features in JoyoFit.",
      ],
    },
    {
      id: "age",
      title: "Age: 18 and over",
      blocks: [
        "JoyoRogo is for users aged 18 and over. If we learn that we hold data of someone under 18, we delete the account and its data.",
      ],
    },
    {
      id: "purposes",
      title: "Why we process your data",
      blocks: [
        { list: [
          "To provide your account and sign-in (Google or Apple).",
          "To calculate your daily eat, burn and sleep targets from your personal details, and to show your progress.",
          "To estimate calories from photos, text or voice stories, and from barcode scans or nutrition label photos.",
          "To sync workouts, steps and sleep (Health Connect, Apple Health, Strava, JoyoFit) when you choose to.",
          "Community features (feed, groups, challenges) when you choose to post something.",
          "Pro payments, proving your subscription and emailing your receipt.",
          "To send the push notifications you allow, never ads.",
          "To measure and improve the accuracy of the AI, and to prevent abuse.",
          "To understand which pages and buttons are used, with cookie-free analytics (Revklik): no name, email or health records.",
          "To answer your requests and complaints.",
        ] },
        "We do not sell your data, do not use it for ads, and do not use it to train AI models.",
      ],
    },
    {
      id: "voluntary",
      title: "Which data is required and which is voluntary",
      blocks: [
        { list: [
          "Required to create an account: your name and email from Google or Apple (the email can be an Apple relay address). Without them we cannot provide an account. JoyoRogo does not store passwords.",
          "Needed for daily targets: year of birth, sex, height and weight. Without them we cannot calculate your targets.",
          "Voluntary: food photos, stories, weight log, workouts, sleep, water, eatery locations, Health Connect, Apple Health, Strava, JoyoFit cloud, Family, sleep insights, notifications, community posts and AI connections. All of them are off until you turn them on or use them yourself, and you can turn them off at any time.",
        ] },
      ],
    },
    {
      id: "sensitive",
      title: "Sensitive personal data and explicit consent",
      blocks: [
        "Some data you enter is sensitive personal data under the PDPA because it relates to your health or body: weight and height, food, workouts, sleep, heart rate, blood oxygen (SpO2) and cycle (period) data, and pregnancy or breastfeeding mode details if you use them.",
        "We process sensitive data only with your explicit consent. You give that consent when you enter the data or turn on the relevant optional feature, for the purposes above only. Cycle (period) data follows a Pro account and has its own switch (Sync cycle data).",
        "You can withdraw consent at any time: turn the feature off, delete the data in Profile, or contact us. Withdrawing consent may mean the feature no longer works.",
      ],
    },
    {
      id: "data",
      title: "Data we store",
      blocks: [
        { list: [
          "Account: name, email and profile photo from the Google account you sign in with. If you sign in with Apple on the iPhone app, we store your name (when Apple provides it) and email, which can be an Apple relay address. JoyoRogo does not store passwords.",
          "Personal details: year of birth, sex, height and weight.",
          "Daily records: weigh-ins, food, workouts, sleep and water.",
          "Daily plan: eat, burn and sleep targets calculated from your personal details.",
        ] },
        { note: "One account = one set of data. We store nothing you did not enter yourself." },
        { note: "Everything sent between the app or browser and the JoyoRogo server uses HTTPS (TLS)." },
      ],
    },
    {
      title: "Camera, gallery and barcodes",
      blocks: [
        "The camera is used only when you photograph food to count its calories, scan a package barcode, or photograph the \"Nutrition Information\" table on a package. The gallery is used only for photos you pick yourself (food photos, label photos, profile photos, story photos). We do not read your gallery beyond the photos you pick. For barcodes, only the barcode number goes through our server and external product databases, such as Open Food Facts (an open product database), to fetch nutrition info. The number is not sent with your name or email.",
        "If you photograph a product's nutrition label, the photo of the table (and the photo of the front of the pack, if you take one) is sent once to our server to be read by AI, then discarded: the photo is not stored or kept. What is stored is only the product name and the nutrition figures you type or confirm yourself in the form. That product data is shared with all JoyoRogo users so they can scan the same product. Your contribution stays linked to your account so we can count how many people confirmed the figures and limit abuse, but your name is not shown to other users.",
        "There is one exception, and only if you switch it on: the label photo screen has an option \"Use the front photo as my meal's sticker\", which is always off and only appears after you take a photo of the front of the pack. When it is on, the server cuts that front photo out (background removed) and keeps only the cutout, at a random address that cannot be guessed, as the sticker of the meal you log from that product. The original photo and the nutrition table photo are still discarded. The cutout is not part of the shared product data. Delete the food entry and its sticker is deleted too, as it is when you delete your account or all your data. If you never log the meal, the cutout is deleted automatically after about 2 days. With the option off, a product from a label gets no sticker made from your photo.",
      ],
    },
    {
      title: "Food photos",
      blocks: [
        "Photos you send are passed to AI (Cloudflare Workers AI) to count calories and nutrients, and are not used to train models. The photo is held temporarily on the server so the \"Recalculate\" button can use the same photo, then deleted automatically after about 2 days (automatic deletion can run a little late). Original photos are not stored permanently. What we store is only the cut-out of each food (without background) as a diary sticker, at a random address that cannot be guessed; delete the food entry and its sticker is deleted too.",
        "If you rate a scan result \"Not accurate\" or \"Wrong\", there is an optional, unticked box: \"You may keep this photo to help improve the AI\". Only if you tick it is the photo stored together with your note, the AI's food list and the result you saved. It is used only to test and improve JoyoRogo's AI, can be deleted on request, and is also deleted when you delete your account or all data. Without the tick, the photo is not kept beyond the temporary period above.",
        "For every photo scan, the AI's answer text (food list, estimated weight, calories and nutrients, without the photo) is stored with the final result you log. The purpose is to measure and improve AI accuracy. That text is deleted when you delete your account or all data.",
        "If you turn on \"Keep original photo\" in Profile, the original photo (a small version) of scans you save is kept so you can view it again in the diary. Only your account can open it. Turning the setting off, or deleting all data, deletes all stored original photos.",
        "One exception: accounts in the internal accuracy dataset (currently only the JoyoRogo maker's own account) keep scan photos, AI answers, corrections and the saved final result, to evaluate the model. The photos are not used to train models and can be deleted on request. Other accounts are not affected.",
      ],
    },
    {
      title: "Eatery locations",
      blocks: [
        "Location is off by default. If you turn on \"Save eatery location\" when logging a plate with a place name, we store the place's point rounded to about 100 metres, not the exact point. The location is used only for the map and the \"Nearest\" order in the Places tab, is visible only to your account, and never appears on a public profile or feed.",
        "Locations can be deleted one place at a time or all at once from the Places tab without changing your food records. Deleting all data also deletes all stored locations.",
      ],
    },
    {
      title: "Stories and voice recordings",
      blocks: [
        "When you describe your food, your text or voice recording is passed to AI (Cloudflare Workers AI) to be turned into text and have its calories counted. Voice recordings are not stored and not used to train models. Only the foods you choose to log are stored.",
      ],
    },
    {
      title: "Health Connect (Android)",
      blocks: [
        "If you connect Health Connect in the Android app, you choose which data to allow, and you can revoke permission at any time from Health Connect. JoyoRogo reads workout sessions, steps, distance, active calories and sleep sessions from the last 7 days, only while the app is open, and does not read in the background.",
        { list: [
          "Read: workout sessions, steps, distance, active calories and sleep.",
          "Stored in your account: each workout (name, duration, calories), daily summaries (steps, distance, active calories) and sleep hours per night, so your daily targets can be calculated.",
          "Written to Health Connect: food you log (name, calories, protein, carbohydrate, fat, fibre, meal type), so other health apps you allow can read it.",
        ] },
        { note: "Health Connect data is not sold, not used for ads or ad profiling, and not shared with third parties. It is used only to calculate and show your progress. Deleting all data in Profile deletes all records already stored in your account; data we already wrote to Health Connect is deleted through the Health Connect app." },
      ],
    },
    {
      id: "apple-health",
      title: "Apple Health (iPhone)",
      blocks: [
        "If you connect Apple Health in the iPhone app, iOS asks your permission through Apple Health's own dialog, and you can revoke it at any time in the Health app or iPhone Settings. JoyoRogo only reads; the app writes nothing to Apple Health. What is read is data from the last 7 days, when you run sync from Profile, and afterwards when the app is opened. There is no background reading.",
        { list: [
          "Read: workouts (type, start and end time, calories), steps, walking and running distance, active calories and sleep.",
          "Stored in your account: each workout (name, type, duration, calories), daily summaries (steps, distance, active calories, exercise minutes) and sleep hours per night, so your daily targets can be calculated.",
          "Not read: heart rate, GPS routes, body weight, or any other health data outside the list above.",
        ] },
        { note: "Apple Health data is not sold, not used for ads or ad profiling, and not shared with third parties. It is used only to calculate and show your progress. Deleting all data in Profile deletes all records already stored in your account." },
      ],
    },
    {
      id: "strava",
      title: "Strava (optional)",
      blocks: [
        "If you connect Strava, JoyoRogo asks for permission to read your activities (read and activity:read_all) to turn them into calories burned in your diary. When you press Sync in Profile or Workouts, JoyoRogo fetches your last 30 activities.",
        { list: [
          "Read from each activity: type, name, start time, moving time and calories. If Strava does not record calories, we estimate them from the workout type, duration and your weight.",
          "Stored in your account as a workout, with the Strava activity number so it is not logged twice. Workouts from Strava are visible only to you: they do not count in groups, challenges or the feed, and are not used to adjust your targets.",
          "Strava access tokens and athlete ID are stored in the JoyoRogo database. JoyoRogo and JoyoFit use one Strava app, so the connection is shared; workouts JoyoFit uploads to Strava are not imported again by JoyoRogo so they are not doubled.",
          "Workouts from Strava are kept only 7 days from the activity, following the Strava API Agreement (section 6.2: Strava data may not be cached for more than seven days). After that the whole row, including calories, is deleted automatically every few minutes, so calories burned for older days no longer include it. Activities older than 7 days are not imported at all. For calories that stay stored, use Health Connect (Android) or Apple Health (iPhone).",
        ] },
        { note: "Disconnecting Strava in JoyoRogo deletes the workouts imported from Strava earlier. Permission is revoked at Strava only if JoyoFit is not using it too; if it is still in use, the JoyoFit connection keeps working. If you revoke the app at strava.com (Settings, My Apps), all tokens and all workouts imported from Strava are deleted too. Deleting your data or account revokes Strava permission completely. JoyoRogo does not use Strava data for ads or analytics, and does not sell it." },
      ],
    },
    {
      id: "coros",
      title: "COROS (optional)",
      blocks: [
        "If you connect COROS, JoyoRogo asks for permission through COROS's official MCP server (openid mcp.tools offline_access) to read the workouts from your watch and turn them into calories burned in your diary. Data is read when you press Sync or open the COROS page in Profile.",
        { list: [
          "Read from each workout: sport type, day, duration and calories. If COROS does not send calories, we estimate them from the workout type, duration and your weight.",
          "Stored in your account as a workout, with the COROS activity number so it is not logged twice. The same workout from Health Connect, Apple Health or Strava is not counted twice.",
          "COROS access and refresh tokens are stored in the JoyoRogo database. Workouts from COROS are used like any other workout in your diary, including by Joyo AI and for your calorie target.",
        ] },
        { note: "Disconnecting COROS in JoyoRogo deletes the tokens and every workout imported from COROS. Deleting your data or account removes them too. You can also revoke JoyoRogo's access in the COROS app. JoyoRogo does not use COROS data for advertising and does not sell it." },
      ],
    },
    {
      id: "joyofit-workouts",
      title: "JoyoFit workouts in the cloud (Pro)",
      blocks: [
        "If your account is Pro and you sign in to JoyoRogo in the JoyoFit app, workouts recorded by JoyoFit are stored in your account so they can be restored on a new phone and viewed on the JoyoFit Workouts page on the web. Free accounts and accounts not signed in on JoyoFit upload nothing; the workouts stay only on your phone.",
        { list: [
          "Stored: workout summary, GPS route, heart rate, elevation, speed, cadence, power, and derived analysis (distance, moving time, climb, zones, splits).",
          "Where: JoyoRogo's own Cloudflare storage, linked to your account and not openable without signing in.",
          "Who can see it: only you. A workout you share to the feed or a group is a separate, filtered copy (for example without the route or heart rate if you hide them), not this cloud data. See the Community section.",
          "Not used for ads or to train models, and not sold.",
        ] },
        { note: "Delete one workout or all of them from the JoyoFit Workouts page on the web, or in the app under Settings, Health Connect and cloud (on iPhone: Apple Health and cloud), Cloud sync section, Delete cloud data. Deleting a workout also deletes it from the phone that synced it at the next sync. Deleting all data or the account also deletes all cloud workouts. If Pro ends, workouts already stored can still be read and deleted; new workouts are not uploaded until Pro is active again." },
      ],
    },
    {
      id: "old-strength",
      title: "Old strength training history",
      blocks: [
        "Strength training is now logged in JoyoFit. Old history in JoyoRogo can still be viewed but not changed. History you brought to JoyoFit is stored in JoyoFit (on your phone, and in JoyoFit's cloud for Pro). Deleting data in JoyoRogo does not delete that copy.",
      ],
    },
    {
      id: "joyo-ai-rogo",
      title: "Joyo AI in JoyoRogo (Pro)",
      blocks: [
        "Joyo AI answers questions about food in the JoyoRogo web and phone app: about your own food log, or comparing foods before you eat. It is for Pro accounts and for people aged 18 and over. Joyo AI is not a doctor or a dietitian, and its answers can be wrong and are not medical advice.",
        { list: [
          "Nothing is sent until you agree to a one-time notice at the start. The notice lists the data that is sent.",
          "Sent when you ask a question: the message you type and up to the last 12 messages of that conversation; your age, sex, height and goal; your daily targets (kcal, protein, carbohydrate, fat, fibre, and your target weight and date); today's log (total eaten, what is left of your targets, the name, weight and kcal of each food, water, and fasting status); the last seven days (kcal, protein, fibre and water); and your latest weight with its change. If the AI asks for it, your food and weight log up to 90 days back is also read out, read only and never changed.",
          "It goes through the JoyoRogo server to our AI provider, Cloudflare Workers AI, only to answer your question, and is not used to train models.",
          "Never sent: your name, email, photos, location or GPS, menstrual cycle data, pregnancy or breastfeeding mode, Strava data, and device IDs. If you write in a message that you are pregnant or breastfeeding, Joyo AI answers more carefully, but that is never read from your account.",
          "Messages and answers are not stored on our server. Only the number of questions per day (for the daily limit) and token use are recorded.",
          "Conversations are kept on your own device only: in the browser for the web, on the phone for the app. They are not synced to your account or other devices. On the web, Delete all conversations in the Joyo AI history removes them, and so does clearing the site data in the browser, which also withdraws your consent.",
          "Messages that mention injury, pain, symptoms, medication or an eating disorder are answered with advice to see a doctor or a dietitian, with no diet tips. Joyo AI is not available to users under 18.",
        ] },
        "In the phone app, Joyo AI can also use your own API key without Pro. That route is separate: your phone sends straight to the provider you choose (OpenRouter, OpenAI, Anthropic or Google Gemini), not through the JoyoRogo server, and the key stays in your phone's secure storage. Once the data reaches that provider, the provider's own privacy rules apply. Data from Health Connect or Apple Health (steps, workouts, sleep, heart rate) is never sent on this route. The web does not support your own key.",
      ],
    },
    {
      id: "joyofit-coach",
      title: "JoyoFit Coach (Pro)",
      blocks: [
        "Coach in the JoyoFit app has two parts that touch the server: the plan document and Ask coach. Both are for Pro accounts only. Coach is not a doctor and its answers are not medical advice.",
        { list: [
          "Plan document: your training plan choices (type, level, days, start date), sessions you tick or skip, and the reps and weights you log. Stored in the JoyoRogo database, linked to your account, so it is the same on all your phones and can be restored. Only you can read it. Deleted when you use Delete all my data or delete your account.",
          "Ask coach: the message you type, a summary of fitness data from your phone (readiness, sleep, training load, last workout, plan), and a little of your account data (profile, latest weight, food summary) are sent to the AI provider, Cloudflare Workers AI, to be answered.",
          "Ask coach messages and answers are not stored on our server. Only the number of messages per day (for the daily limit) and token usage are recorded.",
          "Messages that mention injury, pain, symptoms, medicine or eating disorders are answered with advice to see a doctor or physiotherapist, with no exercise or diet advice.",
          "Not used for ads or to train models, and not sold.",
        ] },
      ],
    },
    {
      id: "many-phones",
      title: "Settings across all your phones",
      blocks: [
        "So that two or three phones (Android and iPhone) show the same thing, the small choices you set are stored in your account and follow you to another phone after you sign in. This applies to all accounts in JoyoRogo; in JoyoFit only to Pro accounts.",
        { list: [
          "JoyoRogo (all accounts): theme, reminders (time and days), view and filters in the Food tab, sticker privacy choices (hide numbers, show name, watermark), and announcements you dismissed. Language is stored in your profile.",
          "JoyoFit (Pro): settings that follow the account (profile, daily targets, theme, language, temperature unit and weather city name, cycle switch and its reminders, sleep report), sticker templates you made, routes you saved, HRV, sleep score, health metrics reported by the watch, and the last 90 days of steps and sleep to restore on a new phone.",
          "Cycle data (periods and daily notes) is health data. It only follows a Pro account and has its own switch, Sync cycle data, which is on by default. Turning it off deletes the cycle copy in the cloud.",
          "Does not follow the account: notification permission, location switch, Health Connect or Apple Health connection, camera choice, raw heart-rate interval, and watch pairing key. A watch must be paired on each phone.",
          "Health Connect (Android) and Apple Health (iPhone) data are never mixed. If two phones report the same day, the step count does not go down and the longer sleep is used, and the same workout is not logged twice.",
        ] },
        { note: "Stored in the JoyoRogo database, linked to your account, and readable only by you. Not used for ads or to train models, and not sold. Deleted when you use Delete all my data or delete your account, and in JoyoFit through Delete cloud data." },
      ],
    },
    {
      id: "sleep-insights",
      title: "Sleep insights (optional)",
      blocks: [
        "Sleep insights are off by default. Only after you turn them on (in JoyoRogo or in JoyoFit, one shared switch) does JoyoFit send one summary per night to your account. It contains:",
        { list: [
          "Sleep start and wake time, and your phone's time zone offset.",
          "Time asleep, time awake, and how many times you woke.",
          "Total sleep stages (deep, REM, light) if your watch measures them.",
          "Sleep score from the watch, night HRV and night resting heart rate.",
          "Naps (start and end time).",
          "If you set up a room thermometer in JoyoFit: average, lowest and highest room temperature and humidity during sleep (not minute-by-minute readings).",
        ] },
        "JoyoRogo lines the summary up with your food and workout records to describe patterns, for example when your last dinner was or the days you exercised. The AI text sees only counts and averages, never night by night or food names. Caffeine and alcohol are only counted from your existing food records, and no new workout data is sent from JoyoFit.",
        "At most the last 90 nights are stored. Turning the switch off immediately deletes all stored nights, as do Delete all my data and deleting your account. This data is not shared with groups, the feed, family or MCP connectors, not used for ads or tracking, and not sold. Sleep insights are not medical advice; if your sleep stays disturbed, talk to a health professional.",
        "In a food record there is also an optional \"meal time\" field. That time is stored with the food entry, used for time-based insights, and deleted together with your food record.",
      ],
    },
    {
      title: "Community: feed and groups",
      blocks: [
        "Nothing is shared automatically. Only what you choose to post (food, workouts, weight or stories, with the photo and caption you write) is visible to others: to your group members, or to everyone if you choose public and turn on your public profile. Your name, profile photo, username (handle) and bio appear with your post. Public posts and comments can be reported, and users can block other users. You can delete your posts at any time.",
        "Workouts from a watch that you post through JoyoFit (Share to JoyoRogo) can carry the GPS route, heart-rate chart and workout analysis, according to the switches you pick when posting. The workout summary is visible to the audience you chose (group or public); the details (map, charts, splits, zones) are visible to you and JoyoRogo Pro members. The post is a separate copy: deleting the workout on your phone or in the cloud does not delete the post, and deleting the post deletes its kudos, comments, route and charts. Posts and comments are kept until you delete them or your account is deleted.",
        "Joining a group challenge means that group's members can see whether your target is met each day, your streak, and your steps, strain, sleep or workout count for that challenge. Your food numbers (calories and protein) are visible only to you; friends see only met or not met. You can leave a challenge at any time and your data on its leaderboard disappears too.",
        "The weekly consistency board (optional, off by default). If you join, other people see your name or the alias you chose, how many days you logged, workout days, protein days and your streak that week. Body weight and body data are never shown, and the board is never ranked by weight. The board is not available during pregnancy or breastfeeding. Leaving the board deletes your data from it at once, and Delete all my data or deleting your account also removes your badges and board data. Badges are worked out from your logs; on a public profile they are visible only if your public profile is on.",
      ],
    },
    {
      id: "family",
      title: "Family in JoyoFit (optional)",
      blocks: [
        "The JoyoFit app has a Family feature that is off until the person being monitored accepts an invitation. The monitor must sign in with a JoyoRogo account, and each person's JoyoRogo name is shown to the person connected with them.",
        { list: [
          "Only a daily summary is sent: steps, resting heart rate, last night's sleep, blood oxygen (SpO2) if turned on, and when the watch last connected and its battery. Never sent: location, routes, per-minute heart rate, food and photos.",
          "Where: the JoyoFit cloud server in the developer's Cloudflare account, separate from the JoyoRogo database and linked to your JoyoRogo account ID. Summary history is kept 30 days for Free monitors and 90 days for Pro monitors, then deleted automatically.",
          "The monitored person sets each category, can pause or stop at any time (the monitor instantly sees nothing and summaries already sent are deleted), and can always see who is monitoring.",
          "Deleting the JoyoRogo account deletes all Family links, summaries and push tokens, both as the monitored person and as a monitor.",
        ] },
        { note: "Full details are at [fit.joyorogo.com/privasi](https://fit.joyorogo.com/privasi#keluarga) (Bahasa Indonesia)." },
      ],
    },
    {
      id: "notifications",
      title: "Push notifications",
      blocks: [
        "Notifications are off until you allow them yourself. There are two kinds, and both are used only to tell you things, not for ads.",
        { list: [
          "In the browser (web): if you allow notifications, we store your browser's push subscription (endpoint address and its encryption keys) for fasting reminders, kudos and comments on the feed, and group pokes. Notifications are sent through your browser's own push service. Subscriptions that are no longer valid are deleted automatically, and deleting all data or the account deletes them too.",
          "In the JoyoFit app (Family): your phone's push token (Expo token) is stored on the JoyoFit server and used to tell the monitor when data looks unusual. Notifications are sent through the Expo push service, then Google Firebase Cloud Messaging (Android) or the Apple Push Notification service (iPhone). The token is deleted when you sign out in JoyoFit and when the account is deleted.",
        ] },
      ],
    },
    {
      id: "payments",
      title: "Payments",
      blocks: [
        "On the web, Pro is paid once per period on the payment page in the browser: QRIS through Pakasir or bank transfer through DOKU (rupiah methods). We store the order number, amount, status and payment time. DOKU receives your name and email to create the payment page. We do not store your card, bank account or e-wallet details; the payment provider handles them. A receipt is sent to your email.",
        "Purchases in US dollars (USD) on the web are processed by Polar (polar.sh, Polar Software Inc.), the merchant of record for those transactions. Polar collects card details, name, email, country or billing address, and tax number (if any) to calculate tax and check for fraud. JoyoRogo receives the order number, amount, status, subscription status and the Polar customer ID. JoyoRogo never sees your card number. Polar's privacy policy: [polar.sh/legal/privacy](https://polar.sh/legal/privacy).",
        "In the app, Pro is an automatic subscription through the App Store (iPhone) or Google Play (Android). Payment is handled by Apple or Google; we do not receive your card number or payment data. What we store to link the subscription to your account and to renew or revoke Pro when Apple or Google tell us (renewal, cancellation, refund):",
        { list: [
          "App Store: original transaction ID, product ID, environment (Sandbox or Production), subscription status, end date, and the random token the app used when purchasing.",
          "Google Play: purchase token, product and base plan IDs, subscription status, and last order ID.",
          "A record of each transaction: transaction or order number, amount in rupiah, number of months, status and time.",
        ] },
        { note: "Subscriptions are managed and cancelled in Apple or Google settings, not in JoyoRogo." },
        { note: "Purchase terms are in the [Terms of Service](/my/terms) and [Refunds](/pengembalian-dana) (Bahasa Indonesia)." },
      ],
    },
    {
      id: "sign-in-apple",
      title: "Sign in with Apple",
      blocks: [
        "In the iPhone app you can sign in with Apple, as well as with Google. Apple sends an identity token to the app, then JoyoRogo checks it with Apple. What we receive and store: the Apple user ID for your account, your email (Apple's private relay address if you choose Hide My Email), and your name if Apple sends it. If there is no name, we use \"Pengguna\". We do not receive your Apple ID password.",
        "When you delete your account from the app, JoyoRogo first revokes your account's Sign in with Apple token at Apple. For that the app asks you to sign in with Apple again, and if the revocation fails, your account is not deleted yet and you can try again.",
      ],
    },
    {
      id: "what-we-dont-do",
      title: "What we do not do",
      blocks: [
        { list: [
          "We do not sell your data to anyone.",
          "We do not share your data with third parties other than the processors listed in the Processors and third parties section, only as far as the features you use need.",
          "We do not use your data for ads.",
        ] },
        { note: "The only data other people can see is the public progress page and posts you share yourself to the feed or a group (see the Community section). The public progress page is active only if you turn it on in Profile, and contains only your starting weight to current weight, with no email and no food records." },
        { note: "To know which pages and buttons are used, we use cookie-free analytics (Revklik): the pages opened, visit source, device type, and steps such as sign-up or Pro payment. No name, email or health records." },
      ],
    },
    {
      id: "ai-connections",
      title: "AI connections (Claude and ChatGPT)",
      blocks: [
        "This JoyoRogo Pro feature lets an AI app of your choice, for example Claude from Anthropic or ChatGPT from OpenAI, read your data. Nothing is connected unless you add the connector yourself in that AI app, sign in to JoyoRogo, and press Allow on the permission screen that lists what data is requested.",
        { list: [
          "What is shared: only data whose permission you approve (profile and targets, food records, body weight, workouts, sleep and recovery), and read-only. The AI app cannot log, change or delete anything in your account.",
          "When and to whom: data is sent from JoyoRogo to that AI app and its provider, and only when you ask a question in your account there. JoyoRogo does not send your data anywhere on its own initiative through this connection.",
          "Once at the AI provider, their privacy, retention and model-training rules apply. JoyoRogo cannot control them, so check the settings in your account there.",
          "Audit log: we record the tool used and its date range (not the data itself), kept 90 days, and you can see it in AI connections.",
          "Revocation: you can disconnect an app at any time in AI connections and its access stops immediately. Deleting your data in JoyoRogo disconnects all connected apps.",
          "Token storage: the access token is valid for one hour, and its refresh token for up to 30 days or until you disconnect the app, whichever comes first.",
          "Never shared: GPS routes and data imported from Strava.",
        ] },
        { note: "Health data here is not medical advice, and AI answers can be wrong." },
        "The steps to connect and the details are in the [Claude and ChatGPT guide](/panduan/ai) (Bahasa Indonesia).",
      ],
    },
    {
      id: "delete-account",
      title: "Delete your account and data",
      blocks: [
        "You can permanently delete all your records (profile, weight, food, workouts, sleep, feed posts, photos, locations, browser notification subscriptions, JoyoFit cloud workouts, Coach plan documents, and sleep nights for sleep insights) with the **Delete all my data** button on the Profile page. Your account stays usable, so you can start again from scratch at any time. This button does not delete the account itself: payment history and Pro status remain.",
        "In the iPhone and Android apps, the **Delete account** button in Profile deletes the account itself: all the records, photos, locations and cloud workouts above, the Strava connection (permission revoked at Strava), Google and Apple sign-in links, sessions, name, email and payment history. Pro cannot be restored afterwards. App Store or Google Play subscriptions must still be cancelled by you in Apple or Google settings.",
        "In the JoyoFit app, the **Delete JoyoRogo account** button (Settings, Health Connect and cloud, or Apple Health and cloud on iPhone, Cloud sync section) deletes the same JoyoRogo account together with its JoyoFit data, including cloud workouts, Family links and push tokens. Details are at [fit.joyorogo.com/privasi](https://fit.joyorogo.com/privasi#hapus) (Bahasa Indonesia).",
        `From the web, or if you do not have the app, send an email from the address of the account you use to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}?subject=Delete%20JoyoRogo%20account) with the subject **Delete JoyoRogo account**. We delete the account and all its data and confirm by email when done. This page is also the account deletion request address for the JoyoRogo app on Google Play.`,
      ],
    },
    {
      id: "processors",
      title: "Processors and third parties",
      blocks: [
        "We do not sell your data. We share it only with the following classes of third parties and processors, as far as the features you use need, as described in the sections above:",
        { list: [
          "Infrastructure and AI providers: Cloudflare (Workers AI for photos, stories and Coach; storage and servers, including the JoyoFit cloud server).",
          "Payments: Polar (Polar Software Inc.) for USD purchases; DOKU and Pakasir for rupiah payments; Apple (App Store) and Google (Google Play) for in-app subscriptions.",
          "Sign-in: Google and Apple.",
          "Health and workout sync, when you choose it: Google (Health Connect), Apple (Apple Health) and Strava.",
          "Product databases for barcodes: Open Food Facts and similar external product databases (barcode number only).",
          "Push notifications: Expo, Google Firebase Cloud Messaging (Android), Apple Push Notification service (iPhone), and your browser's own push service.",
          "Cookie-free analytics: Revklik.",
          "AI apps you connect yourself through AI connections, for example Anthropic (Claude) or OpenAI (ChatGPT): only on your choice and request.",
        ] },
        "The only other people who see your data are other users, and only for what you choose to post.",
      ],
    },
    {
      id: "cross-border",
      title: "Transfers outside Malaysia",
      blocks: [
        `Your data is processed by us in Indonesia (${COMPANY_REGION}) and by the processors above, which may be located in other countries outside Malaysia and Indonesia. We transfer data only as far as needed to provide the features you use, with your consent when you use that feature, and subject to each processor's terms and privacy policy.`,
        "If you do not agree to these transfers, do not use the feature concerned, or delete your account.",
      ],
    },
    {
      id: "retention",
      title: "How long data is kept",
      blocks: [
        { list: [
          "Account and daily records: until you delete them (Delete all my data) or delete the account. Delete all my data does not delete payment history and Pro status; deleting the account does.",
          "Food photos: held temporarily for about 2 days, then deleted. Nutrition label photos and voice recordings are not stored. Neither is the front-of-pack photo, unless you switch on the sticker option: only its cutout is kept, with that food entry.",
          "Workouts from Strava: 7 days from the activity.",
          "Sleep insights: at most the last 90 nights.",
          "Family summaries: 30 days (Free monitors) or 90 days (Pro monitors).",
          "AI connections audit log: 90 days. Access tokens are valid for one hour, refresh tokens up to 30 days.",
          "Community posts and comments: until you delete them or your account is deleted.",
          "Photos you allowed us to keep to improve the AI: until you ask for deletion, or delete your account or all data.",
        ] },
      ],
    },
    {
      id: "rights",
      title: "Your rights and how to make a request",
      blocks: [
        "Under the PDPA you have the right to:",
        { list: [
          "Access the personal data we hold about you.",
          "Ask for correction of inaccurate data (you can also correct it yourself in the app).",
          "Withdraw consent, including consent for sensitive data.",
          "Ask for deletion. Deletion itself is already in the app: Delete all my data, and Delete account (see the Delete your account and data section).",
          "Ask for a copy of your data to be given to you or to another data controller, as far as the Act allows.",
        ] },
        `How to make a request: ${contactLineEn}. Send it from the address of the account you use so we can verify you. Our target is to reply within 21 days. If we cannot fully meet a request, we will say why.`,
      ],
    },
    {
      id: "breach",
      title: "If there is a data breach",
      blocks: [
        "If a personal data breach occurs that is likely to cause significant harm, we commit to notifying the Personal Data Protection Commissioner and affected users within the periods the PDPA sets.",
      ],
    },
    {
      id: "complaints",
      title: "Complaints",
      blocks: [
        `Contact us first so we can put it right. You also have the right to complain to the Personal Data Protection Commissioner of Malaysia (Personal Data Protection Department): email ${PDP_EMAIL}, phone ${PDP_PHONE}.`,
      ],
    },
    {
      id: "language",
      title: "Language of this notice",
      blocks: [
        "This notice is available in Bahasa Melayu and English, and both are equally valid. If anything is unclear or seems to differ, contact us and we will explain. The original Indonesian privacy page is at [joyorogo.com/privasi](/privasi).",
        "If this notice changes, the version and date above change with it.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        `Questions about your data? ${COMPANY_NAME},${address} ${COMPANY_REGION}. [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}), WhatsApp [${WHATSAPP_DISPLAY}](https://wa.me/6289680839591).`,
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------------------------------------------

const USD_EN: LegalSection = {
  id: "usd",
  title: "USD purchases (Polar)",
  lang: "en",
  blocks: [
    "This section applies to Pro purchases paid in US dollars on the web. It is written in English because these purchases are meant for buyers outside Indonesia.",
    { list: [
      "Seller: Polar (polar.sh) is the merchant of record and the seller for USD purchases. Charges on your card statement appear as Polar or JoyoRogo.",
      "Renewal: a USD purchase is a subscription that renews automatically every month or every year, depending on the plan you chose, until you cancel.",
      "Cancelling: cancel any time from Profile > Manage subscription or from the Polar customer portal. Pro stays active until the end of the period you already paid for.",
      "Taxes: Polar adds VAT, GST, or sales tax at checkout where it applies to your location.",
      "Price changes: the price may change. We give notice before a new price applies to a new billing period.",
      "Refunds: see the refund policy linked below.",
    ] },
    "Polar's own terms and privacy policy also apply to the payment itself. See the [refund policy](/pengembalian-dana#usd) and the [Privacy Notice](/my/privacy).",
  ],
};

const TERMS_MS: LegalDoc = {
  path: "/my/syarat",
  lang: "ms",
  title: "Syarat Perkhidmatan",
  intro: "Peraturan menggunakan JoyoRogo, ditulis ringkas.",
  version: `Versi ${LEGAL_VERSION}`,
  sections: [
    {
      id: "penyedia",
      title: "Siapa penyedia perkhidmatan",
      blocks: [
        `JoyoRogo disediakan oleh ${COMPANY_NAME},${address} ${COMPANY_REGION}. ${contactLineMs}. Syarat ini terpakai pada joyorogo.com dan aplikasi JoyoRogo.`,
      ],
    },
    {
      id: "akaun",
      title: "Akaun dan penggunaan",
      blocks: [
        "JoyoRogo membantu mencatat makan, senaman, berat dan tidur. Angka yang muncul ialah anggaran untuk membantu anda mengatur tabiat, bukan nasihat perubatan. Untuk keadaan kesihatan tertentu, tanyakan kepada pakar kesihatan.",
        "Anda bertanggungjawab atas akaun anda dan isi yang anda kongsi ke kumpulan atau suapan. Data apa yang kami simpan diterangkan di [Notis Privasi](/my/privasi). JoyoRogo untuk pengguna berumur 18 tahun ke atas.",
      ],
    },
    {
      id: "paket",
      title: "Pelan percuma dan Pro",
      blocks: [
        "Ciri asas percuma selama-lamanya, dengan jatah imbasan AI harian. Pro menambah jatah imbasan dan ciri lain yang tercatat di halaman [Harga](/my#harga). Isi dan harga pelan boleh berubah; perubahan tidak menjejaskan tempoh yang sudah anda bayar.",
      ],
    },
    {
      id: "rupiah",
      title: "Pembayaran rupiah di web",
      blocks: [
        "Di web, Pro dibayar dengan QRIS atau pindahan bank untuk satu tempoh (bulanan atau tahunan) di muka. Pembayaran ini tidak diperbaharui secara automatik; anda memperbaharuinya sendiri dari Profil. Membeli lagi sebelum tempoh habis ditambah di atas baki masa aktif anda.",
      ],
    },
    {
      id: "kedai",
      title: "Pembelian melalui App Store dan Google Play",
      blocks: [
        "Di aplikasi, Pro ialah langganan automatik yang ditagih, diperbaharui dan dibatalkan melalui Apple atau Google mengikut syarat kedai tersebut.",
      ],
    },
    {
      id: "usd-ms",
      title: "Pembelian USD (Polar)",
      blocks: [
        "Bahagian ini terpakai pada pembelian Pro yang dibayar dalam dolar AS di web. Pembelian ini ditujukan kepada pembeli di luar Indonesia.",
        { list: [
          "Penjual: Polar (polar.sh) ialah merchant of record dan penjual bagi pembelian USD. Caj pada penyata kad anda muncul sebagai Polar atau JoyoRogo.",
          "Pembaharuan: pembelian USD ialah langganan yang diperbaharui secara automatik setiap bulan atau setiap tahun, bergantung pada pelan yang anda pilih, sehingga anda membatalkannya.",
          "Pembatalan: batalkan bila-bila masa dari Profil > Urus langganan atau dari portal pelanggan Polar. Pro kekal aktif sehingga akhir tempoh yang sudah anda bayar.",
          "Cukai: Polar menambah VAT, GST atau cukai jualan semasa pembayaran jika terpakai pada lokasi anda.",
          "Perubahan harga: harga boleh berubah. Kami memberi notis sebelum harga baru terpakai pada tempoh bil baru.",
          "Bayaran balik: lihat dasar bayaran balik yang dipautkan di bawah.",
        ] },
        "Syarat dan dasar privasi Polar sendiri turut terpakai pada pembayaran itu. Lihat [dasar bayaran balik](/pengembalian-dana#usd) (Bahasa Indonesia) dan [Notis Privasi](/my/privasi). Pembelian USD diterangkan juga dalam bahasa asalnya di versi [English](/my/terms#usd).",
      ],
    },
    {
      id: "perubahan",
      title: "Perubahan dan hubungan",
      blocks: [
        `Jika syarat ini berubah, tarikh di atas ikut berubah. Soalan atau aduan: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) atau WhatsApp [${WHATSAPP_DISPLAY}](https://wa.me/6289680839591). Soal wang dikembalikan ada di [Pengembalian Dana](/pengembalian-dana) (Bahasa Indonesia).`,
        "Syarat ini ada dalam Bahasa Melayu dan English, dan kedua-duanya sama sah. Jika ada bahagian yang tidak jelas, hubungi kami. Syarat asal dalam Bahasa Indonesia ada di [joyorogo.com/syarat](/syarat).",
      ],
    },
  ],
};

const TERMS_EN: LegalDoc = {
  path: "/my/terms",
  lang: "en",
  title: "Terms of Service",
  intro: "The rules for using JoyoRogo, written short.",
  version: `Version ${LEGAL_VERSION}`,
  sections: [
    {
      id: "provider",
      title: "Who provides the service",
      blocks: [
        `JoyoRogo is provided by ${COMPANY_NAME},${address} ${COMPANY_REGION}. ${contactLineEn}. These terms apply to joyorogo.com and the JoyoRogo apps.`,
      ],
    },
    {
      id: "account",
      title: "Account and use",
      blocks: [
        "JoyoRogo helps you log food, workouts, weight and sleep. The numbers it shows are estimates to help you manage your habits, not medical advice. For specific health conditions, ask a health professional.",
        "You are responsible for your account and for what you share to groups or the feed. What data we store is described in the [Privacy Notice](/my/privacy). JoyoRogo is for users aged 18 and over.",
      ],
    },
    {
      id: "plans",
      title: "Free and Pro plans",
      blocks: [
        "Basic features are free forever, with a daily AI scan allowance. Pro adds scan allowance and other features listed on the [Pricing](/my#harga) page (Bahasa Melayu). Plan contents and prices can change; changes do not affect a period you have already paid for.",
      ],
    },
    {
      id: "rupiah",
      title: "Rupiah payments on the web",
      blocks: [
        "On the web, Pro is paid with QRIS or bank transfer for one period (monthly or yearly) upfront. This payment does not renew automatically; you renew it yourself from Profile. Buying again before the period ends stacks on top of your remaining active time.",
      ],
    },
    {
      id: "stores",
      title: "Purchases through the App Store and Google Play",
      blocks: [
        "In the app, Pro is an automatic subscription billed, renewed and cancelled through Apple or Google under that store's terms.",
      ],
    },
    USD_EN,
    {
      id: "changes",
      title: "Changes and contact",
      blocks: [
        `If these terms change, the date above changes with them. Questions or complaints: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) or WhatsApp [${WHATSAPP_DISPLAY}](https://wa.me/6289680839591). For refunds see [Refunds](/pengembalian-dana) (Bahasa Indonesia).`,
        "These terms are available in Bahasa Melayu and English, and both are equally valid. If anything is unclear, contact us. The original Indonesian terms are at [joyorogo.com/syarat](/syarat).",
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalPath, LegalDoc> = {
  "/my/privasi": PRIVACY_MS,
  "/my/privacy": PRIVACY_EN,
  "/my/syarat": TERMS_MS,
  "/my/terms": TERMS_EN,
};

export const LEGAL_PATHS = Object.keys(LEGAL_DOCS) as LegalPath[];

export type InlinePart = { text: string } | { label: string; href: string } | { bold: string };

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/** Splits `[label](href)` links and `**bold**` out of a string. */
export function inlineParts(source: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    if (match[3] !== undefined) parts.push({ bold: match[3] });
    else parts.push({ label: match[1] as string, href: match[2] as string });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}
