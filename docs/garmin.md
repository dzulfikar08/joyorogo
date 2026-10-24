# Garmin in JoyoRogo

JoyoRogo reads a person's own Garmin data through Garmin's official **Personal API**: workouts go to the diary as burned
calories (`exercise_log.source = 'garmin'`), weigh-ins to the weight log (`weight_log.source = 'garmin'`), and daily steps /
distance / active calories / intensity minutes to `daily_activity` (`source = 'garmin'`). Profil → Garmin has a field for the
API key, **Sambungkan**, **Sinkron** and **Putuskan**; the screen also syncs once when it opens (if the last sync is older than
an hour). Imported rows are ordinary diary rows (they count in the day's burn, the target's add-back, the diary and Joyo AI) and
carry the label "Garmin".

Source of truth: <https://github.com/garmin/connect-personal-api-python> (the official client; `src/garmin_personal_api/client.py`
lists every path and parameter). The key is created at <https://connect.garmin.com/app/settings/personalApiToken>
(Garmin Connect → Settings → Personal API Key).

Code: `packages/api/src/lib/garmin-grant.ts` (allowlist, key → token, connection row, deletion), `garmin-client.ts` (the GET client),
`garmin-parse.ts` (pure readers, type mapping, net calories), `garmin-sync.ts` (the import), `routers/garmin.ts` (oRPC), web
`components/garmin-card.tsx`, `components/profil/garmin-screen.tsx`, `routes/_auth/profil.garmin.index.tsx`, native
`components/garmin-card.tsx`, `app/profil/garmin.tsx` and the Garmin row of "Sumber data" (`app/sumber.tsx`). Table:
`garmin_account` (migration `0065_garmin`).

## Why it is gated

The Personal API's terms cover **a person's own data only**: a user pastes the key of their own Garmin account, and JoyoRogo
uses it for that user alone. That is not something to offer the public, so the whole feature sits behind `GARMIN_USER_IDS`
(comma-separated user ids, or `*`; empty = nobody; `garminEnabled` in `lib/garmin-grant.ts`, same shape as `COROS_USER_IDS`).
For a user not on it `garmin.status` says `configured: false`, `connect` / `sync` answer "not available", and the web hub row, the
Garmin screen, the native Profil row and the "Sumber data" row are hidden. `apps/server/wrangler.jsonc` lists the owner and QA.
There is deliberately **no release entry** (owner-only).

Later, when Garmin approves a business application (the Starter tier of the Garmin Connect Developer Program), the same tables and
import are fed through OAuth and push. `garmin_account.auth_kind` is there for that: today the only kind is `personal_key`, and a
second kind adds its own columns next to `api_key` / `token`. Nothing but the personal-key path exists now.

## The key and the token

- The user pastes the key; it is trimmed and sent to `garmin.connect({ apiKey })`, which proves it by minting a token with it. A key
  Garmin refuses (`401`) answers `UNAUTHORIZED` with the "key is not valid" message and stores nothing.
- Token: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with
  `Authorization: ApiKey <key>`; the answer is the **raw bearer JWT as text** (not JSON), valid 24 hours, no refresh token. A new
  one is minted from the key. The JWT's `exp` is the expiry kept in `token_expires_at` (23 h assumed if it cannot be read).
- The stored token is used until one hour before it expires, then replaced (`freshToken`). A data call answered 401 mints once more
  and retries once.
- A key Garmin stops accepting (expired, revoked) deletes the `garmin_account` row: the user is asked to create a new key and
  connect again; what was already imported stays. Garmin emails before a key expires.
- The key and the token are secrets: `status` never returns them, error messages never contain them (the client names path and HTTP
  status only), nothing logs them. They live in D1 like the COROS tokens; deleting the account row removes them.

## Sync (`garmin.sync`)

- Data calls: `GET https://personal.connectapi.garmin.com<path>` with `Authorization: Bearer <jwt>`.
  - activities: `/activitylist-service/activities/search/activities?start&limit=100&startDate&endDate` (paged, at most 5 pages)
  - weigh-ins: `/weight-service/weight/range/{start}/{end}?includeAll=true`
  - days: `/usersummary-service/v2/dailysummaries?startDate&endDate` (up to 90 days per request; the `stats/steps/daily` endpoint
    refuses ranges that long with 400, so it is not used)
- **First sync = backfill** (no `last_sync_at`, so also the first sync after a new key replaced a revoked one; everything is
  idempotent). Activities: every page of 100 until a short page, **at most 10 pages (the newest 1000)**; the window opens at
  2000-01-01 (Garmin accepts any date and answers only what exists), so a history that is an exact multiple of 100 costs one more,
  empty, page. Weigh-ins: **730 days**, one request (the endpoint takes any range; 2000-01-01..today answered the same in a
  real account). Daily summaries: **365 days in requests of at most 90 days** (5 requests, one after the other; `syncPlan`,
  `dayChunks`). More than 1000 activities: the older ones are not imported, and later syncs never look back that far.
