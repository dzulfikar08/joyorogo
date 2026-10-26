# Strava in JoyoRogo

JoyoRogo reads the athlete's recent Strava activities (`GET /athlete/activities`) and adds them to the diary as burned
calories (`exercise_log.source = 'strava'`). Profil → Strava has **Sambungkan** (connect), **Sinkron** (import) and
**Putuskan** (disconnect). Code: `packages/api/src/routers/strava.ts` (the oRPC procedures),
`packages/api/src/lib/strava-grant.ts` (tokens, scopes, exchange, refresh, unlink),
`apps/server/src/strava.ts` (the `/internal/joyofit/strava/*` routes), `apps/web/src/components/strava-card.tsx`
and `routes/_auth/profil.strava.callback.tsx`, `apps/native/components/strava-card.tsx`.

Source of truth: <https://developers.strava.com/docs/authentication/>, <https://developers.strava.com/docs/webhooks/>,
<https://www.strava.com/legal/api>.

## One Strava application, shared with JoyoFit

JoyoRogo uses the same Strava API application as **JoyoFit** (the Huawei watch app, repo `watch-fit`, which uploads
workouts to Strava): client id `287873`. The athlete capacity is per application, so a second application would split it. The
full design, with the same reasoning, is in `watch-fit/docs/strava.md` section 1; what matters here:

