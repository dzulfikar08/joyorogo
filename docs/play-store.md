# JoyoRogo on Google Play: closed testing runbook

Written 2026-10-15. Package `com.joyodigitama.joyorogo`. Everything here is for the Play Console steps only the account owner can click through; the app and the upload artifact are prepared in this repo.

"Verified" below means read in this repo or on the cited Google page. "[INFERENCE]" marks my reasoning where no source was read.

## 0. What the repo ships for Play

| Item | Where |
| --- | --- |
| Play build flag | `JOYOROGO_DISTRIBUTION=play` (read by `apps/native/app.config.ts`, exposed to JS as `extra.distribution`, helper `apps/native/src/distribution.ts` -> `IS_PLAY_BUILD`) |
| Build the upload bundle | `scripts/build-release-apk.sh --play` writes `dist/joyorogo-play-<versionCode>.aab` (gitignored). `--clean` forces a fresh prebuild. First build is ~30 min (arm64-v8a + armeabi-v7a native code); later ones reuse `android/`. |
| versionCode | minutes since 2024-01-01 UTC, computed at build time, so each new build is higher than the last. Play caps versionCode at 2100000000; this stays under it for thousands of years. |
| Signing | The AAB is signed with `apps/native/keystore/joyorogo-release.jks` (password in the gitignored `keystore.properties` next to it). That key is the **upload key** (Play App Signing, section 2). Back both files up outside the repo. |
| Sideload build | `scripts/build-release-apk.sh` (no flag) is unchanged: keeps `REQUEST_INSTALL_PACKAGES` and the in-app APK updater. See the signing warning below. |

What the Play build removes compared with the sideload build:

- `REQUEST_INSTALL_PACKAGES` is not in the manifest, and the APK self-updater never runs: no fetch of `latest-apk.json` at start, no "Pembaruan aplikasi" card in Profil (`useApkUpdate` returns `null`, same path iOS and web already take).
- No web checkout. Play requires Google Play Billing for digital goods, so the DOKU/Pakasir checkout never shows in the Play build and nothing links to it. The Play build sells JoyoRogo Pro through Play Billing instead (subscription `pro`, base plans `monthly` and `yearly`); it stays hidden until the server has the Play service account (`useAppConfig` reports `billing: googlePlayBilling`). Setup, products and testing: `docs/play-billing.md`. Free-tier scan limits still apply, and Pro bought elsewhere keeps working on the account.

### Signing warning (read before mixing sideload and Play)

The currently published sideload APK (`https://api.joyorogo.com/downloads/latest-apk`, versionCode 1466505 when checked) and the repo-root `joyorogo-release.apk` are signed with the **Android Debug** certificate (SHA-256 `fac61745...3b9c`), not with the release keystore. Cause: the SDK 57 Expo template has comment lines between `release {` and `signingConfig`, so the script's old string replace silently did nothing. `--play` now patches that block with a regex and fails the build if it cannot, and it signs the AAB with the release keystore. Sideload builds still use the debug key on purpose: switching them would make every installed APK refuse the update (Android rejects an in-place update across signing keys). Consequence: **an APK sideloaded from joyorogo.com cannot be updated by the Play version or vice versa; the user must uninstall first.** Tell testers who already sideloaded to uninstall before opting in.

Release keystore fingerprints (public, compare with the Play Console upload-key screen after the first upload):

```
SHA-1:   9B:5D:38:51:24:8E:60:3F:3B:15:30:EC:F3:E2:F9:29:9D:C0:B4:EA
SHA-256: 47:9A:DC:31:3A:A0:D6:15:60:F4:F5:AE:7C:F2:97:9E:10:F4:22:A3:06:F8:7C:70:60:4F:F0:48:53:66:DF:80
```

## 1. Developer account: personal vs organization

Source: https://support.google.com/googleplay/android-developer/answer/14151465

