# Pricing and the founder ladder

Source of truth: `FOUNDER_PRICE_LADDER` in `apps/server/wrangler.jsonc`, parsed by `packages/api/src/lib/tiers.ts`.

```
10:15000/149000,110:29000/199000,:49000/349000
 ^  ^      ^
 |  |      yearly price while this step is current (optional)
 |  monthly price
 buyers covered by the step (empty = open-ended last step)
```

| Step | Buyers | Monthly | Yearly |
| --- | --- | --- | --- |
| 1 | 1-10 | Rp15.000 | Rp149.000 |
| 2 | 11-110 | Rp29.000 | Rp199.000 |
| 3 | 111+ | Rp49.000 | Rp349.000 |

Buyers = distinct users with at least one paid, non-zero order (all gateways and stores). Without `/yearly` a step's yearly is `FOUNDER_YEARLY_PRICE_IDR` (capped at 10x monthly) or 10x monthly. `FOUNDER_YEARLY_PRICE_IDR` (199000 in production) is also the fallback for Apple/Play transactions not billed in IDR. A malformed ladder throws at startup of every billing route.

Grandfathering: anyone who paid before keeps their lowest paid monthly-equivalent (yearly orders count as amount/10). Yearly checkout = min(step yearly, locked monthly x 10); monthly = locked monthly.

## What follows the step automatically

Web (DOKU/Pakasir) checkout amounts, `/api/config`, `/harga`, the landing page, the paywall and `/pro`. All read `founderYearlyPriceIdr` from `/api/config`, which is the current step's yearly.

## What does NOT follow: store prices

Apple and Google Play charge a fixed price per product. The server records whatever the store reports (`priceIdr` of the receipt), so ledger revenue is always right, but store buyers pay the store price, not the step price. Store prices are changed by hand.

Store prices checked 2026-10-18 (read back after the change):

| Store | Product | Monthly | Yearly |
| --- | --- | --- | --- |
| App Store Connect (IDN) | auto-renewable `com.joyodigitama.joyorogo.founder.monthly` / `.yearly` | Rp29.000 | **Rp199.000** |
| Google Play | subscription `pro`, base plans `monthly` / `yearly` (ID region, Indonesia price shown; other regions below) | Rp29.000 | **Rp199.000** |

The current step (buyers 11-110) matches both stores in Indonesia. The server accepts only the two auto-renewable Apple products (`DEFAULT_APPLE_SUB_*_PRODUCT_ID` in `packages/api/src/lib/apple.ts`).

Outside Indonesia the price follows the web USD price (US$9.99/month, US$59.99/year), not the founder ladder. Apple, changed 2026-10-18 with `preserveCurrentPrice: true` (existing subscribers keep their old price): USA price point 9.99 / 59.99, every other territory on Apple's equalized price point of it, except Indonesia (unchanged) and 53 low/lower-middle-income territories (World Bank LIC/LMC) held at the old price pending an owner decision. Full territory list: `store-prices-plan.md` (outside the repo).

| Territory (Apple) | Monthly before | Monthly now | Yearly before | Yearly now |
| --- | --- | --- | --- | --- |
| USA | $2.99 | $9.99 | $19.99 | $59.99 |
| GBR | £2.99 | £9.99 | £19.99 | £59.99 |
| DEU (EUR) | €2.99 | €9.99 | €22.99 | €69.99 |
| AUS | A$4.99 | A$14.99 | A$29.99 | A$99.99 |
| SGP | S$3.98 | S$14.98 | S$29.98 | S$89.98 |
| MYS | RM14.90 | RM49.90 | RM99.90 | RM299.90 |
| IND (held) | ₹299 | ₹299 | ₹1,999 | ₹1,999 |
| IDN | Rp29.000 | Rp29.000 | Rp199.000 | Rp199.000 |

Google Play, changed 2026-10-18 in Play Console (new subscribers only, no "apply to existing" option; Indonesia untouched): `pro` base plans `monthly` (US$9.99) and `yearly` (US$59.99) now carry 128 regions each (Indonesia plus 127), priced by Play's "Set prices" conversion from USD, and none of the 53 excluded low/lower-middle-income territories is present. Before: ID only (Rp29.000 / Rp199.000). "New countries / regions" was left off. Read back with `play.call('GET', play.B + 'com.joyodigitama.joyorogo/subscriptions')`, `basePlans[].regionalConfigs`:

| Region (Play) | Monthly now | Yearly now |
| --- | --- | --- |
| US | US$9.99 | US$59.99 |
| GB | £8.99 | £53.99 |
| DE (EUR) | €10.99 | €64.99 |
| AU | A$15.99 | A$94.99 |
| SG | S$13.98 | S$83.98 |
| MY | RM43.99 | RM264.99 |
| ID | Rp29.000 | Rp199.000 |

Closed testing track (`alpha`) countries went from Indonesia only to 131 (all Play-listed countries except the excluded ones; "Rest of World" left off), sent for review in Publishing overview as the only pending change. Of the 53 excluded territories, 46 are in Play's track list and were left unticked; AFG, BTN, MDG, MRT, MWI, STP and SWZ are not offered there. Production was not touched.

Legacy non-renewing IAPs (removed 2026-10-18): `.founder.1y` was deleted in App Store Connect (it was never submitted). `.founder.1m` could not be deleted (`IAP_DELETE_NOT_ALLOWED`, state READY_TO_SUBMIT); it is cleared for sale in every territory (availability: no territories, not in new territories) and stays at Rp29.000. Neither is referenced by the app or the server. Four zero-revenue sandbox `apple:` payments from earlier tests remain in D1 as history.

## Ringgit and Singapore dollar prices (web follows the stores)

Store prices read back 2026-10-21 (read only: Play `subscriptions` API, App Store Connect `/v1/subscriptions/{id}/prices`; the Apple rows are the current price, the earlier price is only kept for subscribers who had it):

| Store | MYR monthly | MYR yearly | SGD monthly | SGD yearly |
| --- | --- | --- | --- | --- |
| Google Play (`pro`, base plans `monthly` / `yearly`) | RM43.99 | RM264.99 | S$13.98 | S$83.98 |
| App Store (`founder.monthly` / `founder.yearly`, MYS and SGP) | RM49.90 | RM299.90 | S$14.98 | S$89.98 |

The two stores do not agree (Apple's equalised price points are higher than Play's conversion). The web advertises the lower, the Play prices, so a buyer never finds the web dearer than a store: `POLAR_PRICE_MONTHLY_MYR_SEN=4399`, `POLAR_PRICE_YEARLY_MYR_SEN=26499`, `POLAR_PRICE_MONTHLY_SGD_CENTS=1398`, `POLAR_PRICE_YEARLY_SGD_CENTS=8398` (`apps/server/wrangler.jsonc`). Like the USD pair they only drive what `/api/config` shows (`myr`, `sgd`; a pair is shown only when both of it are set). What is charged is the price in that currency on the Polar product, so create the same four prices on the two Polar products (monthly `RM43.99`/`S$13.98`, yearly `RM264.99`/`S$83.98`, tax-inclusive) before deploying the vars; change a store price and these vars and the Polar price together. `/api/config` also carries `region` (`ID`, `MY` or `SG`, from the UI language and `CF-IPCountry`).

## TestFlight purchases (Sandbox, Rp0)

A purchase in a TestFlight build runs in Apple's Sandbox and charges nothing. The server grants a Sandbox buyer who is not in `APPLE_SANDBOX_EMAILS` 24 h of Pro at Rp0 (`apple:<txn>` payment row, amount 0), so testers may think they paid.

- **In the app (iOS):** only a neutral alert after a Sandbox grant ("Ini pembelian uji coba dari Apple (sandbox), jadi tidak ditagih. Pro aktif 24 jam.", strings `billing.sandbox.*`), driven by `sandbox: true` in the `/api/billing/apple` answer (Sandbox transaction credited at Rp0). No link, no mention of the web (App Store 3.1.1/3.1.3), and no "TestFlight" or beta wording (guideline 2.2). There is deliberately no pre-purchase notice: TestFlight and the App Store ship the same binary and App Review also buys in the Sandbox, so nothing can tell a tester from a reviewer before the purchase. The server leaves the flag off for `review@`/`qa@` and every `REVIEW_LOGIN_EMAILS` entry. Ships OTA (JS only).
- **By email:** one mail per user (`email_log` kind `testflight_notice`, ref = user id), from `dzulfikar@joyorogo.com` with the broadcast unsubscribe footer (opt-outs apply), id or en by the user's profile locale. It says the purchase was Apple's simulation, no charge, Pro 24 h, and that joyorogo.com/harga (QRIS/VA) subscribes for real, working on iPhone too. Code: `apps/server/src/testflight-notice.ts`. Sent right after the grant (purchase route and App Store notifications) and by the `*/5` cron sweep, which also covers buyers from before the mail existed and failed sends (20 per tick, stops at the first failure). Never sent to `review@`/`qa@`, `ADMIN_EMAILS`, `APPLE_SANDBOX_EMAILS` or unverified emails.
- **Admin:** a Rp0 `apple:` order shows the method "TestFlight (uji)". Revenue sums, the paid-order counts and the daily paid series count only `amount_idr > 0`.