| Question | Answer |
|---|---|
| Scopes | JoyoRogo asks `read,activity:read_all`, JoyoFit `activity:write` (and `profile:read_all` when the athlete turns on gear linking in JoyoFit; JoyoFit's Worker adds it to the authorize URL itself and tells the app it is granted when `requestedScope` carries it, so nothing changes here: it is stored in `scope` and kept by the union rule below). The authorize URL always asks for the product's scopes **plus every scope the athlete already granted** (`requestedScope`), so connecting here never narrows a grant JoyoFit uploads with. The callback checks the granted scope: JoyoRogo needs `activity:read_all` or `activity:read`; a grant without it is refused (and revoked at Strava unless a row already exists). Strava only says the athlete can opt out of any scope and the app must check what came back, so the code never assumes a second authorization keeps the first one's scope. |
| Tokens | One row per user in `strava_account`, used by both products. Strava keeps one refresh-token chain per athlete and application ("Once a new refresh token is returned, the older refresh token is invalidated immediately"), so two separate stores would invalidate each other. JoyoFit's Worker asks this one for tokens over `POST /internal/joyofit/strava/{status,exchange,token,disconnect,deauthorized}`, HTTP Basic with the Strava client id and secret (`401` otherwise, `503` when unset). |
| Linked products | `rogo_linked_at` / `fit_linked_at` say who uses the grant. A product's `connected` means it is linked **and** the granted `scope` covers it. |
| Disconnect | **Putuskan** unlinks JoyoRogo and deletes the Strava rows it imported. The grant is revoked at Strava (`oauth/revoke`) and the row deleted only when JoyoFit is not linked either; the last one to leave revokes. Account deletion and "hapus data" revoke outright. |
| Deauthorization | One webhook subscription per application, and it points at JoyoFit's Worker (`https://api.fit.joyorogo.com/strava/webhook`). It forwards the athlete's deauthorization to `deauthorized`, which deletes the tokens of both products and every `source = 'strava'` row of that athlete. As a backstop, `strava.status` deletes the imported rows of any user whose Strava link is gone (deauthorized, refused refresh token). Do not create a second subscription for this application. |
| Double counting | A workout JoyoFit uploads has `external_id` `joyofit-<start>` on Strava, and JoyoRogo already receives it through Health Connect / Apple Health (`source = 'health_connect'` / `'apple_health'`, JoyoFit's **Write to Health Connect**). `strava.sync` therefore skips every activity whose `external_id` starts with `joyofit-` (`isJoyofitUpload`); it is counted in `skipped`. |
| Capacity | One athlete capacity for both products: free users connect only while more than `STRAVA_PAID_RESERVE` slots are free, paying users while any is; idle free users are released. Section "Capacity" below. |
| Consent screen | Strava shows the application's name and description to JoyoRogo users too. Recommended: rename the application to "JoyoRogo & JoyoFit" and describe both uses (details in `watch-fit/docs/strava.md` section 3, "Branding"). |

## Capacity: free while slots are spare

Strava caps how many athletes may authorize one application, and JoyoRogo and JoyoFit share one (client `287873`, 10
athletes). The cap filled with free users while paying users waited, so since 2026-10-26 Strava is **free while slots
are spare**: the last slots are kept for paying users and idle free users give theirs back. Code:
`packages/api/src/lib/strava-capacity.ts` (rule, config, checks) and `packages/api/src/lib/strava-release.ts` (release).

| Setting (Worker var, `apps/server/wrangler.jsonc`) | Default | Meaning |
|---|---|---|
| `STRAVA_CAPACITY` | `10` | Athletes the application may hold (Strava's athlete capacity). Raise it when Strava raises the limit. |
| `STRAVA_PAID_RESERVE` | `3` | Slots kept for paying users (`N`). |
| `STRAVA_IDLE_DAYS` | `14` | Days without token use after which a free user's grant may be released. |

- **Who counts.** A slot is one distinct `athlete_id` in `strava_account` (an athlete linked from two accounts is one
  slot). Paying = `effectiveTier(user) === "founder"`: a paid period or subscription (`founder_until` in the future, which
  Polar, DOKU/Pakasir, Google Play and Apple all extend) or the manual `founder` comp, so the owner counts as paying.
- **Rule** (`slotRefusal`). With `free = capacity - connected`: a paying user may connect while `free > 0`; a free user
  only while `free > N`. A user who already has a row (re-authorizing, adding JoyoFit's gear scope, linking the other
  product) or an athlete another account already holds needs no new slot and is never refused.
- **Before Strava's page.** `strava.status` (JoyoRogo) and `POST /internal/joyofit/strava/status` (JoyoFit) answer
  `slotsFull: true` and `slotsReason` (`reserved_for_paid`: only the reserve is left; `full`: no slot at all) for a user
  who is not connected and may not connect; the apps show "Slot Strava penuh" with the alternatives instead of the
  connect button. `strava.authorizeUrl` refuses with `FORBIDDEN` (`data.slotsFull`), and JoyoFit's `/v1/strava/authorize`
  answers 409 `slots_full`.
- **At the code exchange.** `exchangeCode` checks again (the answer can change while the athlete is on Strava's page). A
  refused grant is revoked at Strava at once (`oauth/revoke`), so it never occupies a slot, and logged as
  `strava_slot_refused`; JoyoRogo answers `FORBIDDEN`, the internal route 409 `{ error: "slots_full", reason }`.
- **Release.** Releasing an athlete revokes its grant at Strava, deletes its `strava_account` rows and the imported
  `source = 'strava'` rows of those users (as a disconnect does), and writes a `strava_release` row per user (reason
  `released_for_pro`, Strava's revoke answer, time; no tokens). Paying users, the owner included, are never released.
  Each release is logged as `strava_slot_released` (athlete, users, Strava's answer, last use).
  - *Idle* = the newest `updated_at` of the athlete's rows is older than `STRAVA_IDLE_DAYS`. `updated_at` moves on every
    token refresh and an access token lasts six hours, so any use by either product moves it within a day.
  - *Cron*: the server Worker's `*/5` tick runs `keepPaidReserve`: when fewer than `N` slots are free it releases idle
    free athletes, longest unused first, until `N` are free again (or nobody idle is left). One count query otherwise.
  - *By hand*: `POST https://api.joyorogo.com/internal/strava/release`, HTTP Basic with the Strava client id and secret
    (the same credentials as the JoyoFit routes). `{ "athleteIds": [..] }` releases those athletes whatever their idle
    time; without ids it releases idle free athletes (`olderThanDays`, default `STRAVA_IDLE_DAYS`; `max`, default 1).
    `"dryRun": true` changes nothing. The answer lists per athlete `outcome` (`released`, `would_release`, `paid`,
    `not_found`), `revoked` (Strava confirmed), `users` and `lastUsedAt`.
- **What the user sees.** The next status call says Strava is disconnected: `released: { at, reason:
  "released_for_pro" }` ("Slot dilepas untuk pengguna Pro"), with the alternatives: in JoyoRogo Health Connect / Apple
  Health or adding workouts by hand, in JoyoFit the manual upload ("Unggah ke Strava (manual)"). Connecting again (when a
  slot is open) clears the notice.

2026-10-26 one-off: the owner released the five JoyoFit-only free athletes idle for 7+ days (147233143, 171431136,
32431117, 179882661, 107300269) with the endpoint above; five athletes stayed (the owner and four active users).

## Owner setup

1. Strava application settings (<https://www.strava.com/settings/api>): **Authorization Callback Domain** = `joyorogo.com`. Strava accepts any
   redirect on that domain and its subdomains: web `https://app.joyorogo.com/profil/strava/callback` (the app host; `https://joyorogo.com/...` redirects there), the Android/iOS app
   `joyorogo://joyorogo.com/strava`, and JoyoFit's `https://api.fit.joyorogo.com/strava/callback`.
2. Worker config (from `apps/server/`): `STRAVA_CLIENT_ID=287873` and the secret `bunx wrangler secret put STRAVA_CLIENT_SECRET`.
   JoyoFit's Worker must have the **same** `STRAVA_CLIENT_SECRET` (it signs the OAuth state with it and authenticates to
   `/internal/joyofit/strava/*` with it). Unset = `configured: false` and the Profil card says "Segera hadir".
3. Migration `0032_strava_shared_grant` (adds `scope`, `rogo_linked_at`, `fit_linked_at`, an index on `athlete_id`). Rows made before it are marked as
   JoyoRogo links with scope `read activity:read_all`.
4. Self-hosting (`apps/selfhost`) is unchanged: bring your own Strava application, there is no JoyoFit in the picture and
   `rogo_linked_at` is the only link ever set. The `/internal/joyofit/strava/*` routes exist but need your own client credentials.

Imported rows follow Strava's API policy: owner-only (excluded from groups, challenges, feed and shares), never sent to AI,
not used in the weight-trend activity-level recommendation; they are deleted on disconnect and on deauthorization.

## Retention: 7 days (API Policy 6.2)

<https://www.strava.com/legal/api_policy>, section 6.2 (Cache and Retention): "You may not retain Strava Data in your cache for
longer than seven (7) days." "Strava Data" is "all data you access or collect from the Strava API Materials" (Agreement 2.3(i)), and
the policy has no exception for derived or diary data (5.4, 5.5 and 7.4 name "data derived from Strava Data" too). So an imported
`source = 'strava'` row, calories included, lives at most 7 days; nothing is kept in a scrubbed form.

- **Scrub:** `scrubExpiredStravaRows` (`packages/api/src/lib/strava-retention.ts`) deletes whole rows with `source = 'strava'`
  whose WIB day is on or before `stravaRetentionCutoff()` (today minus 7 days), or whose `created_at` (fetch time, never changed
  by an edit) is more than 7 days old; the second test stops a user from keeping a row by moving its date forward. It deletes in
  batches of 200 (`DELETE ... WHERE id IN (SELECT id ... LIMIT 200)`), is idempotent, and needs no schema change. The server
  Worker's existing `*/5 * * * *` cron runs it every tick (`runStravaRetention` in `apps/server/src/index.ts`). Reads do not scrub.
- **No re-import:** `strava.sync` skips an activity whose WIB start day is on or before the same cutoff, so a scrubbed activity is
  never fetched back; inside the window the unique index `(user_id, source, external_id)` still dedupes. Both sides use
  `stravaRetentionCutoff()`, so what sync accepts is exactly what the scrub keeps.
- **User-facing:** the Strava card (web and native) says imports are kept 7 days and recommends Health Connect (Android) or Apple
  Health (iPhone) for lasting burned calories; users who already had Strava connected see a one-time dismissible notice on the home
  screen (`StravaRetentionNotice`, dismissal stored per account on the device: localStorage on web, SecureStore on native). The
  privacy page (`/privasi#strava`) states the same.

## Tests

`bun test packages/api/src` includes `lib/strava-grant.test.ts` (scopes, exchange, refresh and rotation, the lost-refresh race,
unlink and revoke rules, deauthorization, the `joyofit-` prefix) on an in-memory libsql database built from the real migrations.
`lib/strava-capacity.test.ts` covers the slot rule (paid vs free, the reserve boundary, athletes not accounts, held slots
never refused), a refused exchange revoking the fresh grant, release ordering (oldest use first, `max`, dry run), paying
users and the owner never released, an athlete idle only when all its rows are, the release dropping rows and imported
activities and leaving the notice, reconnecting clearing it, and the cron's reserve keeping. `apps/server/src/strava.test.ts`
covers the internal routes (status `slotsFull`, 409 `slots_full`, the release endpoint's auth and answer).
`lib/strava-retention.test.ts` covers the scrub (cutoff boundary, other sources and users untouched, idempotent, `created_at` guard,
batching) and `strava.sync` after a scrub (no re-import, nothing past the window imported), with a mocked clock.
