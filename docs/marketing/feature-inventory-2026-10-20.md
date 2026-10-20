# Feature inventory: JoyoRogo + JoyoFit (as of 2026-10-20)

Method: README, docs/roadmap.json, docs/*.md, git log (default branch of each repo), landing source + live fetch of joyorogo.com and fit.joyorogo.com on 2026-10-20.

**Read first**
- Both git histories start in October (joyorogo initial public release **2026-10-12**; watch-fit log starts **2026-10-14**). So every feature is "since 2026-10-01"; ship date below = first commit date on master, NOT store-release date. Store-binary status for most items is unverified. Per README/landing: Android = Play closed test only; iOS = public TestFlight beta, App Store 1.0 "sedang menunggu review Apple". app.json: both apps version 1.0 / build 1.
- `NEW` = committed 2026-10-17 or later (the last 3-4 days; the marketing plan was written 2026-10-15 so none of these are in its claim ledger).
- Commit != available: JoyoFit live site still marks multi-watch, BT sensors and pro cycling as "Segera hadir" and README roadmap lists them under "Sedang dikerjakan", although code is on master. Do not post them as "sudah rilis" until a store build/OTA is confirmed.
- Roadmap files updated 2026-10-18 (joyorogo/docs/roadmap.json, watch-fit/docs/roadmap.json).

---
## 1. JoyoRogo user-visible features
Repo /home/dzul/Documents/JoyoDigitama/joyorogo. Free = Cloud free tier (3 AI scans/day, `FREE_DAILY_SCANS` in apps/server/wrangler.jsonc:95). Pro = "Pro" (renamed from Founder 2026-10-16; badge "Founder" still for promo-step buyers).

| Feature (UI name) | What it does | Tier | Ship | Evidence |
|---|---|---|---|---|
| Foto makanan -> kalori | AI reads Indonesian dishes, kcal/protein/karbo/lemak, TKPI 2019 calibration, edit before save | Free 3/day, Pro more | 10-12 | README.md "Fitur"; routes/index.tsx |
| Ceritakan (ketik/ucapkan) | "kemarin pagi nasi kuning..." -> items placed on right meal/day, Whisper voice | Free (counts as scan) | 10-12 | README |
| Koreksi scan pakai suara/teks NEW | "nasinya setengah aja", "cuma 2" recalculates; undo | Free | 10-17 | git 10-17 "Scan correct"; landing card |
| Scan lebih cepat (stream) NEW | results stream in (names, items, done) | Free | 10-17 | git 10-17 "Scan speed" |
| Hitung ulang kalori per piring NEW | recalc plate preview/apply | Free | 10-18 | git 10-18 |
| Catat minuman NEW | 0-kcal drinks, water, Coke Zero; hidden-contents cup asks type+size | Free | 10-18 | git "fix(ai): log drinks" |
| Barcode + foto label gizi NEW | unknown product -> photo nutrition table; community DB; OFF + USDA fallback | Free | 10-17 | docs/barcode-community.md |
| Stiker makanan | AI cutout stickers per item; Makan views (Daftar, Kalender stiker, Stiker book, Tempat) | Free | 10-15 | git 10-15 |
| Harga per piring | price per plate, spend per day/week/month, protein per rupiah | Free | 10-13 | README |
| Puasa intermiten + Mode Ramadan | 16:8/18:6/20:4/OMAD, Ramadan schedule, web push reminders | Free | 10-13 | README |
| Tiga angka: Boleh makan / Harus bakar / Butuh tidur | daily eat target (Mifflin-St Jeor), burn, sleep | Free | 10-12 | landing |
| Target dari level aktivitas NEW | eat target = BMR x chosen factor (1.2-1.9) minus deficit; watch/phone only ADDS allowance, never subtracts | Free | 10-18/19 | docs/energy-model.md; landing card; /panduan/kalori |
| Tanggal target + kebutuhan harian NEW | Indonesian calendar, safe-pace verdict, realistic date one-tap | Free | 10-17/18 | git 10-17, 10-18 |
| Naikin BB (gain mode) NEW | target weight above current: small surplus, protein 1.6-2.2 g/kg | Free | 10-18 | docs/gain-mode.md |
| Hamil dan Menyusui NEW | no deficit, AKG 2019 targets, IOM weight-gain band, food-safety notes (estimates) | Free | 10-18 | docs/maternal-mode.md |
| Berat, tren, lingkar perut | EMA trend, projected date, waist vs Asia cutoff + waist-to-height | Free | 10-12/13 | README |
| Rekap mingguan + story | weekly recap judged per-day budget | Free | 10-15; reworked 10-19 | git |
| Favorit, pengingat | save/relog meals, reminders (meals, water, weigh-in, IF) | Free | 10-15 | git |
| Edit porsi (gram<->kcal) | grams scale kcal/macros, undo | Free | 10-14/17 | git |
| Tanggal sebelumnya | past-day logging via date switcher | Free | 10-14 | git |
| Grup | groups (max 20 members), Colek, Catatan, VAR di grup | Free | 10-13 | marketing-plan 1.1 |
| VAR perut | AI compares two belly photos (estimate, not measurement) | Free | 10-14 rebuilt | marketing-plan 1.1 |
| Tantangan grup | Pro hosts 7/14/30-day challenges; all members join | Pro host / free join | 10-15 | git 10-15 |
| Feed + cerita | community feed, kudos, comments, follow, public /u /p | Free | 10-13/14 | git |
| Skor JoyoFit di grup NEW | share Recovery/Strain/Tidur to groups; watch workout posts; HR/route detail Pro | Free share, detail Pro | 10-17 | docs/feed-maps.md; landing card |
| Peta rute di feed NEW | route map on workout posts, per-post + account switch | Free view own, Pro detail of others | 10-18 | git 10-18 |
| Analisis latihan lengkap di post NEW | map, charts, splits, zones, laps, comparison | Pro | 10-18 | git 10-18 |
| Bagikan progres / Story share | Strava-style share sheet (Instagram, Copy, Save, More), 9:16 | Free | 10-14, sheet 10-17 | git |
| Kartu & stiker share baru NEW | sticker engine, 32 JoyoRogo templates | Free | 10-18 | docs/sticker-studio.md (roadmap "doing") |
| Sticker Studio (bikin sendiri) | NOT shipped: roadmap "Berikutnya" | - | - | docs/roadmap.json |
| JoyoFit cloud workouts (/jam) NEW | watch workouts saved to cloud, shown on web | Pro | 10-18 | docs/watch-workout-cloud.md |
| Latihan beban pindah ke JoyoFit NEW | card "Latihan sekarang di JoyoFit"; old logs read-only | - | 10-18 | docs/strength-moved.md |
| Makan guidance dari readiness JoyoFit | food guidance from Recovery/Strain; locked teaser for free | Pro | 10-15 | git 10-15 |
| Satu akun banyak HP NEW | preferences follow account (sync_record, 50 MB) | Pro writes for JoyoFit; free for JoyoRogo prefs | 10-18 | docs/multi-device.md |
| Koneksi AI (Claude/ChatGPT via MCP) NEW | read-only connector: diary, weight, workouts, sleep | Pro | 10-18 | docs/mcp-connector.md; /panduan/ai |
| Tidur dari JoyoFit | Tidur tile/screen read JoyoFit sleep hours | Free | 10-19 | git 10-19 |
| Profil hub NEW | Akun, Langganan, Target, Makan, Strava, Kesehatan, Pengingat, Tampilan, Privasi, Koneksi AI | - | 10-18 | landing card |
| Health Connect / Apple Health | read steps, workouts, sleep; write meals as Nutrition (Android) | Free | 10-13/14 | git |
| Strava | import; Strava API slot full (10 athletes), waitlist | Free | 10-16 shared tokens | docs/strava.md; landing |
| Widget Android | Progres Hari Ini, Kotak Masuk Grup, Ringkasan | Free | 10-13 | marketing-plan |
| Bahasa ID + EN | full translation web + native | - | 10-17 | docs/i18n.md |
| Pembaruan cepat (OTA) + banner Android | JS fixes without store | - | 10-17/18 | docs/ota.md |
| Mascot Joyo + Malang panorama footer | brand art | - | 10-13 / 10-18 | assets/mascot |
| Blog + Panduan | 11+ TKPI articles; 5 Panduan guides; Hamil/Naikin BB posts; JoyoFit tanpa Huawei Health | - | 10-12..10-19 | apps/web/blog |

**Pricing (IDR, web)**: Free 3 scans/day. Pro ladder: buyers 1-10 Rp15.000/mo or Rp149.000/yr; 11-110 **Rp29.000/mo or Rp199.000/yr (current step)**; 111+ Rp49.000/Rp349.000. Yearly ≈ Rp16.600/mo. Outside Indonesia USD US$9.99/mo, US$59.99/yr (Polar card on web since 10-18; Apple/Play prices raised 10-18). Payments: QRIS (Pakasir), Transfer Bank (DOKU), Apple IAP, Google Play Billing. Source docs/pricing.md. Step changes with buyer count: re-read /api/config before any post.

---
## 2. JoyoFit features
Repo watch-fit. Android + iPhone, ID + EN, AGPL-3.0, "free forever"; Pro = JoyoRogo Pro (Rp29.000/mo intro for first 110 buyers then Rp49.000; Rp199.000/yr). Support via Trakteer buys nothing (README).

**Status**: Android = Google Play closed test (join Google Group `joyofit-testers`, then "Become a tester", Android 10+). iPhone = public TestFlight beta (iOS 16.4+), App Store 1.0 awaiting Apple review. Watch tested: **only Huawei Watch Fit 4 Pro** (Bluetooth Classic). Everything else experimental (docs/watch-reference.md): Fit 4/5/5 Pro/3/2, GT 2..4 series, Band 2..10 and Honor bands over BLE (site says "61 model"); **Honor Watch 5/5 Pro/6 not supported**; earbuds not supported. Testers programme: site /dukung-jam (lend/pool funds/request model), in-app Watch > Help support your watch > Send report -> Atur board or GitHub watch-report template (#11, 10-20).

| Feature | One line | Tier | Ship | Evidence |
|---|---|---|---|---|
| Watch sync without Huawei Health | per-minute steps, kcal, distance, HR, SpO2, resting HR, TruSleep stages, workouts+GPS, live HR; bg mode syncs every 30 min | Free | before 10-14 | README; site |
| Recovery / Strain / Readiness | HRV (ln RMSSD) vs 30-day baseline; TRIMP 0-21; readiness. "inspired by WHOOP, not a WHOOP product" | Free | pre 10-14; metrics 10-18 | site; README |
| VO2max, recovery time, training status, race predictor, HRV status, sleep need | pure tested functions | Free | 10-18 | git 10-18 "Fitness metrics" |
| Workout analysis | map, scrubber charts, splits, laps, HR zones, best efforts, load, compare | Free | 10-18 | README |
| Live exercise: kcal, fat, carbs NEW-ish | Keytel kcal from live HR, fat/carb by zone, estimate not lab ("Baru, masih diuji") | Free | pre 10-14 | site |
| Strength logger (Hevy style) | rest timer, supersets, RPE, PRs, routines+folders, 105-exercise library, calendar, muscle heat map | Free (cloud copy Pro) | 10-18 | docs/strength.md |
| Works without a watch | no-watch onboarding, strength-first Today, manual body-feel | Free | 10-18 | README |
| Coach (Pro) | daily rule-based suggestion (no AI), run plans 5K/10K/HM/3x week, full-body plans, 100+ exercises w/ CC BY-SA wger images, "Tanya coach" chat (20 msg/day, not stored, not medical) | JoyoRogo Pro | 10-18 | docs/coach.md; site |
| Cloud sync (Pro) | workouts, strength, gear, coach plan, prefs, templates, routes, health history; restore on new phone | Pro | 10-18 | docs/multi-device.md |
| Strava | FIT upload with the watch's own numbers, gear linking; Strava slot full, waitlist /strava | Free | 10-18 | docs/strava.md |
| Gear (Sepatu & sepeda) | lifetime km, retire reminders 90/100% | Free (cloud Pro) | 10-18 | site |
| Watch faces + Studio | install/preview/delete .hwt; photo face; modular faces (community PR #3 by David4rr); JoyoFit Studio browser editor (Fit 4 / Fit 4 Pro, 408x480); EN/ID + Pro cloud projects NEW 10-19 | Free (cloud projects Pro) | 10-17/19 | web/README.md |
| Routes | GPX/TCX import, draw, send to watch (P2P push) | Free | 10-18 | git |
| Kartu bagikan | Story 9:16 / Square, route/photo/transparent sticker; 58 built-in template engine NEW | Free | 10-18 | docs/sticker-studio.md |
| Share to Threads NEW | carousel of 1080x1350 slides, caption copied | Free | 10-18/19 | docs/share-threads.md |
| Sticker Studio (create own stickers) | roadmap "Berikutnya", not shipped | - | - | roadmap |
| Social tab | JoyoRogo feed/groups inside app; HR/route detail of others Pro | Free / Pro detail | 10-17 | site |
| Keluarga (family monitoring) NEW | adult child sees few daily numbers from parent's watch, alerts, consent-based, push+email | [INFERENCE: Pro per design doc, verify] | 10-17/18 | docs/family-monitoring.md; /keluarga/<code> |
| Workout replay (MP4) NEW | 3D-ish replay of route, export MP4 with native encoder | Free | 10-18 | docs/replay.md |
| Bike computer mode NEW | ride screen, auto-pause/lap, alerts, route follow | Free | 10-18 | docs/bike-computer.md |
| Pro cycling analytics NEW | NP, IF, TSS, FTP suggest, power curve, climbs | Free (code on master; site says "Segera hadir") | 10-18 | docs/cycling-metrics.md |
| Record on phone + BT sensors NEW | chest strap, cadence/speed, power meter, foot pod; GPS, lock-screen; "Segera hadir" on site | Free | 10-18 | docs/sensors.md |
| Multi-watch NEW | several watches, switch active; "Segera hadir" | Free | 10-18 | docs/multi-watch.md |
| A-GPS update NEW | Watch tab row, Broadcom public server only; Huawei servers option removed | Free | 10-18 | docs/agps.md |
| Bluetooth scale NEW | body composition to JoyoRogo | Free | 10-19/20 | docs/scale.md |
| Loop dari rumah NEW | seeded street loops (OSRM) for steps/distance/time/kcal target | Free | 10-19/20 | docs/loops.md |
| Wawasan tidur + bedroom thermometer NEW | nightly sleep summary to JoyoRogo (opt-in), LYWSD03MMC room temp/humidity | Free, opt-in | 10-20 | docs/sleep-insights.md |
| JoyoFit Web (app.fit.joyorogo.com) NEW | browser analysis of workouts, sleep, uploads, export GPX/FIT/JSON, AI connector | JoyoRogo Pro | 10-19 | site #web |
| JoyoFit Ride (fit.joyorogo.com/ride) NEW | browser virtual cycling, phone as cadence sensor, 4 routes (Pantai 12 km, Bukit 9, Kebun 3, Bromo 8), intervals, daily challenge gold/silver/bronze, top-20 leaderboard, pacer bots | Free (no Pro needed) | 10-18/19 | docs/ride-web.md |
| Notifikasi, cuaca, alarm, cari jam | forward app notifications, Open-Meteo weather, alarms, find watch/phone | Free | pre 10-14 | site |
| Health Connect / Apple Health export, FIT import, Huawei Health export import | interoperability | Free | pre 10-14 | README |
| Update gate / OTA | blocking "Update dulu" wall for min builds | - | 10-19 | git |
| Kartu kalori di jam (JoyoRogo intake) | from Huawei Health reverse engineering, NOT tested on Fit 4 Pro | - | - | site disclaimer |

**Reverse-engineering angle**: site says "Aplikasi pengganti Huawei Health", "Pakai Huawei Watch tanpa Huawei Health", protocol = port of Gadgetbridge (AGPL). LEGAL.md: no Huawei code/account/servers, not affiliated, interoperability software; watch must be unbound from Huawei Health first (one app at a time).

---
## 3. Landing messaging verbatim

### joyorogo.com (live fetch 2026-10-20)
- Title: "JoyoRogo: Hitung Kalori dari Foto Makanan Indonesia"; OG: "JoyoRogo: Diet yang Paham Porsi Warteg"
- Hero H1: **Diet yang paham porsi warteg**
- Live subhead: "Foto piringmu, kalorinya terhitung dalam beberapa detik. JoyoRogo lalu bilang berapa lagi yang boleh kamu makan hari ini, berapa yang perlu dibakar, dan butuh tidur berapa jam. Gratis, tanpa kartu kredit."
- Source subhead (apps/web/src/routes/index.tsx:~460, newer): "Foto piringmu, kalorinya terhitung dalam beberapa detik. Tiap pagi JoyoRogo kasih tiga angka: berapa lagi yang boleh kamu makan, berapa yang perlu dibakar, dan butuh tidur berapa jam."
- Source hero CTA: "Coba gratis" (#coba) + platform-aware app buttons (Android tester, iPhone TestFlight, web). Live CTA: "Daftar dengan Google"
- Meta: "Foto piringmu, AI menghitung kalorinya dalam beberapa detik. Tiap hari tahu berapa boleh makan, harus bakar, dan butuh tidur. Gratis, foto tidak disimpan."
- Sections (live): "Tiga angka setiap pagi" (Boleh makan / Harus bakar / Butuh tidur) · "Foto, bukan ketik" · "Tren berat, bukan angka harian" · "Privasi" · "Web, Android, dan iPhone". Source adds: "Baru di versi tes" (cards: Koreksi scan pakai suara, Barcode dan foto label gizi, Tanggal target dan kebutuhan harian, Target makan dari level aktivitasmu, Bagikan progres, Grup dengan skor JoyoFit, Catat minuman, Profil yang dirapikan, Pembaruan cepat), Grup (Colek, Catatan, VAR perut), promises (Foto tidak disimpan / Tanpa iklan / Hapus kapan saja), open-source AGPL section, smartwatch section, roadmap, Threads quotes marquee.
- Platform line: "Aplikasi Android masih tes tertutup di Google Play... Aplikasi iPhone sudah bisa dicoba lewat beta publik TestFlight (iOS 16.4 ke atas); versi App Store 1.0 sedang menunggu review Apple."
- Footer: "Dibuat di Malang oleh Dzulfikar · Web, Android, dan iPhone · Bahasa Indonesia"
- Pricing page /harga: see section 1 ladder; promo label "Harga Founder (terbatas)" in source; user-facing name now "Pro".

### fit.joyorogo.com (live fetch 2026-10-20)
- Title: "JoyoFit: Pengganti Huawei Health untuk Jam Huawei, Open Source"; OG: "JoyoFit: Jam-mu. Data-mu. HP-mu."
- Hero: **Aplikasi pengganti Huawei Health / Jam-mu. Data-mu. HP-mu.**
- Subhead: "Pendamping jam Huawei yang jalan di HP sendiri. Langkah, detak jantung, tidur, dan olahraga ditarik langsung lewat Bluetooth dan disimpan di HP. Tanpa Huawei Health, cloud hanya kalau kamu mau. Belum punya jam? Catat latihan beban dari HP saja."
- CTAs: "JoyoFit untuk Android" (Google Group) · "JoyoFit untuk iPhone" (TestFlight) · "Cara pakai" · "GitHub" · "Mulai"; closing: "Pindahkan data jam-mu ke HP hari ini"
- Fine print: "Gratis dan open source. Diuji di Huawei Watch Fit 4 Pro, jam lain eksperimen."
- Section titles: "Semua data jam-mu, di HP-mu." · "Tidur lengkap dengan tahapnya" · "Olahraga langsung, lemak dan karbo ikut terhitung" · "Recovery, Strain, dan Readiness" · "Makan di JoyoRogo, gerak di JoyoFit" · "Tampilan jam sendiri" · "Latihan beban, dengan jam atau tanpa jam" · "Coach: tahu harus latihan apa hari ini" · "Social: latihan dari jam-mu, dilihat teman" · "JoyoFit Web: analisis latihan di browser" · "JoyoFit Studio: rancang tampilan jam" · "JoyoFit Ride: main sepeda virtual di web" · "Bagikan, kirim, dan mulai tanpa bingung" · "Jam yang ikut bekerja untukmu." · "Segera hadir" · "Roadmap" · "Kata mereka di Threads" · "Pakai Huawei Watch tanpa Huawei Health" · "Tiga cara memakai JoyoFit" · "Pertanyaan yang sering muncul" · "Kodenya terbuka, bisa kamu cek sendiri"
- Trust chips: "Langsung ke HP" / "Disimpan di HP dulu" / "Ekspor ke Health Connect dan Apple Health"; "61 model jam dan band Huawei dan Honor bisa dicoba"
- Pricing: Open source AGPL-3.0 **Rp0 selamanya**; Cloud sendiri di CloudAgni (self-host); **JoyoFit Cloud = JoyoRogo Pro Rp29.000/bulan** ("Harga perkenalan untuk 110 pembeli pertama, lalu Rp49.000/bulan. Atau Rp199.000/tahun (~Rp16.600/bulan)"), bullet "Dukungan prioritas: laporan dan permintaan fitur didahulukan" (added 10-20), CTA "Ambil JoyoRogo Pro".
- Threads quotes (real, with handles; get permission before reposting beyond site): "Nahh ini, buka huawei health serasa buka shopee sekarang" (@putrahn) · "mantapp ini yang saya perlu" (@manehteh_) · "Keren pak dibuat live…" (@pepperparker8) · "Gila pack effortnya" (@dorobryakov) · "GOAT." (@aldorino.yan).
- Note: live page is behind master (no Loop, scale, thermometer, bike computer, replay, multi-watch yet).

---
## 4. Dated releases, last 5 weeks, newest first (dates = commit dates)

### JoyoRogo (max 30)
| Date | Release | Post angle |
|---|---|---|
| 10-19 | Sisa Beranda: target makan = BMR x level aktivitas pilihanmu; weekly recap per-hari | "Target makanmu sekarang ngikutin level aktivitas yang kamu pilih, bukan tebakan app." |
| 10-19 | Tidur di JoyoRogo baca jam tidur dari JoyoFit | "Tidur dari jam Huawei langsung nongol di JoyoRogo, nggak perlu input manual." |
| 10-19 | /panduan/kalori: panduan rumus kalori gaya blog | "Penasaran angka kalori harianmu dari mana? Rumusnya dijelasin tuntas, sumbernya ada." |
| 10-18 | Naikin BB (mode gain) | "Mau naik berat? Sekarang ada mode surplus kecil + target protein, bukan cuma buat yang diet." |
| 10-18 | Mode Hamil dan Menyusui | "Mode khusus ibu hamil/menyusui, tanpa defisit. Tetap perkiraan, tetap tanya dokter." |
| 10-18 | Koneksi AI (Claude/ChatGPT via MCP) | "Tanya Claude soal diary makanmu sendiri. Read-only, bisa dicabut kapan aja." |
| 10-18 | Kartu & stiker share baru (32 template) | "Rekap harian dan streak jadi stiker Story yang enak dipamerin." |
| 10-18 | Profil dirapikan jadi hub | "Profil nggak lagi satu halaman panjang, sekarang rapi per topik." |
| 10-18 | Latihan beban pindah ke JoyoFit | "Gym log pindah ke JoyoFit, JoyoRogo fokus ke makan." |
| 10-18 | Latihan jam di cloud /jam (Pro) + peta rute di feed | "Lari kamu muncul di feed lengkap sama peta rutenya." |
| 10-18 | Satu akun banyak HP (preferensi ikut akun) | "Ganti HP? Pengaturanmu ikut pindah." |
| 10-18 | Tanggal target lewat -> kartu tanggal realistis | "Target tanggalmu udah lewat? Ada tombol satu ketuk ke tanggal yang masuk akal." |
| 10-18 | Bayar USD kartu internasional (web) | "Di luar Indonesia? Sekarang bisa bayar Pro pakai kartu dolar." |
| 10-18 | Catat minuman: 0 kkal, air putih, Coke Zero | "Air putih akhirnya dihitung 0 kalori, nggak ditebak lagi." |
| 10-18 | OTA: update tanpa nunggu toko | (skip or behind-the-scenes) "Bug kecil bisa dibenerin tanpa nunggu review toko." |
| 10-17 | Koreksi scan pakai suara/teks | "Salah baca? Bilang 'nasinya setengah aja', langsung dihitung ulang." |
| 10-17 | Barcode + foto label gizi + sumber USDA | "Produk nggak ada di database? Foto label gizinya, jadi ilmu bareng semua user." |
| 10-17 | Scan streaming (hasil muncul bertahap) | "Hasil scan muncul pelan-pelan, nggak nunggu layar kosong." |
| 10-17 | Kalender tanggal target + Kebutuhan harianmu | "Pilih tanggal, langsung tau ritmenya aman apa nggak." |
| 10-17 | Banner update Android + Story share Strava-style | "Share progres ke IG Story tinggal satu ketukan." |
| 10-17 | Bahasa Indonesia + English penuh | "JoyoRogo sekarang bisa full English juga." |
| 10-17 | Akurasi scan: kalibrasi lauk (ayam penyet sambal ijo, tahu tek, tempe mendoan) | "Dibenerin biar sambal nggak bikin kalori lauk salah itung." (no accuracy %) |
| 10-16 | Founder jadi Pro; Play Billing; Strava token dipakai bareng JoyoFit | "Founder sekarang namanya Pro, harga tetap ikut tangga Founder." |
| 10-16 | Android tester Play closed test + TestFlight CTA | "Android udah bisa ikut tes tertutup di Play, iPhone via TestFlight." |
| 10-15 | iOS build diterima App Store (review); Sign in with Apple | "iPhone: build udah masuk review Apple." |
| 10-15 | Tantangan grup (Pro host 7/14/30 hari) | "Bikin tantangan 7 hari bareng grup: langkah, protein, atau tidur." |
| 10-15 | Makan views: Daftar, Kalender stiker, Stiker book; Rekap mingguan | "Riwayat makanmu jadi buku stiker, lucu." |
| 10-14 | VAR perut rebuilt, Date switcher, Story share, Profile photos | "VAR perut: AI bandingin foto perut, bukan ngukur." |
| 10-13 | Grup, feed komunitas, Puasa intermiten, Harga per piring, latihan beban | "Diet bareng teman: grup, colek, feed." |
| 10-12 | Rilis publik (AGPL), Ceritakan, lingkar perut, blog TKPI | "JoyoRogo open source dari Malang." |

### JoyoFit (max 30)
| Date | Release | Post angle |
|---|---|---|
| 10-20 | Kirim laporan jam ke Atur (#11) | "Jam kamu belum didukung? Kirim laporan langsung dari app, kita cek." |
| 10-20 | Thermometer kamar + Wawasan tidur (opt-in) | "Suhu kamar ikut dihitung buat analisis tidurmu. Opsional." |
| 10-20 | Timbangan Bluetooth -> JoyoRogo; Loop shortcut | "Timbangan pintar nyambung, berat langsung masuk catatan makan." |
| 10-20 | Loop planner (rute lari muter dari rumah) | "Mau lari 5 km tapi nggak tau lewat mana? Rute muter dari rumah otomatis." |
| 10-20 | Dukungan prioritas untuk Pro | "Pro dapat laporan & request fitur didahulukan." |
| 10-19 | JoyoFit Web (app.fit.joyorogo.com) + Studio EN/ID + cloud proyek | "Analisis latihan di laptop. Datanya tetap di akunmu." |
| 10-19 | JoyoFit Ride: bot peloton, jersey, HUD | "Sepeda virtual ala Zwift, cukup HP jadi sensor kadens." |
| 10-19 | Share ke Threads (carousel 1080x1350) | "Share latihan jadi carousel Threads sekali tap." |
| 10-19 | Bulan terbit/terbenam di cuaca jam; reconnect lebih tahan | "Jam kamu sekarang tau kapan bulan terbit." |
| 10-19 | Bluetooth scale (#9) | "Timbangan Bluetooth sekarang didukung." |
| 10-19 | Perbaikan database korup (auto-repair) | "Data aman: kalau database rusak, app memperbaiki sendiri." |
| 10-18 | Kartu/stiker share 58 template | "58 gaya kartu share buat latihanmu." |
| 10-18 | Replay latihan jadi video MP4 | "Latihan kamu jadi video replay. Share ke IG." |
| 10-18 | Ride web: game pesepeda 3D, interval, tantangan harian | "Main sepeda virtual di browser." |
| 10-18 | Mode bike computer + analisis bersepeda (NP, TSS, FTP) | "HP kamu jadi bike computer." (hold until store build) |
| 10-18 | Rekam dari HP + sensor BLE (chest strap, cadence) | "Nggak punya jam? Rekam lari/gowes dari HP + sensor." (hold) |
| 10-18 | Multi-watch (lebih dari satu jam) | "Satu jam buat harian, satu buat lari." (hold; site says Segera hadir) |
| 10-18 | Coach (saran harian, rencana lari, Tanya coach) | "Coach tau kamu harus latihan apa hari ini. Aturannya terbuka, tanpa AI." |
| 10-18 | Pencatat latihan beban Hevy-style | "Catat gym gratis, jam atau tanpa jam." |
| 10-18 | Latihan tanpa jam (onboarding & Today) | "Belum punya jam? Tetap bisa pakai." |
| 10-18 | Gear: sepatu & sepeda + pengingat pensiun | "Tau sepatu larimu udah berapa km." |
| 10-18 | Angka 1:1 dengan Strava; FIT mencantumkan jam | "Angka di JoyoFit sama persis dengan Strava." |
| 10-18 | Cloud latihan (Pro) + sinkron banyak HP + wipe | "Ganti HP, riwayat ikut pulih." |
| 10-18 | Social route map; hapus latihan; notifikasi rekam lock-screen | "Peta rute larimu tampil di feed." |
| 10-18 | A-GPS (Android+iOS), opsi server Huawei dihapus | "GPS jam lock lebih cepat." |
| 10-18 | Modular watch faces (#3, kontributor), Studio field browser | "Watch face modular, kerja bareng kontributor komunitas." |
| 10-18 | i18n ID/EN penuh | "JoyoFit sekarang bisa bahasa Inggris." |
| 10-17 | Keluarga (family monitoring) server + app | "Pantau kondisi orang tua dari HP kamu, dengan izin mereka." |
| 10-17 | Social tab: grup, bagikan latihan jam ke JoyoRogo | "Share latihan jam ke teman." |
| 10-16..14 | iOS TestFlight/CI; Strava FIT; Play closed test | "Build iPhone udah bisa dicoba via TestFlight." |

---
## 5. Visual assets (all under /home/dzul/Documents/JoyoDigitama)
- joyorogo/docs/img/landing-mobile.png, landing-desktop.png: landing screenshots
- joyorogo/docs/img/feed-maps-web-*.png (5): feed route maps
- joyorogo/.tmp/appstore/01-beranda..07-founder-iap.png: App Store screens (Beranda, scan, makan, olahraga, tidur, berat, grup, feed, Pro)
- joyorogo/.tmp/appstore-ios/01-04.png: iOS store frames
- joyorogo/.tmp/storeframes/ (frame.html, render.mjs, out/): phone-frame generator; scripts/store-shots (JSON spec generator)
- joyorogo/.tmp/ios-shots/: raw iPhone WhatsApp screenshots (private, check)
- joyorogo/.tmp/story-v3/: before/after Story share cards (workouts, meals, progress)
- joyorogo/.tmp/mascot-use/: mascot empty states, light/dark
- joyorogo/assets/mascot/*.png (19): Joyo mascot poses (cheer, happy, hero, sleepy, wink, mantap...) + README
- joyorogo/apps/web/public/: og.png, mascot/, food/ cutouts, tips-img/, brand/logo.svg, logo-mark.svg
- joyorogo/apps/web/public/brand/connect-with-strava.svg, powered-by-strava.svg: official Strava marks (rules apply)
- joyorogo/.tmp/ other folders: favorit, feed, recap, sticker-rows, tile, undo, var, widget, harga (feature screenshots; check dates)
- joyorogo/dist/store-play: Play listing assets
- watch-fit/site/public/shots/*.webp: today, sleep, strength-routines, strength-exercises, watch, studio-face, ride-hud, ride-routes (+480/640 sizes)
- watch-fit/docs/screenshots/*.png (12): bike computer, cycling ride detail, social route map light/dark
- watch-fit/site/public/og.png, mascot/, brand/, exercises/ (CC BY-SA wger images, credit), play/ (store assets)
- watch-fit/assets/icon.png, brand/, strava/ (official), brand-marks/ (Apple Health, Health Connect; platform-restricted)
- watch-fit/site/og/og-image.html: OG image source

---
## 6. Claims to avoid (additional to marketing-plan.md 1.1)
**Huawei / reverse engineering**
- Do not say "hack", "bypass", "jailbreak", "crack", "unlock Huawei premium", "gratiskan fitur Huawei". LEGAL.md: JoyoFit does not unlock paid features and cannot forge Huawei face signatures.
- Do not say "official", "Huawei-approved", "kerja sama Huawei", or use the Huawei/Honor logo or product renders (names only, nominative: brand-marks.md). Say "tidak berafiliasi dengan Huawei/Honor".
- "Pengganti Huawei Health" is the site's own phrase but sensitive; prefer "pendamping jam Huawei tanpa Huawei Health" and keep "tidak berafiliasi".
- Reverse-engineering is claimed only for the calorie card on the watch ("hasil reverse engineering Huawei Health, belum diuji di Fit 4 Pro"). Core protocol is a Gadgetbridge port: credit Gadgetbridge, avoid "kami reverse engineer Huawei".
- Never say "semua jam Huawei didukung". Only Watch Fit 4 Pro tested; "61 model bisa dicoba" = experimental. Honor Watch 5/5 Pro/6 explicitly NOT supported. Never promise Watch Fit 3/5/GT/Band/Fit 1/Fit SE support (roadmap items).
- Do not tell people to unbind casually without the caveat: the watch loses the Huawei Health pairing (one app at a time).
- A-GPS uses Broadcom's public server only; do not say "A-GPS dari Huawei".

**Availability**
- Not in stores: App Store (awaiting review), Play (closed test only). Do not say "tersedia di Play Store / App Store".
- Not shipped (site "Segera hadir"/roadmap): multi-watch, BT sensors + phone recording, pro cycling data, Sticker Studio (create-own), Strava slot lift, Apple Health history import, Garmin/Wahoo pull, watch-side maps, gym-on-watch, "Tantangan Balik rutin". Code on master != release.
- Strava: only 10 athlete slots, all full; waitlist. Do not promise "langsung upload ke Strava". Brand rules: use only official "Connect with Strava"/"Compatible with Strava"/"Powered by Strava" artwork unmodified; no Strava logo in JoyoFit stickers; do not imply Strava endorsement; do not call it "Strava replacement". Say "kirim latihan ke Strava". Compare only with "seperti Strava" cautiously (roadmap copy does; keep out of ads).
- Apple Health / Health Connect icons: platform-only (Apple icon iOS builds only; Health Connect Android only). Do not use them in social graphics.
- Claude / ChatGPT: no logos; "konektor read-only" only; not yet listed in their directories (roadmap).
- Threads testimonials: quote only with handle and link; do not say "ribuan pengguna".

**Health / medical**
- Fat/carb burn, kcal (Keytel), Recovery/Strain/Readiness, HRV, VO2max, race predictor, sleep need, cycle predictions are estimates, "bukan alat medis". No "bakar lemak X gram", no "diagnosa". Recovery = "terinspirasi WHOOP, bukan produk WHOOP": do not use WHOOP name/logo or compare accuracy.
- Keluarga: monitoring parents is consent-based, not an emergency/fall/SOS system; do not say "deteksi darurat", "selamatkan nyawa", "pantau kesehatan lansia" as medical. Always say "dengan izin".
- Hamil/Menyusui: estimates only, "tanya dokter/bidan"; no "aman untuk bayi", no weight-loss framing. Naikin BB: no "bulking" claims or muscle-gain outcome promises; no "naik X kg".
- Coach: rules-based ("tanpa AI", aturan terbuka), not medical, not a trainer replacement. "Tanya coach" uses Workers AI (not stored): do not say "tanpa AI" about the chat. Max 20 messages/day.
- Sleep insights / thermometer: opt-in, nightly summary to JoyoRogo; no "meningkatkan kualitas tidur" claims.
- Share/Workout numbers "1:1 dengan Strava": only true for distance/time from the watch's own numbers; do not generalize to "sama dengan Garmin/Strava semua metrik".
- Scale body composition: scale-reported, not clinical; no body-fat diagnosis.

**Pricing / privacy**
- Prices are a ladder tied to buyer count (Rp29.000 now); never hardcode without /api/config. Store (Apple/Play) prices differ outside ID (US$9.99/US$59.99). "Rp0 selamanya" applies to JoyoFit app, NOT cloud sync/Coach.
- Do not say "data tidak pernah keluar dari HP" without the cloud/opt-in caveats (cloud when signed in, Open-Meteo weather, JoyoRogo sync, Atur reports). Free accounts do not upload workouts.
- "Tanpa cloud": multi-phone sync, Coach, cloud workouts need Pro. Prioritized support for Pro began 10-20.
- Ride: virtual power is estimated; leaderboard only phone-sensor verified; other riders are bots. Do not call it "Zwift" (internal commit wording only).
- wger exercise images are CC BY-SA: credit required in any reuse. Android robot art (CC BY 3.0 credit in footers), CC credit needed for landing art reuse.
- Open-source AGPL: do not say "bebas dipakai komersial tanpa kewajiban".
