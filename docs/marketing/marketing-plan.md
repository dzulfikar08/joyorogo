# JoyoRogo marketing plan

Written 2026-10-15. Covers a 30-day launch (Mon 19 Oct to Tue 17 Nov 2026) and a Ramadan 2027 track. Built for one person, near-zero cash budget, roughly 10 to 12 hours a week (a proposal, adjust to your real time).

Evidence rules used throughout. "Verified" means I read it in the repo or on the cited page on 2026-10-15. "Inference" means my reasoning, not a measurement. There are no user counts, ratings, testimonials, or conversion rates in this plan because none exist in the repo. Every target number below is a goal to calibrate after the Day 0 baseline, not a forecast.

Update 2026-10-20: social execution (Threads, Instagram, TikTok, JoyoFit included, static formats before video) moved to [`social-playbook.md`](social-playbook.md), which overrides sections 3, 4 and the social rows of section 10 where they differ. Every user-visible feature now gets a release entry in [`releases/`](releases/README.md).

---

## 0. Findings that change the plan

1. A near-identical competitor exists. Pantau Kalori (pantaukalori.com) promises "Foto piringmu. Kalorinya langsung muncul.", splits nasi padang per komponen, shows "Segera di App Store / Google Play" and "Sedang dalam peninjauan toko aplikasi", and prices Pro at Rp49.000/bulan or Rp499.000/tahun with auto-renew and a 7-day trial [S8]. "Foto lalu kalori" cannot be the lead differentiator. Lead with what only JoyoRogo has: groups (colek, VAR, catatan), IF and Ramadan scheduling, price lock with no auto-renew, open source, and the TKPI-sourced blog.
2. Android distribution is an APK today (README, landing). Before a Play listing is possible you need a closed test with at least 12 testers opted in continuously for 14 days if your developer account is a personal one created after 13 Nov 2023 [S11], a Health apps declaration plus a "not a medical device" disclaimer in the description [S10], and an answer on billing (section 8.5). The 14-day clock is the longest lead item, so it starts in week 1 and the challenge cohort doubles as the tester pool.
3. Virality runs on WhatsApp, discovery on TikTok and Instagram. APJII 2025 (via Kontan) puts WhatsApp at 95.9% of internet users, Instagram 62.4%, Facebook 60.5%, TikTok 42.5% [S2]. Group invites are `https://joyorogo.com/gabung/<kode>` links that people paste into WhatsApp, so every acquisition asset should end in "ajak 1 teman".
4. Revklik is blind inside the app and the admin console has no group or retention numbers. Revklik only keeps `/`, `/harga`, `/login`, `/pembayaran`, `/privasi`, `/blog`, `/u/`, `/p/` plus conversions (`apps/web/blog/revklik.ts`, an inline filter in `<head>` ahead of the tag, so it holds even when the app bundle does not load). Admin shows users, signups, active today, founders, scans, orders. Section 11.4 supplies SQL for the rest.
5. Scan time: the landing now says "8-15 detik", the owner's observed end-to-end time (photo to result). Prod `ai_usage` for the 14 days to 15 Oct 2026 (67 user scans) shows the AI call alone at a median of about 3 s, p90 about 7.5 s, max 14.5 s; upload, resizing and cropping add the rest. Re-check before quoting a tighter number.
6. Ramadan 1448 is expected around 8 to 9 Feb 2027, with the official date set by Sidang Isbat Kemenag [S5][S6]. The app's `auto` Ramadan mode uses the Umm al-Qura calendar (`packages/api/src/lib/engine.ts`, `isRamadanDate`), which can differ from the Indonesian decision by a day. Tell users to set Mode Ramadan to "Aktif" by hand on day 1.
7. Avoid the visual and copy patterns of oyenza.com (section 1.6).

---

## 1. Positioning and ICP

### 1.1 Claim ledger (what the product can back up)

| Say | Where it is true | Never say |
| --- | --- | --- |
| Foto piring, AI memperkirakan kalori, protein, karbo, lemak; kamu koreksi sebelum simpan | README, landing FAQ | "akurat", "pasti", "100%", any accuracy percentage |
| Kalori dikalibrasi dengan TKPI 2019 Kemenkes | README, blog | "disetujui" or "disahkan Kemenkes" |
| Foto makanan tidak disimpan kecuali "Simpan foto asli" | README, landing promises | Do not stretch this to VAR perut: belly photos are stored privately in R2 and can be deleted (`group.ts` varAnalyze, varDelete) |
| Tanpa iklan; satu tombol hapus semua data di Profil | landing | |
| Gratis 3 scan AI per hari (README default; live value comes from `/api/config`), Founder tanpa batas | README, `tiers.ts` | Any price or quota not read from `/api/config` the same day |
| Founder: Rp15.000/bulan atau Rp149.000/tahun untuk 10 pembeli pertama, Rp29.000 / Rp199.000 untuk pembeli 11 sampai 60, lalu Rp49.000 / Rp349.000; harga tahunan mengikuti langkah tangga (sekarang Rp199.000, ~Rp16.600/bulan), ditampilkan tahunan lebih dulu; harga terkunci di harga terendah yang pernah dibayar; tanpa perpanjangan otomatis; harga Apple/Play diubah manual (`docs/pricing.md`) | `FOUNDER_PRICE_LADDER`, `FOUNDER_YEARLY_PRICE_IDR`, `tiers.ts`, `harga.tsx` | "Harga naik besok" or countdowns that are not tied to the buyer count |
| Pro membuka lebih dari jatah scan, dikelompokkan: AI (jatah scan, Joyo AI, Tanya coach, Koneksi AI untuk Claude/ChatGPT, refleksi rekap mingguan, temuan tidur pribadi), Makan (rencana makan + daftar belanja, saran makan dari skor JoyoFit), JoyoFit (cadangan cloud latihan, tidur, rute, sensor, latihan beban), Sosial (membuat tantangan grup, detail latihan teman di feed), pengingat menu mingguan, badge Pro, dukungan prioritas | `PRO_BENEFIT_GROUPS` (`packages/i18n/src/pro-benefits.ts`; tiap item menyebut gate di `packages/api`), `docs/pricing.md` "What Pro unlocks", `harga.tsx` | "Pro cuma soal jatah scan" (salah); rute resolusi penuh di postingan orang lain (yang terbuka hanya garis yang dibagikan, plus detak jantung dan analisis); JoyoNavi, peta offline, wajah jam premium (belum ada); jam yang belum dites sebagai didukung |
| Dukungan prioritas (Pro saja): kirim DM Threads ke akun pemilik, sebut email akun JoyoRogo, dibalas paling lambat 1 hari kerja. Pengguna gratis tetap bisa menulis ke email kontak, tanpa janji waktu balas | `PRIORITY_SUPPORT` di `pro-benefits.ts` (satu konstanta: akun dan janji waktu balas), kartu "Dukungan prioritas" di Profil > Langganan (web dan aplikasi, hanya akun Pro) | Janji waktu balas untuk akun gratis; "24 jam", "live chat" atau saluran lain; akun Threads pemilik adalah akun sementara sampai ada akun resmi |
| Grup: maksimal 20 anggota, satu akun maksimal 5 grup, colek sekali per jam per orang, catatan 140 karakter (20 per hari) | `group.ts` | |
| VAR di grup: kamera ke teman, makanan yang ia catat hari ini tampil, vonis aman atau offside terhadap target kalorinya | `group.ts` varScan, `varVerdict` | That friends' food is hidden by default: `share_food` defaults to on, each member can switch it off per group. `share_var` (belly verdict) defaults to off |
| Tantangan grup: Founder membuat tantangan 7, 14, atau 30 hari di dalam grup (langkah, protein, kalori, latihan, strain atau tidur JoyoFit); semua anggota, termasuk akun gratis, bisa ikut; papan peringkat dan streak per anggota, kartu hasil untuk dibagikan | `challenge.ts`, `lib/challenge.ts`, `lib/challenge-host.ts` | That every number is verified. Langkah dan skor JoyoFit datang dari perangkat; makanan dan latihan yang diketik tampil sebagai "Dicatat manual", makanan dari scan sebagai "Dari scan foto". Protein dan kalori dibandingkan dengan target pribadi yang dibekukan saat bergabung, hari ini baru dinilai setelah selesai untuk kalori |
| VAR perut (sendiri): AI membandingkan dua foto perutmu: turun, sama, naik, atau beda; estimasi visual, bukan pengukuran | `varscan.ts` prompt | Any percent body fat, cm, or kg claim. TikTok bans "harmful body comparisons" [S9] |
| IF 16:8, 18:6, 20:4, OMAD; Mode Ramadan sahur 40%, berbuka 45%, camilan 15% | `fasting.ts`, `engine.ts` | That 40/45/15 is a scientific split. It is the app's default starting point |
| Widget Android: Progres Hari Ini, Kotak Masuk Grup, Ringkasan | `app.json` | Real-time updates: widgets refresh about every 30 minutes or when the app loads (`widget-task-handler.tsx`) |
| Health Connect: langkah, olahraga, tidur; Strava | README | iOS Health parity |
| Open source AGPL-3.0, dibuat di Malang | README, `llms.txt` | |
| Tips diet berbasis studi | `tips.ts` (16 tips, each with source links) | Any tip stated stronger than its own "Catatan jujurnya" |

