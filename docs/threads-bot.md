# Threads mention bot

Someone tags the brand Threads account (`@joyorogo_com`) on a food photo, or replies "@joyorogo_com" under one, and the account
replies with a calorie estimate. The estimate is the same photo scan the app uses, run server-side on the image held in
memory. **No photo is ever stored** (no R2, no dataset); the D1 row keeps only the media id, the author's username, the
dish names, the kcal range, status and times.

Status: code merged, **off by default** (`THREADS_BOT_MODE=off`). Nothing has run against the real Threads API yet: the
brand account and Meta app did not exist when this was written. Every Threads call is covered by tests against a stubbed
Graph API (`packages/api/src/lib/threads-bot/fixtures.ts`); the first live run is the real check. The things to watch on
that run are listed under [First live run](#first-live-run).

## How it works

```
Meta webhook (mentions)  ─┐
                          ├─> processMention ─> filters ─> reserve slot (caps) ─> fetch image into memory ─> scan ─> reply text
cron poll, every 5 min   ─┘     (idempotent                                                                         │
  GET /{user-id}/mentions       by media id)                                               review: queued for admin ◄─┤
                                                                                           auto:   published at once ◄┘
```

| Piece | Where |
| --- | --- |
| Webhook (GET challenge, POST + `X-Hub-Signature-256`), OAuth redirect, deauthorize/delete callbacks, admin API, cron tick | `apps/server/src/threads-bot.ts` |
| Graph client (OAuth, refresh, mentions edge, post read, reply publish, image fetch) | `packages/api/src/lib/threads-bot/graph.ts` |
| Pipeline: filters, scan, draft, approve, poll, sweep | `packages/api/src/lib/threads-bot/pipeline.ts` |
| Reply text and kcal range | `packages/api/src/lib/threads-bot/reply.ts` |
| Caps, slots, queue queries | `packages/api/src/lib/threads-bot/store.ts` |
| Token storage and auto-refresh | `packages/api/src/lib/threads-bot/token.ts` |
| Tables `threads_account`, `threads_mention` (migration `0068_threads_bot`) | `packages/db/src/schema/threads.ts` |
| Admin page (Threads tab) | `apps/admin/src/sections/ThreadsBot.tsx` |

### Ingest

- **Webhook.** `POST https://api.joyorogo.com/api/threads/webhook`. The body is verified with `X-Hub-Signature-256`
  (HMAC-SHA256 of the raw body, constant-time compare) before anything is parsed; a bad or missing signature is 401. The
  `GET` with `hub.mode=subscribe` echoes `hub.challenge` only when `hub.verify_token` equals `THREADS_WEBHOOK_VERIFY_TOKEN`.
  The handler answers 200 at once and does the work in `waitUntil`. Both payload shapes in Meta's docs are read
  (`{target_id, values:{field,value}}` and `{entry:[{changes:[{field,value}]}]}`); only the `mentions` field is used.
- **Cron poll.** Every 5 minutes (the existing `*/5 * * * *` trigger) `GET /{user-id}/mentions?since=<cursor>` is read
  (up to 3 pages of 50). The cursor is the newest mention seen (`threads_account.mentions_since`); the first poll looks
  back 1 hour, never more than 24 hours. Each tick answers at most 8 mentions; the rest are recorded as `received` and
  finished by the sweep on the next ticks.
- **Idempotency.** `threads_mention.media_id` (the id of the post that tagged us) is the primary key and the row is
  inserted `ON CONFLICT DO NOTHING` before any work. A webhook retry, the poll seeing the same mention, or both at once
  all collapse into one row and one scan. A Graph failure before the model call leaves the row `received`; the sweep
  retries it up to 3 times (5 minutes apart), then marks it `failed`. Anything undecided after 24 hours is `skipped: stale`.

### Filters (all before any model call)

In this order. A mention that stops at one is stored as `skipped` with the reason, never scanned.

1. `THREADS_BOT_MODE=off`: nothing at all (webhook acknowledged with 200, poll and sweep return, approve refused).
2. `stale`: the post is older than 24 hours.
3. `own_post`: the author is the brand account.
4. `own_thread`: the mention sits in a thread rooted at our post, or replies to one of our posts (this also stops the loop
   "user replies to our bot reply and tags us again").
5. `no_image`: neither the mention nor the post it replies to has an IMAGE (or a CAROUSEL_ALBUM with an IMAGE child; the
   first image child is scanned). Text, video, audio and reposts are ignored. A text reply under someone's food photo
   uses that photo.
6. `duplicate_photo`: another mention already got (or is getting) an answer for the same photo, so five people tagging
   us under one post cost one scan.
7. `user_cap` / `global_cap`: see below.

### Caps

Counted per **WIB day** (the day admin reports use) from `threads_mention.scanned_at`, so they are the same number the
admin page shows. The slot is taken with one `UPDATE ... WHERE (count < cap)` statement **before** the model is called, so
concurrent mentions cannot all pass a stale count (tests fire 10 and 20 at once and see exactly the cap reach the model).

| Var | Default | Meaning |
| --- | --- | --- |
| `THREADS_BOT_USER_DAILY_CAP` | `3` | Scans per Threads username per day. `0` = nobody is answered. |
| `THREADS_BOT_DAILY_CAP` | `200` | Scans per day over everyone. `0` = nobody is answered. |

A scan that reaches the model costs a slot even when the photo was not food. A failed image fetch gives the slot back.
Every scan also writes an `ai_usage` row (`scan_type = 'threads'`, no user) so the cost shows up beside the app's.

### Scan

`analyzeFoodPhoto` (the function behind the app's photo scan: same prompt, same calibration of the items, same food gate
`not_food`), with the production model `AI_VISION_MODEL`. Without a signed-in person there is nothing personal to add: no
dishware, correction memory, scale readout or usual portions. The image is fetched from a `cdninstagram.com` / `fbcdn.net` /
`threads.*` / `instagram.com` HTTPS URL (anything else is refused), at most 8 MB, and dropped when the scan returns.

### Reply

Indonesian, at most 500 characters (the Threads limit; the formatter folds the smallest dishes into "+ N lainnya" when a
plate is long, and the total still counts them):

```
Perkiraan kalori dari fotomu:
• Nasi goreng: 400–600 kcal
• Telur mata sapi: 70–110 kcal

Total: 470–710 kcal (±20%)

Perkiraan AI, bukan saran medis. Catat makananmu lebih mudah di JoyoRogo: https://joyorogo.com/?utm_source=threads&utm_medium=reply&utm_campaign=mention-bot
```

- **Range.** Each dish and the total are `kcal × (1 ± band)`, rounded to 10 kcal. There is no per-scan error band in the app
  (`lib/calibration.ts` is a per-person energy shift, not a scan band), so the band is `THREADS_BOT_KCAL_BAND`, default
  `0.2` (±20%), clamped to 0.05 to 0.5. Replace it with a measured figure when the accuracy report has one.
- Dish names are cleaned before they are published: one line, no `@`, `#` or links, at most 40 characters.
- It never says anything about a body, weight or health.
- **Not food** (`not_food` from the gate): **no reply**, recorded as `skipped / not_food`. A bot that answers every
  tagged selfie or screenshot is spam; a silent skip costs the person nothing.
- **Food but unclear** (`unclear`, `too_many`, or the scan's average confidence under 0.4): one short polite reply with no
  numbers ("Fotonya belum cukup jelas ... Coba foto dari atas dengan cahaya terang, lalu tag kami lagi ya"). In review
  mode it is a draft like any other, so you can drop it.
- Model timeout or failure: `failed`, nothing sent.

### Modes (`THREADS_BOT_MODE`)

| Value | Behaviour |
| --- | --- |
| `off` (default, or anything else) | Kill switch. No ingest, no scan, no publish; the webhook still answers 200 so Meta does not retry; approving a draft is refused. The token is still refreshed. |
| `review` | Mentions are scanned and the reply is queued as a draft. Nothing is posted until an admin approves it. |
| `auto` | The reply is posted at once. If posting fails the draft falls back to the review queue with the error, never lost. |

Changing the mode is a var change (`wrangler.jsonc` `vars`, or the dashboard) and a deploy; it takes effect on the next
request. Drafts left in the queue stay approvable after switching `auto` back to `review`, not while `off`.

### Admin page

`admin.joyorogo.com/#threads` (behind `ADMIN_EMAILS`):

- **Header:** mode, today's scans / sent / waiting, caps, token state (active, expiring, expired) and expiry, last poll
  and last error, the webhook URL and OAuth redirect URI to paste into Meta, **Hubungkan Threads** (OAuth) and **Baca
  mention sekarang** (runs the cron tick on demand).
- **Antrian:** every draft with the photo (read live from Threads when the page loads, never stored), a link to the post,
  dish names with ranges, an editable text with a 500-character counter, and **Tolak** / **Simpan edit** /
  **Setujui & kirim**. Approving posts the (edited) text; the row moves atomically `pending_review -> publishing -> sent`,
  so a double click or two admins post once. A failed post goes back to the queue with Meta's error.
- **Terkirim:** the log of every reply sent, with the exact text, auto or approved-by, and time.
- **Dilewati:** skipped, rejected and failed mentions with the reason.

### Token

One long-lived Threads token (60 days) in `threads_account` (row `id = 1`). Either:

- **Connect** in the admin page (OAuth, recommended), or
- seed the secret `THREADS_ACCESS_TOKEN` with a long-lived token. It is copied into D1 on first use and refreshed at
  once; after that the **D1 row wins**: changing the secret later does nothing (use Connect to replace the token).

`ensureAccount` (pattern: intip `ensureToken`) runs every cron tick, also when the bot is off: inside the last 7 days it
calls `refresh_access_token` and stores the new 60 days. A failed refresh keeps the old token, marks it `expiring`, records
the error and is retried at most every 6 hours. The admin header shows the state. Meta refuses a refresh of a token younger
than 24 hours; the failure is harmless and retried.

## Setup (what the owner does)

1. **Meta app.** developers.facebook.com > create an app, add the use case **Access the Threads API**.
2. **Permissions** (Use cases > Customize > Permissions): `threads_basic`, `threads_manage_mentions`,
   `threads_read_replies`, `threads_manage_replies`, `threads_content_publish`. Meta's "Create Replies" page lists
   `threads_content_publish` and `threads_manage_replies` as both required to post a reply with `reply_to_id`, and says the
   app needs `threads_manage_mentions` (or keyword search) to reply under posts it does not own.
3. **Use case Settings:** copy the **Threads app ID** and **Threads app secret** (not the Meta app's own ID and secret).
   Add:
   - Client OAuth redirect URI: `https://api.joyorogo.com/api/threads/callback`
   - Deauthorize callback URL: `https://api.joyorogo.com/api/threads/deauthorize`
   - Data Deletion Requests URL: `https://api.joyorogo.com/api/threads/delete`
   - Privacy Policy URL: `https://joyorogo.com/privasi` (has a "Bot kalori di Threads" section)
4. **Roles:** App roles > add the brand account as a **Threads Tester** and accept the invite in the Threads app
   (Settings > Account > Website permissions > Invites). Until Advanced Access is approved the API only returns mentions
   made by testers and only lets you post as testers.
5. **Webhooks:** Use cases > Customize > **Add** the sub-use case "Get real-time notifications with Threads Webhooks".
   Webhooks > subscribe the **`mentions`** field (topic Interaction). Callback URL `https://api.joyorogo.com/api/threads/webhook`,
   Verify token = the value of `THREADS_WEBHOOK_VERIFY_TOKEN`. Meta only delivers webhooks to a **published (Live)** app and,
   for other people's mentions, needs Advanced Access to `threads_manage_mentions` (see App Review). The cron poll covers
   the gap, so the bot works without the webhook, 5 minutes late.
6. **Secrets** (`wrangler secret put`, in `apps/server`):

   | Secret | Value |
   | --- | --- |
   | `THREADS_APP_ID` | Threads app ID |
   | `THREADS_APP_SECRET` | Threads app secret (OAuth code exchange, signature check) |
   | `THREADS_WEBHOOK_VERIFY_TOKEN` | any random string; the same one goes into the Meta webhook form |
   | `THREADS_ACCESS_TOKEN` | optional: a long-lived token to seed instead of using Connect |
   | `THREADS_WEBHOOK_SECRET` | optional, only if deliveries come back 401: the Meta app secret (Settings > Basic), accepted as a second signing key |

   Vars (`apps/server/wrangler.jsonc`, already present): `THREADS_BOT_MODE` (`off`), `THREADS_BOT_USER_DAILY_CAP` (`3`),
   `THREADS_BOT_DAILY_CAP` (`200`); optional `THREADS_BOT_KCAL_BAND` (`0.2`).
7. **Connect:** deploy, open `admin.joyorogo.com/#threads`, **Hubungkan Threads**, log in as the brand account and allow.
8. **Try it in review mode:** set `THREADS_BOT_MODE=review`, tag the account on a food photo from a tester account, wait
   for the webhook (or press **Baca mention sekarang**), approve the draft, check the reply on Threads.
9. Go `auto` only after a few dozen reviewed drafts look right.

Deploying the migration: `packages/db/src/migrations/0068_threads_bot.sql` (also in `migrations-deploy/`) creates the two
tables; the usual D1 migration step applies it.

## App Review notes

- Webhooks and other people's mentions need **Advanced Access** to `threads_basic`, `threads_manage_mentions`,
  `threads_read_replies`, `threads_manage_replies` and `threads_content_publish`, which means App Review and, for a
  non-tech-provider app, a Live app and a verified business. Before that the bot only answers testers.
- Screencast for each permission: tag the account on a food photo; the draft appears in the admin queue; approve; the reply
  appears under the post. Say plainly that the bot only replies to people who tag it, never DMs, never reads other
  content, never stores the photo.
- Privacy policy: `joyorogo.com/privasi` section "Bot kalori di Threads" says what is read and kept. The data deletion
  callback forgets the brand token (the only account that authorizes the app); a person who wants their stored username
  and dish rows deleted emails the contact on that page (delete from `threads_mention` where `author_username`).
- Rate limits: Meta allows 250 posts and 1000 replies per 24 hours per profile; the global cap (200) stays under both.

## Data kept

| Table | Holds |
| --- | --- |
| `threads_account` | the brand token, its expiry and refresh state, the brand user id and username, the mentions cursor, last error |
| `threads_mention` | media id, author username, id of the post with the photo, status, skip reason, dish names and kcal range (JSON), reply text and its media id, who approved, timestamps |

Not kept: the photo (memory only), its URL, the text of the mention, the author's profile. The admin photo is requested
from Threads each time the queue loads.

## First live run

Written from Meta's docs, never run against Meta. Check these first and fix what differs:

1. **Webhook signature key.** The code accepts the Threads app secret, and `THREADS_WEBHOOK_SECRET` as a second key. If
   Meta's test delivery gets 401, set the Meta app secret there.
2. **Webhook payload.** The mention `value` is used as the post; missing fields (`media_type`, `media_url`, `children`,
   reply links) are read from `GET /{media-id}`. Compare one real delivery with `parseMentionEvents`.
3. **Carousel children** are read by id (`GET /{child-id}?fields=id,media_type,media_url`).
4. **Host.** Graph calls go to `graph.threads.net` (what atur and intip use in production); Meta's current docs show
   `graph.threads.com`. Change `GRAPH` in `graph.ts` if one stops answering.
5. **Publish timing.** Meta suggests ~30 s between creating a container and publishing it; a text container is normally
   ready at once, so the code publishes immediately and retries once after 4 s. If replies fail with a "not ready" error,
   lengthen `PUBLISH_RETRY_MS`.
6. **`since` on the mentions edge** is unix seconds (docs: at least 1688540400).

## Runbook

- **Stop everything:** `THREADS_BOT_MODE=off` and deploy. Or revoke the app in Threads (Settings > Account > Website
  permissions); the deauthorize callback clears the token.
- **Bot does nothing:** admin header: mode `off`? token state? `Error terakhir`? caps reached (today's scans)? Then
  `wrangler tail` for `[threads-bot]` lines.
- **Token expired:** press **Hubungkan ulang** (or put a new `THREADS_ACCESS_TOKEN` and delete the `threads_account` row).
- **A wrong reply went out:** delete it in the Threads app; tighten `THREADS_BOT_MODE` to `review`; add the case to the
  eval set.
- **Someone asks for deletion:** `DELETE FROM threads_mention WHERE author_username = '<username>'`.

## Tests

`packages/api/src/lib/threads-bot/*.test.ts` (signature, challenge, payload shapes, reply formatting and length, filters,
caps incl. concurrent bursts, idempotency, kill switch, not-food and unclear paths, token refresh, queue approve / edit /
reject with Threads HTTP stubbed) and `apps/server/src/threads-bot.test.ts` (the HTTP routes end to end, admin queue, OAuth
callback, deauthorize/delete, cron tick).
