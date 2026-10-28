# joyorogo-scan-jumlah-tulang

Carousel 5 slide, 1080x1350. Atur JRG-394. Release entry: `docs/marketing/releases/2026-10-22-scan-jumlah-dan-tulang.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (hasil scan setelah plus), 2 Jumlah sebelum dan sesudah, 3 Dengan tulang dan Tanpa tulang, 4 batasnya, 5 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 5)

scan salah hitung telur? dulu harus diketik ulang dari nol. sekarang di hasil scan, makanan yang berupa potongan (telur, sate, nugget, pangsit, bakwan) punya pengatur "Jumlah". ketuk plus, berat, kalori, dan makronya ikut.

dan ayam goreng akhirnya jelas: ada tombol "Dengan tulang / Tanpa tulang". berat yang dicatat bisa lo pilih. kalorinya tetap, karena itu kalori daging yang dimakan.

gambar ke-2 dan ke-3 itu layar aslinya, item awalnya contoh, bukan hasil scan beneran.

Post 2 (balasan, link di sini)

batasnya: berat bagian yang bisa dimakan itu perkiraan per bagian (sayap 50%, paha bawah 60%, paha 65%, dada 70%, iga 50%, ikan utuh 55%), bukan hasil timbang. AI masih bisa salah baca bagian ayamnya atau beratnya. jumlah awal tetap dibaca AI dari foto, plus dan minus buat ngebetulin.

download di Play Store (versi tes, gabung dulu lewat link), iPhone di App Store, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-scan-jumlah-tulang

## Instagram

Scan salah hitung telur? Ketuk plus, kalorinya ikut naik.

Di hasil scan JoyoRogo, makanan yang berupa potongan (telur, sate, nugget, pangsit, bakwan) punya pengatur "Jumlah" dengan tombol minus dan plus. Satu ketukan mengubah jumlahnya, dan berat, kalori, serta makronya ikut.

Ayam goreng, iga, dan ikan utuh sekarang punya tombol "Dengan tulang / Tanpa tulang" untuk memilih berat mana yang dicatat. Kalorinya tetap, karena itu kalori daging yang dimakan.

Slide 2 dan 3 adalah layar aslinya, item awalnya contoh, bukan hasil scan. Berat bagian yang bisa dimakan adalah perkiraan per bagian, bukan hasil timbang.

Download di Play Store (versi tes, gabung dulu lewat link), iPhone di App Store, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-scan-jumlah-tulang`). Semua angka perkiraan, bukan saran medis.

#JoyoRogo #HitungKalori #DietIndonesia

## Alt text

1. Teks "Scan salah hitung telur? Ketuk plus." di latar hijau tua, dengan potongan hasil scan: "Telur rebus, 3 butir, 234 kkal" dengan pengatur Jumlah (minus, 3 butir, plus), dan "Nasi putih 195 kkal". Angka 234 dilingkari.
2. Dua potongan layar berlabel "AI baca 1 butir" (telur rebus 78 kkal) dan "Ketuk plus dua kali" (telur rebus 3 butir, 234 kkal). Kolom kalori dilingkari di keduanya. Keterangan: item awal contoh, bukan hasil scan.
3. Dua potongan layar berlabel "Dengan tulang" dan "Tanpa tulang" untuk ayam goreng paha 290 kkal: yang pertama menyebut ±200 g dengan tulang, ±130 g bisa dimakan, yang kedua ±130 g tanpa tulang. Teks berat dilingkari. Keterangan: kalori tetap.
4. Teks "Bagian yang bisa dimakan itu perkiraan" dengan tiga poin: perkiraan per bagian bukan hasil timbang (sayap 50%, paha bawah 60%, paha 65%, dada 70%, iga 50%, ikan utuh 55%), AI masih bisa salah baca, jumlah awal dari foto.
5. Maskot JoyoRogo hijau berbaju zirah dan teks "Telurnya tiga, bukan satu.", tombol joyorogo.com, serta catatan Android tes tertutup dan iPhone di App Store.

## Notes

- Layar slide 1 sampai 3: web app, akun demo "Rina" (fiktif), stack lokal dari kode terbaru (`.tmp/appstore/shoot-d2.mjs count,bone`). Jawaban scan DITIRU (`analyzeFood` mengembalikan item tetap: telur rebus 1 butir 78 kkal, ayam goreng paha 200 g dengan tulang / 130 g bisa dimakan 290 kkal, nasi putih). Ketukan plus dan "Tanpa tulang" dijalankan di browser: 234 kkal dan berat berpindah dihitung aplikasi sendiri. Item awalnya contoh, bukan hasil scan; slide 2 memberi keterangan.
- Sudah live: deploy server, web, dan OTA native 22-23 Okt.
- Persentase bagian yang bisa dimakan di slide 4 dari entri rilis; itu perkiraan per bagian, jangan disajikan sebagai fakta gizi.