Never claim: medical outcomes, "turun X kg dalam Y hari", detoks, "bakar lemak", user counts, ratings, testimonials, "#1".

### 1.2 Market context (cited)

- 230 juta pengguna internet dan 180 juta identitas pengguna media sosial di Indonesia akhir 2025; median usia penduduk 30,4 [S1].
- TikTok punya jangkauan iklan 180 juta pengguna usia 18+ (56,3% perempuan), Instagram 108 juta (53,2% perempuan pada audiens dewasa) [S1]. Ini jangkauan iklan, bukan pengguna aktif bulanan, dan tidak sebanding langsung dengan angka APJII di atas.
- Survei Kesehatan Indonesia 2023: 23,4% penduduk dewasa (di atas 18 tahun) obesitas. Perempuan usia 40 sampai 44 tahun tertinggi di 41,7%; kelompok usia 20 sampai 40-an berkisar 16% sampai 38% [S3]. Kemenkes mengaitkan obesitas dengan porsi berlebihan, makan tidak teratur, serta makanan manis, berlemak, dan gorengan [S3]. Itu persis topik blog kita.
- Ramadan: seorang ekonom yang dikutip Media Keuangan Kemenkeu menyebut konsumsi makanan justru lebih tinggi saat Ramadan dibanding di luar Ramadan [S4]. Itu satu kutipan, bukan data kalori; pakai sebagai alasan mengapa topik "diet saat puasa" layak dikerjakan, bukan sebagai angka di konten.
- Kompetitor yang saya baca: FatSecret di Google Play (50 jt+ unduhan, rating 4,5 dari 548 rb ulasan pada 15 Okt 2026; fitur Premium termasuk rencana puasa intermiten dan pemantau air; dua dari tiga ulasan terbaru yang saya baca mengeluh pembaruan membuat input makanan lambat dan membingungkan, satu lagi mengeluh makanan dasar tidak ada di pencarian) [S7]; Pantau Kalori [S8]; Yazio (AI calorie counter, listing Play dan App Store). Tidak saya teliti: MyFitnessPal, Cal AI, dan aplikasi lain.
- Pantau Kalori vs JoyoRogo, dari halaman publik masing-masing: mereka menjual rekap mingguan dan target adaptif di Pro; kita membuka grup, VAR, latihan beban, IF, dan harga makanan untuk semua tier. Tangga Founder kita berakhir di Rp49.000/bulan, sama dengan harga bulanan Pro mereka hari ini, tapi tanpa perpanjangan otomatis dan dengan harga terkunci.

### 1.3 Positioning

Statement (internal): Untuk orang Indonesia yang mau turun berat badan dan sudah capek mencatat kalori manual, JoyoRogo adalah pencatat diet yang ngerti porsi warteg dan bisa dipakai bareng teman. Foto piring, lihat tiga angka hari ini, dan ada teman yang mencolek kalau kamu bolos.

Public one-liners (pick per channel):

- Video: "Diet bareng teman, tanpa ribet nyari kalori."
- Store and SEO: "Hitung kalori makanan Indonesia dari foto."
- Partners: "Ruang grup buat klien dan member, gratis."
- Founder pitch: "Aplikasi diet buatan Malang, open source, tanpa iklan."

Order of proof, strongest first:

1. Diet bareng (colek, catatan, VAR, widget). Not found in the Pantau Kalori or FatSecret listings I read. I did not verify FatSecret's community features in depth.
2. Honest and local: TKPI, editable results, "Hasil foto selalu perkiraan" already on the landing.
3. Fair money: free tier is real, Founder is a one-off payment per period, price lock, no card stored.
4. Open source and made in Malang.

AI is the mechanism, not the headline. People respond to "foto nasi padang, ini hasilnya" more than to "AI".

### 1.4 ICP

Primary (hypothesis to validate): pekerja atau mahasiswa Android, kira-kira 22 sampai 38 tahun, makan di warteg, padang, atau pesan online, pernah mencoba aplikasi kalori lalu berhenti karena mencari makanan satu per satu terlalu ribet, dan punya satu sampai tiga teman, pasangan, atau rekan kantor yang juga mau diet. Reasons: the product is Android-first (APK, widgets, Health Connect) with web for iPhone; groups only pay off with 2 or more people; Rp15.000 to Rp49.000 is an impulse price over QRIS.

Secondary, in this order:

1. Orang yang berpuasa (IF 16:8 or Ramadan): seasonal peak Feb to Mar 2027.
2. Pemula angkat beban yang ingin menjaga otot saat defisit (workout module, protein target; tips "angkat-beban-saat-diet", "protein-kenyang-jaga-otot").
3. Perempuan 40 tahun ke atas, kelompok dengan prevalensi obesitas tertinggi [S3]. They reach you through WhatsApp family groups, Facebook, and ahli gizi or senam groups, not TikTok. Treat as phase two via partnerships.
4. Multipliers: PT, gym, ahli gizi, komunitas lari atau senam. They bring groups, not individuals.

Not for: anyone with an eating-disorder history, under 18, pregnant or with a medical condition that needs a supervised diet. Content never pushes aggressive deficits, and every health-adjacent asset carries "konsultasi dengan dokter atau ahli gizi".

Validate in the first 30 days: 5 interviews with cohort members (15 minutes, ask what they used before and why they stopped), plus admin's Users table (last seen, food logs) to see who actually returns.

### 1.5 Message house

