# joyorogo-joyo-ai

Carousel 6 slide, 1080x1350. Atur JRG-384 (JoyoRogo). Release entry: `docs/marketing/releases/2026-10-22-joyo-ai.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (layar /joyo asli), 2 potongan layar dengan pertanyaan contoh, 3 angka serat dari TKPI, 4 kalau datanya tidak ada, 5 siapa yang bisa pakai, 6 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 6)

pepaya, melon, atau semangka: mana yang seratnya paling tinggi?

gue bikin Joyo AI di JoyoRogo buat nanya hal kayak gini sebelum makan, bukan setelah dicatat. angkanya dari tabel TKPI 2019 (serat per 100 g): pepaya 1,6 g, melon 1,0 g, semangka 0,4 g. kalau makanannya nggak ada di tabel, jawabannya "nggak tahu", bukan tebakan. bisa juga nanya soal catatan lo sendiri, misal sisa kkal hari ini cukup buat apa.

Post 2 (balasan, link di sini)

batasnya: mesin bawaan JoyoRogo buat Pro (web dan app), ada batas pertanyaan per hari. di app, siapa pun 18+ bisa pakai kunci API sendiri, gratis, biayanya ke penyedia pilihan lo. TKPI nggak punya kolom gula, jadi soal gula dijawab nggak ada di data. bukan saran medis.

download di Play Store (versi tes, gabung dulu lewat link), iPhone di App Store, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-joyo-ai

## Instagram

Pepaya, melon, atau semangka: mana yang seratnya paling tinggi? Tanya Joyo AI di JoyoRogo sebelum makan.

Angkanya dari tabel TKPI 2019 (serat per 100 g): pepaya segar 1,6 g, melon segar 1,0 g, semangka segar 0,4 g. Kalau makanannya tidak ada di tabel, jawabannya "tidak tahu", bukan tebakan. Bisa juga bertanya soal catatan makanmu sendiri.

Mesin JoyoRogo untuk Pro (web dan app). Di app, usia 18 tahun ke atas bisa memakai kunci API sendiri, gratis, biaya ke penyedia pilihanmu. Bukan saran medis. Download di Play Store (versi tes, gabung dulu lewat link), iPhone di App Store, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-joyo-ai`).

#JoyoRogo #JoyoAI #HitungKalori #DietIndonesia

## Alt text

1. Teks "Pepaya, melon, atau semangka? Tanya sebelum makan." di atas bingkai ponsel berisi layar Joyo AI: judul, "0 dari 20 pertanyaan hari ini", teks pembuka, dan tiga pertanyaan contoh.
2. Potongan layar Joyo AI di web: "Tanya Joyo AI", "Percakapan hanya tersimpan di browser ini", tiga tombol pertanyaan, yang pertama dilingkari: "Mana yang seratnya paling tinggi: pepaya, melon, atau semangka?".
3. Tiga bar serat per 100 g dari tabel TKPI 2019: pepaya segar 1,6 g, melon segar 1,0 g, semangka segar 0,4 g.
4. Teks "Jawabannya tidak tahu, bukan tebakan" dengan tiga poin: makanan di luar tabel, gula (TKPI tidak punya kolom gula), bukan saran medis.
5. Teks "Dua mesin, pilih satu": mesin JoyoRogo untuk Pro, dan kunci API sendiri gratis di app.
6. Maskot JoyoRogo hijau berbaju zirah dan teks "Tanya dulu, makan kemudian", tombol joyorogo.com, serta catatan Android tes tertutup dan iPhone di App Store.

## Notes

- Slide 1 dan 2: layar `/joyo` asli dari web app dengan akun demo "Rina" (`_shots/rogo-joyo-ask.webp`, stack lokal). `joyo.status` dibuat tetap sebagai akun Pro, jadi "0 dari 20" adalah angka contoh; persetujuan sudah diterima; pertanyaan ada di kolom tulis seperti yang dilakukan titik masuk "Tanya Joyo AI" (tidak dikirim). Tidak ada jawaban yang ditampilkan: aliran jawaban tidak ditiru.
- Slide 3: angka dari `packages/api/src/lib/tkpi2019-data.ts` (ER073 pepaya 1,6; ER067 melon 1,0; ER105 semangka 0,4 g serat per 100 g). Bukan kutipan jawaban Joyo AI; slide menjelaskannya.
- Entri rilis menandai `available: test-build` sedangkan git log menyebut "JoyoRogo Joyo AI shipped by OTA". Perbarui entri, lalu pastikan mesin hosted (Pro) memang jalan di produksi sebelum posting.
- Versi JoyoFit (FIT-114) tidak dibuat; itu build tes JoyoFit dan balasan Threads yang meminta kunci API sendiri (di entri) layak jadi posting terpisah setelah build itu keluar.
- Jangan sebut penyedia "tidak menyimpan" data. Bukan saran medis.
