import type { Campaign } from "./broadcast-render";

/**
 * From address of announcement mail. The root joyorogo.com is the owner's
 * personal-looking address; `replyTo` is only set when From is a sending
 * subdomain whose inbox does not exist.
 */
export const BROADCAST_SENDER: { email: string; name: string; replyTo?: string } = {
  email: "dzulfikar@joyorogo.com",
  name: "Dzulfikar",
};

/** Play closed test: the Google group first, then the opt-in page (same links as apps/web app-config). */
const TESTER_GROUP_URL = "https://groups.google.com/g/joyorogo-testers";
const TESTER_OPTIN_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyorogo";

/** The announcement the admin console opens with (editable there before a test or the full send). */
export const DEFAULT_CAMPAIGN: Campaign = {
  id: "2026-10-koreksi-suara",
  subject: "Sekarang bisa koreksi hasil scan pakai suara, dan bantu kami rilis di Play Store",
  body: `Halo {nama},

Ada beberapa kabar dari JoyoRogo dan JoyoFit:

**1. Hasil scan salah? Tinggal bilang.**
Sekarang kamu bisa koreksi hasil foto makanan dengan mengetik atau bicara, misalnya "itu rolade bukan perkedel" atau "nasinya setengah aja". Hanya bagian yang kamu sebut yang berubah, kalorinya dihitung ulang, dan tidak mengurangi jatah scan. Hasil scan juga sekarang muncul bertahap, jadi lebih cepat terlihat.

**2. JoyoRogo dan JoyoFit di iPhone (beta)**
- JoyoRogo iPhone: https://testflight.apple.com/join/gD8dPxW3
- JoyoFit iPhone (untuk jam Huawei): https://testflight.apple.com/join/GXzrQ8GJ

**3. Bantu kami masuk Play Store (Android)**
Supaya JoyoRogo bisa dirilis untuk semua orang di Play Store, Google minta kami menjalankan tes dengan cukup banyak tester aktif selama 14 hari. Kalau kamu pakai Android, gabung sebentar ya:
1) Gabung grup: ${TESTER_GROUP_URL}
2) Buka ${TESTER_OPTIN_URL} lalu ketuk "Become a tester"
3) Pasang JoyoRogo dari Play Store, cukup biarkan terpasang

**4. Strava: slot penuh, daftar antre**
Sinkron Strava gratis, tapi slot dari Strava untuk aplikasi baru (10 orang) sudah terisi semua. Kami sudah mengajukan penambahan kuota. Daftar di https://fit.joyorogo.com/strava, nanti kami kabari.

Terima kasih sudah pakai JoyoRogo. Balas email ini kalau ada masukan, saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
};
