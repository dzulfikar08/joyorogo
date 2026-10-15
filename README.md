<p align="center">
  <img src="apps/web/public/brand/logo.svg" alt="JoyoRogo" width="260">
</p>

<p align="center">
  Tiga angka tiap hari: boleh makan berapa, harus bakar berapa, butuh tidur berapa jam.<br>
  Foto piringmu, kalorinya dihitung AI. Open source, AGPL-3.0.
</p>

<p align="center">
  <a href="https://cloudagni.id/deploy/joyorogo"><img src="https://cloudagni.id/button.svg" alt="Deploy di CloudAgni" height="40"></a>
</p>

<p align="center">
  Tidak mau mengurus server? <a href="https://joyorogo.com">Pakai JoyoRogo Cloud</a>.
</p>

## Apa itu JoyoRogo

Pencatat diet untuk makanan Indonesia:

- **Foto makanan, kalori keluar.** AI mengenali menu warteg sampai nasi padang
  dan mengisi kalori, protein, karbo, lemak. Tiap makanan di piring dipotong
  jadi stiker sendiri. Foto asli tidak disimpan, kecuali kamu menyalakan
  "Simpan foto asli" di Profil (hanya bisa kamu buka sendiri).
- **Lupa foto? Ceritakan.** Ketik atau ucapkan "kemarin pagi nasi kuning pakai
  telur dadar, siang nasi padang lauk rendang". AI menghitung kalorinya dan
  menaruh tiap item di waktu makan dan hari yang tepat; kamu cek dulu sebelum
  disimpan. Suara diubah jadi teks lewat Whisper di Workers AI dan tidak disimpan.
- **Target harian yang jujur.** Dari usia, tinggi, berat, aktivitas, dan
  target beratmu (Mifflin-St Jeor), lalu menyesuaikan dengan data makan dan
  timbanganmu sendiri.
- **Lingkar perut.** Catat di halaman Berat, lengkap dengan ilustrasi cara
  mengukur. Dibandingkan dengan batas obesitas sentral Asia (pria 90 cm,
  wanita 80 cm) dan rasio lingkar perut terhadap tinggi badan (di bawah 0,5).
- **Olahraga dan tidur.** Catat manual, impor dari Strava, atau baca langkah,
  olahraga, dan tidur dari Health Connect di Android.
- **Data gizi lokal.** Database Tabel Komposisi Pangan Indonesia (TKPI) 2019.

Web untuk HP dan laptop, plus aplikasi Android.

## Tiga cara memakai