- Hero line for outbound: "Foto piringmu, lihat sisa kalorimu hari ini."
- Three proofs: tiga angka harian; colek dan VAR; data TKPI dan hasil yang bisa dikoreksi.
- Objections, answered with what is already in the FAQ: akurasi (perkiraan, bisa diubah), foto disimpan (tidak, kecuali kamu pilih), gratis sampai kapan (diary gratis selamanya, 3 foto AI per hari), iPhone (lewat browser).
- Calls to action, one per asset: "Coba scan tanpa daftar" (landing `#coba`, tracked as `try_scan_click`), "Unduh APK" (`apk_download`), "Buat grup" (in-app), never three at once.

### 1.6 Guardrails against lookalikes

oyenza.com (I read its landing on 2026-10-15) is a finance tracker with a distinct pattern. Do not borrow it:

- Headline formula "Verb benda. Langsung tercatat." and the "Bayar QRIS. Langsung tercatat." rhythm. Write full sentences instead.
- Number-as-headline blocks ("0 ketikan", "0,5 detik", "8 detik", "3.000 baris") with a swapped unit under each. The existing facts strip on our landing ("3-9 detik", "Rp0", "0 foto") already leans toward this; do not repeat it in ads or the store listing. Put numbers inside sentences.
- Section titles like "Pilih caramu mencatat." and "Satu angka yang langsung jelas."
- A hero with three adjacent CTAs (web, TestFlight, APK) and a phone mock at 9:41.
- An orange cat mascot in food or payment scenes. Our mascot is a green, muscular cat in Javanese armor (`apps/web/public/mascot/hero.webp`). Keep it green and armored; no orange, no cute-pose variants.
- Also avoid Pantau Kalori's exact tagline "Foto piringmu. Kalorinya langsung muncul." Our landing already says "Foto piringmu, kalorinya terhitung dalam beberapa detik"; do not move closer.

---

## 2. Channel priority

Order reflects effort and how soon each one gives a readable signal.

| # | Channel | Role | Weekly time | Cash | First readable signal | Continue rule |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TikTok and Reels (same files) | Discovery | 4 h (batch film Sunday, 20 min a day replying) | 0 | Views per video, then `signup_click` per weekly UTM campaign | Keep the pillar with the most signup_click per 1.000 views after 8 videos each; drop the weakest |
| 2 | Group challenge and WhatsApp invites | Activation and referral | 2 h | 0 | Groups with 3 or more active members; invited joins (SQL in section 11.4) | Keep if cohorts produce members who log on 3 or more days |
| 3 | SEO via blog and tips | Compounding, intent traffic | 2 h | 0 | Revklik `top_pages` for `/blog/*` in 2 weeks; `gsc_queries` after indexing | Keep indefinitely; it is the only channel that compounds without you posting |
| 4 | Instagram Stories via story share | Social proof from users, own account | 1 h | 0 | Story replies, link taps (UTM `instagram` / `story`) | Keep if replies or taps beat your normal story baseline |
| 5 | Play Store ASO | Trust and search | 1 h plus setup | 0 | Console installs after production access | Gated by section 8 prerequisites |
| 6 | Partnerships (PT, gym, ahli gizi) | Group multipliers | 1 h | 0 | Replies, pilot groups | Keep if a pilot group reaches 5 active members |
| 7 | Ramadan and IF campaign | Seasonal peak | Starts Dec | 0 | See section 7 | Fixed calendar |

No paid ads. Revisit only after activation (section 11) is stable, because each free scan costs inference money; a viral spike also raises that bill. If a video spikes, watch "Scans today" and "anon" in admin. `ANON_SCANS` and `FREE_DAILY_SCANS` are the levers (README env table).

---

## 3. TikTok and Reels

### 3.1 Content pillars

| Pillar | What it is | Source material in the repo | Safe angle |
| --- | --- | --- | --- |
| P1 Hitung makanan kita | Screen recording of a real scan, then the manual correction | Scan flow, blog TKPI tables | Always show the edit step and the word "perkiraan" |
| P2 Diet tanpa mitos | One tip, one named study, one honest caveat | `tips.ts` (16 tips with source links) | Put the study name and caveat on screen; link in pinned comment |
| P3 Diet bareng | Colek, VAR di grup, grup challenge, widget | `group.ts`, landing group section | Only people who agreed to appear; sharing toggles explained |
| P4 Dibuat di Malang | Founder talks price, open source, bugs, numbers | `FOUNDER_PRICE_LADDER`, README | Real slot count from `/api/config` the same day |
| P5 Puasa dan Ramadan | IF windows, sahur and berbuka split, takjil | `fasting.ts`, Ramadan article | Starts in earnest Jan 2027; two probes in October |

### 3.2 Production system (solo, free tools)

