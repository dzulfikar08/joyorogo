# joyorogo-barcode-teliti

Carousel 5 slide, 1080x1350. Atur JRG-388 dan JRG-387 (digabung). Release entries: `docs/marketing/releases/2026-10-22-barcode-lebih-teliti.md`, `docs/marketing/releases/2026-10-22-barcode-gambar-produk.md`. Post: Threads (utas 2 post) dan Instagram.

Slide: 1 cover (lembar "Tambah lagi?"), 2 barcode yang sama dalam 15 menit, 3 label yang janggal dihitung ulang, 4 batasnya, 5 CTA. Gambar produk di diari belum punya tangkapan asli, jadi hanya disebut di teks.

## Threads

Post 1 (gambar: slide 1 sampai 5)

tiga hal kecil di scan barcode JoyoRogo yang bikin catatan lo nggak diam-diam meleset.

1. barcode yang sama discan lagi dalam 15 menit, sekarang ditanya dulu: "Tambah lagi?". nggak ada catatan dobel gara-gara kepencet dua kali.
2. label yang nulis 0 kkal padahal ada lemaknya, kalorinya dihitung ulang dari protein, karbo, dan lemak, dan diberi catatan perkiraan.
3. produk kemasan yang discan sekarang muncul gambar bungkusnya di diari, bukan ikon garpu.

gambar ke-2 dan ke-3 pakai produk contoh, bukan barcode asli.

Post 2 (balasan, link di sini)

batasnya: kalori hasil hitung ulang itu perkiraan (4/4/9 kkal per gram), bukan angka resmi label, cek ke kemasan lo. gambar produk cuma ada kalau Open Food Facts punya foto depannya, dan cuma untuk catatan baru. foto produk dari kontributor Open Food Facts (CC BY-SA).

download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau langsung di web. joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-barcode-teliti

## Instagram

Scan barcode yang sama dua kali? Sekarang JoyoRogo tanya dulu: "Tambah lagi?"

Kalau produk dengan barcode yang sama kamu catat lagi dalam 15 menit, JoyoRogo bertanya sebelum menambah baris kedua, jadi tidak ada catatan dobel karena kepencet. Kalau label menulis kalori yang jelas tidak cocok dengan protein, karbo, dan lemaknya (misalnya 0 kkal padahal ada lemak), kalorinya dihitung ulang dan diberi catatan perkiraan. Dan produk kemasan yang discan muncul dengan gambar bungkusnya di diari.

Slide 2 dan 3 memakai produk contoh, bukan barcode asli. Hasil hitung ulang itu perkiraan, bukan angka resmi label. Foto produk: kontributor Open Food Facts (CC BY-SA).

Download di Play Store (versi tes, gabung dulu lewat link), iPhone lewat TestFlight, atau web joyorogo.com (link di bio: `https://joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-barcode-teliti`). Semua angka perkiraan, bukan saran medis.

#JoyoRogo #HitungKalori #ScanBarcode #DietIndonesia

## Alt text

1. Teks "Scan barcode yang sama dua kali? Ditanya dulu." di latar hijau tua, dengan lembar bawah "Sudah dicatat 5 menit lalu: Minuman kacang hijau sudah kamu catat 5 menit lalu. Tambah lagi?" dan tombol "Tambah lagi" dan "Jangan".
2. Lembar yang sama lebih besar, dengan keterangan: produk contoh, bukan barcode asli.
3. Potongan layar produk contoh "Minuman kacang hijau 250 ml, per 100 ml 50 kkal, protein 2 g, karbo 6 g, lemak 2 g", dengan catatan dilingkari: label menulis kalori yang tidak cocok dengan makronya, jadi kalorinya dihitung dari ketiganya (perkiraan).
4. Teks "Beberapa hal yang tidak berubah" dengan tiga poin: kalori hitung ulang itu perkiraan (4, 4, 9 kkal per gram), gambar hanya kalau ada fotonya, hanya catatan baru.
5. Maskot JoyoRogo hijau berbaju zirah dan teks "Satu kali catat, cukup.", tombol joyorogo.com, serta catatan versi tes.

## Notes

- Slide 2 dan 3: web app, akun demo "Rina" (fiktif), stack lokal dari kode terbaru (`.tmp/appstore/shoot-d2.mjs barcode-note,barcode-repeat`). Server DITIRU: `barcode.lookup` mengembalikan produk karangan ("Minuman kacang hijau", bukan barcode asli, label 0 kkal dengan flag `kcalFromMacros`) dan `barcode.recentLog` menjawab "5 menit lalu". Lembar dan catatannya UI asli; angka 50 kkal diberikan tiruan, bukan dihitung aplikasi di layar; cocok dengan 4/4/9 dari 2 g protein, 6 g karbo, 2 g lemak (8 + 24 + 18). Slide 3 memberi keterangan produk contoh.
- Slide gambar produk (JRG-387) dihapus: tangkapan dari server lokal tidak memotong latar, jadi tidak mewakili fitur asli. Tambahkan lagi dari tangkapan HP setelah ada catatan barcode baru yang bergambar.
- Pilihan "Pakai foto depan jadi stiker makanan" (produk foto label) sengaja tidak ditampilkan. Jangan tulis "foto disimpan".
- Sudah live: deploy server, web, dan OTA native 22-23 Okt.
- Hanya catatan baru yang bergambar. Gambar produk berlisensi CC BY-SA dari kontributor Open Food Facts; atribusi ada di caption.