- **Later syncs**: since `last_sync_at` minus **2 days**, at most 30 days (workouts, days) and 90 days (weigh-ins), 1-5 activity pages.
- **Subrequests** (Workers allow 50 on the free plan, 1000 on paid; fetches and D1 statements both count; `db.batch` is one).
  Measured with a fake Garmin shaped like the owner's account (150 activities, 31 weigh-ins, 85 days of summaries): first sync
  **8 fetches** (2 activity pages + 1 weigh-in range + 5 day chunks) **+ 12 D1 calls = 20** (22 when the token also had to be
  minted); a later sync 4 fetches + 7 D1 = 11. Worst case of the backfill (1000 activities, cap hit): 10 + 1 + 5 fetches (+1 mint)
  and about 13 D1 calls (plus one delete per 90 workouts another source already holds) = about 30, so one request carries it
  and no cursor is needed.
- **Calories.** Garmin's `calories` is gross and includes `bmrCalories`, the resting energy of the same minutes. The diary gets
  `calories − bmrCalories` (never below 0). Some activities carry no `bmrCalories` (2 of 150 in the owner's account): the resting
  share is then estimated as 1 MET, the person's weight in kcal per hour (the real figures are within 6% of that). No `calories` at
  all: the MET estimate of the type at the weight on that day (`lib/met.ts`, `weightLookup`).
- **Workouts.** `external_id = garmin-<activityId>`; the unique `(user_id, source, external_id)` index makes a re-sync a no-op. The
  day is the watch's own `startTimeLocal`. Types (`garminWorkoutType`): `walking`, `casual_walking`, `speed_walking` Walk;
  `hiking` Hike; `running`, `street_running`, `track_running`, `virtual_run` Run; `treadmill_running`, `indoor_running` Treadmill;
  `trail_running` TrailRun; `cycling`, `road_biking`, `gravel_cycling`, `mountain_biking`, `indoor_cycling` Ride; `virtual_ride`
  VirtualRide; `e_bike_*` EBikeRide; `lap_swimming`, `open_water_swimming`, `swimming` Swim; `strength_training` WeightTraining;
  `yoga`, `badminton`, `soccer`; everything else `OtherWorkout` (default MET 6.0, named after its Garmin key, e.g. "Paddelball
  (Garmin)"). The name comes from the type, not from Garmin's title: the default title carries the city.
- **Duplicates.** Garmin also writes to Health Connect, Apple Health and Strava. A workout one of those rows already stands for
  (same day, same kind by `workoutClassOf`, duration within 2 minutes; one stored row absorbs one workout, `diaryMatcher`) is not
  imported, and a Garmin row stored before the other copy arrived is deleted on the next sync, as with COROS.
- **Weigh-ins.** The day's latest weigh-in (`latestWeight.weight`, grams → kg; body fat and body water percent, bone mass grams →
  kg, each only when inside the range the weight log accepts). `weight_log` has one row per user-day: a day that holds anything but
  a Garmin row is never overwritten; a Garmin row is refreshed when the weight changed. Garmin rows are imported history: they do
  not count toward streaks (`IMPORTED_WEIGHT_SOURCES`, like the Huawei import). Garmin edits older than the sync window are not
  seen.
- **Days.** Steps, distance, `calories.burnedActive`, intensity minutes (moderate + vigorous) into `daily_activity`, under the
  health stores' rule: the same source refreshes its row; another source's row is replaced only by a reading with at least as many
  steps. Only changed days are written. Days without wellness data or steps are skipped.
- A record the parser cannot read is counted (`unparsed`) and skipped; the sync never fails on one.
- Failures: a refused key means "create a new key" (401, row deleted); a Garmin or network failure keeps the connection and sets
  `last_error` (never shown raw: the app says "last sync failed"), which the next good sync clears.
- Not imported: sleep, HRV, stress, body battery and the other wellness endpoints (no existing table fits cleanly). Possible next
  steps; the daily summary already carries resting heart rate, stress and body battery if a table is added.
- No background polling: the Personal API has no push, and the sync runs on the Garmin screen and on Sinkron.

## Disconnect and deletion

**Putuskan** (`garmin.disconnect`) deletes `garmin_account` (key and token) and every `source = 'garmin'` row in `exercise_log`,
`weight_log` and `daily_activity`. "Hapus data" and account deletion clear everything through `deleteAllUserData`, which also
deletes `garmin_account`. There is nothing to revoke at Garmin: the user removes the key in Garmin Connect.

## Owner setup

1. Apply migration `0065_garmin` (`garmin_account`; `weight_log.source` gains the TS value `'garmin'`, a text column, no SQL change).
2. `GARMIN_USER_IDS` in `apps/server/wrangler.jsonc` vars (owner and QA). Add a tester by appending their user id.
3. In the app: Profil → Garmin → create the key at <https://connect.garmin.com/app/settings/personalApiToken>, paste, Sambungkan.

## Privacy

Imported rows carry type, day, duration, calories, weight (and body composition when the scale sends it), steps. The key and token
live in D1. All deleted on disconnect, "hapus data" and account deletion.

## Tests

`packages/api/src/lib/garmin-parse.test.ts` (trimmed real answers: activities, net calories, type mapping, weigh-ins, daily
summaries, bad records), `garmin-flag.test.ts` (allowlist), `garmin-sync.test.ts` on the real migrations with a fake Garmin:
connect with a bad key, token cache and re-mint, revoked key, the backfill plan, day chunking and page boundaries (short page, exact multiple, the 1000 cap, 1000 workouts inside D1's limits), later windows, import with net calories, idempotency, dedupe in
both directions, weigh-ins (manual day kept, Garmin day refreshed), daily rollup rule, outage, disconnect cleanup.
