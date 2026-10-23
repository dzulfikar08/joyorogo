# joyofit-zona-hr

Carousel 6 slide, 1080x1350. Atur JRG-371 (Zona HR) dan koreksi strain (watch-fit `48cf38f`). Release entry: `watch-fit/docs/marketing/releases/2026-10-22-zona-hr.md`. Post: Threads (utas 2 post, Running dan Cycling Threads) dan Instagram.

Slide: 1 cover (teks), 2 tiga metode, 3 contoh hitungan, 4 hitung dari data, 5 strain tidak ikut zona, 6 CTA.

## Threads

Post 1 (gambar: slide 1 sampai 6)

zona detak jantung lo nggak harus 220 dikurangi usia.

di JoyoFit sekarang bisa diatur: Lainnya > Target & tubuh > Zona HR. pilih cara hitung (persen HR maks, cadangan HR, atau LTHR), ubah lima batas dalam bpm. ada tombol "Hitung dari data" buat saran HR maks dan HR istirahat dari latihan lo, tapi nggak dipakai sebelum lo setujui.

Post 2 (balasan, link di sini)

satu koreksi: sempat strain ikut metode zona yang lo pilih, jadi ganti metode ikut menggeser angkanya. gue balikin. strain, beban latihan, dan menit intensitas selalu dari persen tetap HR maks (50 sampai 90%, metode Edwards). zona lo dipakai buat waktu per zona, grafik detak jantung harian, dan Coach. yang masih ngubah strain cuma HR maks.

skor itu perkiraan, bukan alat medis. dites di Huawei Watch Fit 4 Pro. fit.joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-zona-hr

## Instagram

Zona detak jantung tidak harus 220 dikurangi usia. Di JoyoFit: Lainnya, Target & tubuh, Zona HR. Pilih cara hitung (persen HR maks, cadangan HR, atau LTHR) dan ubah lima batas dalam bpm. "Hitung dari data" memberi saran HR maks dan HR istirahat dari latihanmu, dan baru dipakai setelah kamu setuju.

Satu koreksi: strain pernah ikut metode zona. Sekarang strain, beban latihan, dan menit intensitas selalu dari persen tetap HR maks (metode Edwards), jadi mengganti zona tidak menggesernya.

Strain dan skor lain = perkiraan, bukan alat medis. Dites di Watch Fit 4 Pro, jam lain eksperimen. Tidak berafiliasi dengan Huawei. Link di bio: `https://fit.joyorogo.com/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10-zona-hr`

#JoyoFit #DetakJantung #ZonaHR #RunningIndonesia

## Alt text

1. Teks "Zona detak jantungmu bukan cuma 220 dikurangi usia" di latar gelap, dengan keterangan 3 cara hitung dan 5 batas dalam bpm.
2. Tiga metode zona: persen HR maks (bawaan, lima zona dari 50 sampai 90 persen), cadangan HR (enam zona dari HR maks dan HR istirahat), LTHR (zona dari ambang laktat, ada layar tes 30 menit).
3. Contoh umur 35 dengan HR maks 185: batas pemanasan 93 bpm, bakar lemak 111, aerobik 130, anaerobik 148, ekstrem 167. Diberi catatan bahwa itu contoh, bukan angka pembaca.
4. Teks "Saran dari datamu. Kamu yang menyetujui": HR maks dari detak tertinggi latihan bila di atas rumus usia, HR istirahat dari median 14 hari terakhir, dan catatan bukan tes lapangan.
5. Dua kartu: "Pakai zonamu" untuk waktu per zona, grafik harian, dan Coach; "Persen tetap dari HR maks" untuk strain, beban latihan, dan menit intensitas. Catatan bahwa strain sempat ikut metode zona dan sudah dikoreksi.
6. Maskot JoyoFit santai dan teks "Atur zonamu sekali", tombol fit.joyorogo.com, serta catatan perkiraan dan bukan alat medis.

## Notes

- Tidak ada tangkapan layar: layar Zona HR hanya ada di aplikasi native dan belum ada capture. Angka dari `watch-fit/docs/hr-zones.md`. Contoh 185 bpm: 50, 60, 70, 80, 90 persen dibulatkan ke atas ke bpm bulat (aturan `ceil` di dokumen itu): 92,5 jadi 93, 111, 129,5 jadi 130, 148, 166,5 jadi 167. Orang dan angkanya fiktif, diberi label di slide.
- Soal "sempat": commit `48cf38f` menyebut sejak pengaturan zona, strain ikut zona orang. Konfirmasi apakah build tengah itu pernah sampai ke pengguna; kalau belum, ubah kalimatnya menjadi "sebelum rilis".
- Pengiriman zona ke jam sengaja tidak disebut: belum teruji pada jam tertentu dan butuh build toko baru.
- Jangan klaim: "otomatis", "akurat", atau model jam selain Watch Fit 4 Pro. Strava dan WHOOP tidak disebut.
