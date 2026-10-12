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
  Tidak mau mengurus server? <a href="https://joyorogo.dzulfikar.com">Pakai JoyoRogo Cloud</a>.
</p>

## Apa itu JoyoRogo

Pencatat diet untuk makanan Indonesia:

- **Foto makanan, kalori keluar.** AI mengenali menu warteg sampai nasi padang
  dan mengisi kalori, protein, karbo, lemak. Foto tidak disimpan.
- **Target harian yang jujur.** Dari usia, tinggi, berat, aktivitas, dan
  target beratmu (Mifflin-St Jeor), lalu menyesuaikan dengan data makan dan
  timbanganmu sendiri.
- **Olahraga dan tidur.** Catat manual, impor dari Strava, atau baca langkah,
  olahraga, dan tidur dari Health Connect di Android.
- **Data gizi lokal.** Database Tabel Komposisi Pangan Indonesia (TKPI) 2019.

Web untuk HP dan laptop, plus aplikasi Android.

## Tiga cara memakai

| | Untuk siapa | Biaya |
|---|---|---|
| [JoyoRogo Cloud](https://joyorogo.dzulfikar.com) | Kebanyakan orang. Langsung pakai, tanpa setup. | Gratis 3 scan AI/hari. Founder Rp15.000/bulan untuk scan tanpa batas. |
| [Deploy di CloudAgni](https://cloudagni.id/deploy/joyorogo) | Klinik, gym, ahli gizi, atau keluarga yang ingin servernya sendiri. | Paket CloudAgni, kuota AI sudah termasuk. |
| Cloudflare sendiri | Developer yang ingin mengurus semuanya sendiri. | Akun Cloudflare-mu, termasuk tagihan Workers AI. |

Langganan Founder di JoyoRogo Cloud membiayai pengembangan proyek ini.

## Deploy di CloudAgni

<a href="https://cloudagni.id/deploy/joyorogo"><img src="https://cloudagni.id/button.svg" alt="Deploy di CloudAgni" height="40"></a>

1. Klik tombol di atas, masuk, pilih slug.
2. Siapkan OAuth client Google (jenis *Web application*) di
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Form deploy menampilkan *authorized redirect URI* yang harus kamu daftarkan,
   bentuknya `https://app.<slug>.cloudagni.id/api/auth/callback/google`.
3. Isi Client ID dan Client Secret, lalu deploy. Database, penyimpanan,
   HTTPS, dan secret aplikasi disiapkan otomatis.

Paywall, Strava, dan DOKU bisa diisi di form yang sama atau diubah nanti dari
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
(paywall, Strava, DOKU) ada di bawah; set dengan `wrangler secret put` atau di
`vars`.

## Paywall dan pembayaran

Pemilik server yang menentukan. Tanpa konfigurasi, semua fitur gratis tanpa batas.

| Variabel | Arti | Bawaan |
|---|---|---|
| `FREE_DAILY_SCANS` | Batas scan AI per hari untuk pengguna gratis. Kosong = tanpa paywall. | kosong |
| `FOUNDER_DAILY_CAP` | Batas pengaman scan Founder per hari. Kosong = tanpa batas. | kosong |
| `ANON_SCANS` | Coba scan tanpa daftar per perangkat. `0` mematikan demo. | 2 |
| `FOUNDER_PRICE_IDR` | Harga Founder per bulan. | 15000 |
| `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_BASE_URL` | DOKU Checkout (QRIS, VA, e-wallet). Pembayaran aktif hanya kalau `FREE_DAILY_SCANS` juga diisi. | kosong |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Impor olahraga dari Strava. | kosong |

Founder dibayar per bulan (tanpa perpanjangan otomatis). Notifikasi DOKU
masuk ke `/api/billing/webhook`.

## Aplikasi Android

APK resmi di halaman depan JoyoRogo Cloud terhubung ke JoyoRogo Cloud. Untuk
server sendiri, build dari source: ganti `EXPO_PUBLIC_SERVER_URL` di
`scripts/build-release-apk.sh` dan package id di `apps/native/app.json`, lalu
jalankan skrip itu (butuh Android SDK, JDK, dan Bun). Tanpa APK, aplikasi
web tetap bisa dipasang ke layar utama HP.

## Pengembangan

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

| Folder | Isi |
|---|---|
| `apps/server` | API Hono di Cloudflare Workers (D1, R2, Workers AI) |
| `apps/web` | Aplikasi web (Vite, React, TanStack Router) |
| `apps/native` | Aplikasi Android (Expo) |
| `apps/selfhost` | API + web dalam satu worker, untuk CloudAgni dan self-host |
| `packages/api` | Router oRPC dan logika (target, TKPI, paywall, DOKU) |
| `packages/db` | Skema Drizzle dan migrasi D1 |
| `packages/auth` | Better Auth (Google) |

`scripts/deploy.sh` dan `apps/server/wrangler.jsonc` adalah konfigurasi
JoyoRogo Cloud (akun pemilik); untuk server sendiri pakai `apps/selfhost`.

## Lisensi

[AGPL-3.0](LICENSE). Kalau kamu menjalankan versi yang diubah sebagai layanan
publik, kodenya juga harus dibuka untuk penggunanya. Nama dan logo JoyoRogo
bukan bagian dari lisensi kode; lihat [NOTICE](NOTICE) untuk merek dan sumber
data (TKPI 2019 Kemenkes, Compendium of Physical Activities).
