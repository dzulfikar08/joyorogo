# joyofit-lari-jalan

Carousel 6 slide, 1080x1350. Atur JRG-399. Release entry: `watch-fit/docs/marketing/releases/2026-10-23-lari-jalan-mulai-lari-lagi.md`. Post: Threads (utas 3 post) dan Instagram. Post ke komunitas Running Threads.

Slide: 1 cover (teks), 2 susunan sesi minggu 1, 3 delapan minggu, 4 detak jantung yang memimpin, 5 tes ulang 1 km, 6 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 6)

detak jantung lo langsung zona 4 di kilometer pertama? jangan dipaksa ngejar pace.

gue bikin rencana Lari-jalan di Coach JoyoFit buat mulai lari lagi dari nol. 8 minggu, 3 sesi seminggu. minggu 1: jogging 1 menit, jalan 2 menit, 8 kali. yang mimpin detak jantung: jogging di zona 2-3 lo, masuk zona 4 hp getar "jalan sekarang", turun ke zona 2 "boleh jogging lagi". minggu 7-8 jogging terus 15 sampai 30 menit.

Post 2 (balasan)

kemajuannya diukur dari tes 1 km di detak jantung zona 3 yang sama (minggu 1, 5, 8). hasilnya dibandingin cuma kalau rata-rata detak jantungnya selisih maksimal 5 bpm.

jujurnya: ini rencana buatan JoyoFit sendiri, bukan program lari resmi. petunjuknya datang dari hp (jam nggak nerima interval dari JoyoFit) dan belum gue tes dengan layar mati.

Post 3 (balasan, link di sini)

getar dan petunjuk detak jantung butuh latihan Lari yang jalan di jam dan ngirim detak jantung langsung. Coach butuh JoyoRogo Pro. dites di Huawei Watch Fit 4 Pro, jam lain masih eksperimen. tidak berafiliasi dengan Huawei. bukan saran medis.

fit.joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-lari-jalan

## Instagram

Detak jantung langsung zona 4 di kilometer pertama? Jangan paksa pace. Coach di JoyoFit punya rencana Lari-jalan untuk mulai lari lagi dari nol: 8 minggu, 3 sesi seminggu.

Minggu 1: jogging 1 menit, jalan 2 menit, 8 kali. Detak jantung yang memimpin: jogging di zona 2 sampai 3 milikmu, masuk zona 4 HP bergetar dan bilang "jalan sekarang", turun ke zona 2 baru boleh jogging lagi. Minggu 7 dan 8 jogging terus 15 sampai 30 menit. Tes 1 km di detak jantung yang sama di minggu 1, 5, dan 8.

Rencana buatan JoyoFit sendiri, bukan saran medis. Petunjuk datang dari HP dan butuh latihan Lari yang berjalan di jam. Coach butuh JoyoRogo Pro. Dites di Watch Fit 4 Pro. Tidak berafiliasi dengan Huawei. Link di bio: `https://fit.joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-lari-jalan`

#JoyoFit #LariPemula #RunningIndonesia #MulaiLariLagi

## Alt text

1. Teks "Detak jantung langsung zona 4 di kilometer pertama? Jangan paksa pace. Jogging 1 menit, jalan 2 menit." di latar gelap, dengan keterangan rencana Lari-jalan 8 minggu 3 sesi seminggu.
2. Garis waktu sesi minggu 1: jalan 5 menit, delapan kali (jogging 1 menit, jalan 2 menit), jalan 5 menit. Total 34 menit.
3. Daftar delapan minggu: minggu 1 sampai 6 jogging 1, 1,5, 2, 3, 5, 8 menit dikali 8, 7, 6, 5, 4, 3; minggu 7 jogging terus 15, 20, 20 menit; minggu 8 jogging terus 25 dan 30 menit.
4. Tiga langkah: zona 2 sampai 3 jaga jogging, zona 4 HP bergetar "jalan sekarang", turun ke zona 2 "boleh jogging lagi". Catatan: petunjuk datang dari HP.
5. Teks "Kemajuan dilihat dari pace di detak jantung yang sama": tes 1 km di zona 3 pada minggu 1, 5, dan 8, dibandingkan hanya kalau selisih rata-rata detak jantung paling banyak 5 bpm.
6. Maskot JoyoFit santai dan teks "Mulai lagi dari nol, pelan-pelan", tombol fit.joyorogo.com, catatan Coach butuh JoyoRogo Pro.

## Notes

- Tidak ada tangkapan layar: layar Coach hanya ada di aplikasi native dan belum ada capture. Semua angka dari `watch-fit/src/features/coach/plans/runWalk.ts` dan `docs/coach.md`; tidak ada UI tiruan. Kalau pemilik mau screenshot nyata (atur rencana, layar sesi minggu 1, pemandu, tes 1 km), ambil dari ponsel dengan data uji dan tambahkan sebagai slide 2 atau 4.
- Selaras dengan entri: JS only, OTA-safe, tetapi menyinkronkan rencana butuh deploy server JoyoRogo lebih dulu (`8f502f33`). Pastikan sudah naik sebelum posting.
- "Minggu ke-4 diringankan (80 persen)" dari komentar `runWalk.ts`.
- Jangan klaim: diuji di perangkat dengan layar mati, hasil menurunkan berat, atau program yang dipublikasikan.
