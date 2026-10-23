---
app: joyorogo
feature: Makanan hasil scan barcode tampil dengan gambar produknya
shipped: 2026-10-22
available: test-build
tier: free
post: todo
atur: JRG-387
---

**Apa:** Makanan yang dicatat lewat scan barcode sekarang punya gambar produknya (foto depan kemasan dari Open Food Facts, dipotong seperti stiker makanan) di baris diari, di lembar detail, di penampil stiker, dan di kartu bagikan, sama seperti makanan hasil scan foto. Untuk produk yang kamu daftarkan sendiri lewat foto label, ada pilihan (selalu mati sampai dinyalakan): "Pakai foto depan jadi stiker makanan". Kalau dinyalakan, foto depan kemasan yang kamu ambil dipotong tanpa latar dan potongannya jadi stiker makanan yang kamu catat, menggantikan gambar produk.

**Kenapa orang peduli:** Catatan snack kemasan dulu hanya ikon garpu; sekarang terlihat seperti makanannya, dan kartu bagikannya punya gambar. Produk lokal yang tidak ada fotonya di Open Food Facts pun bisa bergambar, dari foto kemasan buatan sendiri.

**Angle post:** Scan barcode mi instan, di diari muncul bungkusnya. Bukan lagi ikon kosong. Cerita kedua: produk lokal yang belum ada fotonya, foto depannya sendiri jadi stiker.

**Bukti visual:** Scan barcode produk kemasan yang punya foto di Open Food Facts (mis. biskuit atau mi instan), catat, lalu lihat baris di tab Makan dan tombol Bagikan di penampil stiker. Produk tanpa foto di OFF tetap berikon. Untuk pilihan foto sendiri: scan barcode produk yang belum terdaftar, ketuk Foto label gizinya, ambil foto tabel dan foto depan, nyalakan "Pakai foto depan jadi stiker makanan", baca, simpan, lalu catat; stikernya muncul di baris diari.

**Jangan klaim:** Hanya catatan baru sesudah rilis yang bergambar; catatan barcode lama tidak. Gambar produk hanya ada bila Open Food Facts punya foto depan produknya (produk dari foto label, USDA, atau yang belum difoto di sana tidak). Gambar produk berlisensi CC BY-SA dari kontributor Open Food Facts. Pilihan foto sendiri: hanya muncul sesudah foto depan diambil di layar foto label, selalu mati sampai dinyalakan (tidak diingat untuk lain kali), dan hanya untuk satu catatan makanan yang dicatat sesudahnya; tidak berlaku untuk catatan lama dan tidak mengubah produk yang dibagikan ke pengguna lain. Jangan tulis "foto disimpan": yang tersimpan hanya potongan tanpa latar, foto aslinya dan foto tabel gizi tetap dibuang, dan potongan hilang bersama catatan makanannya (atau sendiri dalam sekitar 2 hari kalau catatannya tidak jadi dibuat). Bila pilihan mati, foto label dan foto depan tetap hanya dibaca lalu dibuang seperti sebelumnya. Butuh deploy server dan OTA aplikasi (JS saja, tanpa build toko); tidak butuh migrasi D1 (memakai kolom `scan_id` yang sudah ada). Jangan sebut tersedia di Play Store atau App Store.