|                                                             | Untuk siapa                                                         | Biaya                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [JoyoRogo Cloud](https://joyorogo.com)                      | Kebanyakan orang. Langsung pakai, tanpa setup.                      | Gratis 3 scan AI/hari. Pro Rp15.000/bulan untuk scan tanpa batas.     |
| [Deploy di CloudAgni](https://cloudagni.id/deploy/joyorogo) | Klinik, gym, ahli gizi, atau keluarga yang ingin servernya sendiri. | Paket CloudAgni, kuota AI sudah termasuk.                             |
| Cloudflare sendiri                                          | Developer yang ingin mengurus semuanya sendiri.                     | Akun Cloudflare-mu, termasuk tagihan Workers AI.                      |

Langganan Pro di JoyoRogo Cloud membiayai pengembangan proyek ini.

## Deploy di CloudAgni

<a href="https://cloudagni.id/deploy/joyorogo"><img src="https://cloudagni.id/button.svg" alt="Deploy di CloudAgni" height="40"></a>

1. Klik tombol di atas, masuk, pilih slug.
2. Siapkan OAuth client Google (jenis _Web application_) di
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Form deploy menampilkan _authorized redirect URI_ yang harus kamu daftarkan,
   bentuknya `https://app.<slug>.cloudagni.id/api/auth/callback/google`.
3. Isi Client ID dan Client Secret, lalu deploy. Database, penyimpanan,
   HTTPS, dan secret aplikasi disiapkan otomatis.

Paywall, Strava, dan pembayaran (DOKU atau Pakasir) bisa diisi di form yang sama atau diubah nanti dari
halaman **Instans**. Biarkan kosong untuk JoyoRogo tanpa batas scan dan tanpa
halaman harga.

## Self-host di Cloudflare sendiri

Butuh akun Cloudflare, Bun, dan OAuth client Google. Pemakaian Workers AI,
Images, D1, dan R2 ditagih ke akun Cloudflare-mu.

```bash
bun install
cd apps/selfhost
bunx wrangler d1 create joyorogo          # salin database_id ke wrangler.jsonc
bunx wrangler r2 bucket create joyorogo-stickers
```

Di `apps/selfhost/wrangler.jsonc`, ganti `BETTER_AUTH_URL` dan `APP_URL`
dengan alamat publikmu (misalnya `https://joyorogo-mu.workers.dev`), lalu:

```bash
openssl rand -hex 32 | bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bun run build && bun run deploy           # migrasi D1 + deploy worker
```

Redirect URI Google: `<alamatmu>/api/auth/callback/google`. Variabel opsional
(paywall, Strava, DOKU, Pakasir) ada di bawah; set dengan `wrangler secret put` atau di
`vars`.

## Paywall dan pembayaran

Pemilik server yang menentukan. Tanpa konfigurasi, semua fitur gratis tanpa batas.

| Variabel                                                 | Arti                                                                                                                                                                        | Bawaan |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `FREE_DAILY_SCANS`                                       | Batas scan AI per hari untuk pengguna gratis. Kosong = tanpa paywall.                                                                                                       | kosong |
| `FOUNDER_DAILY_CAP`                                      | Batas pengaman scan Pro per hari. Kosong = tanpa batas.                                                                                                                     | kosong |
| `ANON_SCANS`                                             | Coba scan tanpa daftar per perangkat. `0` mematikan demo.                                                                                                                   | 2      |
| `FOUNDER_PRICE_IDR`                                      | Harga Pro per bulan (dipakai saat `FOUNDER_PRICE_LADDER` kosong).                                           | 15000  |
| `FOUNDER_PRICE_LADDER`                                   | Tangga harga "pembeli:hargaBulanan", mis. `10:15000,110:29000,:49000`: 10 pembeli pertama Rp15rb, pembeli 11-110 Rp29rb, lalu Rp49rb. Langkah awal tampil sebagai promo "Harga Founder (terbatas)"; pembeli promo itu mendapat lencana Founder. Pembeli = pengguna unik dengan minimal satu pembayaran. Yang pernah bayar mengunci harga terendahnya. Kosong = harga flat tanpa promo. | kosong |
| `FOUNDER_YEARLY_PRICE_IDR`                               | Harga Pro per tahun. Kosong = 10x harga bulanan; kalau diisi, berlaku untuk SEMUA step tangga.              | kosong |
| `BILLING_PROVIDER`                                       | Gateway untuk checkout tanpa pilihan metode (versi aplikasi lama): `doku` atau `pakasir`. Kosong = DOKU kalau diisi, kalau tidak Pakasir.                                   | kosong |
| `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_BASE_URL`     | DOKU Checkout, tombol **Transfer Bank**. Pembayaran aktif hanya kalau `FREE_DAILY_SCANS` juga diisi.                                                                        | kosong |
| `PAKASIR_SLUG`, `PAKASIR_API_KEY`, `PAKASIR_WEBHOOK_SECRET` | Pakasir payment link khusus QRIS, tombol **QRIS**. Webhook proyek: `/api/billing/pakasir/webhook`.                                                                      | kosong |
| `PAKASIR_SANDBOX`                                        | `1` = pembayaran sandbox Pakasir ikut mengaktifkan Pro (uji coba saja).                                                                                                     | kosong |
| `APPLE_BUNDLE_ID`, `APPLE_FOUNDER_PRODUCT_ID`            | Apple in-app purchase untuk Pro di iOS. Kosong = `com.joyodigitama.joyorogo` dan `com.joyodigitama.joyorogo.founder.1m`; harus sama dengan produk di App Store Connect. | kosong |
| `APPLE_SANDBOX_EMAILS`                                   | Email (pisah koma) yang boleh memakai pembelian sandbox/TestFlight: akunmu dan akun demo App Review. Production selalu diterima.                                            | kosong |
| `REVIEW_LOGIN_EMAILS`                                    | Email (pisah koma) yang boleh masuk dengan email + kata sandi: akun reviewer Google Play/App Store. Daftar tidak pernah membuka pendaftaran lewat email. Akun dibuat dengan `bun packages/auth/scripts/review-login.ts` (Pro gratis, sandi acak disimpan di `~/.config/joyorogo/review-login.txt`). Kosong = masuk dengan email mati. | kosong |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`               | Impor olahraga dari Strava.                                                                                                                                                 | kosong |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push untuk pengingat puasa intermiten di web (cron tiap 5 menit). Kosong = pengingat web mati.                                                                          | kosong |

Pro dibayar per bulan (tanpa perpanjangan otomatis). Sebelum checkout,
pembeli memilih **QRIS** (Pakasir) atau **Transfer Bank** (DOKU); tombol hanya
muncul untuk gateway yang kredensialnya diisi, dan kalau cuma satu yang diisi
pilihan dilewati. Notifikasi DOKU masuk ke `/api/billing/webhook`, Pakasir ke
`/api/billing/pakasir/webhook`; keduanya tetap aktif selama kredensialnya
diisi. Di iOS, Pro dibayar lewat Apple in-app purchase
(`/api/billing/apple`) tanpa kredensial tambahan.

## Email

Email transaksional (struk pembayaran, notifikasi admin, pengingat habis
masa Pro) dikirim lewat Cloudflare Email Service. Tanpa konfigurasi,
email mati dan aplikasi tetap jalan. Untuk mengaktifkan:

1. Di dashboard Cloudflare, buka domain **joyorogo.com** → **Email** →
   **Email Service**, lalu onboard domain pengirim `mail.joyorogo.com`
   (Enable Email Sending; ikuti wizard DNS-nya).
2. Tambahkan binding `send_email` bernama `EMAIL` di `apps/server/wrangler.jsonc`
   (sudah ada di repo).
3. Set variabel: `EMAIL_FROM=halo@mail.joyorogo.com` (alamat di domain yang
   di-onboard), `EMAIL_FROM_NAME=JoyoRogo`, dan opsional
   `EMAIL_REPLY_TO=dzulfikar.at@gmail.com` supaya balasan pembeli masuk ke
   pemilik. Notifikasi admin dikirim ke daftar `ADMIN_EMAILS`.

Catatan: self-host tanpa binding/`EMAIL_FROM` otomatis mematikan email.

## Aplikasi Android

APK resmi di halaman depan JoyoRogo Cloud terhubung ke JoyoRogo Cloud. Untuk
server sendiri, build dari source: ganti `EXPO_PUBLIC_SERVER_URL` di
`scripts/build-release-apk.sh` dan package id di `apps/native/app.json`, lalu
jalankan skrip itu (butuh Android SDK, JDK, dan Bun). Tanpa APK, aplikasi
web tetap bisa dipasang ke layar utama HP.

Setiap build memberi `versionCode` otomatis (menit sejak 2024-01-01 UTC), jadi
selalu naik tanpa diubah manual, dan menulis `joyorogo-latest.json` di root
repo: manifest berisi `versionCode`, `versionName`, `size`, `sha256`, dan
`publishedAt`. Aplikasi Android memakai manifest itu untuk pembaruan dalam
aplikasi: kartu "Versi baru tersedia" muncul di Profil, APK diunduh ke cache,
diverifikasi sha256-nya, lalu dibuka lewat installer sistem. Tambahkan flag
`--publish` untuk mengunggah keduanya ke R2 (APK dulu, manifest terakhir):

```bash
scripts/build-release-apk.sh --publish
```

APK pertama yang mendukung pembaruan dalam aplikasi harus dipasang manual satu
kali; setelah itu pembaruan berikutnya bisa dari dalam aplikasi.

## Latihan beban, puasa intermiten, dan harga makanan

Tiga fitur ini ada di web dan Android. Catatan desainnya:

### Latihan beban: turun berat tanpa kehilangan otot

Defisit kalori tanpa latihan beban ikut membakar otot. Fitur ini mencatat
latihan kekuatan (mirip aplikasi Hevy) supaya yang turun lemak, bukan otot.

- **Catat sesi**: gerakan, set, repetisi, beban, dan RPE. Template rutin
  (push/pull/legs, full body) dan "ulangi sesi terakhir" supaya cepat.
- **Peta otot**: tiap gerakan dipetakan ke otot utama dan pendukung (bench press
  → dada, triceps, bahu depan). Volume mingguan per otot dihitung dari set
  efektif.
- **Peringatan otot terlewat**: kalau satu otot belum dilatih dalam 7 hari atau
  volumenya jauh di bawah otot lain, Beranda memberi tahu, misalnya "Triceps
  belum dilatih minggu ini", lengkap dengan saran gerakan.
- **Progres kekuatan**: rekor pribadi dan perkiraan 1RM per gerakan. Kalau
  kekuatan turun selagi berat turun cepat, itu tanda defisit terlalu besar,
  jadi JoyoRogo menyarankan memperlambat target.
- **Protein**: hari latihan menaikkan target protein (sekitar 1,6 g/kg) dan
  sisa kalori menyarankan menu tinggi protein.
- **Data**: tabel baru `workout_session` dan `workout_set`, plus katalog
  gerakan dengan pemetaan otot. Kalori sesi beban masuk ke angka bakar seperti
  `exercise_log` sekarang.

### Mode puasa intermiten (IF)

Perluasan dari mode Ramadan yang sudah ada, untuk pola 16:8, 18:6, 20:4, dan
OMAD.

- **Panduan jadwal makan**: pengguna memilih pola dan jam buka. JoyoRogo
  membagi kalori harian ke waktu makan di dalam jendela makan, misalnya buka
  12.00 sebanyak 700 kcal, camilan 15.30 sebanyak 250 kcal, dan makan terakhir
  19.30 sebanyak 650 kcal.
- **Status di Beranda**: sedang puasa atau di jendela makan, hitung mundur ke
  waktu makan berikutnya, jam makan terakhir, dan sisa kalori jendela ini.
- **Notifikasi (opsional)**: "jendela makan buka", "waktunya makan, sisa
  650 kcal", "30 menit lagi jendela tutup". Memakai jadwal pengingat makan yang
  sudah ada di aplikasi Android, lalu ditambah ke web lewat Web Push.
- **Catatan konsisten**: makanan yang dicatat di luar jendela ditandai, dan ada
  ringkasan mingguan berapa hari jadwal puasa terpenuhi.
- **Data**: `profile` mendapat pola puasa dan jam buka; jadwal dihitung di
  mesin target yang sama dengan mode Ramadan.

### Harga makanan: kalori dan uang

Tidak cuma mencatat kalori, tapi juga biaya makan, supaya pengguna bisa memilih
makanan yang paling hemat sekaligus bergizi.

- **Harga per piring, bukan per komponen**: satu foto nasi padang tersimpan
  sebagai beberapa baris `food_log` (nasi, rendang, sayur), padahal yang dibayar
  satu harga untuk sepiring. Karena itu harga menempel ke **piring**: satu scan,
  satu cerita, atau satu catatan manual. Layar konfirmasi scan meminta satu
  angka "Harga sepiring (Rp)", bukan harga tiap item.
- **Catat harga**: opsional, dengan nama piring ("Nasi padang") dan tempat
  ("RM Sederhana"), terisi otomatis dari harga terakhir untuk nama dan tempat
  yang sama. Kalau satu cerita berisi beberapa piring di waktu makan berbeda,
  tiap piring punya harganya sendiri.
- **Ringkasan belanja makan**: total per hari, minggu, dan bulan, serta rata-rata
  per waktu makan.
- **Nilai terbaik**: dihitung per piring dari jumlah gizi semua komponennya,
  misalnya "nasi padang rendang Rp28.000: 31 g protein, 1,1 g per Rp1.000" lawan
  "pecel + tempe Rp12.000: 18 g, 1,5 g per Rp1.000". Saran menu "masih muat di
  sisa kalori" juga bisa diurutkan dari yang paling hemat. Komponen tidak
  diberi harga sendiri, karena harga lauk di warung jarang diketahui.
- **Anggaran**: batas belanja makan harian atau bulanan, dengan sisa anggaran
  ditampilkan di samping sisa kalori.
- **Data**: tabel `plate` (`id`, `user_id`, `date`, `meal`, `name`, `place`,
  `price_idr`) dan kolom `plate_id` di `food_log`, diisi oleh `addScan`, cerita,
  dan catatan manual. Baris lama tanpa `plate_id` tetap tampil, hanya tanpa
  harga. Menghapus semua komponen satu piring ikut menghapus piringnya.

## Pengembangan

### Admin console (admin.joyorogo.com)

Konsol operator internal di `apps/admin`, dilindungi server lewat variabel
`ADMIN_EMAILS` (daftar email di apps/server; selain itu API membalas 403).

```bash
cd apps/admin && VITE_SERVER_URL=http://localhost:3000 bun run dev  # http://localhost:3002
```

Deploy: `scripts/deploy.sh` build + deploy ke `admin.joyorogo.com` setelah web.

```bash
bun install

# API (http://localhost:3000). Isi apps/server/.dev.vars, lihat apps/server/.env.schema
cd apps/server && bunx wrangler d1 migrations apply DB --local && bunx wrangler dev --port 3000

# Web (http://localhost:3001)
cd apps/web && VITE_SERVER_URL=http://localhost:3000 VITE_DEV_LOGIN=1 bun run dev:bare
```

`DEV_LOGIN=1` di server dan `VITE_DEV_LOGIN=1` di web memunculkan tombol
"Masuk (dev)" tanpa Google, hanya untuk lokal.

Sebelum kirim perubahan:

```bash
bunx oxfmt --write <file yang diubah>
bunx oxlint
bunx turbo run check-types
cd packages/api && bun test src/lib
```

| Folder          | Isi                                                        |
| --------------- | ---------------------------------------------------------- |
| `apps/server`   | API Hono di Cloudflare Workers (D1, R2, Workers AI)        |
| `apps/web`      | Aplikasi web (Vite, React, TanStack Router)                |
| `apps/web/blog` | Blog statis: artikel Markdown, dirender saat build         |
| `apps/native`   | Aplikasi Android (Expo)                                    |
| `apps/selfhost` | API + web dalam satu worker, untuk CloudAgni dan self-host |
| `packages/api`  | Router oRPC dan logika (target, TKPI, paywall, DOKU)       |
| `packages/db`   | Skema Drizzle dan migrasi D1                               |
| `packages/auth` | Better Auth (Google)                                       |

`scripts/deploy.sh` dan `apps/server/wrangler.jsonc` adalah konfigurasi
JoyoRogo Cloud (akun pemilik); untuk server sendiri pakai `apps/selfhost`.

Artikel blog ada di `apps/web/blog/posts/*.md` (frontmatter `title`,
`description`, `date`, opsional `updated` dan `featured`). Baris
`::tkpi AP001 FP062` membuat tabel per 100 g dari TKPI 2019, `::porsi AP001 150
Nasi putih | FP062 70` membuat contoh porsi beserta totalnya, `::contoh` sama
tanpa total. Build menulis `/blog/`, RSS, dan `sitemap.xml`; `VITE_SITE_URL`
mengganti domain kanonik (bawaan `https://joyorogo.com`).

Judul, deskripsi, dan kartu share tiap halaman publik (`/`, `/harga`,
`/privasi`, `/login`) ada di `apps/web/src/lib/seo.ts`; build menulisnya ke
HTML statis masing-masing (`harga.html`, dst.) beserta JSON-LD halaman utama.
Gambar share `public/og.png` (1200×630) dibuat dari `apps/web/og/og-image.html`
dengan `bun run og` di `apps/web` (butuh Chromium).

Tautan `/gabung/<kode>`, `/p/<id>`, dan `/u/<handle>` punya pratinjau share
sendiri (crawler pratinjau umumnya tidak menjalankan JavaScript). Worker web
(`apps/web/worker`, `HTMLRewriter`) menulis judul, deskripsi, dan gambar ke
HTML halaman itu dari `GET /og/*` di API (`apps/server/src/og.ts`). Hanya
postingan publik dan profil publik yang tampil; yang privat atau tidak ada
memakai tag umum. Hasilnya di-cache sekitar semenit. Hanya tiga rute itu yang
melewati worker (`run_worker_first`); sisanya tetap dilayani langsung dari
aset. `API_URL` dan `SITE_URL` ada di `apps/web/wrangler.jsonc`. Versi
`apps/selfhost` belum memakai worker ini.

Pratinjau undangan (`group.preview`) bisa dibuka sebelum masuk, jadi dibatasi
60 permintaan per menit per IP lewat binding `INVITE_PREVIEW_LIMITER`
(`ratelimits` di wrangler); tanpa binding itu tidak ada batas. Yang keluar
hanya nama grup dan jumlah anggota. Tautan share dari aplikasi membawa
`utm_source=app-share` lewat `shareUrl` (web dan native); `/gabung` tetap tidak
dilacak Revklik dan kodenya dipotong dari data analitik.

## Lisensi

[AGPL-3.0](LICENSE). Kalau kamu menjalankan versi yang diubah sebagai layanan
publik, kodenya juga harus dibuka untuk penggunanya. Nama dan logo JoyoRogo
bukan bagian dari lisensi kode; lihat [NOTICE](NOTICE) untuk merek dan sumber
data (TKPI 2019 Kemenkes, Compendium of Physical Activities).
