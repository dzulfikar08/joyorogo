---
app: joyorogo
feature: Bagikan makanku sehari (story dan carousel)
shipped: 2026-10-23
available: code
tier: free
post: todo
atur: JRG-400
---

**Apa:** Dari Makan (hari ini atau hari yang sudah lewat) ada tombol "Bagikan makanku sehari". Pilih salah satu dari dua bentuk: satu gambar story 9:16 yang memuat semuanya (tanggal, kkal terhadap target seperti "1.760 / 1.850 kkal", protein, karbo, lemak, serat terhadap target, dan tiap waktu makan dengan stiker piringnya plus kkal dan makronya), atau carousel 4:5 "Makanku sehari" untuk Threads dan Instagram: sampul dengan total dan target yang tercapai, satu halaman per waktu makan (stiker piring dan rincian tiap makanan: nama, gram, kkal, protein, karbo, lemak), lalu halaman total penutup. Carousel dikirim sekaligus ke lembar bagikan (semua gambar), atau disimpan semuanya ke galeri.

**Kenapa orang peduli:** "What I eat in a day" adalah format yang orang suka tonton, tapi biasanya harus disusun sendiri dari banyak screenshot. Di sini sudah jadi dari catatan, lengkap dengan stiker makanannya, dan yang disorot hanya yang tercapai (misalnya protein 122 dari target 110 g). Kalau hari itu melewati target, tidak ada kata "lewat" atau warna peringatan.

**Angle post:** Sehari makanku, 1.760 dari 1.850 kkal, protein tercapai, semua dari foto yang discan. Geser untuk lihat tiap piringnya.

**Bukti visual:** Contoh dari catatan asli pemilik, 22 Okt 2026: `/home/dzul/Pictures/day-share-story.png` dan `day-share-carousel-1..6.png` (stiker per komponen, karena catatan itu dibuat sebelum stiker piring utuh). Varian dengan stiker piring utuh (stiker contoh, bukan hasil scan): `day-share-plate-*.png`. Golden: `packages/sticker/__goldens__/dayfood.*.png`. Untuk screenshot layar: Makan, pilih hari dengan 3 sampai 4 waktu makan yang discan, ketuk "Bagikan makanku sehari".

**Jangan klaim:** Berat badan tidak pernah ada di gambar (tidak ada pilihan untuk menampilkannya). Target kkal dan protein adalah rencana pengguna sendiri, target karbo, lemak dan serat adalah patokan umum dari aplikasi; jangan sebut itu anjuran medis. Carousel tidak bisa langsung membuka composer Story Instagram (Instagram hanya menerima satu gambar di sana): yang dikirim lewat lembar bagikan sistem atau disimpan lalu diunggah. Stiker piring utuh hanya ada untuk makanan yang discan setelah fitur stiker piring utuh; makanan lama memakai stiker per komponen, dan yang diketik tanpa foto tampil tanpa stiker. Perlu deploy web dan OTA native (server tidak berubah). Belum rilis: jangan tulis 'tersedia di Play Store/App Store'.
