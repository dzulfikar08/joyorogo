# Joyo Pro: one subscription for JoyoRogo, JoyoFit and JoyoArto

Joyo Pro is the user-facing name of the one paid tier (code, store products and the ledger still say Pro, Founder,
`founder_until`; store product ids are unchanged). One subscription per JoyoRogo account covers:

| App | How it knows |
| --- | --- |
| JoyoRogo | its own `user.tier` / `user.founder_until` (`premiumUnlocked`, `packages/api/src/lib/readiness-food.ts`) |
| JoyoFit | signs in to the same JoyoRogo account and reads the same rows |
| JoyoArto (family finance ledger, `app.arto.joyorogo.com`, repo `dzulfikar08/joyoarto`) | asks JoyoRogo, below |

JoyoRogo is the only billing authority. JoyoArto sells nothing itself: its Upgrade links to JoyoRogo's checkout.

## Status endpoint for JoyoArto

JoyoArto has its own accounts in its own D1, but signs in with the same Google OAuth client ("JoyoRogo Web", GCP
project `joyorogo`), so a person's Google account id (`sub`) is the same in both apps.

```
POST https://api.joyorogo.com/api/internal/joyo-pro/status
x-joyo-internal-key: <JOYO_INTERNAL_KEY>
content-type: application/json

{ "googleSub": "1098...", "email": "person@gmail.com" }    // googleSub optional (string or null), email required

200 { "pro": true, "until": "2027-11-04T03:00:00.000Z", "plan": "yearly", "source": "polar" }
```

| Field | Values |
| --- | --- |
| `pro` | the same rule JoyoRogo applies to itself: a manual comp (`tier = 'founder'`), a paid period still running (`founder_until` > now; DOKU, Pakasir, Apple, Google Play and Polar all write it), or a server without a paywall |
| `until` | ISO time the paid period ends; `null` when not Pro, for a comp, or without a paywall |
| `plan` | `"monthly"`, `"yearly"` (from the newest paid ledger row of the period), `"lifetime"` (comp tier), or `null` (not Pro, a period set by hand in the admin, no paywall) |
| `source` | `"doku"`, `"pakasir"`, `"apple"`, `"google_play"`, `"polar"`, `"comp"`, `"no_paywall"`, or `null` when not Pro |

Lookup: the better-auth `account` row with `provider_id = 'google'` and `account_id = googleSub` first, then
`user.email` (lowercased) **only if `email_verified`**. An unknown person and a free account get the same answer
(`{ pro: false, until: null, plan: null, source: null }`).

Errors: `404` while `JOYO_INTERNAL_KEY` is unset (the route does not exist), `401` for a missing or wrong key
(constant-time compare of SHA-256 digests), `400` for a bad body, `429` (`Retry-After: 60`) past 300 calls a minute.
The limit is one bucket for the authenticated caller (`JOYO_INTERNAL_LIMITER`, namespace 1005), not per IP: Workers
calling Workers share Cloudflare's egress addresses, so a per-IP bucket would let any Worker drain JoyoArto's. Wrong keys
are cheap to refuse and never touch the database. The route logs nothing from the body; Hono's request logger prints
method and path only, so emails never reach the logs. Answers carry `Cache-Control: no-store`; JoyoArto may cache them
itself for a short time.

Code: `apps/server/src/joyo-pro.ts` (route), `packages/api/src/lib/joyo-pro.ts` (lookup and rule), tests in
`apps/server/src/joyo-pro.test.ts`.

### Deploy

1. `openssl rand -hex 32`, then set it on both Workers:
   `cd apps/server && bunx wrangler secret put JOYO_INTERNAL_KEY` here, and the same value as JoyoArto's secret.
2. Deploy the server (the `JOYO_INTERNAL_LIMITER` binding and migration `0075` ship with it).
3. Check: `curl -s -X POST https://api.joyorogo.com/api/internal/joyo-pro/status -H 'content-type: application/json' -d '{"email":"x@example.com"}'` answers 401 (404 means the secret is not set).

## Buying from JoyoArto

JoyoArto's Upgrade opens `https://app.joyorogo.com/pro?from=joyoarto`.

- Signed out: `/login?redirect=/pro?from=joyoarto` (the `_auth` guard now keeps the query). The login page says to use
  the same Google account as in JoyoArto; a new Google account gets a JoyoRogo account on the spot and lands back on
  `/pro` (only Beranda sends new accounts to onboarding, so the checkout is not interrupted).
- `/pro?from=joyoarto`: subhead "Joyo Pro also unlocks JoyoArto", the signed-in email with a reminder to use the same
  Google account, and "Back to JoyoArto" instead of "Not now". An account that is already Pro gets a "You already have
  Joyo Pro" card with the link back.
- The checkout sends `source: "joyoarto"`. DOKU orders store it in `payment.source` (migration 0075) and come back to
  `/pembayaran?order=…&from=joyoarto`; Polar checkouts carry it in the Polar metadata and come back to
  `/pro?polar=success&from=joyoarto`. Once paid, both pages offer "Back to JoyoArto".
- The return link is the constant `https://app.arto.joyorogo.com/settings` (`apps/web/src/lib/joyoarto.ts`). `from` is
  an allowlist (`joyoarto` or nothing) on the server and the web, never a URL, so it is not an open redirect.
