# joyorogo-seperti-biasanya

Carousel 5 slide, 1080x1350. Atur JRG-393. Release entry: `docs/marketing/releases/2026-10-22-seperti-biasanya.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (potongan layar hasil scan), 2 baris "Seperti biasanya" dilingkari, 3 cara kerjanya, 4 batasnya, 5 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 5)

putih telur yang sama, tiap discan kalorinya beda. 50, 52, kadang 104. gue sering ngalamin ini sendiri.

sekarang kalau lo pernah nyatet makanan dengan nama yang sama, scan foto dan Cerita di JoyoRogo pakai kalori per gram terakhir lo, bukan angka baru dari AI. di hasil scan ada satu baris kecil: "Seperti biasanya, dari catatanmu", plus angka AI di sampingnya. angkanya tetap bisa lo ubah.

gambar ke-2 itu layar aslinya. angkanya contoh, bukan hasil scan beneran.

Post 2 (balasan, link di sini)

batasnya: ini bukan angka yang lebih akurat, cuma seakurat catatan terakhir lo. nama makanannya harus sama persis (nasi putih nggak minjem dari nasi goreng). kalau angka lo beda lebih dari dua kali lipat dari perkiraan AI, yang tampil angka AI. hasil scan tetap perkiraan.

download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-seperti-biasanya

## Instagram

Putih telur yang sama jangan ganti kalori tiap discan.

Kalau kamu pernah mencatat makanan dengan nama yang sama, scan foto dan Cerita di JoyoRogo sekarang memakai kalori per gram terakhirmu untuk porsi yang terbaca, bukan angka baru dari AI. Di hasil scan ada satu baris kecil: "Seperti biasanya, dari catatanmu", dengan angka AI di sampingnya. Kolom kalorinya tetap bisa kamu ubah.

Slide 2 adalah layar aslinya dengan akun demo. Angkanya contoh, bukan hasil scan.

Batasnya: ini angkamu sendiri, jadi seakurat catatan terakhirmu. Nama makanan harus sama persis. Kalau beda lebih dari dua kali lipat dari perkiraan AI, angka AI yang tampil.

Download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-seperti-biasanya`). Semua angka perkiraan, bukan saran medis.

#JoyoRogo #HitungKalori #DietIndonesia

## Alt text

1. Teks "Putih telur yang sama jangan ganti kalori tiap discan." di latar hijau tua, dengan potongan layar hasil scan: "Putih telur rebus, 3 butir, 52 kkal" dengan baris "Seperti biasanya, dari catatanmu · AI hitung 90 kkal" dilingkari, dan "Timun 15 kkal".
2. Potongan layar yang sama dengan judul "Yang AI lihat" dan baris "Seperti biasanya" dilingkari. Keterangan: contoh tampilan, angkanya contoh.
3. Teks "Makanan yang pernah kamu catat memakai angka terakhirmu" dengan tiga poin: kalori per gram dari catatanmu, angka AI tetap kelihatan, tetap bisa kamu ubah.
4. Teks "Ini angkamu sendiri, bukan angka yang lebih akurat" dengan tiga poin: seakurat catatan terakhirmu, nama harus sama persis, tidak dipakai kalau beda jauh dari perkiraan AI.
5. Maskot JoyoRogo hijau berbaju zirah dan teks "Angkamu, bukan tebakan baru.", tombol joyorogo.com, serta catatan versi tes.

## Notes

- Layar slide 1 dan 2: web app, akun demo "Rina" (fiktif), stack lokal dari kode terbaru (`.tmp/appstore/shoot-d2.mjs usual`). Jawaban scan DITIRU (`analyzeFood` dibuat mengembalikan dua item tetap: putih telur rebus dengan catatan `usualDensity` AI 90 kkal, dan timun). Layar dan barisnya UI asli, angkanya contoh. Jangan sebut sebagai scan sungguhan. Slide 2 memberi keterangan.
- Contoh 50/52/104 kkal di Threads dari entri rilis ("putih telur, ayam goreng, americano"); itu angka dari catatan tim, bukan hasil ukur yang bisa dikutip lebih jauh. Pemilik: hapus kalau tidak mau memakai angka itu.
- Sudah live: deploy server, web, dan OTA native 22-23 Okt.
- Aturan: hanya nama yang sama persis; tidak dipakai bila beda lebih dari dua kali lipat dari perkiraan AI. Jangan klaim akurasi.
- Tidak mencakup "Biasanya" porsi nasi (JRG-348, entri terpisah).
