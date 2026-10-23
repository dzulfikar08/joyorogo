# joyorogo-stiker-piring-utuh

Carousel 5 slide, 1080x1350. Atur JRG-386. Release entry: `docs/marketing/releases/2026-10-22-stiker-piring-utuh.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (teks + kartu lama asli), 2 dulu (kartu asli dari diari pemilik), 3 sekarang (render contoh, diberi label), 4 batas, 5 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 5)

kartu share JoyoRogo gue dulu isinya potongan lauk: satu stiker per makanan, dipotong dari foto. sekarang satu gambar, seluruh piringnya, dengan nama dan total kkal seluruh piring.

geser: gambar ke-2 kartu asli dari diari gue (versi lama). gambar ke-3 render contoh pakai piring ilustrasi, bukan hasil scan beneran.

Post 2 (balasan, link di sini)

batasnya: cuma scan baru yang dapet stiker piring, makanan lama tetap per lauk. potongan latar dikerjakan model segmentasi, jadi tepi piring atau benda di meja kadang ikut kebawa. di diari, gambar kecil tiap baris tetap per makanan, ketuk buat buka stiker piringnya.

download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-stiker-piring

## Instagram

Kartu bagikan JoyoRogo dulu dibuat dari potongan tiap lauk. Sekarang gambarnya seluruh piring, dengan nama dan total kkal seluruh piring.

Slide 2 kartu asli dari catatan sebelum pembaruan. Slide 3 render contoh dengan piring ilustrasi, bukan hasil scan. Hanya scan baru yang punya stiker piring, dan potongan latar tidak selalu rapi.

Download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-stiker-piring`). Semua angka perkiraan, bukan saran medis.

#JoyoRogo #HitungKalori #DietIndonesia

## Alt text

1. Teks "Dulu kartu share isinya potongan lauk. Sekarang satu gambar: seluruh piring." di latar hijau tua, dengan bingkai ponsel berisi kartu lama "Makan Siang 690 kkal" yang memakai stiker per lauk.
2. Label "Kartu asli dari diariku" di atas kartu "Makan Siang 690 kkal" dengan empat stiker lauk hasil potong foto yang tepinya tidak rata dan tabel enam makanan: nasi liwet, ayam bakar, tahu goreng, sambal, sayur urap, putih telur.
3. Label "Contoh render, bukan hasil scan" di atas kartu "Makan Siang 690 kkal" yang sama dengan satu piring ilustrasi berisi lauk dan telur, ditambah satu stiker putih telur, dan tabel yang sama.
4. Teks "Hanya scan baru yang dapat stiker piring" dengan tiga poin: makanan lama tetap per lauk, potongan tidak selalu rapi, gambar kecil di diari tetap per makanan.
5. Maskot JoyoRogo hijau berbaju zirah dan teks "Bagikan sepiring penuh", tombol joyorogo.com, serta catatan versi tes.

## Notes

- Slide 3 memakai fixture mesin render yang sama (`day-share-plate-fixture-carousel-3.png`, piring ilustrasi), diberi label di slide. Belum ada ekspor dari scan nyata setelah fitur ini. Kalau pemilik mau versi yang lebih kuat: scan satu piring di build terbaru, buka Makan, Bagikan makanku sehari, ambil halaman waktu makan itu, dan ganti `plate-fixture-carousel-3.webp` (slide 3 dan label "Contoh render" ikut diubah).
- Slide 2 memakai halaman yang sama dengan `joyorogo-bagikan-makan-sehari/day-carousel-3.webp` (data pribadi pemilik).
- Butuh migrasi D1 (`food_log.plate_scan_id`), deploy server dan web, serta OTA native sebelum posting. Boleh tulis "download di Play Store (versi tes, gabung dulu lewat link)"; jangan tulis "tersedia di Play Store" tanpa keterangan versi tes, dan iPhone tetap TestFlight.
