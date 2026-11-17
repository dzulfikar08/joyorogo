# JoyoRogo on the App Store: listing text

The public listing as Apple serves it, copied on 17 Nov 2026 from the iTunes lookup API
(`https://itunes.apple.com/lookup?id=6823222101&country=id&lang=id_id`, and `country=us&lang=en_us` for English), so listing
copy can be reviewed and changed in a PR like `docs/play-store.md`. App Store Connect is the source of truth: when the
owner changes the listing there, update this file in the same week.

Not public, so not here: the **subtitle**, the **keyword field** and the **promotional text**. Paste them from App Store
Connect (App Information and the version page) into the empty sections below.

| Field | Value (17 Nov 2026) |
| --- | --- |
| App id | `6823222101` |
| Version live | 1.1.4 (released 2026-11-02) |
| Name, Indonesian | JoyoRogo: Kalori & Gizi |
| Name, English | JoyoRogo: Calorie Tracker |
| Category | Health & Fitness |
| Minimum iOS | 16.4 |

## Review notes (claim ledger, conversion audit)

- Both descriptions still say **JoyoRogo Pro**; the plan is **Joyo Pro** since 4 Nov 2026 (one subscription for JoyoRogo,
  JoyoFit and JoyoArto, `docs/marketing/releases/2026-11-04-joyo-pro-joyoarto.md`). Fix at the next submission (owner).
- The first lines are what a store visitor sees before "more". Today they describe three numbers; the photo scan, the
  reason most people install, starts in the second paragraph. Candidate first line for the next submission (owner):
  "Foto piringmu, JoyoRogo memperkirakan kalori tiap makanan, termasuk nasi padang dan gorengan. Kamu cek dan ubah sebelum
  disimpan." It keeps the claim ledger: an estimate the user corrects, no accuracy word, no weight promise.
- The Indonesian description names the price (Rp29.000/bulan, Rp199.000/tahun). It must match the App Store price set in
  App Store Connect; when that changes (the web ladder's next step is Rp49.000), the description has to change in the same
  submission, or drop the amounts and keep only "bulanan atau tahunan".
- No "akurat", no kg-per-week promise, no watch named. The medical disclaimer and the auto-renew text are present.
- Custom product pages (audit item 14) would reuse this text with per-audience screenshots and promotional text.

## Subtitle

(paste from App Store Connect)

## Keywords

(paste from App Store Connect)

## Promotional text

(paste from App Store Connect)

## Description, Indonesian

```text
JoyoRogo memberi kamu tiga angka tiap hari: boleh makan berapa, perlu bakar berapa, dan butuh tidur berapa jam. Semuanya dihitung dari data dirimu, target beratmu, dan tanggal yang kamu pilih.

CATAT MAKAN TANPA RIBET
• Foto piringmu: AI memperkirakan kalori, protein, karbohidrat, lemak, dan serat tiap makanan. Kamu cek dan koreksi angkanya sebelum disimpan.
• Ceritakan makananmu lewat suara atau teks, lalu JoyoRogo yang menghitung.
• Pindai barcode kemasan untuk mengambil info gizi produk.
• Dibuat untuk makanan Indonesia, dengan acuan Tabel Komposisi Pangan Indonesia (TKPI).

BAKAR DAN TIDUR
• Catat olahraga dan jam tidur, atau hubungkan Apple Health supaya langkah, olahraga, dan tidur terbaca otomatis. Kamu yang memilih data apa yang diizinkan.
• Pelatih latihan beban sederhana dengan rutinitas dan timer istirahat.
• Mode puasa (IF) dan Mode Ramadan dengan jadwal makan sahur dan berbuka.

BARENG TEMAN
• Grup kecil: colek teman yang lupa mencatat, tinggalkan catatan, dan lihat ringkasan bersama.
• Feed komunitas untuk membagikan makanan, latihan, atau cerita. Tidak ada yang dibagikan otomatis.

PRIVASI
• Tanpa iklan.
• Foto asli tidak disimpan di server kecuali kamu menyalakan "Simpan foto asli".
• Satu tombol di Profil untuk menghapus semua datamu.

Catatan penting: JoyoRogo bukan alat medis dan tidak mendiagnosis, mengobati, menyembuhkan, atau mencegah penyakit apa pun. Perkiraan kalori dari AI bisa meleset dan hanya panduan. Bicarakan dengan dokter atau ahli gizi sebelum mengubah pola makan atau olahraga, terutama kalau kamu hamil, menyusui, punya kondisi medis, atau di bawah 18 tahun.

Dibuat di Malang, Indonesia.

Langganan JoyoRogo Pro (Rp29.000/bulan atau Rp199.000/tahun lewat App Store) diperpanjang otomatis kecuali dibatalkan minimal 24 jam sebelum periode berakhir. Kelola atau batalkan di Pengaturan > Apple ID > Langganan.
Syarat Penggunaan (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Kebijakan Privasi: https://joyorogo.com/privasi
```

## Description, English

```text
JoyoRogo gives you three numbers every day: how much you can eat, how much to burn, and how many hours to sleep. They come from your own profile, your target weight, and the date you pick.

LOG MEALS WITHOUT THE HASSLE
• Photograph your plate: AI estimates calories, protein, carbs, fat, and fiber per food. You review and correct the numbers before saving.
• Tell JoyoRogo what you ate by voice or text and it does the counting.
• Scan a package barcode to pull the product's nutrition facts.
• Built for Indonesian food, calibrated against the Indonesian Food Composition Table (TKPI).

BURN AND SLEEP
• Log workouts and sleep, or connect Apple Health so steps, workouts, and sleep are read automatically. You choose which data to allow.
• A simple strength-training coach with routines and a rest timer.
• Intermittent fasting and a Ramadan mode with suhoor and iftar meal schedules.

WITH FRIENDS
• Small groups: nudge a friend who forgot to log, leave notes, and see a shared summary.
• A community feed to share a meal, workout, or story. Nothing is shared automatically.

PRIVACY
• No ads.
• Original photos are not stored on the server unless you turn on "Save original photo".
• One button in Profile to delete all your data.

Important: JoyoRogo is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. AI calorie estimates can be wrong and are guidance only. Talk to a doctor or dietitian before changing your diet or exercise routine, especially if you are pregnant, nursing, have a medical condition, or are under 18.

Made in Malang, Indonesia.

JoyoRogo Pro subscriptions (monthly or yearly through the App Store) renew automatically unless cancelled at least 24 hours before the end of the period. Manage or cancel in Settings > Apple ID > Subscriptions.
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://joyorogo.com/privasi
```

## What's new (1.1.4), Indonesian

```text
Baru di 1.1.4:
• Siap untuk iPhone Duo: aplikasi mengisi layar dalam dan luar, tampilan menyesuaikan saat dilipat atau dibuka.
• Salin rekap mingguan dan bulanan sebagai teks dari layar Rekap, tinggal tempel ke Threads atau grup WA.
• Halaman yang dibuka dari Beranda dan Profil kini bisa digulir sampai bawah di layar besar.
```
