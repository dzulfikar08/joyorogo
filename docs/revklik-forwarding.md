# RevKlik revenue forwarding

Every real payment in the `payment` ledger is forwarded to [RevKlik](https://app.revklik.com) so revenue from all products and rails
(Polar, Apple, Google Play, DOKU, Pakasir) lands in one portfolio view with net-after-fee earnings. Code: `packages/api/src/lib/revklik.ts`
(outbox, event shape, delivery), `apps/server/src/revklik.ts` (Worker wiring).

## Config

| Name | Kind | Meaning |
| --- | --- | --- |
| `REVKLIK_TOKEN` | secret (`wrangler secret put REVKLIK_TOKEN`) | RevKlik site token (`rv_`) or account token (`rvt_`) with scope `events:write`. |
| `REVKLIK_SITE_ID` | var (wrangler.jsonc) | RevKlik site id; JoyoRogo is `88069ee9-6eac-4dc9-a23b-f5757a4b948e`. |
| `REVKLIK_API_URL` | var | Default `https://app.revklik.com`. |

Forwarding is off, and every call a no-op, until the token and the site id are both set.

## What is sent

`POST {REVKLIK_API_URL}/api/v1/events/server`, one event per ledger fact, `product: "joyorogo"`:

- **Sale** (`name` `purchase` for a buyer's first real payment, `renewal` after): sent when an order flips to `paid` (DOKU/Pakasir
  `activateOrder`, Apple redeem + notifications, Google Play verify + RTDN, Polar `order.paid`). `external_id` = `payment.order_id`,
  `occurred_at` = `paid_at`.
- **Refund** (`name` `refund`): sent when a paid row is flipped to `failed` by an Apple REFUND/REVOKE, a Google voided/revoked order or a
  Polar `order.refunded`. `external_id` = `<order_id>:refund`, `revenue` = the sale's amount, negative, `occurred_at` = when the refund
  was processed. DOKU and Pakasir have no reversal path, so they never refund.
- **Skipped**: `is_test = 1` rows (Apple Sandbox, Play license testers, Polar sandbox), rows that charged nothing (sandbox trials),
  and orders that were never paid. `is_test` null (old rows) counts as real, like the admin revenue totals.
- `rail`: `apple`, `google_play`, `polar`, `doku`, `pakasir`. The ledger does not store DOKU vs Pakasir (both are `JRG-...` ids):
  live orders pass the gateway; backfilled ones use the payment link (`pakasir` in the URL = Pakasir, else DOKU).
- **Amount and currency**: Polar sends what the customer was charged in their own currency (`charged_currency`, `charged_amount_minor`
  converted to major units) **before tax**: that is the figure `amount_idr` is converted from, and Polar remits the tax as merchant of
  record, so it is not revenue. The tax is in `props.tax_minor`. Apple, Google Play, DOKU and Pakasir send `amount_idr` in `IDR`; the
  ledger stores no store price in another currency.
- `props`: `plan` (`monthly` / `yearly` / `proration`), `months`, `environment`. No email, name or user id.

## Delivery

Events are written to `revklik_outbox` (migration `0070_revklik_outbox`), keyed by `external_id`, so queueing twice is a no-op.
Billing endpoints (`POST /api/billing/*`) flush the outbox with `waitUntil` after answering; the 5-minute cron first queues any
paid/refunded row of the last 3 days the outbox misses (a Worker dying between the ledger flip and the enqueue), then flushes.

Retry: 2xx = delivered. 4xx (except 408/429) parks the row at once. 5xx, 408, 429 and network errors retry after 0, 5, 15, 45,
120, 360 minutes (the cron is the clock), and park after 6 attempts. A parked row keeps its `last_error`. To resend one, set its
`attempts` to 0 in D1.

## Backfill

`POST /api/admin/revklik/backfill` (same `ADMIN_EMAILS` session as the rest of `/api/admin`) queues every historical real paid order and
every refunded one (refund dated at the sale's `paid_at`, the ledger keeps no refund time), then delivers up to five batches of 40.
The answer is `{ scanned, queued, skipped, enabled, flush: { sent, failed, parked } }`. Re-running is safe: rows already queued or
delivered are skipped by `external_id`, and RevKlik dedupes on it too. Run it again to deliver a larger queue, or let the cron do it.
With the token unset it still queues, so setting the token later and waiting for the cron delivers the history.

## Attribution and the client conversion

The server is the only source of revenue. The web's `founder_purchase` conversion (`/pembayaran`) keeps its name and `order` prop for
funnels but carries no revenue, otherwise the sale would be counted twice.

To keep attribution, the web sends the tag's visitor and session ids (`_kp_vid` in localStorage, `_kp_sid` in sessionStorage) as
`revklikVisitorId` / `revklikSessionId` in the body of `POST /api/billing/checkout` (DOKU, Pakasir) and `POST /api/billing/polar/checkout`.
The server keeps them only when they match `[A-Za-z0-9_-]{8,64}` and stores them on the payment row (`revklik_visitor_id`,
`revklik_session_id`, migration `0071`). For Polar, which creates the ledger row on `order.paid`, they travel as checkout metadata
(`revklik_vid`, `revklik_sid`) and are read back from the first order (`subscription_create`) only. The sale event then carries
`visitor_id` / `session_id`, so RevKlik inherits that visitor's utm, referrer and geo. Refunds, renewals and native Apple/Google
purchases carry none.