| | Personal | Organization |
| --- | --- | --- |
| Needs | Government ID verification, phone, payment profile, one-time USD 25 | D-U-N-S number (free from Dun & Bradstreet, can take weeks), legal entity (PT/CV/yayasan), website, phone, USD 25 |
| Production access | Accounts created after 13 Nov 2023 must run a closed test with **at least 12 testers opted in continuously for 14 days**, then apply for production | Exempt from the 12x14 rule |
| Public name | Your legal name appears on the store page; a contact email is public | Organization name |
| Android developer verification (enforced in Indonesia from 30 Sep 2026) | Covered by the Play Console account | Same |

Recommendation: JoyoRogo has no legal entity today, so a personal account plus the 12x14 closed test is the fastest path. The closed test costs 14 calendar days but no paperwork. If an organization account becomes available later, apps can be transferred. [INFERENCE] on transfer; confirm in Play Console help before relying on it.

Steps (owner only):

1. https://play.google.com/console/signup -> "Personal". Pay USD 25, verify identity, verify the phone number and the contact email.
2. Complete the account identity checks until the Console shows no blocking banner.

## 2. Create the app and Play App Signing

1. Console -> **Create app**. Name `JoyoRogo`, default language Indonesian (`id`), App (not game), Free, accept declarations.
2. Left menu -> **Test and release -> Setup -> App signing**. Choose **Use Google-generated key** (default, recommended). Do not upload the sideload/debug key.
3. Upload the AAB `dist/joyorogo-play-<versionCode>.aab` in the first closed-test release (section 3). Play registers the signing key of the AAB as the **upload key**: it must be `joyorogo-release.jks` (fingerprints above). Every later upload must use the same keystore.
4. If the upload key is ever lost: Console -> App signing -> "Request upload key reset"; Play does the rest because Google holds the real signing key.

## 3. Closed testing with the Google Group

1. https://groups.google.com -> **Create group**. Name `joyorogo-testers`, email `joyorogo-testers@googlegroups.com` (use the address Google gives you). Settings: "Who can join" = **Anyone can ask**, "Who can view conversations" = group members. Accept requests by hand or set to "Anyone can join" for speed.
2. Console -> **Test and release -> Testing -> Closed testing -> Create track** (or use the default "Closed testing - Alpha").
3. **Testers** tab -> **Create email list** `JoyoRogo testers` -> add the Google Group address. Add yourself directly as well. Save.
4. **Releases** tab -> **Create new release** -> upload the AAB -> release name auto-filled -> release notes (Indonesian), for example:

```
<id-ID>
Versi uji pertama JoyoRogo di Google Play. Coba scan makanan, catat olahraga dan tidur, dan beri tahu kami kalau ada yang aneh.
</id-ID>
```

5. Review and **Start rollout to Closed testing**. Google review of the first release takes from hours to a few days.
6. Console -> Closed testing track -> **Testers** tab -> copy the **opt-in URL**. For this package it is `https://play.google.com/apps/testing/com.joyodigitama.joyorogo`. Send it to the testers (WhatsApp is the channel in the marketing plan).
7. Each tester must: be a member of the Google Group with the same Google account they use on their phone -> open the opt-in link -> tap **Become a tester** -> tap the "download it on Google Play" link. They install and update from the Play Store afterwards.

### The 12 x 14 rule

- Need **12 or more testers opted in at the same time, continuously for 14 days**. Opting out resets nothing in Play's counter but drops you below 12 while they are out. Recruit 15 to 20 to keep a margin (the marketing plan uses 15).
- Count only opted-in testers, not group members. Group membership alone is not enough; the person has to tap "Become a tester".
- After 14 days: Console -> **Dashboard -> Apply for production** (the card appears when the requirement is met). Answer the questions about the test honestly (how you recruited, what feedback you got, what you changed). Review takes up to about 7 days.
- Use the 14 days to ship at least one update through the track, to show the testers are actually using it.

## 4. Store listing drafts

Limits: app name 30 characters, short description 80, full description 4000. Counts below were measured with a script; both full descriptions are about 1,700 characters.

### Indonesian (main, `id`)

- **App name** (23): `JoyoRogo: Kalori & Gizi`
- **Short description** (70): `Foto makananmu, hitung kalorinya, dan capai target berat bareng teman.`
- **Full description**:

```
JoyoRogo memberi kamu tiga angka tiap hari: boleh makan berapa, perlu bakar berapa, dan butuh tidur berapa jam. Semuanya dihitung dari data dirimu, target beratmu, dan tanggal yang kamu pilih.

CATAT MAKAN TANPA RIBET
• Foto piringmu: AI memperkirakan kalori, protein, karbohidrat, lemak, dan serat tiap makanan. Kamu cek dan koreksi angkanya sebelum disimpan.
• Ceritakan makananmu lewat suara atau teks, lalu JoyoRogo yang menghitung.
• Pindai barcode kemasan untuk mengambil info gizi produk.
• Dibuat untuk makanan Indonesia, dengan acuan Tabel Komposisi Pangan Indonesia (TKPI).

BAKAR DAN TIDUR
• Catat olahraga dan jam tidur, atau hubungkan Health Connect supaya langkah, olahraga, dan tidur terbaca otomatis. Kamu yang memilih data apa yang diizinkan.
• Pelatih latihan beban sederhana dengan rutinitas dan timer istirahat.
• Mode puasa (IF) dan Mode Ramadan dengan jadwal makan sahur dan berbuka.

BARENG TEMAN
• Grup kecil: colek teman yang lupa mencatat, tinggalkan catatan, dan lihat ringkasan bersama.
• Feed komunitas untuk membagikan makanan, latihan, atau cerita. Tidak ada yang dibagikan otomatis.
• Widget layar utama untuk progres harian dan kabar grup.

PRIVASI
• Tanpa iklan.
• Foto asli tidak disimpan di server kecuali kamu menyalakan "Simpan foto asli".
• Satu tombol di Profil untuk menghapus semua datamu.

Catatan penting: JoyoRogo bukan alat medis dan tidak mendiagnosis, mengobati, menyembuhkan, atau mencegah penyakit apa pun. Perkiraan kalori dari AI bisa meleset dan hanya panduan. Bicarakan dengan dokter atau ahli gizi sebelum mengubah pola makan atau olahraga, terutama kalau kamu hamil, menyusui, punya kondisi medis, atau di bawah 18 tahun.

Dibuat di Malang, Indonesia. Kebijakan privasi: https://joyorogo.com/privasi
```

### English (`en-US`)

- **App name** (25): `JoyoRogo: Calorie Tracker`
- **Short description** (71): `Snap your meals, count calories, and hit your weight goal with friends.`
- **Full description**:

```
JoyoRogo gives you three numbers every day: how much you can eat, how much to burn, and how many hours to sleep. They come from your own profile, your target weight, and the date you pick.

LOG MEALS WITHOUT THE HASSLE
• Photograph your plate: AI estimates calories, protein, carbs, fat, and fiber per food. You review and correct the numbers before saving.
• Tell JoyoRogo what you ate by voice or text and it does the counting.
• Scan a package barcode to pull the product's nutrition facts.
• Built for Indonesian food, calibrated against the Indonesian Food Composition Table (TKPI).

BURN AND SLEEP
• Log workouts and sleep, or connect Health Connect so steps, workouts, and sleep are read automatically. You choose which data to allow.
• A simple strength-training coach with routines and a rest timer.
• Intermittent fasting and a Ramadan mode with suhoor and iftar meal schedules.

WITH FRIENDS
• Small groups: nudge a friend who forgot to log, leave notes, and see a shared summary.
• A community feed to share a meal, workout, or story. Nothing is shared automatically.
• Home screen widgets for daily progress and group news.

PRIVACY
• No ads.
• Original photos are not stored on the server unless you turn on "Save original photo".
• One button in Profile to delete all your data.

Important: JoyoRogo is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. AI calorie estimates can be wrong and are guidance only. Talk to a doctor or dietitian before changing your diet or exercise routine, especially if you are pregnant, nursing, have a medical condition, or are under 18.

Made in Malang, Indonesia. Privacy policy: https://joyorogo.com/privasi
```

Notes for the listing text: it deliberately avoids accuracy claims, prices, Strava (marked "coming soon" in the app), and Founder, because the Play build does not sell Founder.

### Graphics