- Batch film 6 videos in one Sunday session: Android screen recording for scans, selfie voiceover for hooks.
- 9:16, burned-in Indonesian captions, hook inside the first 2 seconds, one CTA, 15 to 35 seconds.
- Caption ends "Link di bio". Bio link: `https://joyorogo.com/?utm_source=tiktok&utm_medium=bio&utm_campaign=<minggu>` (change the campaign weekly; Revklik cannot split by video because link-in-bio is a single URL, so combine with TikTok's own per-video analytics).
- Pinned comment carries the source (TKPI page or study) for every factual claim.
- Post the same file to Instagram Reels. YouTube Shorts is optional and free.

### 3.3 Platform and health safety

- TikTok does not allow content that promotes disordered eating or risky weight-loss methods, or harmful body comparisons [S9]. So: no extreme deficits, no body checking, no before/after body shots, no "what I eat to lose X kg in Y days". Show food, numbers, and process.
- VAR perut is deliberately not used as a hook. Show a results screen at most, no bodies.
- No testimonial or "kata pengguna" until real users give attributable permission in writing.

### 3.4 Fifteen hooks (Indonesian)

Numbers marked TKPI come from the blog posts in `apps/web/blog/posts/`; re-read the post before filming. "Sumber" is what goes in the pinned comment.

| # | Pillar | Hook (spoken or on screen) | What the viewer sees | Sumber / claim check |
| --- | --- | --- | --- | --- |
| 1 | P1 | "Nasi padang kamu sebenarnya berapa kalori? Aku foto, AI-nya nebak, aku koreksi sendiri." | Scan, AI result, change nasi portion, number moves | The product; show "perkiraan" |
| 2 | P1 | "Satu bakwan, satu tempe goreng, satu tahu goreng, plus kerupuk. Totalnya sama kayak 200 gram nasi putih." | Plate of gorengan next to rice, both about 360 kkal | TKPI 2019, blog kalori-gorengan (tiga potong plus sedikit kerupuk sekitar 360 kkal; 200 g nasi 360 kkal) |
| 3 | P1 | "Minta nasi setengah hemat sekitar 180 kalori. Lebih besar dari beda rendang sama ayam goreng." | Two nasi padang plates, portion swap | TKPI 2019, blog kalori-nasi-padang (selisih antar lauk paling jauh sekitar 130 kkal) |
| 4 | P1 | "Tempe digoreng naik dari 201 jadi 350 kalori per 100 gram. Tahu cuma dari 80 ke 115. Kenapa bedanya jauh?" | Two columns, then the one-line reason: tahu banyak air | TKPI 2019, blog kalori-gorengan; the post also says part of the rise is water evaporating, say so |
| 5 | P2 | "Es teh manis sekitar 60 sampai 100 kalori. Kopi susu gula aren bisa lewat 200. Tiga gelas sehari, defisitmu hilang." | Drinks lineup with kcal captions | Tip kalori-cair-es-teh-kopi; DiMeglio & Mattes 2000, Malik dkk. 2013 |
| 6 | P2 | "Timbangan naik semalam? Belum tentu itu lemak." | Trend line in the weight page next to daily dots | Tip timbangan-naik-turun-normal; Zheng dkk. 2015. Say: air, garam, isi perut |
| 7 | P2 | "Minum 500 ml air sebelum makan: di satu uji acak, yang melakukannya turun berat lebih banyak. Tapi pesertanya 55 sampai 75 tahun." | Water glass, then the caveat card | Tip segelas-air-sebelum-makan; Dennis dkk. 2010. The caveat is mandatory |
| 8 | P3 | "Temanku dua hari nggak catat makan. Aku colek dari HP." | Skit: colek, notification arrives, friend logs a meal | `group.nudge`; friend consents and is in the group |
| 9 | P3 | "Kamera VAR: makan temanku hari ini aman atau offside?" | Point camera, floating foods, verdict card | `varScan`, verdict is only about kcal vs target; show the share toggle |
| 10 | P3 | "Aku bikin grup diet bareng lima teman kantor. Hari ketiga, siapa yang masih catat?" | Group screen with streak per member | `streakDays` in group detail; members consent; frame as logging, not weight |
| 11 | P5 | "16:8 bukan makan bebas di 8 jam. Ini cara JoyoRogo membagi kalorimu di jendela makan." | IF schedule card: buka 12.00, camilan 15.30, makan terakhir 19.30 | README fasting section (design example, show your own settings, not those numbers as fact); not medical advice |
| 12 | P4 | "Harga aplikasiku naik setelah 10 pembeli pertama. Ini tangganya, dan kenapa nggak ada perpanjang otomatis." | Screen of `/harga` plus the live slot bar | `/api/config` the same day; Rp15.000, Rp29.000, Rp49.000; lock at lowest price paid |
| 13 | P4 | "AI-nya salah tebak nasi uduk jadi nasi putih. Ini cara koreksinya lima detik." | A real miss, the fix, the number updating | Pure product; trust builder |
| 14 | P5 | "Puasa nggak otomatis turun berat. Sahur 40 persen, berbuka 45, camilan malam 15." | Mode Ramadan screen | `engine.ts` ramadanSplit; label as default, "bukan aturan kaku" as in the article |
| 15 | P5 | "Takjil kecil-kecil, tapi satu bakwan plus satu tempe goreng sudah sekitar 240 kalori." | Takjil spread | TKPI 2019, blog diet-saat-puasa-ramadan; post from mid-Jan |

Schedule: 13 of these run in the 30-day calendar (hook 11 as a probe on day 24). Hooks 14 and 15 are held for the Ramadan track.

---

## 4. Instagram Stories via the story-share feature

What exists (verified): story cards at 1080x1920 with Instagram safe zones, three templates (Foto, Stiker transparan, Kartu JoyoRogo), three kinds (meal, workout, progress), shared from Beranda, scan results, and workout summary (`apps/native/components/story/*`; web twin in `apps/web/src/components/story/*`). The footer prints "joyorogo.com" as text. In this checkout the Facebook App ID is not set in `apps/native/.env` (it exists only in `.env.schema`; check your release build env), so Android falls back to the system share sheet and the user picks Instagram, then Story. With an ID set, `react-native-share` opens the Instagram story composer directly and passes the sticker PNG as `stickerImage` (`share.ts`). The library also documents `attributionURL` (marked beta) and `linkUrl` / `linkText` options for Stories [S14]; test on a device before relying on them.

Playbook:

1. Own account, daily: one story from real usage. Alternate meal card (photo template), weekly progress card (brand card, focus on streak and protein, not kilograms), and workout summary.
2. "Tebak kalori" poll: post the photo template without the number, use Instagram's native poll sticker, then reveal with the scan result. It teaches the product and invites replies.
3. Highlights: "Hasil scan", "Grup", "Founder", "FAQ". Pin the install and `#coba` links.
4. Challenge output: at the end of each cohort, ask members to share the Kartu with their streak (the progress story includes `streakDays` and protein). Do not reward or request weight-loss posts; the platform body-image concern in section 3.3 applies to stories too.
5. Reshare only with permission. Reply template: "Boleh aku repost ceritamu? Cukup balas ya."
6. Link sticker: `https://joyorogo.com/?utm_source=instagram&utm_medium=story&utm_campaign=<kind>`.

Measure: Instagram Insights (replies, taps forward, link taps) plus Revklik `campaigns` for `instagram`.

---

## 5. Community and group challenges

### 5.1 "7 Hari Catat Jujur"

Goal is consistency of logging, not weight lost. That keeps it clear of the body-image issues in section 3.3 and fits what the group screen already shows (each member's logging streak).

- Format: a group of up to 20 (hard cap, `MAX_MEMBERS`). Each person can be in at most 5 groups (`MAX_GROUPS`), so run several cohorts of 15 to 20 rather than one big one.
- Rule: log at least one meal on each of 7 days. Colek is allowed once an hour per person and is for friendly nudges; note messages max 140 characters.
- You are the owner of each cohort group. Name it "Catat Jujur #1", "#2", etc.
- Ladder to completion: day 1 kickoff message (what to log, how to colek), day 3 check-in note, day 7 closing note with a streak screenshot (members consent).
- Reward, cheap and honest: public recognition, plus 1 month of Founder as a comp for completing 7 of 7 (admin, user detail, "Beri / perpanjang Founder +1 bulan"). By my reading of `admin.ts` and `billing.ts` comps set `founder_until` without creating a `payment` row, and the price ladder counts distinct users with paid payments, so comps should not consume a ladder slot. Confirm with one test comp before promising. Set a hard cap (for example the first 30 completers) and keep the AI cost in view.
- Where to recruit: WhatsApp contacts, kos or kantor groups, Facebook groups (60,5% penggunaan [S2]), Telegram. Read each community's rules first and ask the admin before posting.

Cohort plan: #1 (day 3, friends, at least 15 Android users) also serves as the Play closed-test pool. #2 (day 10) is public from videos and stories. #3 (day 17) is a partner pilot if one confirms, else public.

### 5.2 Referral using groups

There is no automated referral reward, referral table, or invite attribution in the code (I searched `packages/db`, `packages/api`, `apps/server`, `apps/web`, `apps/native`). The group invite link is the referral. For the first 30 days:

- The unit is the group, not the individual. "Ajak 1 teman" means "bikin grup berdua".
- The invite message on native includes name, code, and link; the web share text is only "Gabung grup <nama> di JoyoRogo!" plus the URL.
- Count it yourself with SQL (section 11.4): invited joins per new signup.
- Manual rewards only (the Founder comp above) until the loop shows it works. Build real referral rewards only if the invited-join numbers justify it.

---

## 6. SEO via blog and tips

State (verified): 7 articles in `apps/web/blog/posts/` (kalori makanan Indonesia, nasi padang, gorengan, telur, mie, defisit kalori, diet saat puasa Ramadan) plus 16 tips rendered at `/blog/<slug>/` from `tips.ts`, each with study links. Static HTML per page, sitemap.xml, RSS, BlogPosting and BreadcrumbList JSON-LD, FAQPage JSON-LD on `/`. `llms.txt` lists only the 7 articles, not the tips. Every post ends with the "Malas menghitung sendiri?" card (Coba gratis to `/login`, tracked `signup_click` with location `blog`, plus Unduh APK).

Actions, in order:

1. Done in code (2026-10-15): `llms.txt` is now generated at build from every article and tip, grouped by category (intro text in `apps/web/blog/llms-intro.txt`). Still manual: submit the sitemap in Google Search Console and connect it to Revklik so `gsc_queries` works.
2. Done in code (2026-10-15): every post ends with an "Artikel terkait" block computed in `apps/web/blog/related.ts` from shared topics, always including one article and one tip when they exist. Optional frontmatter `related: slug-a, slug-b` pins links; `category:` overrides the derived category (Makanan, Ramadan, Tips).
3. Change the blog CTA to include "Coba scan tanpa daftar" pointing at `/#coba` (product change 5). Readers with search intent get the demo scan without signing up.
4. Publish one new article a week from this backlog. Each uses the `::tkpi` / `::porsi` directives so numbers come from TKPI 2019, and you look up the real food IDs when writing (do not invent figures; where TKPI lacks a value, say so as the nasi padang article does for sambal):
   - Kalori bakso dan soto
   - Kalori sate ayam dan lontong
   - Kalori gado-gado dan pecel
   - Kalori nasi goreng, nasi uduk, nasi kuning
   - Kalori ayam geprek dan ayam goreng
   - Kalori martabak, pisang goreng, jajanan pasar
   - Kalori es teh, kopi susu, minuman kemasan (links tip kalori-cair)
   - Ramadan set: kalori kurma dan kolak, es buah dan bubur, menu sahur, ketupat dan opor Lebaran
5. Publish the Ramadan set by mid-December 2026 so pages have weeks to be indexed before January searches (an inference, not a measured lag).
6. Backlinks without budget: the GitHub README (already links the app), Indonesian developer communities for the open-source and TKPI angle, and ahli gizi or komunitas sehat who may cite the TKPI table page.
7. Check `gsc_queries` every two weeks and rewrite titles for pages that rank but get few clicks. I have no keyword volume data; the article list above is a hypothesis.

Metrics: Revklik `top_pages` filtered to `/blog`, `campaigns` for blog, and `signup_click` with location `blog`.

---

## 7. Ramadan and IF campaign

Dates: 1 Ramadan 1448 expected around Mon 8 or Tue 9 Feb 2027, official after Sidang Isbat; Idulfitri about 9 Mar 2027 [S5][S6]. Mode Ramadan is already in the app (sahur, berbuka, snack, default split 40/45/15) and the IF module covers 16:8, 18:6, 20:4, OMAD with window-based reminders.

| When | Do | Check |
| --- | --- | --- |
| Nov to mid-Dec 2026 | Write the Ramadan article set (section 6). Update `diet-saat-puasa-ramadan` with any numbers learned from cohorts | Article published, in sitemap, in `llms.txt` |
| Dec 2026 | If the app is on Play, prepare a custom store listing for a Ramadan audience [S15]. Prepare screenshots of Mode Ramadan and IF | Listing text uses the same claim ledger |
| Mon 11 Jan to Sun 7 Feb | "Siap puasa" weeks: hooks 11, 14, 15, a Reels on sahur planning, a Story highlight "Ramadan". Post the setting tutorial "Atur Mode Ramadan di Profil" | Opens of `/blog/diet-saat-puasa-ramadan/` in Revklik |
| Day 1 of Ramadan | Post "Set Mode Ramadan ke Aktif" (do not rely on auto, see finding 6). Launch "Ramadan Catat Bareng" groups of 20, 30 days, same logging-streak rule as section 5 | Groups created, members logging in the first week |
| Ramadan weeks 1 to 4 | Weekly themes: sahur and berbuka split; takjil you forgot to count; sleep during Ramadan (tip tidur-cukup-lapar-turun); Lebaran food without panic | Weekly review as in section 11.5 |
| After Idulfitri | "Balik rutin": a fresh 7-day catat challenge, diet-break framing from the MATADOR tip, never "detox" | Cohort completion |

Safety lines for every Ramadan asset: puasa tidak otomatis menurunkan berat; tidak untuk semua orang; anyone with diabetes or another medical condition should discuss fasting and medication with a doctor (the existing article already says so). Keep the tone respectful; do not tie religious observance to a product pitch.

---

## 8. ASO for Google Play

### 8.1 Prerequisites

1. Closed test: at least 12 testers opted in for 14 continuous days, then apply for production access [S11]. Start at day 3 of the calendar (Wed 21 Oct) with 15 testers; apply on day 18 (Thu 5 Nov), one day after the 14-day mark, to leave margin.
2. Health apps declaration in Play Console and a privacy policy URL (you have `https://joyorogo.com/privasi`). The description must carry a "not a medical device and does not diagnose, treat, cure, or prevent any medical condition" disclaimer and remind users to consult a health professional [S10]. The draft below does.
3. Health Connect permissions are in scope of the health policy and need prominent disclosure [S10]; request only what the core features need.
4. Do not publish unattributed testimonials in the description [S12].
5. Billing (details in 8.5).

### 8.2 Title options (limit 30 characters [S12])

| Option | Characters |
| --- | --- |
| JoyoRogo: Hitung Kalori Foto | 28 |
| JoyoRogo: Catat Kalori & Diet | 29 |
| JoyoRogo: Diet Bareng Teman | 27 |

Pick the first for search. The third states the differentiator but is a weaker search phrase. A/B test them with Play's store listing experiments after production access.

### 8.3 Short description options (limit 80 characters [S12])

| Draft | Characters |
| --- | --- |
| Foto makananmu, AI hitung kalorinya. Diet bareng teman, tanpa iklan. | 68 |
| Hitung kalori nasi padang sampai gorengan dari foto. Bisa diet bareng teman. | 76 |
| Foto piring, lihat sisa kalori hari ini. Diet bareng teman, tanpa iklan. | 72 |

### 8.4 Full description draft (Indonesian, 2.3 rb karakter, limit 4.000 [S12])

```
JoyoRogo mencatat makan dan diet dengan menu yang kamu makan sehari-hari: nasi padang, soto, gado-gado, gorengan, sampai sarapan di warteg.

Foto piringmu, lalu AI memperkirakan tiap makanan di piring beserta kalori, protein, karbohidrat, dan lemaknya. Hasilnya selalu perkiraan. Sebelum disimpan, kamu bisa mengubah porsi, menghapus yang salah, atau menambah yang terlewat. Lupa foto? Ketik atau ucapkan saja, misalnya "kemarin pagi nasi kuning pakai telur dadar".

Tiga angka setiap hari
Berapa kalori yang boleh kamu makan, berapa yang perlu dibakar, dan butuh tidur berapa jam. Target dihitung dari usia, tinggi, berat, aktivitas, dan target beratmu (rumus Mifflin-St Jeor), lalu menyesuaikan dengan catatan makan dan timbanganmu sendiri.

Diet bareng teman
- Buat grup dan undang temanmu lewat tautan (sampai 20 anggota per grup).
- Colek teman yang lupa mencatat, atau tinggalkan catatan semangat.
- Lihat makanan teman hari ini lewat VAR. Setiap anggota bisa mematikan berbagi makanan di grup.
- Widget layar utama untuk progres harian dan kotak masuk grup.

Puasa dan Ramadan
Jadwal puasa intermiten (16:8, 18:6, 20:4, OMAD) membagi kalori harianmu ke waktu makan di dalam jendela makan. Mode Ramadan mengganti waktu makan menjadi sahur, berbuka, dan camilan.

Olahraga, tidur, dan berat
- Baca langkah, olahraga, dan tidur dari Health Connect, atau sambungkan Strava.
- Catat latihan beban dan lihat otot yang belum dilatih minggu ini.
- Tren berat dan lingkar perut, supaya kamu melihat arah sebenarnya, bukan naik turun harian.

Data dan privasi
- Data gizi dikalibrasi dengan Tabel Komposisi Pangan Indonesia (TKPI) 2019 dari Kementerian Kesehatan.
- Foto makanan dianalisis lalu dibuang, kecuali kamu menyalakan "Simpan foto asli".
- Tanpa iklan. Semua datamu bisa dihapus dari halaman Profil.
- Kode sumber terbuka (AGPL-3.0).

Gratis dan Founder
Diary makan, olahraga, berat, dan tidur gratis, dengan 3 scan foto AI per hari. Paket Founder membuka scan tanpa batas dan membantu pengembangan JoyoRogo.

Penting
JoyoRogo bukan alat medis dan tidak mendiagnosis, mengobati, menyembuhkan, atau mencegah penyakit apa pun. Kalori dari foto adalah perkiraan. Konsultasikan dengan dokter atau ahli gizi sebelum mengubah pola makan, terutama jika kamu hamil, menyusui, punya diabetes atau kondisi medis lain, atau pernah mengalami gangguan makan.
```

Before pasting: confirm the free-scan number against `/api/config`, and that "Simpan foto asli", "Tanpa iklan", and the widget names match the build you upload. Keep the price out of the description (it moves with the ladder). The "VAR perut" belly-photo feature is left out on purpose; if you add it, copy the "estimasi visual, bukan pengukuran" wording from `varscan.ts`.

Keywords worth keeping in natural prose: hitung kalori, kalori makanan Indonesia, catat makan, diet, puasa intermiten, Ramadan, TKPI. Do not repeat them to stuff the text: Google warns that repetitive or irrelevant keywords in the name or description can get an app suspended [S12]. I have no search-volume data; check Play Console's search-term report after launch. Also note package names are permanent once used; `com.joyodigitama.joyorogo` is already set in `app.json`.

Screenshots (8, in this order): scan with editable result; tiga angka Beranda; grup dengan colek; VAR di grup (results screen only); kartu story; Mode Ramadan; IF jendela makan; tren berat. Each caption states one benefit in one sentence, no rankings or price.

### 8.5 Billing

The Android Founder purchase goes through a web checkout (QRIS, virtual account through DOKU or Pakasir), and iOS uses Apple in-app purchase (`apps/native/components/billing.tsx`, README). On Google Play, digital subscriptions normally use Play Billing. Indonesia is listed among countries where developers can offer alternative billing, with the user given a choice alongside Play Billing [S13]. I did not confirm eligibility steps or fees; read the "billing choice program" pages in Play Console before submitting, and decide whether Android users buy Founder in the app or on the web page. This is a launch blocker for Play, not for the APK.

---

## 9. Partnerships: PT, gyms, nutritionists

What you can truthfully offer:

1. A group as a coaching space: up to 20 clients per group, colek and catatan to nudge, logging streak per member, and each client controls what they share. A PT can be in at most 5 groups.
2. Founder comp for the partner while they run a pilot (admin tier controls).
3. Co-created content: the partner explains a plate or a tip, you supply TKPI-based numbers with sources.
4. For clinics or gyms that want their own instance: the README describes deploying to CloudAgni, with AI quota included. I did not verify CloudAgni pricing; do not quote one.

Do not offer: revenue share (nothing is built), medical advice through the app, or "reviewed by" credits without written consent and real credentials. Play and basic honesty both reject anonymous endorsements [S12].

Targets: PT and coaches, small gyms, komunitas lari, senam, yoga, and ahli gizi, starting in Malang where you are. Outreach list of 20 in week 2.

WhatsApp DM template:

```
Halo Kak [nama], aku Dzul, bikin JoyoRogo, aplikasi catat kalori buat makanan Indonesia (gratis, tanpa iklan, buatan Malang). Ada fitur grup: Kakak bikin grup buat klien, bisa lihat siapa yang rajin catat dan colek yang lupa. Aku pengen coba 2 minggu bareng 5 klien Kakak, gratis, dan aku bantu setup. Kalau cocok kita lanjut, kalau nggak ya nggak apa-apa. Boleh aku kirim penjelasan singkatnya?
```

Pilot terms: one group of 5 or more for 2 weeks; one 15-minute feedback call; permission to quote only in writing with name and role. Group named "[Nama Gym] Pilot". Partner landing link: `https://joyorogo.com/?utm_source=partner&utm_medium=<slug>&utm_campaign=pilot1`.

---

## 10. 30-day launch calendar

Day 0 (Thu 15 to Sun 18 Oct), prep:
- Baseline: Revklik 30-day overview, admin overview, the SQL in section 11.
- Read `GET /api/config` and note the current rung and `promo.taken`.
- Scan time is settled at "8-15 detik" end to end (see finding 5); re-check `ai_usage.latency_ms` before quoting anything tighter.
- Create TikTok and Instagram accounts with one identical handle (no handle exists in the repo).
- Fresh-phone test: landing, `#coba` demo, Google sign-in, onboarding, first scan on the APK.
- Decide whether to set `EXPO_PUBLIC_FB_APP_ID` for direct Instagram story sharing.
- Start the Play Console app setup (health declaration, data safety, privacy URL).

Week 1, 19 to 25 Oct: foundation and cohort #1

| Day | Date | Main | Support |
| --- | --- | --- | --- |
| 1 | Mon 19 Oct | Post hook 1 | Story: first meal card. Message 30 personal contacts about Catat Jujur #1 |
| 2 | Tue 20 Oct | Post hook 2 | Create the cohort group(s). Upload closed-test build to Play, add testers |
| 3 | Wed 21 Oct | Cohort #1 starts (7 days) | 14-day tester clock starts. Post the day-1 group note |
| 4 | Thu 22 Oct | Publish article 1 from the backlog | Update `llms.txt` with tips. Submit sitemap in Search Console |
| 5 | Fri 23 Oct | Post hook 3 | "Tebak kalori" Story poll |
| 6 | Sat 24 Oct | 2 interviews with cohort members | Log insights |
| 7 | Sun 25 Oct | Batch film 6 videos | Weekly review (section 11) |

Week 2, 26 Oct to 1 Nov: diet bareng goes public

| Day | Date | Main | Support |
| --- | --- | --- | --- |
| 8 | Mon 26 Oct | Post hook 8 (colek) with "daftar Catat Jujur #2" call | Fix issues cohort #1 found |
| 9 | Tue 27 Oct | Cohort #1 ends; collect consented streak screenshots | Draft the partner list (20) |
| 10 | Wed 28 Oct | Cohort #2 starts; post hook 10 | Story highlight "Grup" |
| 11 | Thu 29 Oct | Publish article 2 | |
| 12 | Fri 30 Oct | Post hook 5 | Story: streak card from cohort #2 day 3 |
| 13 | Sat 31 Oct | Send 10 partner DMs | |
| 14 | Sun 1 Nov | Mid-point review: which pillar has the best `signup_click` per 1.000 views | Drop the weakest pillar for week 3 |

Week 3, 2 to 8 Nov: evidence and sources

| Day | Date | Main | Support |
| --- | --- | --- | --- |
| 15 | Mon 2 Nov | Post hook 6 | |
| 16 | Tue 3 Nov | Cohort #2 ends; debrief message | Send the other 10 partner DMs |
| 17 | Wed 4 Nov | Cohort #3 starts (partner pilot or public) | Play: confirm testers are still opted in |
| 18 | Thu 5 Nov | Publish article 3 | Play: apply for production access if 12 or more testers stayed opted in 14 full days and 8.1 is done |
| 19 | Fri 6 Nov | Post hook 4 | |
| 20 | Sat 7 Nov | Partner calls | |
| 21 | Sun 8 Nov | Batch film; weekly review | |

Week 4, 9 to 15 Nov: Founder, build in public, Ramadan prep

| Day | Date | Main | Support |
| --- | --- | --- | --- |
| 22 | Mon 9 Nov | Post hook 12 using the real slot count | |
| 23 | Tue 10 Nov | Cohort #3 ends | Collect consented results |
| 24 | Wed 11 Nov | Post hook 11 as an IF probe | Publish Ramadan article 1 |
| 25 | Thu 12 Nov | Post hook 13 | |
| 26 | Fri 13 Nov | Post hook 7 with the caveat | |
| 27 | Sat 14 Nov | Partner pilot kickoff (if any) | |
| 28 | Sun 15 Nov | Weekly review | |
| 29 | Mon 16 Nov | Post hook 9 | Publish "Yang kami pelajari 30 hari" (real numbers only) |
| 30 | Tue 17 Nov | 30-day retro: keep, drop, next 30 days | Start the Ramadan track |

If a Founder rung sells out, that is a real event. Post it plainly ("Slot Rp15.000 sudah habis, pembeli ke-11 sampai 60 bayar Rp29.000"), and only then.

30-day goals (adjust after the day-7 baseline; these are goals, not forecasts):
- 15 Android testers opted in; production access applied for.
- 3 cohorts run; groups with at least 3 active members counted.
- 13 hook videos plus 2 to 4 re-cuts of the best performer, 4 new articles (one a week), 5 interviews, 20 partner outreaches, 2 pilots.
- Stretch: fill the 10 first Founder slots.

---

## 11. Metrics

### 11.1 What each tool can and cannot see

Revklik (tag only on public pages; conversions pass from anywhere): overview, top pages, referrers, campaigns by UTM, geo and device, revenue breakdown, visitor journeys, Search Console queries (`gsc_queries`).

Goals defined in the repo: `try_scan_click`, `signup_click` (location hero, pricing, closing, blog), `login_click`, `google_signin`, `apk_download` (a click, not an install), `pricing_click`, `privacy_click`. Conversions: `onboarding_complete`, `founder_purchase` (carries revenue and order).

Invisible to Revklik: everything after sign-in (Beranda, scans, groups, stories), installs, retention.

Admin (`admin.joyorogo.com`): users, onboarded, signups today and 7 days, active today, founders, scans today and 7 days (user vs anon), revenue, paid and pending orders, 30-day scans and signups, per-user last seen and food logs, orders, feedback ratings on scans. No group, share, or retention numbers.

### 11.2 UTM convention

`utm_source` = tiktok, instagram, whatsapp, partner, play, github, blog. `utm_medium` = bio, story, post, dm, listing. `utm_campaign` = week label or content slug (for example `w1`, `challenge-2`, `ramadan-2027`). The invite link `/gabung/<kode>` is not in Revklik's allow-list and should stay that way: the code is the capability, and sending it to an analytics vendor would leak it. Measure invites in D1.

### 11.3 Funnel and definitions

| Stage | Metric | Source |
| --- | --- | --- |
| Reach | Views per video, story replies | TikTok, Instagram |
| Visit | Visitors by campaign | Revklik `campaigns` |
| Intent | `try_scan_click` / visitors | Revklik goals |
| Signup | `signup_click`, then `google_signin`, then `onboarding_complete` | Revklik; admin signups |
| Activation | Share of signups that log food on 3 or more distinct days in their first 7 | SQL below |
| Group | Groups with 3 or more members; colek per week; invited joins per signup | SQL below |
| Revenue | Founder buyers, revenue, rung | Admin orders; `/api/config` `promo.taken` |
| Cost watch | Scans today, anon scans | Admin overview |

JoyoFit tester funnel (same Revklik site; fit.joyorogo.com loads the tag, filter hostname `fit.joyorogo.com` for pageviews). Goal names, in order: `tester_group_click` and `tester_optin_click` (location `hero` or `cara`, on fit.joyorogo.com), then `google_signin` (click) and `signin_success` (reported after the Google round trip returns a session, once per button press), then `founder_purchase` (revenue). Links from fit.joyorogo.com to `/harga` carry `from=joyofit` plus `utm_source=joyofit`; `signin_success` and `founder_purchase` get the prop `from=joyofit` when that marker was stored in the browser (`captureFrom` in `apps/web/src/lib/analytics.ts`). Visitor ids are per origin, so the stages are compared as counts, not followed per visitor. Sign-in inside the JoyoFit app happens in the system browser against api.joyorogo.com and is not seen by Revklik; use the cloud worker or admin signups for that.

### 11.4 Weekly SQL (read-only; run `bunx wrangler d1 execute DB --remote --command "..."` from `apps/server`; timestamps are epoch milliseconds)

Activation since a date (replace `:since` with the epoch ms of the start of your window):

```sql
select count(*) as signups,
  sum(exists(select 1 from food_log f where f.user_id = u.id)) as logged_any,
  sum((select count(distinct f.date) from food_log f where f.user_id = u.id) >= 3) as logged_3_days
from user u
where u.created_at >= :since;
```

Groups and nudges:

```sql
select
  (select count(*) from team where created_at >= :since) as groups_created,
  (select count(*) from team_member where joined_at >= :since) as joins,
  (select count(*) from (select team_id from team_member group by team_id having count(*) >= 3)) as groups_3plus,
  (select count(*) from team_nudge where created_at >= :since and kind = 'poke') as colek,
  (select count(*) from team_nudge where created_at >= :since and kind = 'note') as notes;
```

Invited joins (new users who joined a group as a member within a day of signing up):

```sql
select count(*) as invited_joins
from team_member tm join user u on u.id = tm.user_id
where tm.role = 'member'
  and tm.joined_at between u.created_at and u.created_at + 86400000
  and u.created_at >= :since;
```

Founder buyers (matches the ladder's definition):

```sql
select count(distinct user_id) as buyers from payment where status = 'paid';
```

### 11.5 Weekly review checklist (Sunday, 30 minutes)

1. Revklik: visitors, `try_scan_click`, `signup_click`, `onboarding_complete` by campaign.
2. Admin: signups 7 days, active today, scans, any odd spike in anon scans.
3. SQL: activation, groups, invited joins.
4. TikTok and Instagram: best and worst video, with hook number.
5. Decide: which pillar to repeat, which to drop, which article to write.

---

## 12. In-app growth loops the product already supports

| Loop | Trigger | Action | Return | Gap |
| --- | --- | --- | --- | --- |
| Group invite | User makes a group | Shares `/gabung/<kode>` on WhatsApp | Friend signs in with Google, joins, now has someone to log with | Invite page requires login before it shows the group name; web share text is thin (changes 1, 4) |
| Colek and catatan | A member skips logging | Colek (once an hour per person) or a 140-character note | Push to the recipient where a subscription exists (web push in `group.ts`; verify native), inbox, and the Kotak Masuk Grup widget | Widget refreshes about every 30 minutes or when the app loads |
| Story share | User finishes a scan, workout, or day | Posts a card (photo, sticker, brand) | Friends see "joyorogo.com" text | The link is not tappable or tracked (change 3) |
| Public feed | User makes a post public (needs public profile on) | Shares `/p/<id>` or `/u/<handle>` | Visitors land on a public, Revklik-tracked page | Preview image is set by client JS only, so link previews fall back to the default (change 2) |
| Streak and VAR | Daily logging | Friends see each other's streak and food verdict | Social accountability | Needs 2 or more people to matter |
| Content to scan | Blog reader | Taps "Coba gratis" | Signs up | The demo scan is one click closer than login (change 5) |

Note: another agent is building a weekly recap story card. I have not verified it or seen it ship; use it in the plan only after it does.

---

## 13. Five small product changes that would help virality

Order is by value per effort.

1. Name the group on the invite page before login. Today `/gabung/$code` redirects to `/login` first, and `group.preview` is a protected procedure, so a friend who taps the link sees a generic sign-in. Add a public, rate-limited preview that returns only group name and member count (same data a logged-in code holder sees), render it on the invite page, and show "Kamu diundang ke <nama>" on the login page. Files: `packages/api/src/routers/group.ts`, `apps/web/src/routes/gabung/$code.tsx`, `apps/web/src/routes/login.tsx`. Effort: small. Measure: invited joins per group created.
2. Server-rendered Open Graph tags for `/gabung/<kode>`, `/p/<id>`, and `/u/<handle>`. `p.$postId.tsx` adds `og:image` from a `useEffect`, and its own comment says static crawlers still get the default `og.png`. WhatsApp and other preview crawlers read the static HTML (inference about their behavior; verify with one test share). A Worker `HTMLRewriter` pass would give each shared link its own title and image. Effort: medium-small. Measure: opens per share on public pages.
3. Put a UTM link in the share text. `defaultShareText` in `story-card.ts` has no URL, and the native `Share.open` call passes only the PNG. Add `https://joyorogo.com/?utm_source=app-share&utm_medium=<story|workout|progress>` to the caption so visits from shares show up in Revklik campaigns. Files: `apps/web/src/components/story/story-card.ts`, `apps/native/components/story/share.ts`. Effort: small.
4. "Diet bareng" step at the end of onboarding. The result screen's only button is "Buka Beranda" (which goes through `/founder`). Add a secondary action that creates a group named after the user and opens the share sheet with a WhatsApp-ready message (nama, kode, link, one sentence). Do not delay the first scan. Files: `apps/web/src/routes/_auth/onboarding.tsx`, native onboarding. Effort: small. Measure: onboarding to group-created rate.
5. "Coba scan tanpa daftar" in the blog CTA. In `apps/web/blog/render.ts` `ctaCard`, add a link to `/#coba` with `data-revklik-goal="try_scan_click"` and `data-revklik-goal-location="blog"`. Anon scans are on by default (`ANON_SCANS`, 2 per device). Effort: small. Measure: `try_scan_click` from blog over `signup_click` from blog.

If any of these touches `/gabung` tracking, keep the invite code out of analytics: normalize the path to `/gabung` in the inline filter (`INVITE_PATH` in `apps/web/blog/revklik.ts`) before sending.

Status (15 Oct 2026): all five are in the code, not yet deployed. What changes how you measure: `/gabung` links now carry UTM (`utm_medium=invite`) but stay untracked, and the code is cut from every Revklik batch (the inline filter in `apps/web/blog/revklik.ts`, which sits in `<head>` ahead of the tag), so invited joins still come from the database, not Revklik. Story, recap, profile-copy and invite shares carry `utm_source=app-share`, `utm_medium` of `meal`, `workout`, `progress`, `recap`, `invite` or `profile`, and `utm_campaign` of `share-web` or `share-android`/`share-ios`. The share-progress link on the Profil screen points at the API-rendered `/u/<kode>` page, which has no Revklik tag, so it has no UTM. Change 5 is the link only, as written: the guest scan already existed (`ANON_SCANS` lifetime scans per device cookie, nothing stored), and it is not limited per IP.

---

## 14. Open decisions for you

1. Play billing path (8.5) and whether Play is worth doing before Ramadan 2027.
2. Whether to create the Facebook App ID for direct Instagram story sharing (section 4).
3. Whether to use Founder comps as challenge rewards, and the cap.
4. The identical social handle across TikTok and Instagram.
5. (Settled) Scan-time claim changed to "8-15 detik".

---

## Sources

- [S1] DataReportal, Digital 2026: Indonesia. https://datareportal.com/reports/digital-2026-indonesia
- [S2] Kontan, "WhatsApp & Instagram: Media Sosial Paling Populer di Indonesia" (data APJII 2025), 13 Aug 2025. https://aktual.kontan.co.id/news/whatsapp-instagram-media-sosial-paling-populer-di-indonesia
- [S3] Indonesiabaik.id, "Obesitas di Indonesia" (Survei Kesehatan Indonesia 2023, Kemenkes). https://indonesiabaik.id/infografis/obesitas-di-indonesia
- [S4] Media Keuangan Kemenkeu, "Ramadan Effect", 17 Mar 2026. https://mediakeuangan.kemenkeu.go.id/article/show/ramadan-effect-lonjakan-konsumsi-thr-dan-mudik-yang-menggerakkan-ekonomi
- [S5] CNN Indonesia, "Berapa Bulan Lagi Puasa 2027?", 22 Sep 2026 (estimate 9 Feb 2027, official date by Sidang Isbat). https://www.cnnindonesia.com/edukasi/20260921150529-561-1406369/berapa-bulan-lagi-puasa-2027-ini-perkiraan-awal-ramadan
- [S6] Medcom, "Kapan Awal Puasa Ramadan 2027? Perkiraan Muhammadiyah, NU, dan Pemerintah" (search result snippet: 8 Feb 2027, 29 days to 8 Mar). https://www.medcom.id/pendidikan/news-pendidikan/aNr1gwPK-kapan-awal-puasa-ramadan-2027-ini-perkiraan-jadwal-versi-muhammadiyah-nu-dan-pemerintah
- [S7] Google Play listing, Penghitung Kalori fatsecret, read 15 Oct 2026. https://play.google.com/store/apps/details?hl=id&id=com.fatsecret.android
- [S8] Pantau Kalori, read 15 Oct 2026. https://www.pantaukalori.com/
- [S9] TikTok Community Guidelines, Disordered Eating, Risky Weight Management, and Body Image (search result text). https://www.tiktok.com/community-guidelines?cgversion=2025H2update
- [S10] Google Play, Health Content and Services. https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
- [S11] Google Play, App testing requirements for new personal developer accounts. https://support.google.com/googleplay/android-developer/answer/14151465
- [S12] Google Play, Create and set up your app (limits: name 30, short description 80, full description 4000; keyword-stuffing warning), Best practices for your store listing (no unattributed testimonials), and Metadata. https://support.google.com/googleplay/android-developer/answer/9859152?hl=en, https://support.google.com/googleplay/android-developer/answer/13393723?hl=en, https://support.google.com/googleplay/android-developer/answer/9898842?hl=en-mt
- [S13] Google Play Help, Learn about Google Play & alternative billing systems. https://support.google.com/googleplay/answer/11174377?hl=en
- [S14] react-native-share, Share.shareSingle (Instagram Stories options). https://react-native-share.github.io/react-native-share/docs/share-single
- [S15] Google Play, Create custom store listings to target specific user segments (page title from search results; contents not read). https://support.google.com/googleplay/android-developer/answer/9867158?hl=en-IN
- oyenza.com, read 15 Oct 2026, used only for the "do not resemble" list. https://oyenza.com