**Switch it off when App Store 1.0 is live:** the mail is gated by the server var `TESTFLIGHT_PURCHASE_EMAIL`. Set it to anything but `on` (e.g. `off`) in `apps/server/wrangler.jsonc` `vars`, then `cd apps/server && CLOUDFLARE_ACCOUNT_ID=3268f27664d77716b648b00c8850469e bunx wrangler deploy`. That stops both the after-grant mail and the sweep. The in-app alert needs no switch: real App Store purchases are not Sandbox and never raise it.

## Polar (USD, web only)

Polar (polar.sh) is the merchant of record for USD card subscriptions on the web, for buyers outside Indonesia. Polar is the seller, collects and remits VAT/GST/sales tax, mails its own receipt, and handles refunds and chargebacks. Org "Joyo Digitama Solusi" (`b9fe0372-66f4-4590-9d2d-8c8c733ea73f`, production; it also sells Paparan AI). Tax behaviour is inclusive, so the displayed price is the price charged.

| Plan | Polar product | Price |
| --- | --- | --- |
| Monthly | `0eccddaa-1f8d-404c-b68c-7bfc99026f0c` | US$9.99 |
| Yearly | `52630e7f-e269-4998-8064-f1b375a200a8` | US$59.99 |

**Price is config.** `POLAR_PRICE_MONTHLY_USD_CENTS` / `POLAR_PRICE_YEARLY_USD_CENTS` (default 999 / 5999) only drive what `/api/config` shows (`usd`). What is charged is the Polar product price: to change the price create a new price on the Polar product (existing subscribers keep theirs) and change both vars to match, then deploy the server.

**Vars and secrets** (`apps/server/wrangler.jsonc` vars unless marked secret): `POLAR_PRODUCT_MONTHLY_ID`, `POLAR_PRODUCT_YEARLY_ID`, `POLAR_PRICE_*_USD_CENTS`, `POLAR_SERVER` (`sandbox` = sandbox-api.polar.sh, empty = production), secrets `POLAR_ACCESS_TOKEN` (organization access token: `checkouts:write`, `customer_sessions:write`) and `POLAR_WEBHOOK_SECRET`. USD checkout is off until the token, webhook secret and both product ids are set and the paywall is on.

**Webhook:** `https://api.joyorogo.com/api/billing/polar/webhook`, format raw, events `order.paid`, `order.refunded`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.uncanceled`, `subscription.revoked`, `subscription.past_due`. Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`, 5 minute replay window; both the Standard Webhooks key and the older Polar HMAC key are accepted). Wrong signature = 403. Everything else answers 200 (Polar disables an endpoint after 10 failed deliveries): events of other products in the org, unknown accounts and unreadable payloads are logged and acknowledged; only a lost race on `founder_until` answers 409 so Polar retries. Code: `packages/api/src/lib/polar.ts` (client, signature), `polar-billing.ts` (ledger), routes in `apps/server/src/billing.ts`.

**Flow:**

- `POST /api/billing/polar/checkout {plan}` (signed in) creates a Polar checkout with `external_customer_id` = user id and metadata `{app, user_id, plan}`, success URL `/pro?polar=success`, and answers `{url}`. A user with a live Polar subscription gets 409 (manage it instead).
- `POST /api/billing/polar/portal` answers a customer-portal link (cancel, change plan, card, invoices); `GET /api/billing/polar/subscription` feeds the Profile page (state, renewal date, cancel-at-period-end).
- `/api/config` carries `usd: {monthlyCents, yearlyCents, preferred, country} | null`. `preferred` is true when `CF-IPCountry` is known and not `ID`: the web shows USD first on `/harga`, `/pro` and the picker. Indonesian visitors keep QRIS/bank transfer first and can pick USD manually. `paymentMethods` never contains USD, and no native app surface mentions Polar or USD.

