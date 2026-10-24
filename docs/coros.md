# COROS in JoyoRogo

JoyoRogo reads the athlete's recent workouts from **COROS's official MCP server** and adds them to the diary as burned calories
(`exercise_log.source = 'coros'`). Profil → COROS has **Sambungkan**, **Sinkron** and **Putuskan**; the screen also syncs once when
it opens (if the last sync is older than an hour). The imported rows are ordinary diary rows: they count in the day's burn, in the
calorie target's add-back, in the diary and in Joyo AI's data, and carry the label "COROS". (Unlike Strava there is no API policy that
keeps them private or short-lived; COROS publishes the MCP for exactly this: "No application or approval required".)

Source of truth: <https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP>,
<https://github.com/coroslab/COROS-MCP> (tool guide `docs/en/tools.md`).

Code: `packages/api/src/lib/coros-grant.ts` (OAuth: PKCE, state, tokens, revoke), `coros-mcp.ts` (the MCP client),
`coros-parse.ts` (readers for the tools' text, sport-code mapping), `coros-sync.ts` (the import), `routers/coros.ts` (oRPC),
`apps/server/src/coros.ts` (the OAuth redirect), `scripts/coros-register-client.ts`, web `components/coros-card.tsx`,
`components/profil/coros-screen.tsx`, `routes/_auth/profil.coros.*`, native `components/coros-card.tsx`, `app/profil/coros.tsx`
and the COROS row of "Sumber data" (`app/sumber.tsx`). Tables: `coros_account`, `coros_auth_state` (migration `0064_coros`).

## OAuth flow

COROS's authorization server (`https://mcpus.coros.com`) supports dynamic client registration and requires PKCE S256. JoyoRogo is a
**public client**: no secret, scope `openid mcp.tools offline_access`.

1. `coros.authorizeUrl({ returnTo: "web" | "native" })` creates a random `state` and a PKCE verifier, stores them in
   `coros_auth_state` (10 minutes, bound to the user) and returns COROS's authorize URL.
2. COROS only accepts **https** redirect URIs (a `joyorogo://` URI is refused at registration: `Remote redirect_uri must use https`).
   So the one registered redirect is `https://api.joyorogo.com/api/coros/callback`. That endpoint (`apps/server/src/coros.ts`) looks
   the state up and 302s the browser to the web page `https://app.joyorogo.com/profil/coros/callback?code&state` or the app link
   `joyorogo://joyorogo.com/coros?code&state` (read by `WebBrowser.openAuthSessionAsync`). It exchanges nothing.
3. The web page / app calls `coros.exchangeCode({ code, state })` with the user's session. The state row is deleted in the same
   statement that reads it (single use) and must belong to that user and be unexpired, otherwise `bad_state`; the code is then
   exchanged at `/oauth2/token` with the stored verifier and `client_id`. A tampered, unknown, replayed, expired or someone else's
   state never reaches COROS (`coros-sync.test.ts`).
4. Tokens go to `coros_account` (`access_token`, `refresh_token`, `expires_at`, `scope`, `connected_at`, `last_sync_at`,
   `last_error`). They are refreshed a minute before expiry, or once after a 401 from the MCP. A refresh COROS refuses
   (`invalid_grant`) deletes the row (the user is asked to reconnect; imported workouts stay); a refresh that fails while the row
   already holds a newer refresh token (two syncs at once) uses that one.

## MCP client

`coros-mcp.ts` is a ~150-line Streamable HTTP client (the official SDK is only a dependency of `apps/server`, not of
`packages/api`): `POST https://mcp.coros.com/mcp` with `Authorization: Bearer`, `Accept: application/json, text/event-stream`,
`initialize` then `notifications/initialized` then `tools/call`; JSON and SSE answers, `Mcp-Session-Id` and `MCP-Protocol-Version`
kept. COROS's endpoint is stateless. `https://mcp.coros.com/mcp` is the unified endpoint (the regional ones are `mcpcn`, `mcpeu`,
`mcpus`); the authorization server answers for US, and a user in another COROS region is routed by COROS.

## Sync (`coros.sync`)

- Window: the last **14 days** on the first sync; afterwards since `last_sync_at` minus **2 days** (at most 30 days).
- `querySportRecords(startDate yyyyMMdd, endDate "", [65535], every filter off, limit 50)`, then `getActivityDetail(labelId, sportType)`
  per new activity (at most 30 per sync, 4 at a time) for `Calories: N kcal`. Without calories (no detail, a failed call, past the
  cap): MET estimate (`lib/met.ts`, the workout type, the weight on that day, the duration).
- `external_id = coros-<labelId>`; the unique `(user_id, source, external_id)` index makes a re-sync a no-op, and an activity that is
  already stored costs no detail call. If the list carries no identifier we could find, the id falls back to
  `coros-<day>-<sport>-<start>-<seconds>`.
