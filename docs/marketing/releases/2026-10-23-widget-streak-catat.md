---
app: joyorogo
feature: Widget Streak Catat (Android dan iPhone)
shipped: 2026-10-23
available: test-build
tier: free
post: todo
atur: JRG-401
---

**Apa:** Widget persegi di layar utama, di Android (2x2) dan iPhone (ukuran kecil, plus ukuran sedang yang lebih lebar): api besar dan jumlah hari beruntun kamu mencatat makan, ditemani Joyo. Hari ini sudah dicatat: Joyo mengepalkan tangan. Streak masih hidup tapi hari ini belum dicatat: Joyo melotot dan widget bilang "Jaga apinya: catat hari ini" dengan jumlah streak yang dijaga. Streak putus: api padam, angkanya jadi "3 hari tanpa catat", Joyo menatap tajam (seminggu tanpa catat, Joyo ketiduran). Kalimat colekannya berganti tiap hari, ramah, tidak pernah menyinggung berat badan. Ketuk widget, kamera scan makanan langsung terbuka. Tersedia dalam bahasa Indonesia, Inggris, dan Melayu (di iPhone mengikuti bahasa yang kamu pilih di aplikasi). Angka yang sama muncul di chip streak Beranda: api terang untuk streak hidup, api kosong saat hari ini belum dicatat, api abu-abu dengan jumlah hari saat putus.

**Kenapa orang peduli:** Streak hanya bekerja kalau terlihat setiap hari. Widget di layar utama mengingatkan tanpa notifikasi, dan satu ketuk membawa ke kamera.

**Angle post:** Duolingo punya burung hantu yang menagih. JoyoRogo punya kucing berotot yang menjaga apimu.

**Bukti visual:** Pratinjau ada di `apps/native/assets/widget-preview/streak-catat.png` dan `/home/dzul/Pictures/jr-streak-widget-*.png` (semua keadaan, terang dan gelap). Pratinjau iPhone belum ada (widget iPhone baru dikompilasi di CI, belum dilihat di perangkat); setelah build TestFlight, tangkap layar widget kecil dan sedang dalam mode terang dan gelap. Untuk rekaman asli: build toko dengan widget baru, tambah "Streak Catat" (iPhone: tahan layar utama, +, JoyoRogo), lalu rekam keadaan hari ini sudah dicatat, belum dicatat, dan streak putus.

**Jangan klaim:** Widget iPhone butuh iOS 16.4 atau lebih baru dan belum diuji di iPhone sungguhan: jangan tampilkan sebagai sudah jalan sebelum ada tangkapan layar dari perangkat. Di iPhone widget tidak mengambil data sendiri: angkanya berubah saat aplikasi dibuka (atau saat kamu mencatat di aplikasi), jadi catatan dari perangkat lain baru muncul setelah aplikasi dibuka sekali; yang jalan sendiri hanya pergantian keadaan tengah malam (api jadi "jaga apinya", lalu padam), di zona hari profilmu. Widget baru butuh build toko (tidak datang lewat pembaruan cepat), jadi jangan tulis 'tersedia' sebelum build itu keluar. Jangan tulis 'tersedia di Play Store/App Store': Android masih tes tertutup dan iPhone baru lewat TestFlight setelah build berikutnya. Di Android widget diperbarui paling lama sekitar satu jam sekali (dan langsung saat kamu mencatat di aplikasi), jangan klaim real-time; setelah tengah malam api baru berubah di pembaruan berikutnya. Streak Naikin BB dihitung dari hari yang mencapai 90% target makan, bukan sekadar mencatat; Hamil/Menyusui tidak punya streak (widget hanya jadi tombol scan). Streak dibaca sampai 1000 hari ke belakang.