**Ledger.** Same `payment` table, one row per paid order, `order_id` = `polar:<polarOrderId>`. `amount_usd_cents` holds the net USD charged (before tax); `amount_idr` holds the IDR equivalent, priced like an Apple transaction not billed in IDR: the plan's IDR price from `FOUNDER_PRICE_IDR` / `FOUNDER_YEARLY_PRICE_IDR` (scaled down when a discount code lowered the USD price, Rp0 for a free order). So Polar buyers take a ladder seat and set a grandfathered IDR price like every other gateway, and revenue sums stay in rupiah. `months` is 1 or 12; a plan-change proration charge (`billing_reason subscription_update`) is recorded with `months` 0 and Rp0 and grants no time.

**Grants.** `order.paid` for one of the two products credits 1 or 12 months on top of the remaining Pro period, in one D1 batch guarded on `founder_until` (same pattern as Apple). Idempotent twice: `polar_event` stores each `webhook-id`, and the `polar:<orderId>` ledger row stops the same order crediting twice under a new delivery id. `order.refunded` (full refund) flips the row to `failed` and takes its months back off `founder_until` (never below now); a refund that arrives before its payment blocks the payment from granting. `subscription.canceled` only turns off auto-renew: Pro stays until the period end. `subscription.revoked` after the period ended changes nothing; an immediate revoke cuts Polar-granted time to now unless the user holds time from another purchase or another live Polar subscription. `polar_subscription` keeps the latest state per subscription (older `modified_at` never overwrites newer). Events of products that are not the two Pro products are ignored.

**Emails.** No JoyoRogo receipt for Polar orders (Polar mails its own); the admin notice shows the USD amount and its IDR ledger value. Admin orders list the method as "Polar (USD)".

**Go-live checklist:** (1) deploy the server with the vars above; (2) create the Polar webhook for the URL above and store its secret as `POLAR_WEBHOOK_SECRET`; (3) store the organization access token as `POLAR_ACCESS_TOKEN`; (4) buy the monthly plan once from a non-Indonesian IP or via the picker, confirm Pro turns on and `/api/billing/polar/subscription` shows it, then refund/cancel it in the Polar dashboard.

## Runbook: buyer count crosses 110 (step 2 to step 3)

Check the count: `/api/config` returns `promo` while on a step with a cap; once `promo` is `null` and `founderPriceIdr` is 49000, step 3 is live. Web prices change by themselves. Then:

1. **Apple** (App Store Connect, app 6823222101, group "JoyoRogo Pro"): set the IDN price of `com.joyodigitama.joyorogo.founder.yearly` to Rp349.000 and `.founder.monthly` to Rp49.000. Choose "Preserve current prices for existing subscribers" so current subscribers renew at the old price (Apple's "Raise price" flow; do not apply to existing without consent). Via API: `POST /v1/subscriptionPrices` with the IDN `subscriptionPricePoint` for 349000 / 49000 and `preserveCurrentPrice: true`. Look up price point ids with `GET /v1/subscriptions/{id}/pricePoints?filter[territory]=IDN`.
2. **Google Play** (Play Console, Monetize > Subscriptions > `pro`): base plan `yearly` price Rp349.000, base plan `monthly` Rp49.000, "Apply to existing subscribers" off (new subscribers only). API: `subscriptions.basePlans.migratePrices` or `subscriptions.patch` with `regionalConfigs[ID].price`; the service account needs the monetization permission (it may lack it, then use the console).
3. Re-read both stores (see commands below) and confirm they show the new prices.
4. Update the table above.

Same procedure at the step 1 to 2 boundary (buyers 10, Rp149k to Rp199k), and in reverse if the ladder is ever lowered.

Also keep `FOUNDER_YEARLY_PRICE_IDR` in `wrangler.jsonc` equal to the current store yearly price: it is the fallback priced into the ledger when a receipt has no IDR price.

## Read store prices

Apple:

```
~/.local/share/joyorogo-ios/venv/bin/python
exec(open('/tmp/ascx.py').read())
c('GET', f'/v1/subscriptionGroups/22482392/subscriptions')   # ids
c('GET', f'/v1/subscriptions/{id}/prices?filter[territory]=IDN&include=subscriptionPricePoint')
```

Play: `play.call('GET', play.B + 'com.joyodigitama.joyorogo/subscriptions')` from `~/.cache/playup/play.py`, read `basePlans[].regionalConfigs[ID].price`.
