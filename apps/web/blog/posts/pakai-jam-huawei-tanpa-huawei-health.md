---
title: Pakai jam Huawei tanpa Huawei Health dengan JoyoFit
description: JoyoFit adalah aplikasi Android open source untuk Huawei Watch Fit 4 Pro. Sinkron detak jantung, tidur, langkah, dan olahraga tanpa akun Huawei, lalu kirim ke Strava atau Health Connect.
date: 2026-10-17
category: Tips
---

Jam Huawei biasanya hanya bisa dipakai lewat aplikasi Huawei Health. Di beberapa HP, Huawei Health sulit dipasang, minta akun Huawei, dan tidak mudah mengirim data ke aplikasi lain. JoyoFit menggantikan peran itu: aplikasi Android gratis dan open source yang tersambung langsung ke jam lewat Bluetooth.

## Apa yang bisa dilakukan JoyoFit

- **Sinkron data jam ke HP.** Detak jantung, tidur, langkah, dan olahraga ditarik dari jam dan disimpan di HP-mu. Akun tidak wajib.
- **Sinkron di latar belakang.** Dengan *Keep connected in the background*, JoyoFit tersambung ulang sendiri dan sinkron tiap 30 menit walau aplikasi ditutup.
- **Notifikasi ke jam.** Pilih aplikasi mana yang notifikasinya diteruskan ke jam.
- **Kirim ke Strava dan Health Connect.** Olahraga dari jam bisa langsung masuk ke Strava, dan data jam bisa dibagikan ke aplikasi lain lewat Health Connect.
- **Impor riwayat Huawei Health.** Riwayat lama dari ekspor data Huawei bisa dibawa masuk, jadi kamu tidak mulai dari nol.

## Jam yang didukung

Saat ini baru **Huawei Watch Fit 4 Pro** yang sudah diuji. Puluhan model Huawei dan Honor lain bisa dicoba, tapi statusnya masih eksperimen: secara teori didukung, belum ada yang mencobanya. Daftar lengkapnya ada di [halaman jam yang didukung](https://fit.joyorogo.com/jam). Kalau jammu ada di daftar eksperimen, sambungkan sekali lalu kirim laporan dari aplikasi supaya modelnya bisa ditandai teruji.

## Cara mulai

1. **Lepaskan jam dari Huawei Health** (Unbind). Jam hanya bisa terikat ke satu aplikasi. Kalau ingin membawa riwayat, sinkronkan sekali lagi dan minta ekspor data dulu sebelum melepas.
2. **Pasang JoyoFit** dari Google Play. Untuk sekarang masih tes tertutup: gabung grup tester dulu, lalu ketuk *Become a tester*.
3. **Pasangkan jam.** Buka tab Watch, pilih jam, ketuk *Connect*, lalu setujui di layar jam dalam 30 detik.
4. **Sinkron pertama.** Buka Today dan ketuk *Sync now*. Sinkron pertama mengambil semua riwayat yang masih tersimpan di jam.

Langkah lengkap, izin yang diminta, dan jalan keluar kalau macet ada di [panduan JoyoFit](https://fit.joyorogo.com/panduan).

## Data kamu tetap milikmu

JoyoFit menyimpan data jam di HP. Cloud dan Strava hanya aktif kalau kamu menyalakannya dan masuk dengan akun JoyoRogo. Seluruh kodenya ada di GitHub, termasuk protokol jam yang diporting dari Gadgetbridge, jadi siapa pun bisa memeriksa apa yang dikirim dan ke mana.

## Hubungannya dengan JoyoRogo

JoyoFit mencatat apa yang terjadi di tubuhmu: tidur, detak jantung, olahraga. JoyoRogo mencatat apa yang kamu makan. Keduanya bisa dipakai sendiri-sendiri, tapi kalau kamu masuk dengan akun JoyoRogo yang sama, skor harian dari jam ikut muncul di catatan makanmu. Detailnya ada di tulisan [menghubungkan JoyoFit dengan JoyoRogo](/blog/hubungkan-joyofit-joyorogo/).
