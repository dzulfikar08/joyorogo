# joyorogo-favorit-catat-cepat

Carousel 5 slide, 1080x1350. Atur JRG-392. Release entry: `docs/marketing/releases/2026-10-22-favorit-catat-cepat.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (kartu Catat cepat dengan tawaran), 2 tawaran "Sering kamu catat", 3 layar Atur Catat cepat, 4 yang perlu diketahui, 5 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 5)

lo nyatet putih telur rebus yang sama tiap hari? JoyoRogo sekarang nawarin: makanan yang lo catat tiga kali dalam 14 hari ditanya satu kali, "Simpan sebagai favorit" atau "Nanti".

dan kartu Catat cepat sekarang bisa diatur: tombol Atur di kartunya buat ngurutin favorit, ngubah nama dan kalorinya, ngehapus, nambah sendiri, atau nyembunyiin makanan di "Terakhir dicatat" yang nggak lo mau.

fitur favorit sebenernya udah lama ada, tapi hampir nggak ada yang nemu. gue cek di produksi, belum ada satu pun yang tersimpan.

Post 2 (balasan, link di sini)

batasnya: tawarannya muncul sekali per kebiasaan, bukan pengingat berulang. kalori favorit yang lo tambah sendiri pakai angka yang lo ketik. makronya diambil dari tabel TKPI atau perkiraan teks kalau ada, kosong kalau nggak ada.

download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-favorit-catat-cepat

## Instagram

Kamu mencatat makanan yang sama tiap hari? JoyoRogo sekarang menawarkan jadi favorit.

Makanan atau kombinasi yang kamu catat tiga kali dalam 14 hari ditanya satu kali: "Simpan sebagai favorit" atau "Nanti". Tombol Atur di kartu Catat cepat membuka daftar pilihanmu: urutkan favorit, ubah nama dan kalorinya, hapus, tambah sendiri, atau sembunyikan makanan di "Terakhir dicatat" yang tidak kamu mau.

Tawarannya muncul sekali per kebiasaan, bukan pengingat berulang. Kalori favorit yang kamu tambah sendiri memakai angka yang kamu ketik.

Download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-favorit-catat-cepat`). Semua angka perkiraan, bukan saran medis.

#JoyoRogo #HitungKalori #DietIndonesia

## Alt text

1. Teks "Kamu catat makanan yang sama tiap hari?" di latar hijau tua, dengan potongan kartu Catat cepat: tombol Foto, Barcode, Cerita, kartu hijau "Sering kamu catat: Putih telur rebus sudah 3 kali dalam 14 hari (52 kkal). Simpan biar sekali tap?" dan tombol "Simpan sebagai favorit" dilingkari.
2. Potongan layar yang sama, lebih besar, dengan keterangan bahwa memilih Nanti membuat tawaran tidak muncul lagi untuk makanan itu.
3. Lembar "Atur Catat cepat" dengan tiga favorit (Americano 5 kkal, Pisang 105 kkal, Putih telur rebus 52 kkal), tombol naik, turun, ubah, dan hapus di tiap baris; tombol di baris Pisang dilingkari.
4. Teks "Cuma satu tawaran per kebiasaan" dengan tiga poin: bukan pengingat berulang, kalori tambahan adalah angka yang kamu ketik, Terakhir dicatat bisa disembunyikan.
5. Maskot JoyoRogo hijau berbaju zirah dan teks "Sekali tap, bukan sekali ketik.", tombol joyorogo.com, serta catatan versi tes.

## Notes

- Layar asli dari web app, akun demo "Rina" (fiktif), stack lokal dari kode terbaru (`.tmp/appstore/shoot-d2b.mjs fav`). Tidak ada yang ditiru: "Putih telur rebus" dicatat tiga kali lewat API sehingga kartu tawaran muncul sendiri; tiga favorit di lembar Atur dibuat lewat API di akun demo.
- Klaim "belum satu pun tersimpan di produksi" di Threads dari entri rilis. Pemilik: cek ulang angkanya di produksi sebelum posting, atau hapus kalimatnya.
- Entri rilis menandai `available: test-build`, tetapi isinya "butuh deploy server (migrasi 0062), deploy web, dan OTA native; belum di build mana pun". Pastikan sudah terdeploy sebelum posting.
- Makro favorit tambahan: diambil dari TKPI atau perkiraan teks bila ada, kosong bila tidak. Jangan klaim makro selalu terisi.
