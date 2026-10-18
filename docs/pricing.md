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

Store prices checked 2026-10-18 (read-only):

| Store | Product | Monthly | Yearly |
| --- | --- | --- | --- |
| App Store Connect (IDN) | auto-renewable `com.joyodigitama.joyorogo.founder.monthly` / `.yearly` | Rp29.000 | **Rp199.000** |
| Google Play | subscription `pro`, base plans `monthly` / `yearly` (ID region) | Rp29.000 | **Rp199.000** |

The current step (buyers 11-110) matches both stores. The server accepts only the two auto-renewable Apple products (`DEFAULT_APPLE_SUB_*_PRODUCT_ID` in `packages/api/src/lib/apple.ts`).

Legacy non-renewing IAPs (removed 2026-10-18): `.founder.1y` was deleted in App Store Connect (it was never submitted). `.founder.1m` could not be deleted (`IAP_DELETE_NOT_ALLOWED`, state READY_TO_SUBMIT); it is cleared for sale in every territory (availability: no territories, not in new territories) and stays at Rp29.000. Neither is referenced by the app or the server. Four zero-revenue sandbox `apple:` payments from earlier tests remain in D1 as history.

## TestFlight purchases (Sandbox, Rp0)

A purchase in a TestFlight build runs in Apple's Sandbox and charges nothing. The server grants a Sandbox buyer who is not in `APPLE_SANDBOX_EMAILS` 24 h of Pro at Rp0 (`apple:<txn>` payment row, amount 0), so testers may think they paid.

- **In the app (iOS, TestFlight installs only):** the paywall shows a neutral notice before the buy button, and after a Sandbox grant an alert repeats it. No link, no mention of the web (App Store 3.1.1/3.1.3). Detection is JS only, so it ships OTA: `apps/native/src/lib/testflight.ts` checks for `StoreKit/sandboxReceipt` in the app bundle; the post-purchase alert follows the server's `sandbox: true` in the `/api/billing/apple` answer (Sandbox transaction credited at Rp0). Strings: `billing.testflight.*`.
- **By email:** one mail per user (`email_log` kind `testflight_notice`, ref = user id), from `dzulfikar@joyorogo.com` with the broadcast unsubscribe footer (opt-outs apply), id or en by the user's profile locale. It says the purchase was Apple's simulation, no charge, Pro 24 h, and that joyorogo.com/harga (QRIS/VA) subscribes for real, working on iPhone too. Code: `apps/server/src/testflight-notice.ts`. Sent right after the grant (purchase route and App Store notifications) and by the `*/5` cron sweep, which also covers buyers from before the mail existed and failed sends (20 per tick, stops at the first failure). Never sent to `review@`/`qa@`, `ADMIN_EMAILS`, `APPLE_SANDBOX_EMAILS` or unverified emails.
- **Admin:** a Rp0 `apple:` order shows the method "TestFlight (uji)". Revenue sums, the paid-order counts and the daily paid series count only `amount_idr > 0`.

**Switch it off when App Store 1.0 is live:** the mail is gated by the server var `TESTFLIGHT_PURCHASE_EMAIL`. Set it to anything but `on` (e.g. `off`) in `apps/server/wrangler.jsonc` `vars`, then `cd apps/server && CLOUDFLARE_ACCOUNT_ID=3268f27664d77716b648b00c8850469e bunx wrangler deploy`. That stops both the after-grant mail and the sweep. The in-app notice needs no switch: it only shows in TestFlight installs.

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