- App icon: 512 x 512 PNG, 32-bit, no alpha rounding (Play applies the mask). Source: `apps/native/assets/images/icon.png`, re-export at 512 px if it is not already.
- Feature graphic: 1024 x 500 PNG/JPEG. Mascot (`apps/web/public/mascot`) + the three numbers.
- Category: Health & Fitness. Tags: calorie counter, nutrition, fitness. Contact email `dzulfikar@joyorogo.com`, website `https://joyorogo.com`, privacy policy `https://joyorogo.com/privasi`.

### Screenshots (phone, 9:16, minimum 2, aim for 8; 1080 x 1920 or larger)

Capture from the release build with a demo account (not your real data). Order matters for the first four:

1. Beranda: the three daily numbers (makan / bakar / tidur).
2. Kamera: a plate photo with the AI result sheet (items, kcal, protein, carbs, fat).
3. Makan: the diary with stickers per food.
4. Cerita: voice/text food story with the calorie result.
5. Barcode scan result.
6. Latihan: active workout with the rest timer.
7. Grup: colek, catatan, VAR.
8. Profil: Health Connect sync card and "Hapus semua data saya".
9. (optional) Feed and the three home-screen widgets.

Do not show the Founder/pricing screens (not in the Play build) or any real name or email.

## 5. App content declarations (Policy -> App content)

| Section | Answer |
| --- | --- |
| Privacy policy | `https://joyorogo.com/privasi` |
| App access | Restricted: see section 6 |
| Ads | **No ads.** Verified: no ad SDK in `apps/native/package.json` or in the merged manifest. |
| Content rating (IARC) | Category: utility/reference or health. Violence, sexual content, language, controlled substances, gambling: none. **Users interact / share user-generated content: Yes** (feed posts, comments, group notes). Shares user location with other users: **No** (place coordinates are private and rounded to ~100 m; see `/privasi`). Digital purchases: **No** (Play build). Expect a PEGI 3 / Everyone class. |
| Target audience | **18+ only.** The app is about weight loss and dieting; choosing under-18 groups brings the Families policy and eating-disorder scrutiny. [INFERENCE] on the effect; 18+ is the safe pick. |
| News app | No |
| COVID-19 contact tracing / status | No |
| Data safety | Section 7 |
| Government app | No |
| Financial features | None (Play build has no payment features) |
| Health apps | **Required.** Console -> App content -> Health apps. Select "Nutrition and weight management" and "Activity and fitness" (and "Sleep management" if offered). Source: https://support.google.com/googleplay/android-developer/answer/16679511 . The store description above carries the "not a medical device" disclaimer the policy asks for. |
| Account deletion (Data safety -> data deletion) | URL `https://joyorogo.com/privasi#hapus-akun`. See "Known gaps" at the end. |
| Advertising ID | **No.** The app does not use the advertising ID and the merged manifest has no `com.google.android.gms.permission.AD_ID`. |
| Foreground service permissions | **None declared.** The merged manifest has no service with a `foregroundServiceType` and no `FOREGROUND_SERVICE_*` type permission, so the Console should not ask for the declaration or video. If it does, see the fallback below. |
| Photo and video permissions | Not used. No `READ_MEDIA_*`; photos come from the system photo picker (expo-image-picker). `READ/WRITE_EXTERNAL_STORAGE` are capped at `maxSdkVersion=32`. |
| SMS and Call Log | Not declared and not requested (this app never had them). |
| Exact alarms, full-screen intent, `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW` | None present. |

### Foreground service fallback

The bare `FOREGROUND_SERVICE` permission (without any type permission) remains in the merged manifest because `androidx.work:work-runtime` 2.8.1 declares it; removing it is risky since WorkManager may start a foreground service for expedited work on Android 8-11 and would crash without it. Play only requires a declaration for foreground service *types*, and the Play build declares none. If the Console still asks (the form shows when it detects the permission), answer: "The app does not start foreground services itself; the permission is merged from AndroidX WorkManager, used by notification scheduling and the home-screen widget refresh". [INFERENCE] on whether the Console asks.

## 6. App access for the reviewer

