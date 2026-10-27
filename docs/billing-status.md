# Billing status

Audit of every way JoyoRogo Pro is sold, read from the code, the production Cloudflare worker, Google Play Console, App Store Connect and the production D1 ledger on 2026-10-21. Nothing in this file is a guess unless it carries `[INFERENCE]`. Runbooks: `docs/play-billing.md` (Play), `docs/pricing.md` (prices, Apple, Polar).

The paywall is **already on in production** (`FREE_DAILY_SCANS=3`, `GET /api/config` answers `paywall: true`). This work flipped no flag.

## Status by channel

| Channel | Code | Prod secrets and vars | Store products | Sold so far (prod D1) | Reachable by a real buyer today |
| --- | --- | --- | --- | --- | --- |
| Web, QRIS (Pakasir) and bank transfer (DOKU) | `apps/server/src/billing.ts`, `packages/api/src/lib/{pakasir,doku}*` | `DOKU_SECRET_KEY`, `PAKASIR_API_KEY`, `PAKASIR_WEBHOOK_SECRET` set; `DOKU_CLIENT_ID`, `PAKASIR_SLUG` in `wrangler.jsonc` | none needed | 14 paid orders (Rp266.000), 35 failed, 3 pending | Yes: joyorogo.com/pro, /harga, the sideload APK, JoyoFit sideload |
| Web, USD card (Polar) | `packages/api/src/lib/polar*.ts` | `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` set; product ids and USD prices in `wrangler.jsonc`; `/api/config` carries `usd` | Polar products monthly US$9.99, yearly US$59.99 | **0 `polar:` orders**: never bought once | Yes for non-Indonesian visitors; the go-live buy (docs/pricing.md, step 4) is not on record |
| Android, Google Play Billing | `apps/server/src/google-billing.ts`, `packages/api/src/lib/google-play*.ts`, native `src/lib/play-billing.ts` (expo-iap 6.0.2) | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_PUSH_EMAIL`, `GOOGLE_PLAY_TEST_EMAILS` set. `/api/config`: `googlePlayBilling: true` | Subscription `pro` ACTIVE, base plans `monthly` (Rp29.000) and `yearly` (Rp199.000) both ACTIVE, 128 regions each, auto-renewing | 1 license-tester purchase (2026-10-16): one `google_purchase` row (monthly, 4 test renewals, now `expired`), **no `google:` ledger row** | Only closed-test installs (see "What blocks Android") |
| iOS, StoreKit | local module `apps/native/modules/apple-iap`, `packages/api/src/lib/apple-billing.ts`. (expo-iap is excluded on iOS autolinking; it is not used there) | `appleBilling: true` in `/api/config` | ASC `com.joyodigitama.joyorogo.founder.monthly` and `.yearly`: **IN_REVIEW** with app version 1.0.0 (IN_REVIEW). Legacy `.founder.1m` READY_TO_SUBMIT, cleared for sale nowhere | 7 `apple:` rows, all Rp0 (TestFlight Sandbox) | Not yet: the App Store page `apps.apple.com/app/id6823222101` answers 404 until review ends |

Play pieces I checked directly:

- Merchant profile: active. Subscriptions exist and are sellable, and a charged test order went through on 2026-10-16.
- Service account `joyorogo-play-billing@joyorogo.iam.gserviceaccount.com` is authorised: `purchases.subscriptionsv2.get`, `subscriptions.acknowledge` and `voidedpurchases.list` answer 400 (bad token) or 200, never 401/403.
- RTDN: Play Console, JoyoRogo, Monetize with Play, Monetization setup shows "Enable real-time notifications" ticked, topic `projects/joyorogo/topics/play-rtdn`, content "Subscriptions and voided purchases only". "Send test notification" was pressed on 2026-10-21 and the worker logged `POST /api/billing/google/rtdn 204` (Pub/Sub push, JWT accepted).
- Endpoints without credentials: `/api/billing/google` 401, `/api/billing/google/rtdn` 401, Polar webhook without signature 403.
- Prices follow `docs/pricing.md`: the intended ladder step (buyers 11-60) is Rp29.000 / Rp199.000, `founderYearlyPriceIdr` 199000, and both store products match it.

## What blocks a real Android user from buying today

1. **Nobody outside the closed test can install the Play build yet.** JoyoRogo has no public Play release: Play Console home lists it under "Closed testing", production release 1472513 is "Changes in review", 7 device acquisitions so far. The public APK links were removed from the website (`dd92e98`), so the Android funnel is the closed-test opt-in. This is the blocker. Everything below it is in place.
2. **No real-money Play purchase has completed.** The only Play purchase on record is the 2026-10-16 license-tester one: its token is linked to an account but the ledger has no `google:` row, so the credit path was not seen working in production. The server code path is covered by unit tests; the cause of the missing row is unknown (it may predate the deploy of the credit code, [INFERENCE]). One fresh license-tester purchase settles it (owner step 2).
3. **The paywall was hard to find.** Before this change the only places that led to it were the Beranda "promo" card (the last card of the home list, hideable in "Atur kartu Beranda"), a single row at the bottom of Lainnya, the scan screen after the free scans were gone, and the locked-feature cards. All of those still exist; the section below lists what was added.

Not blockers: Play Console products, base plans, regional prices, service account, RTDN, `googlePlayBilling` flag, the server routes, the paywall flag.

## Purchase flow in the app

Play build (`IS_PLAY_BUILD`, Android): `/founder` reads the `pro` subscription from Play, shows Play's own localized prices for both base plans, and the buy button opens Play's sheet with the JoyoRogo user id as `obfuscatedAccountId`. The token goes to `POST /api/billing/google`, the server verifies it with Google, credits the charged order, then acknowledges. Pro shows immediately (the app invalidates its queries). Restore: "Pulihkan pembelian" on `/founder` and in Profil, plus an automatic replay at start. Manage: Profil, Langganan, "Kelola langganan" opens Play's subscription page for `pro` (new: before, Pro accounts on the Play build only saw "Perpanjang", which would have answered "already subscribed" for an active subscriber). iOS uses the same screen with StoreKit; the sideload APK uses QRIS/transfer.

### Entry points (free accounts that can buy; nothing shows for Pro, self-hosted or a build without billing)

| Moment | Where | `from` | New |
| --- | --- | --- | --- |
| Always visible | "Pro" pill beside the date in the Beranda header | `chip` | yes |
| About to spend a scan | camera: "Sisa N dari M scan gratis hari ini" with "Lihat Pro" (server `profile.scanAllowance`) | `scanleft`, `quota` when 0 | yes |
| Scan limit reached | after the last free scan and on a refused scan | `quota` | |
| Logging streak 7, 14, 30, 60, 100 days | one dismissible card on Beranda, shown once per milestone | `streak` | yes |
| Lainnya tab | Pro card at the top (was one row at the bottom) | `profile` | moved |
| Meal plan locked | locked view | `mealplan` | tagged |
| Sleep insights locked | teaser | `sleep` | tagged |
| Weekly reflection locked | recap | `recap` | tagged |
| Someone's workout detail locked | feed | `workout` | tagged |
| Food guidance, challenge host, AI connections | existing cards | `fitness`, `challenge`, `profile` | |
| Beranda card, Profil Langganan, onboarding end | existing | `banner`, `profile`, `onboarding` | |

The Pro screen (`apps/native/app/founder.tsx`): two plan rows (yearly pre-selected with the saving as a percentage worked out from the stores' own amounts, plus the per-month price where the currency is known), a benefit list led by the feature the person came for, the charge line with price, period, auto-renew and where to cancel above a bottom-pinned buy button, "Pulihkan pembelian" and one dismiss ("Nanti saja") under it, terms and privacy links. No countdown, no fake scarcity, no social proof: no real figure exists to show.

## Owner-only steps still open

1. **Deploy `apps/server`** so `profile.scanAllowance` exists. Until then the scan pill simply does not appear (the app hides it on an error). Nothing else needs the server.
2. **One Play test purchase** after the next Play install: sign in with a Gmail that is a license tester (Play Console, Settings, License testing) and is in `GOOGLE_PLAY_TEST_EMAILS`, buy Pro monthly from the Play build, then check `select order_id, status, amount_idr, months from payment where order_id like 'google:%'` and that the account shows Pro. This is the only unverified link of the Play flow.
3. **Production review of 1472513** (Play) and **App Store 1.0.0 with its two subscriptions** (Apple) have to finish before the public can buy. Neither can be sped up from here.
4. **OTA of the new JS** to the Play build when you are ready (`scripts/ota.sh`; the runtime fingerprints are unchanged: android `13476485deea605975dededc1e3e6567ce860f68`, ios `6d47a687e2b2a3efed6a0d5191c23cb78f40e39c`). Not published.
5. Optional: buy once through Polar from a non-Indonesian IP to close the Polar go-live checklist (nothing sold through Polar so far).
