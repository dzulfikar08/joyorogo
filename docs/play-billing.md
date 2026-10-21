# Google Play Billing: JoyoRogo Pro in the Play app

Package `com.joyodigitama.joyorogo`. This is the runbook for the one-time Play Console, Google Cloud and server setup that only the account owner can do, plus a description of what the repo ships. For the rest of the Play launch (account, signing, closed test) see `docs/play-store.md`.

"[INFERENCE]" marks reasoning where I read no source; the Play Console UI changes often, so button labels may differ slightly.

## 0. What ships

Users buy **JoyoRogo Pro** inside the Play build as a Play subscription. It grants the same paid tier as the web checkout and the App Store (the account's paid period, `user.founder_until`), so Pro is per account no matter where it was bought. The sideload APK keeps the web checkout (QRIS / transfer); the Play build never links to it.

| Piece | Where |
| --- | --- |
| Play product | subscription `pro`, base plans `monthly` and `yearly` (IDR). Prices live in Play Console only; the app shows the localized price Play returns and hardcodes nothing. |
| Client library | `expo-iap` 6.0.2 (Play Billing Library through OpenIAP). Android only: `apps/native/package.json` has `expo.autolinking.apple.exclude: ["expo-iap"]`, so iOS builds keep using the local StoreKit module `modules/apple-iap` and never link it. The sideload APK links it but never calls it. |
| Client code | `apps/native/src/lib/play-billing.ts` (products, purchase sheet, owned purchases), hooks in `apps/native/components/billing.tsx` (`usePlayPurchase`, `usePlayRestore`, `usePlayReplay`, `usePlayPrices`), paywall in `apps/native/app/founder.tsx` (route `/founder`, screen title "Pro"), cards in Profil. Only runs when `IS_PLAY_BUILD` on Android. |
| Server routes | `apps/server/src/google-billing.ts`: `POST /api/billing/google` (client submits a purchase token) and `POST /api/billing/google/rtdn` (Pub/Sub push). |
| Server logic | `packages/api/src/lib/google-play.ts` (service-account OAuth, Android Publisher calls, Pub/Sub JWT check) and `google-play-billing.ts` (verify, credit, link, refund). Tests next to them. |
| Database | `google_purchase` (purchase token -> user link), migration `0030_google_play_billing`. Credits are `payment` rows with order id `google:<Play order id>`. |
| Config | `GET /api/config` reports `googlePlayBilling`. |

### Purchase flow

1. The Play build reads `/api/config`. `googlePlayBilling` true makes the Play build treat billing as on (banner, Harga row, `/founder`, Profil cards). False (secret unset, or no paywall) hides every purchase surface, exactly as the Play build did before this feature.
2. `/founder` loads the `pro` subscription from Play, picks the base-plan offer of the chosen plan, and shows Play's localized price with the required terms (price, period, auto-renew, how to cancel).
3. The buyer taps "Berlangganan JoyoRogo Pro". The app passes their JoyoRogo user id as `obfuscatedAccountId` and opens Play's purchase sheet.
4. On success the app posts the purchase token to `POST /api/billing/google`. The server:
   1. refuses a token already linked to another account (409), before calling Google;
   2. asks Google (`purchases.subscriptionsv2.get`) and checks product `pro`, base plan `monthly` or `yearly`, and that `obfuscatedExternalAccountId`, when present, is this user;
   3. links the token to the user (first account wins; a concurrent claim by another account loses);
   4. credits the latest **charged** order (`lineItems[].latestSuccessfulOrderId`) once: +1 month (`monthly`) or +12 months (`yearly`) stacked on the current period, one D1 batch, so a replay or two concurrent requests credit once;
   5. **only then** acknowledges the purchase (`purchases.subscriptions.acknowledge`). If acknowledge fails the request errors, the app retries on its next start, and the credit is not repeated. Play refunds purchases left unacknowledged for 3 days, which is why a credit is never lost behind a missing acknowledge.
5. Restore: "Pulihkan pembelian" (on `/founder` and in Profil) and an automatic replay at start re-read the Google account's subscriptions from Play and post each token. This also covers a purchase made on a new phone or after a reinstall. A token belonging to another JoyoRogo account answers "terhubung ke akun JoyoRogo lain".
6. Pending purchases (convenience store, cash, bank transfer): the sheet returns `pending`. The server links the token but credits and acknowledges nothing. When the buyer pays, Play sends `SUBSCRIPTION_PURCHASED`, and the RTDN endpoint credits it (or the next app start does through the replay).
7. Manage: an account that is already Pro sees "Kelola langganan" (Profil, Langganan) instead of "Perpanjang". It opens `https://play.google.com/store/account/subscriptions?sku=pro&package=com.joyodigitama.joyorogo` (cancel, payment method, next charge). Pro bought on the web has nothing to manage there.

Where the app points a free account at this screen (Pro pill in the Beranda header, "Sisa N dari M scan" on the camera, streak milestones, Lainnya, locked features) is listed in `docs/billing-status.md`, which also records what is set up in production.

### Real-time notifications

Pub/Sub pushes to `POST /api/billing/google/rtdn`. The payload is never trusted for the credit itself: the server reads the token from the message, looks it up in `google_purchase`, re-reads the subscription from Google and applies it like a client submission.

- Renewals: the new charged order is credited once (`google:<orderId>..N`).
- `SUBSCRIPTION_REVOKED` and voided purchases (refunds, chargebacks): the order's months are taken back and the ledger row flips to `failed`, once. Zero-revenue tester trials are left to expire.
- Cancellation, on hold, expiry: nothing to do. The paid period was credited up front, so the account keeps Pro until it ends. An on-hold or expired subscription simply stops renewing credits.
- Tokens that are not linked yet (the notification beat the app's own verify call) are ignored; the app's call credits them.
- Anything unparsable, from another package, or a test ping answers 204. A Google or database failure answers 500 so Pub/Sub redelivers.
- Auto-renewing Play subscribers are excluded from the "Pro ends soon" reminder emails while Play reports the subscription `active` or in grace.

Authentication: either a Google-signed Pub/Sub push JWT (`GOOGLE_PLAY_RTDN_PUSH_EMAIL`, audience = the endpoint URL) or a shared token in the URL (`GOOGLE_PLAY_RTDN_TOKEN`, `?token=`). With neither set, the endpoint answers 401.

### Tester purchases

A purchase from a Play license tester is reported by Google as a test purchase. To keep testers from minting free months, a test purchase credits **24 hours at Rp0** unless the buyer's account email is in `GOOGLE_PLAY_TEST_EMAILS`, in which case it credits the full period. The owner's own account should be in that list.

### Unavailable by design

Without `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (or without the paywall), `/api/config` reports `googlePlayBilling: false`, both Google routes answer 404 "tidak tersedia", and the Play app shows no purchase UI. Nothing else changes.

## 1. Owner checklist (in this order)

### 1.1 Payments profile (merchant account)

Source: https://developer.android.com/google/play/billing/getting-ready

To sell subscriptions you need a Google Payments profile linked to the developer account.

1. https://pay.google.com -> create or open the payments profile for the developer account (business name, address, tax details Google asks for in Indonesia).
2. Play Console -> **Setup -> Payments profile** (or the "Set up a merchant account" banner under **Monetize with Play**) -> link it. Help: https://support.google.com/googleplay/android-developer/answer/3092739
3. Wait until **Monetize with Play -> Products -> Subscriptions** opens without a "set up a merchant account" block.

### 1.2 Publish a build that contains Play Billing

Play only unlocks product creation after a published build includes the Billing Library. The AAB from `scripts/build-release-apk.sh` (this repo, versionCode higher than 1466923) has it.

1. Upload that AAB to a track (internal testing is enough), start the rollout.
2. Wait for **Monetize with Play** to unlock Products.

### 1.3 Create the subscription

Play Console -> your app -> **Monetize with Play -> Products -> Subscriptions -> Create subscription**.

1. **Product ID:** `pro`. It can never change or be reused, so type it exactly. **Name:** `JoyoRogo Pro`. Add a short benefits list and description (Indonesian is fine).
2. **Add a base plan:**
   - Base plan ID `monthly` (exact), **Auto-renewing**, billing period **Monthly**. Keep the default grace period and account hold. Price: your monthly price in **IDR** (set the Indonesia price; Play converts others). Save.
   - Base plan ID `yearly` (exact), **Auto-renewing**, billing period **Yearly**, your yearly price in IDR (owner checklist: **Rp199.000**, about Rp16.600/month, shown first in the app; monthly base plan Rp29.000 standard, the Rp15.000 first-10 promo is web/DOKU/Pakasir only). The App Store yearly product likewise needs the tier closest to Rp199.000. Prices are never hardcoded in the app. Save.
3. **Activate** both base plans (Activate button on each). Only active base plans are sold.
4. Do not add promotional offers yet. The app picks each plan's plain base-plan offer and ignores offers with extra pricing phases.

The IDs `pro`, `monthly` and `yearly` are what the server accepts (`GOOGLE_PRO_PRODUCT_ID`, `GOOGLE_BASE_PLANS` in `packages/api/src/lib/google-play.ts`). Anything else is rejected as "wrong product".

### 1.4 Google Cloud project and service account

Sources: https://developers.google.com/android-publisher/getting_started, https://developer.android.com/google/play/billing/getting-ready

1. https://console.cloud.google.com -> select or create a project (this same project hosts Pub/Sub in 1.7).
2. **APIs & Services -> Library** -> search **Google Play Android Developer API** -> **Enable**.
3. **IAM & Admin -> Service accounts -> Create service account**, name `joyorogo-play-billing`. No project roles are needed. Create.
4. Open the account -> **Keys -> Add key -> Create new key -> JSON**. A file downloads. This is `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (treat as a secret; do not commit it).
5. Copy the account's email (`joyorogo-play-billing@<project>.iam.gserviceaccount.com`, also `client_email` in the JSON).

### 1.5 Give the service account access in Play Console

Play Console -> **Users and permissions** (left menu, account level) -> **Invite new users**.

1. Email: the service account email from 1.4. (The old "Setup -> API access" screen no longer links service accounts; inviting them as users is the current path. [INFERENCE] on the exact menu wording.)
2. Account permissions are enough, or restrict to the JoyoRogo app under **App permissions**. Tick at least:
   - **View app information and download bulk reports (read-only)**
   - **View financial data, orders, and cancellation survey responses** (Google names this the permission needed for billing APIs)
   - **Manage orders and subscriptions** (needed for the acknowledge call)
3. **Invite user**. Service accounts accept automatically. Permissions can take a while to take effect (Google says changes may take time; [INFERENCE] up to a day). Until they do, verification answers 502 and the server logs `google subscriptionsv2.get 401/403`.

### 1.6 Server secrets

From the repo root (needs the Cloudflare login the deploy already uses):

```
cd apps/server
bunx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --config wrangler.jsonc   # paste the whole JSON file
bunx wrangler secret put GOOGLE_PLAY_TEST_EMAILS --config wrangler.jsonc           # e.g. dzulfikar.at@gmail.com (comma separated)
bunx wrangler secret put GOOGLE_PLAY_RTDN_PUSH_EMAIL --config wrangler.jsonc       # see 1.7 (push subscription service account)
```

Use secrets, not `wrangler.jsonc` vars: `scripts/deploy.sh` rewrites the vars block, and secrets persist across deploys. Optional: `GOOGLE_PLAY_PACKAGE_NAME` (defaults to `com.joyodigitama.joyorogo`), `GOOGLE_PLAY_RTDN_TOKEN` (shared-token alternative to the JWT). The server needs no redeploy after setting secrets; the next request picks them up. Without `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` the feature stays "unavailable".

Check: `curl https://api.joyorogo.com/api/config` shows `"googlePlayBilling": true`.

### 1.7 Pub/Sub topic and push subscription (real-time notifications)

Sources: https://developer.android.com/google/play/billing/getting-ready, https://cloud.google.com/pubsub/docs/push

In the same Google Cloud project:

1. **Pub/Sub API:** APIs & Services -> Library -> **Cloud Pub/Sub API** -> Enable.
2. **Pub/Sub -> Topics -> Create topic**, ID `play-rtdn` (uncheck nothing else). Full name: `projects/<project-id>/topics/play-rtdn`.
3. Open the topic -> **Permissions -> Add principal**: `google-play-developer-notifications@system.gserviceaccount.com`, role **Pub/Sub Publisher**. Save.
4. **Service account for the push:** IAM -> Service accounts -> create `joyorogo-rtdn-push` (no roles). Its email is `GOOGLE_PLAY_RTDN_PUSH_EMAIL` from 1.6.
5. Let Pub/Sub sign tokens as it: IAM -> Service accounts -> `joyorogo-rtdn-push` -> **Permissions -> Grant access**: principal `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com`, role **Service Account Token Creator**. (The Pub/Sub service agent exists once the API is enabled; the console's subscription form can also offer to add this for you.)
6. **Pub/Sub -> Subscriptions -> Create subscription** on topic `play-rtdn`:
   - Delivery type **Push**.
   - Endpoint URL: `https://api.joyorogo.com/api/billing/google/rtdn`
   - **Enable authentication**: service account `joyorogo-rtdn-push`; **Audience**: exactly `https://api.joyorogo.com/api/billing/google/rtdn` (no query string).
   - Acknowledgement deadline 30 s; retry policy "Retry after exponential backoff delay". Create.
7. Play Console -> your app -> **Monetize with Play -> Monetization setup -> Real-time developer notifications**: tick **Enable real-time notifications**, Topic name `projects/<project-id>/topics/play-rtdn`, choose **Get notifications for subscriptions and all voided purchases**, **Save changes**.
8. Click **Send test message**. The subscription should show a delivered message; the endpoint answers 204. Check `wrangler tail` or Pub/Sub's "Unacked messages" metric if not.

Shared-token alternative (skips steps 4, 5 and the authentication switch): `wrangler secret put GOOGLE_PLAY_RTDN_TOKEN` with a long random string, use the endpoint URL `https://api.joyorogo.com/api/billing/google/rtdn?token=<that string>` in step 6 and leave authentication off.

### 1.8 License testers

Play Console -> **Settings -> License testing** (all-apps settings, left menu) -> add the Gmail accounts that will test purchases to a list, **License response** `RESPOND_NORMALLY`, save. Help: https://developer.android.com/google/play/billing/test

- Purchases by license testers are free ("test card, always approves"), flagged as test purchases, and test subscriptions renew on an accelerated schedule (a monthly plan renews every 5 minutes, a small number of times, then cancels). The server credits a test purchase 24 hours at Rp0 unless the buyer's email is in `GOOGLE_PLAY_TEST_EMAILS`.
- Add the owner's own account to both lists to see a full month credited.

### 1.9 How closed testers buy

1. The tester must install the **Play build from Play** (the opt-in link of the closed testing track, `docs/play-store.md` section 3), signed in to Play with the Google account that is on the tester list. A sideloaded APK or the sideload APK from joyorogo.com cannot buy: Play Billing only works for builds installed by Play with a version uploaded to Play.
2. To test without being charged, the account must also be a **license tester** (1.8). Closed testers who are not license testers are charged real money.
3. In the app: sign in to JoyoRogo, open Profil -> **Upgrade** (or the Beranda banner), pick Bulanan or Tahunan, tap **Berlangganan JoyoRogo Pro**, confirm in Play's sheet. The price shown is Play's own.
4. Expected: a "Langganan aktif" toast, the Pro badge, and the higher daily scan quota. Delete test subscriptions in Play Store -> Payments & subscriptions -> Subscriptions.
5. Pending path: Play lets license testers pick the slow test payment method ("Test card, slow decline" and similar entries) to simulate delayed or declined payments.
6. If the product price or "Langganan belum tersedia di Google Play" shows: the `pro` subscription is not active, the base plans are not both active, or the track build was published before the products existed (wait a few minutes and reopen the app).

## 2. After setup: verify end to end

1. `curl https://api.joyorogo.com/api/config` -> `googlePlayBilling: true`.
2. Buy as a license tester; the account shows Pro within seconds. In D1: `select * from google_purchase;` has the token linked to the user; `select order_id, status, amount_idr, months from payment where order_id like 'google:%';` has a paid row.
3. Force a renewal (test subscription renews in ~5 min): a second `google:...` order row appears and the period extends, with no app interaction (RTDN).
4. Cancel in Play Store: the period already paid stays. Refund the order in Play Console (Order management -> Refund): within a minute the ledger row flips to `failed` and the period shrinks by that order's months.
5. Sign in as a second JoyoRogo account on the same phone and tap "Pulihkan pembelian": it answers that the subscription is linked to another account, and grants nothing.

## 3. Policy and edge notes

- No link or button to the web checkout exists in the Play build; the DOKU/Pakasir options, promo card and "Cek pembayaran" are hidden when `IS_PLAY_BUILD`. Pro bought on the web or App Store still unlocks the Play app because the paid period is per account.
- The paywall screen discloses price, billing period, auto-renewal and where to cancel, as Play requires for subscriptions.
- Deleting a JoyoRogo account does not cancel the Play subscription; Play keeps billing until the user cancels in Play Store -> Subscriptions. [INFERENCE] worth a line in the privacy policy / account deletion screen.
- Pro periods credited from Play stack on web and App Store periods. A buyer who has web time left and then buys on Play pays Play and gets the months on top.
- Grace period and account hold: the server grants only for charged orders. A renewal that fails goes to grace, then hold, and no further months are credited until Play charges it successfully.
- If you change a base plan price in Play Console, existing subscribers keep their old recurring price until they accept the change; the ledger records the price Play reports per subscriber (`autoRenewingPlan.recurringPrice`, IDR), falling back to the configured plan price for non-IDR billing.
