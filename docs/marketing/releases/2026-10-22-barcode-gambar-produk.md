---
app: joyorogo
feature: Makanan hasil scan barcode tampil dengan gambar produknya
shipped: 2026-10-22
available: code
tier: free
post: todo
atur: JRG-387
---

**Apa:** Makanan yang dicatat lewat scan barcode sekarang punya gambar produknya (foto depan kemasan dari Open Food Facts, dipotong seperti stiker makanan) di baris diari, di lembar detail, di penampil stiker, dan di kartu bagikan, sama seperti makanan hasil scan foto.

**Kenapa orang peduli:** Catatan snack kemasan dulu hanya ikon garpu; sekarang terlihat seperti makanannya, dan kartu bagikannya punya gambar.

**Angle post:** Scan barcode mi instan, di diari muncul bungkusnya. Bukan lagi ikon kosong.

**Bukti visual:** Scan barcode produk kemasan yang punya foto di Open Food Facts (mis. biskuit atau mi instan), catat, lalu lihat baris di tab Makan dan tombol Bagikan di penampil stiker. Produk tanpa foto di OFF tetap berikon.

**Jangan klaim:** Hanya catatan baru sesudah rilis yang bergambar; catatan barcode lama tidak. Gambar hanya ada bila Open Food Facts punya foto depan produknya (produk dari foto label, USDA, atau yang belum difoto di sana tidak). Foto label atau kemasan yang diambil pengguna untuk membaca label tetap tidak disimpan; karena itu belum ada foto buatan pengguna untuk makanan barcode, dan aturan di server bahwa foto pengguna didahulukan atas gambar produk belum dipakai layar mana pun. Gambar produk berlisensi CC BY-SA dari kontributor Open Food Facts. Butuh deploy server; tidak butuh migrasi D1 sendiri (memakai kolom `scan_id` yang sudah ada). Jangan sebut tersedia di Play Store atau App Store.