- **Duplicates.** COROS also writes to Health Connect, Apple Health and Strava. An activity that one of those rows already stands
  for (same day, same kind of workout by `workoutClassOf`, duration within 2 minutes; one stored row absorbs only one activity,
  `diaryMatcher`) is not imported, and a COROS row stored before the other copy arrived is deleted on the next sync. The check
  covers the sync window.
- Types: COROS sport code to the diary's vocabulary (`corosWorkoutType`): 1, 100, 103 Run; 101 Treadmill; 102, 5 TrailRun;
  104 Hike; 2, 200-203 Ride; 3, 300, 301 Swim; 4, 402 WeightTraining; 900 Walk; everything else `OtherWorkout` (default MET 6.0). The
  1-5 codes are the MCP's own workout codes (tools.md), the others COROS's open API codes; **neither list is confirmed against a
  real account**, so an unexpected code only costs the type.
- A record the parser cannot read is counted (`unparsed`) and skipped; the sync never fails on one. Readers prefer
  `structuredContent` / JSON and fall back to the documented prose (`coros-parse.ts`, samples in `coros-parse.test.ts`).
- Failures: a refused grant means "reconnect" (401); a COROS or network failure keeps the connection and sets `last_error`, which
  the next good sync clears (the app shows only "last sync failed").
- Not imported: daily steps / active calories (`queryDailyHealthData` has no documented sample to build a reader on, and the
  health-store pattern is `activity.upsert` from the phone) and sleep (`querySleepOverview`). Both are possible next steps.
- No background polling: there are no webhooks, and the 5-minute cron is not used (a sync is up to ~35 subrequests per user). The
  sync runs on the COROS screen and on Sinkron.

## Disconnect and deletion

**Putuskan** (`coros.disconnect`) revokes the refresh token at `/oauth2/revoke` (best effort: COROS's metadata lists no `none`
client authentication for revocation, so a public client may be refused with 401; the tokens are deleted whatever COROS answers,
and the user can remove the app in COROS), deletes `coros_account` and `coros_auth_state`, and deletes every `source = 'coros'`
row. "Hapus data" and account deletion (`routers/privacy.ts`, `apps/server/src/privacy.ts`, `lib/privacy.ts`) do the same
revocation and clear both tables.

## Owner setup

0. **Allowlist.** Nothing is verified against a real COROS account yet, so the whole feature sits behind `COROS_USER_IDS`
   (comma-separated user ids, or `*`; empty = nobody; `corosEnabled` in `lib/coros-grant.ts`, same pattern as
   `SCALE_READOUT_USER_IDS`). For a user not on it `coros.status` says `configured: false` and the other procedures answer
   "not configured", exactly as with `COROS_CLIENT_ID` unset, and the web Connections row, the native Profil row and the "Sumber
   data" row are hidden (no "Segera hadir"). `apps/server/wrangler.jsonc` lists the owner and QA. Add a tester by appending
   their user id; set `*` once a real account has confirmed items 1-4 of "What needs a real COROS account". The OAuth redirect
   endpoint and the deletion paths are not gated (they only act on state or data that exists).
1. The client is registered: `COROS_CLIENT_ID=be255c7f-949e-4a44-8638-ba18111f9092` (redirect `https://api.joyorogo.com/api/coros/callback`),
   set in `apps/server/wrangler.jsonc` vars. For another environment run `bun scripts/coros-register-client.ts <https redirect URI>`;
   the redirect must be `<BETTER_AUTH_URL>/api/coros/callback`. Unset = `configured: false`, the screens say "Segera hadir".
2. Apply migration `0064_coros` (`coros_account`, `coros_auth_state`).
3. Self-hosting (`apps/selfhost`): register your own client for your API origin and set `COROS_CLIENT_ID`; not offered in the
   self-host setup form.

## Privacy

Imported workouts carry type, day, duration, calories. Tokens live in D1. Deleted on disconnect, "hapus data" and account deletion
(see `/privasi#coros`).

## Tests

`packages/api/src/lib/coros-parse.test.ts` (documented sample outputs), `coros-mcp.test.ts` (JSON and SSE answers, headers, errors,
handshake retry), `coros-sync.test.ts` on the real migrations: PKCE and state (tampered, replayed, expired, another user's), token
refresh and the refresh race, import with measured and estimated calories, idempotency, dedupe in both directions, bad records,
401 then refresh, outage, the 50-record batch, disconnect.

## What needs a real COROS account

Everything above was exercised against a fake MCP only. To verify with an account: (1) the connect round trip on web and on a phone
(COROS's login page, redirect through the API host, the app link); (2) the real text of `querySportRecords` (is a label id in the
list, under which name; start time) and `getActivityDetail`; (3) the sport codes of the account's watch; (4) that COROS refreshes
tokens as assumed (rotation or not) and what `revoke` answers.
