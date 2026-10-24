---
app: joyorogo
feature: Jam makan di semua cara mencatat
shipped: 2026-10-23
available: test-build
tier: free
post: todo
atur: JRG-402
---

**Apa:** Setiap cara mencatat makan (ceritakan, scan foto, scan barcode, ketik manual, favorit, Catat cepat, catat ulang dari Tempat, "Sudah makan" di rencana makan) sekarang punya kontrol "Jam makan": Sekarang, Tadi pagi, Tadi siang, Tadi malam, atau pilih jam sendiri. Kalau pilihan sarapan, makan siang, atau makan malam tidak cocok dengan jam sekarang, muncul pengingat satu ketuk "Jam makan sebenarnya?". Jam makan juga bisa diubah setelah tersimpan, di lembar ubah makanan dan ubah piring. Jendela puasa (IF), catatan "makan di luar jendela" di Beranda, ringkasan puasa seminggu, dan Joyo AI membaca jam makan itu, bukan jam kamu mengetik.

**Kenapa orang peduli:** Orang sering makan siang lalu baru mencatat malamnya. Tanpa jam makan, catatan itu terhitung makan di tengah waktu puasa. Sekarang puasanya dinilai dari kapan kamu benar-benar makan.

**Angle post:** Makan jam 12.30, dicatat jam 9 malam? Atur jam makannya, puasamu tidak ikut dianggap bocor.

**Bukti visual:** Layar Makan, lembar tambah makanan, pilih Sarapan lalu lihat chip Jam makan dan tulisan "Jam makan sebenarnya?" (rekam malam hari). Lalu Beranda dengan IF 16:8 aktif: catatan "di luar jendela" hilang setelah jam makan diatur ke 12.30. Akun demo dengan IF 16:8 jendela 12:00.

**Jangan klaim:** Jam makan tidak bisa di masa depan (toleransi sekitar 10 menit), tidak bisa lebih dari 45 hari ke belakang, dan harus jatuh di hari catatan yang dipilih (atau dini hari sesudahnya sampai 03.59). Makanan yang dicatat belakangan di hari lain tanpa jam makan tidak dinilai masuk atau di luar jendela, karena jam ketiknya tidak berarti apa-apa. Bukan saran medis soal puasa. Perubahan layar ini dikirim lewat pembaruan cepat aplikasi dan web; hitungan puasa di server berlaku begitu server dideploy. Jangan tulis 'tersedia di Play Store/App Store' sebelum build itu keluar.
