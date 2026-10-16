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
| Scopes | JoyoRogo asks `read,activity:read_all`, JoyoFit `activity:write`. The authorize URL always asks for the product's scopes **plus every scope the athlete already granted** (`requestedScope`), so connecting here never narrows a grant JoyoFit uploads with. The callback checks the granted scope: JoyoRogo needs `activity:read_all` or `activity:read`; a grant without it is refused (and revoked at Strava unless a row already exists). Strava only says the athlete can opt out of any scope and the app must check what came back, so the code never assumes a second authorization keeps the first one's scope. |
| Tokens | One row per user in `strava_account`, used by both products. Strava keeps one refresh-token chain per athlete and application ("Once a new refresh token is returned, the older refresh token is invalidated immediately"), so two separate stores would invalidate each other. JoyoFit's Worker asks this one for tokens over `POST /internal/joyofit/strava/{status,exchange,token,disconnect,deauthorized}`, HTTP Basic with the Strava client id and secret (`401` otherwise, `503` when unset). |
| Linked products | `rogo_linked_at` / `fit_linked_at` say who uses the grant. A product's `connected` means it is linked **and** the granted `scope` covers it. |
| Disconnect | **Putuskan** unlinks JoyoRogo and deletes the Strava rows it imported. The grant is revoked at Strava (`oauth/revoke`) and the row deleted only when JoyoFit is not linked either; the last one to leave revokes. Account deletion and "hapus data" revoke outright. |
| Deauthorization | One webhook subscription per application, and it points at JoyoFit's Worker (`https://api.fit.joyorogo.com/strava/webhook`). It forwards the athlete's deauthorization to `deauthorized`, which deletes the tokens of both products and every `source = 'strava'` row of that athlete. As a backstop, `strava.status` deletes the imported rows of any user whose Strava link is gone (deauthorized, refused refresh token). Do not create a second subscription for this application. |
| Double counting | A workout JoyoFit uploads has `external_id` `joyofit-<start>` on Strava, and JoyoRogo already receives it through Health Connect / Apple Health (`source = 'health_connect'` / `'apple_health'`, JoyoFit's **Write to Health Connect**). `strava.sync` therefore skips every activity whose `external_id` starts with `joyofit-` (`isJoyofitUpload`); it is counted in `skipped`. |
| Consent screen | Strava shows the application's name and description to JoyoRogo users too. Recommended: rename the application to "JoyoRogo & JoyoFit" and describe both uses (details in `watch-fit/docs/strava.md` section 3, "Branding"). |

## Owner setup

1. Strava application settings (<https://www.strava.com/settings/api>): **Authorization Callback Domain** = `joyorogo.com`. Strava accepts any
   redirect on that domain and its subdomains: web `https://joyorogo.com/profil/strava/callback`, the Android/iOS app
   `joyorogo://joyorogo.com/strava`, and JoyoFit's `https://api.fit.joyorogo.com/strava/callback`.
2. Worker config (from `apps/server/`): `STRAVA_CLIENT_ID=287873` and the secret `bunx wrangler secret put STRAVA_CLIENT_SECRET`.
   JoyoFit's Worker must have the **same** `STRAVA_CLIENT_SECRET` (it signs the OAuth state with it and authenticates to
   `/internal/joyofit/strava/*` with it). Unset = `configured: false` and the Profil card says "Segera hadir".
3. Migration `0032_strava_shared_grant` (adds `scope`, `rogo_linked_at`, `fit_linked_at`, an index on `athlete_id`). Rows made before it are marked as
   JoyoRogo links with scope `read activity:read_all`.
4. Self-hosting (`apps/selfhost`) is unchanged: bring your own Strava application, there is no JoyoFit in the picture and
   `rogo_linked_at` is the only link ever set. The `/internal/joyofit/strava/*` routes exist but need your own client credentials.

Imported rows follow Strava's API policy: owner-only (excluded from groups, challenges, feed and shares), never sent to AI,
not used in adaptive plans; they are deleted on disconnect and on deauthorization. The 7-day cache cap (6.2) is not enforced yet.

## Tests

`bun test packages/api/src` includes `lib/strava-grant.test.ts` (scopes, exchange, refresh and rotation, the lost-refresh race,
unlink and revoke rules, deauthorization, the `joyofit-` prefix) on an in-memory libsql database built from the real migrations.