JoyoRogo signs in with Google only (`apps/native/app/login.tsx`, Better Auth social provider). The "Masuk (mode dev)" button only exists when `EXPO_PUBLIC_DEV_LOGIN=1` at build time, and the release script forces it to `0`; the server also only enables `/sign-in/dev-user` when its `DEV_LOGIN` secret is set (`packages/auth/src/index.ts`, default empty in `packages/infra/alchemy.run.ts`). So there is **no demo-account path** in the Play build, and the developer must provide a dedicated test Google account.

Do this before submitting:

1. Create a Google account for review only, for example `joyorogo.review@gmail.com`. No 2-step verification, no recovery-phone prompts at sign-in, so the reviewer is not blocked.
2. Sign in once on a phone and finish onboarding so the profile exists, add a few meals, a workout, and a sleep entry (a populated app reviews faster).
3. **Google Cloud Console -> APIs & Services -> OAuth consent screen**: publishing status must be **In production**. While it is "Testing", only listed test users can sign in and every closed tester and the Play reviewer would see "Access blocked". The Google OAuth client is the one in the server's `GOOGLE_CLIENT_ID`. Basic scopes (email, profile, openid) do not need Google verification.
4. Console -> App content -> **App access** -> "All or some functionality is restricted" -> add instructions:

```
JoyoRogo uses Google sign-in only.
1. Open the app and tap "Masuk dengan Google".
2. Choose or add this Google account:
   Email: <review account email>
   Password: <review account password>
3. The account already has a profile with sample meals, a workout, and sleep.
Camera, microphone, location, and Health Connect are optional features; the app works without granting them.
Health Connect needs the Health Connect app (built into Android 14 and up).
```

Do not put the real password in this repo.

## 7. Data safety form

Source: https://support.google.com/googleplay/android-developer/answer/10787469 . Data is transmitted over HTTPS (all calls go to `https://api.joyorogo.com`; Cloudflare terminates TLS). Answer "Yes" to "Data is encrypted in transit". There is no analytics, crash-reporting, or ad SDK in the native app (verified by searching `apps/native` and its dependencies; the only Revklik mention is a source tag on share links, and the web analytics on joyorogo.com is not part of the app). Push messages are local notifications only; no push token is sent anywhere (`apps/native/src/lib/notifications.ts` schedules local notifications).

"Shared" in Play's sense means transfer to a third party. Sending data to a service provider that processes it on our behalf (Cloudflare Workers AI) is not "sharing" under Play's definitions. [INFERENCE] reading of https://support.google.com/googleplay/android-developer/answer/10787469 ; if you prefer over-disclosure, tick "shared" with purpose "App functionality" for photos and audio.

| Play category / type | Collected | Shared | Optional | Purpose | Code evidence |
| --- | --- | --- | --- | --- | --- |
| Personal info: **Name**, **Email address** | Yes | No | Required (needed to sign in) | App functionality, Account management | Google OAuth profile stored by Better Auth; shown in Profil |
| Personal info: **User IDs** | Yes | No | Required | App functionality, Account management | Account id, public handle |
| Photos and videos: **Photos** | Yes | No | Optional | App functionality | Food photos go to the server for AI analysis; sticker cut-outs and, if "Simpan foto asli" is on, a small original are stored; avatar and feed photos |
| Audio: **Voice or sound recordings** | Yes (transmitted) | No | Optional | App functionality | Cerita voice is sent for transcription and not stored (`/privasi` says so). Play treats data processed only transiently as "not collected"; declaring it is the conservative choice. |
| Health and fitness: **Health info** | Yes | No | Optional | App functionality, Personalization | Weight, height, birth year, gender, sleep hours (incl. from Health Connect) |
| Health and fitness: **Fitness info** | Yes | No | Optional | App functionality, Personalization | Exercise sessions, steps, distance, active calories (Health Connect + manual) |
| Location: **Approximate location** | Yes | No | Optional (off by default) | App functionality | "Simpan lokasi tempat makan": one position fix is rounded to ~100 m on the device before it is sent (`apps/native/src/lib/location.ts`, `roundCoord`). Not shared with other users. Declare approximate, not precise. |
| Messages: **Other in-app messages** | Yes | No (visible to the people you choose) | Optional | App functionality | Group notes and colek, post comments |
| App activity: **Other user-generated content** | Yes | No (visible to group/public as the user chooses) | Optional | App functionality | Feed posts, captions, cerita |
| Financial info: **Purchase history** | Yes | No | Optional | App functionality, Account management | Founder orders made on the website are stored (order id, amount, status, date). The Play build has no checkout, but the account can carry that history. Payment card, bank, and e-wallet details are handled by DOKU/Pakasir and never reach JoyoRogo. DOKU receives name and email when a web checkout is created (not from this app). |
| Nutrition (food and drink) | Play has no separate "nutrition" type: it goes under **Health info** (already declared above). Meals are also **written to** Health Connect. | | | | `health-connect-nutrition.ts` |
| Device or other IDs | **No** | | | | No advertising ID, no push token |
| App info and performance (crash logs, diagnostics) | **No** | | | | No crash SDK in the app. Cloudflare keeps request logs server-side (IP, user agent); this is standard infrastructure logging. [INFERENCE] whether to declare it; Play's guidance covers data the *app* collects. |
| Contacts, calendar, SMS, call log, files and docs, web browsing | **No** | | | | Not requested |

