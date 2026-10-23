---
app: joyorogo
feature: Widget Streak Catat (Android)
shipped: 2026-10-23
available: code
tier: free
post: todo
atur: JRG-401
---

**Apa:** Widget Android persegi (2x2) di layar utama: api besar dan jumlah hari beruntun kamu mencatat makan, ditemani Joyo. Hari ini sudah dicatat: Joyo mengepalkan tangan. Streak masih hidup tapi hari ini belum dicatat: Joyo melotot dan widget bilang "Jaga apinya: catat hari ini" dengan jumlah streak yang dijaga. Streak putus: api padam, angkanya jadi "3 hari tanpa catat", Joyo menatap tajam (seminggu tanpa catat, Joyo ketiduran). Kalimat colekannya berganti tiap hari, ramah, tidak pernah menyinggung berat badan. Ketuk widget, kamera scan makanan langsung terbuka. Tersedia dalam bahasa Indonesia, Inggris, dan Melayu. Angka yang sama muncul di chip streak Beranda: api terang untuk streak hidup, api kosong saat hari ini belum dicatat, api abu-abu dengan jumlah hari saat putus.

**Kenapa orang peduli:** Streak hanya bekerja kalau terlihat setiap hari. Widget di layar utama mengingatkan tanpa notifikasi, dan satu ketuk membawa ke kamera.

**Angle post:** Duolingo punya burung hantu yang menagih. JoyoRogo punya kucing berotot yang menjaga apimu.

**Bukti visual:** Pratinjau ada di `apps/native/assets/widget-preview/streak-catat.png` dan `/home/dzul/Pictures/jr-streak-widget-*.png` (semua keadaan, terang dan gelap). Untuk rekaman asli: build toko dengan widget baru, tambah "Streak Catat", lalu rekam keadaan hari ini sudah dicatat, belum dicatat, dan streak putus.

**Jangan klaim:** Hanya Android; widget iOS belum ada. Widget baru butuh build toko (tidak datang lewat pembaruan cepat), jadi jangan tulis 'tersedia' sebelum build itu keluar. Jangan tulis 'tersedia di Play Store/App Store': Android masih tes tertutup. Widget diperbarui paling lama sekitar satu jam sekali (dan langsung saat kamu mencatat di aplikasi), jangan klaim real-time; setelah tengah malam api baru berubah di pembaruan berikutnya. Streak Naikin BB dihitung dari hari yang mencapai 90% target makan, bukan sekadar mencatat; Hamil/Menyusui tidak punya streak (widget hanya jadi tombol scan). Streak dibaca sampai 1000 hari ke belakang.
