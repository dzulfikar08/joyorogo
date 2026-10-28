---
app: joyorogo
feature: Kartu Progres dan layar Berat yang lebih jelas
shipped: 2026-10-21
available: store
tier: free
post: todo
atur: JRG-340
---

**Apa:** Dari layar Berat, pilih periode (7 hari, 30 hari, 90 hari atau sejak mulai) lalu bagikan kartu Progres, story 9:16 atau kotak 1:1. Isinya perubahan tren berat, berapa hari makan tercatat dari berapa hari, perkiraan defisit kalori dari hari yang tercatat, grafik tren berat, dan grafik kalori masuk per hari terhadap target. Berat badan mutlak disembunyikan secara bawaan (hanya perubahannya yang tampil), perkiraan defisit bisa disembunyikan sendiri. Layar Berat sendiri dirapikan: satu judul, tren berat sebagai angka utama dengan timbangan hari ini di baris kedua, satu set angka (mulai periode, sekarang, perubahan, laju) yang ikut tab periode, dan grafik kalori terpisah dengan sumbu berlabel.

**Kenapa orang peduli:** Orang ingin menunjukkan prosesnya, bukan cuma satu angka timbangan. Kartu ini menunjukkan konsistensi (hari tercatat) dan arah tren, tanpa harus membuka berat badan. Layar Berat tidak lagi menampilkan dua angka perubahan yang saling bertentangan.

**Angle post:** Bukan cuma "turun berapa kg": 26 dari 30 hari tercatat, tren turun pelan, defisit perkiraan dari hari yang dicatat. Berat mutlak tidak ikut tampil.

**Bukti visual:** Setelah rilis: screenshot layar Berat (tab 30H) dan kartu Progres story dengan data demo minimal 30 hari catatan makan dan 8 timbangan. Gambar contoh dirender dari fixture: `packages/sticker/__goldens__/period.progress.*.png`.

**Jangan klaim:** Defisit adalah perkiraan dari TDEE dan catatan makan (hari tanpa catatan tidak dihitung), bukan pengukuran. Setara kg lemak hanya muncul sebagai perkiraan (7.700 kcal per kg) dan hanya bila tidak bertentangan dengan tren timbangan. Jangan tulis "turun X kg dalam Y hari" sebagai hasil yang dijanjikan, jangan sebut membakar lemak, jangan pakai angka orang lain sebagai testimoni. Sudah di App Store (versi 1.1.0) dan Play tes tertutup; jangan tulis 'tersedia di Play Store'.
