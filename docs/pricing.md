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
| App Store Connect (IDN) | legacy non-renewing `.founder.1m` / `.founder.1y` (never submitted, not sold by the app) | Rp29.000 | **Rp199.000** (`.1y`, fixed from Rp290.000 on 2026-10-18) |

The current step (buyers 11-110) matches all store products. The legacy non-renewing products are not referenced by the native app (it only sells `.founder.monthly` / `.founder.yearly`) and are not submitted, so no customer can buy them. The server still accepts them so sandbox/TestFlight receipts and notifications from earlier tests (4 zero-revenue `apple:` payments) stay valid; their ASC prices now match the live step, so they can never sell at a wrong price. They must be repriced alongside the live products at each ladder step.

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
