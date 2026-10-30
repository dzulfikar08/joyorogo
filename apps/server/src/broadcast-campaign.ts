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

/** JoyoRogo on Google Play, `referrer` campaign token per docs/utm.md. */
const JOYOROGO_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Demail%26utm_medium%3Dbroadcast%26utm_campaign%3D2026-10-broadcast";
/** JoyoRogo on the App Store, `ct` campaign token per docs/utm.md. */
const JOYOROGO_APP_STORE_URL = "https://apps.apple.com/id/app/id6823222101?ct=email-2026-10-broadcast";

/** The announcement the admin console opens with (editable there before a test or the full send). */
export const DEFAULT_CAMPAIGN: Campaign = {
  id: "2026-10-koreksi-suara",
  subject: "Sekarang bisa koreksi hasil scan pakai suara, dan JoyoRogo sudah di Google Play",
  body: `Halo {nama},

Ada beberapa kabar dari JoyoRogo dan JoyoFit:

**1. Hasil scan salah? Tinggal bilang.**
Sekarang kamu bisa koreksi hasil foto makanan dengan mengetik atau bicara, misalnya "itu rolade bukan perkedel" atau "nasinya setengah aja". Hanya bagian yang kamu sebut yang berubah, kalorinya dihitung ulang, dan tidak mengurangi jatah scan. Hasil scan juga sekarang muncul bertahap, jadi lebih cepat terlihat.

**2. JoyoRogo sudah di App Store dan Google Play, JoyoFit masih beta**
- JoyoRogo iPhone (App Store): ${JOYOROGO_APP_STORE_URL}
- JoyoRogo Android (Google Play): ${JOYOROGO_PLAY_URL}
- JoyoFit iPhone (beta TestFlight, untuk jam Huawei): https://testflight.apple.com/join/GXzrQ8GJ

**3. Strava: slot penuh, daftar antre**
Sinkron Strava gratis, tapi slot dari Strava untuk aplikasi baru (10 orang) sudah terisi semua. Kami sudah mengajukan penambahan kuota. Daftar di https://fit.joyorogo.com/strava, nanti kami kabari.

Terima kasih sudah pakai JoyoRogo. Balas email ini kalau ada masukan, saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
};