Data deletion section of the form:

- "Can users request that data is deleted?" -> **Yes**.
- In-app: Profil -> "Hapus semua data saya" deletes profile, weight, food, exercise, sleep, feed posts, photos, saved locations. (Feed rows were not covered before this change; `deleteAllUserData` now removes them.)
- Web link for account and data deletion: `https://joyorogo.com/privasi#hapus-akun` (describes the in-app button and an email request for full account removal).
- Whole-account removal is by email today, not self-serve (see Known gaps).

## 8. Health Connect declaration

Console -> Policy -> App content -> **Health Connect** (shown because the manifest has `android.permission.health.*`). Source: https://support.google.com/googleplay/android-developer/answer/9888379 and the Health Connect permission-declaration form. Declare **only** the data types below; they match the merged manifest of the Play AAB exactly (verified with `bundletool dump manifest`).

Use for all of them: the data is used only to power user-facing features inside the app (calorie budget and progress), is not sold, is not used for ads or credit decisions, and is not shared with third parties. Reads happen only while the app is open; there is no background read permission (it was removed). Privacy policy section: `https://joyorogo.com/privasi` -> "Health Connect (Android)".

| Permission | Access | Justification (paste) |
| --- | --- | --- |
| `READ_STEPS` | Read | JoyoRogo's core feature is a daily "burn" target. Steps from the last 7 days are summed per day and shown with the active calories so the user sees how much of the target the day has met. |
| `READ_DISTANCE` | Read | Distance for the same days is shown next to steps and active calories in the daily activity summary. |
| `READ_ACTIVE_CALORIES_BURNED` | Read | Active calories are the main input of the daily "bakar" number and are also used to attribute kcal to imported workouts. |
| `READ_EXERCISE` | Read | Exercise sessions (type, title, duration) from the last 7 days are imported once into the user's workout log so users do not log workouts twice. Duplicates are skipped. |
| `READ_SLEEP` | Read | Sleep sessions are converted to hours per night for the "tidur" target and the sleep log. |
| `WRITE_NUTRITION` | Write | Each meal the user logs is written to Health Connect (name, kcal, protein, carbs, fat, fiber, meal type) so other health apps the user trusts can show it. Writes are idempotent (client record id) and edits and deletes in JoyoRogo update or remove the record. Only written when the user grants this permission. |

Removed from the manifest in this change because the code never used them: `READ_HEALTH_DATA_IN_BACKGROUND` (sync only runs while the app is open, `use-health-sync.ts`) and `READ_NUTRITION` (the app writes meals but never reads nutrition back). The matching runtime requests were deleted from `health-connect.ts` and `health-connect-nutrition.ts`, so the app no longer asks for them.

Other Health Connect Play requirements already met: privacy policy covers Health Connect (section "Health Connect (Android)"); the permission-rationale activity exists (`androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` on `MainActivity` and the `ViewPermissionUsageActivity` alias from `react-native-health-connect`); the health data is not used for advertising.

