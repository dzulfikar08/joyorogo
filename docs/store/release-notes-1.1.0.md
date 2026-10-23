# JoyoRogo 1.1.0 store release notes

Build state: `apps/native/app.json` `version` 1.1.0, `ios.buildNumber` 2 (Android `versionCode` and iOS `CFBundleVersion` are stamped at build time, see docs/ci-release.md). Native changes in this build: `react-native-worklets` 0.10.4 (the UI loop pauses in the background natively, JS gate removed), widget refresh every 60 min instead of 30, Google sign-in through the Android account picker. Do not claim store availability before the build is live.

## Google Play "What's new" (limit 500 characters each)

```
<id-ID>
Baru: masuk dengan Google langsung dari aplikasi (tanpa browser), widget yang lebih rapi dan lebih hemat, baterai HP lebih hemat saat aplikasi di latar belakang, Joyo AI (tanya soal makanmu, bisa pakai kunci API sendiri), bagikan makan sehari, stiker piring utuh, dan scan makanan yang lebih konsisten.
</id-ID>
<en-US>
New: sign in with Google right in the app (no browser), a tidier and lighter widget, lower battery use when the app is in the background, Joyo AI (ask about your meals, your own API key works too), share a whole day of meals, whole-plate stickers, and more consistent food scans.
</en-US>
<ms-MY>
Baharu: log masuk dengan Google terus dalam aplikasi (tanpa pelayar), widget yang lebih kemas dan jimat, bateri telefon lebih jimat bila aplikasi di latar belakang, Joyo AI (tanya tentang makanan anda, boleh guna kunci API sendiri), kongsi makanan sehari dan imbasan makanan yang lebih konsisten.
</ms-MY>
```

(The ms-MY tag only applies if Malay is added as a Play listing language; otherwise paste the text under the closest language.)

## App Store "What's New in This Version"

Indonesian:

```
- Widget lebih rapi dan menyegarkan diri lebih jarang agar baterai lebih awet.
- Baterai HP lebih hemat saat JoyoRogo di latar belakang.
- Joyo AI: tanya soal makanmu; bisa pakai kunci API milikmu sendiri.
- Bagikan makan sehari sebagai story, stiker piring utuh, scan makanan lebih konsisten.
- Perbaikan kecil dan stabilitas.
```

English:

```
- A tidier widget that refreshes less often to save battery.
- Lower battery use while JoyoRogo is in the background.
- Joyo AI: ask about your meals; you can use your own API key.
- Share a whole day of meals as a story, whole-plate stickers, more consistent food scans.
- Small fixes and stability.
```

Malay:

```
- Widget lebih kemas dan dikemas kini kurang kerap untuk menjimatkan bateri.
- Penggunaan bateri lebih rendah semasa JoyoRogo di latar belakang.
- Joyo AI: tanya tentang makanan anda; boleh guna kunci API sendiri.
- Kongsi makanan sehari sebagai story, pelekat pinggan penuh, imbasan makanan lebih konsisten.
- Pembetulan kecil dan kestabilan.
```

Google sign-in on the Android account picker is Android only; iPhone keeps Sign in with Apple. Joyo AI hosted engine is Pro; own key is free for adults.