## 9. Permissions kept in the Play manifest, with justification

Source: `bundletool dump manifest` of the Play AAB. Normal install-time permissions that need no declaration (network, vibrate, wake lock, boot, badges, biometrics, `MODIFY_AUDIO_SETTINGS`) are omitted.

| Permission | Kept because |
| --- | --- |
| `CAMERA` | Photographing meals and scanning barcodes (`expo-camera`) |
| `RECORD_AUDIO` | Cerita: the user records a spoken food note which is transcribed (`components/cerita.tsx`, `expo-audio`) |
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | One foreground position fix for the optional "Simpan lokasi tempat makan" switch; rounded to ~100 m on the device. Foreground only, no background location, no location service. FINE is kept so the fix is good enough to round to 100 m; COARSE alone can be several km off. |
| `POST_NOTIFICATIONS` | Local meal and workout-rest reminders |
| `READ/WRITE_EXTERNAL_STORAGE` (max SDK 32) | Expo template default for old Android versions; harmless |
| `android.permission.health.*` (6) | Section 8 |
| `FOREGROUND_SERVICE` | Merged from AndroidX WorkManager, see "Foreground service fallback" |

Removed in this change: `REQUEST_INSTALL_PACKAGES` (Play build only), `SYSTEM_ALERT_WINDOW` (Expo template default for the dev overlay; unused, blocked in `app.json` `blockedPermissions` for all builds), `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the `AudioControlsService` media service (the app never plays background audio; `expo-audio` plugin option `enableBackgroundPlayback: false`; also drops the iOS `audio` background mode), the `expo-location` `LocationTaskService` with `foregroundServiceType="location"` (never used; `plugins/with-no-location-service.js`), `READ_HEALTH_DATA_IN_BACKGROUND`, `READ_NUTRITION`.

## 10. Update and release routine

1. Bump nothing by hand: `scripts/build-release-apk.sh --play` computes versionCode.
2. Console -> Closed testing -> **Create new release** -> upload the new AAB -> release notes -> rollout.
3. Testers get the update from the Play Store (auto-update or the Update button). The app no longer updates itself.
4. Keep the `version` in `apps/native/app.json` as the user-visible name; versionCode is what Play orders by.
5. After production access is granted, promote the same AAB from the closed track to Production instead of rebuilding.

## 11. Known gaps and decisions for the owner

1. **No self-serve account deletion.** Verified: the only deletion paths are `Hapus semua data saya` (native `profil.tsx`, web `_auth/profil.tsx`; `deleteMyData` RPC and `POST /api/privacy/delete-my-data`) which keep the auth account (user/session/account) and payment rows, and the new email instruction on `/privasi#hapus-akun`. Play's account-deletion policy (https://support.google.com/googleplay/android-developer/answer/13327111) expects an in-app way to request deletion of the *account* plus a web link. Closed testing can proceed, but production review may flag it. Smallest fix: enable Better Auth `user.deleteUser` with a `beforeDelete` hook that runs the existing wipe + media delete, a "Hapus akun" row in Profil, and a web button. I did not build this (scope).
2. **Pro in the Play app uses Play Billing.** Do the owner steps in `docs/play-billing.md` (payments profile, subscription `pro`, service account, Pub/Sub, license testers) before expecting a purchase UI; until the server has `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` the Play build shows none. Do not add an in-app link or button pointing to the web checkout from the Play build (steering is also restricted by Play policy [INFERENCE]).
3. **Sideload APK is debug-signed** (section 0 warning). Moving sideload users to the release key requires one uninstall/reinstall for each of them.
4. **User-generated content policy.** The feed has post reporting and user blocking (`social.report`, `social.block`). The Console's UGC policy also expects a moderation process; see who reads `social_report` rows. [INFERENCE] on how strictly this is reviewed.
5. **Production OAuth consent screen**, section 6 step 3.
6. **Group membership on web wipe**: the web REST route now also leaves groups like the native RPC did (`deleteUserSocialData`), both are deployed together with the server.
