# JoyoFit web (`apps/fit`)

A browser app for the data JoyoFit already keeps in JoyoRogo: training load, recovery, HRV, resting heart rate, VO2max, sleep and every cloud workout, laid out for analysis (dense tables and charts, desktop first, usable down to a 360 px phone). It needs a **JoyoRogo Pro** account, the same rule as the JoyoFit cloud backup.

Host: `app.fit.joyorogo.com` (Cloudflare zone `joyorogo.com`). It is its own Worker serving a static SPA; every data call goes to `https://api.joyorogo.com` (which forwards the JoyoFit-cloud parts, see below).

## What is in it

| Screen | Route | Reads |
|---|---|---|
| Login | `/login` | Same JoyoRogo account as `apps/web` (Google, plus the review email login). |
| Pro wall | any signed-in route | `fitness.cloudAccess` says `unlocked: false`: the wall (link to `https://joyorogo.com/harga`, "check again", sign out). |
| Ringkasan | `/` | Tiles (workouts, distance, strain, recovery, HRV, resting HR, VO2max, sleep), training load, recovery and HRV, resting HR and VO2max, sleep, weekly volume by sport, recent workouts. Range 7/30/90/365 days, optional compare with the period before (dashed lines, ghost bars). |
| Latihan | `/latihan` | Table of cloud workouts: range, sport filter, name search, sortable columns (one card per workout below 1280 px), totals of what is filtered. |
| Latihan detail | `/latihan/<start>` | Map, one chart per metric on a shared distance axis with one synced cursor (map follows it), HR zones, pace zones, best efforts, effort and load, comparison with similar workouts, km splits, laps. |
| Tidur & pemulihan | `/tidur` | Average, estimated need, debt, regularity; nightly bars against the need; **sleep stages** (stage chart of one night at a time, minutes per stage, naps, composition of every night, averages); recovery, HRV, resting HR; average by weekday; night table (cards below 1280 px). |
| Unggah | `/unggah` | **Workouts:** `.fit`, `.gpx`, `.tcx` read in the browser, previewed, checked against what the account already has, uploaded. **Watch faces:** the account's `.hwt` library (upload, download, delete). |

Filters and the range live in the URL (`?range=90&sport=["run"]&sort=distance&dir=asc`, defaults left out), so a view can be linked. Nothing is stored in `localStorage` except the language and theme choice: no health data survives a sign-out on a shared computer.

### Unggah: workout files

`apps/fit/src/lib/import/` (pure, tested with `bun test`): `fit.ts` (Garmin FIT SDK, a port of the JoyoFit app's `parseFit`: sessions added up, records to points, laps kept from two up), `gpx.ts` / `tcx.ts` (DOMParser, vendor extensions by local name), `analysis.ts`, `doc.ts`, `collision.ts`, `upload.ts`.

1. A chosen file is read in the browser (nothing is sent until the person presses Upload) and becomes a **canonical cloud workout document** (`WatchWorkoutDoc`, `packages/api/src/lib/watch-workout.ts`): the workout row, every point by column, and a `WorkoutAnalysis` computed here (series on the shared 720-sample grid, km splits, laps, HR zones from the age rule, strain, elevation, best efforts for runs and walks). It is validated with the same strict schema the server uses, so it cannot be refused for its analysis; a file the schema still refuses imports without an analysis (numbers only). What it cannot have is history: no comparison with earlier workouts, no best-effort ranks, no training load, no pace zones. `engineRev` is 0, so a JoyoFit phone with its own engine may recompute them after it pulls the workout.
2. **Dedupe:** the cloud keys a workout by its start second, so uploading the same start would *replace* a watch workout (and its richer analysis). The screen therefore asks `fitWeb.workouts` for the days around each file first: the same start is a **duplicate**, a stored workout covering more than half of the file's span is an **overlap** (the phone's own `OVERLAP_SHARE`). Both are skipped with the reason. Exact re-uploads of what this page uploaded are duplicates too.
3. Upload is `PUT /api/watch-workouts/<start>` (gzip body). The answers are shown per file: created / updated / unchanged, 402 (Pro wall with a link to pricing), 401, 410 (deleted from the cloud before, never brought back), 413 (quota), 400.
4. Limits: 60 MB per file, 6 MB gzip per document, 100 000 points (more are thinned), 25 hours.

### Unggah: watch face library

Faces live in **joyofit-api** (the JoyoFit cloud, repo `watch-fit`, `server/`): R2 bucket `IMPORTS` under `watchfaces/<userId>/<id>`, D1 table `web_watchfaces` (migration `0010_web_watchfaces.sql`). That bucket and API already hold the account's other JoyoFit uploads, it enforces the Pro rule the same way the phone's uploads do, and the phone talks to the same API, so the "Dari web" section of the app's Watchfaces screen reads the list from there and installs through its existing path (JS only, OTA). A file is validated as a real watch face on upload (zip, `description.xml`, the face's `watchface.bin` through `packages/hwt`), at most 8 MiB and 40 faces per account; the same file twice is one face. Reads (list, download) are open to any signed-in account, upload is Pro, delete is always allowed, and the account wipe removes the library.

### Sleep stages

`GET /v1/sleep?from&to` of joyofit-api (at most 92 days; WIB wake-up days; night plus naps, same rules as the phone: a night is a session with 3 h or more of sleep, a gap over the session gap splits; every other session of the day is a nap). Stage-less ranges are cleaned like the phone does, minus one input: the server has no spot-HRV readings, so a stage-less night can differ from the phone's by a spot-HRV minute; staged nights match exactly. The Tidur page shows the last 92 days of the chosen window. Stage-less nights (the watch only said when you slept) are shown as such, never as made-up stages.

### How the web app reaches joyofit-api

The session cookie is host-only on `api.joyorogo.com` (`sameSite: none`, no `Domain`): a browser never sends it to `api.fit.joyorogo.com`, and credentialed CORS cannot change that. So the web app does not call joyofit-api at all: it calls **`/api/fit/*` on the JoyoRogo API** (`apps/server/src/fit-proxy.ts`), which repeats the call server to server with only the session cookies, and joyofit-api still verifies the session and the Pro rule itself.

| Browser call | Forwarded to joyofit-api |
|---|---|
| `GET /api/fit/sleep?from&to` | `GET /v1/sleep` |
| `GET /api/fit/watchfaces`, `POST /api/fit/watchfaces?filename=` | `GET`, `POST /v1/watchfaces` |
| `GET /api/fit/watchfaces/<id>/file`, `DELETE /api/fit/watchfaces/<id>` | the same under `/v1/watchfaces/<id>` |

Not an open relay: any other path or method is `404` and nothing is forwarded; no session is `401`; a `POST` or `DELETE` must carry an `Origin` that is in the server's `CORS_ORIGIN` list or it is `403 forbidden_origin` (the session cookie is `SameSite=None`, so without this a page on any site could make a visitor's browser upload into or delete from their library), and an upload must be `Content-Type: application/octet-stream` (`415` otherwise: a plain cross-site form cannot send that type, so a browser has to preflight it first, which only our origins pass); request headers are built from scratch (only the session cookies, `Accept`, and for an upload `Content-Type` and `Content-Length`, so hop-by-hop headers, `Host`, `Origin` and foreign cookies never travel); an upload without `Content-Length` is `411` and over 8 MiB `413` before one byte is sent on; only `Content-Type`, `Content-Length`, `Content-Disposition` and `Cache-Control` come back, and the status is passed through (`402 founder_required` is what makes the Pro wall appear); an unreachable joyofit-api is `502 fit_api_unreachable`. The target is the var `JOYOFIT_API_URL` (default `https://api.fit.joyorogo.com`; `http://localhost:3004` locally).

## API

Everything is the existing oRPC router (`/rpc/*`, cookie session). New, in `packages/api/src/routers/fit-web.ts` (data in `lib/fit-web.ts`):

- `fitWeb.recovery({ from?, to? })` -> `{ from, to, days }`: one row per day with sleep, scores or activity, **oldest first**. The rows are `getRecoveryDays` (`lib/fit-data.ts`), the reader the MCP connector and the coach already use, so a night reads the same on the web and in the AI apps. Default: last 30 days.
- `fitWeb.workouts({ from?, to? })` -> `{ from, to, items, truncated }`: the cloud workouts that started in the window (WIB days), newest first, list numbers only (no document, no route). At most 2000, `truncated` says the oldest were cut. Default: last 90 days.

Both are **Pro only** (`FORBIDDEN` with `data: { paywall: true }`, localized message), take windows of at most 366 days (`BAD_REQUEST` otherwise) and only ever read the caller's rows. The compare period is a second call with the window of the same length before the first.

Reused as they are: `fitness.cloudAccess` (the wall), `watchWorkout.detail` (one workout with its `WorkoutAnalysis`, which carries the per-sample series, the track, zones, splits, laps), `profile.myProfile` / `profile.setLocale` (the language follows the account).

Tests: `apps/server/src/fit-proxy.test.ts` (the proxy), `apps/fit/src/lib/{import,sleep-stages,watchfaces}*.test.ts` (readers, analysis, document, dedupe, stage helpers, library rules), `packages/api/src/routers/fit-web.test.ts` (window rules, WIB day edges, tombstones, other accounts, Pro gate in both languages, no paywall = everyone) and `apps/fit/src/lib/*.test.ts` (aggregation, sleep statistics, table sort and filter).

## Stack

Vite 8, React 19, TanStack Router (file routes, `_auth` layout guard) and Query, oRPC client, Tailwind 4, `@joyorogo/ui`, `@joyorogo/i18n` (react-i18next), Better Auth client, Lucide icons, same as `apps/web`.

- **Charts: Recharts.** Daily series with two axes, tooltips, stacked weekly bars and the synced workout charts are declarative in it; uPlot would be faster on very long series but every one of those needs hand-written wrappers, and the series here are small (at most 366 days, 720 samples per workout). The workout charts draw the cursor themselves (a positioned line over panels that share one plot geometry) so moving it does not re-render the charts, and so the map can drive it too.
- **Map and shared maths: `packages/workout-view`.** The route map (`route-map.tsx`), its OpenFreeMap style (`map-style.ts`) and the analysis helpers (`analysis-math.ts`, with its test) moved out of `apps/web` into this package so both apps use one copy; `apps/web` imports them from `@joyorogo/workout-view/...`.
- **Brand:** JoyoRogo's tokens with JoyoFit's primary (`#0A6580` light, `#58C4DE` dark) and mark; light and dark follow the system or the choice in the menu.
- **i18n:** namespaces `fitWeb` (shell, login, wall, states, units), `fitWebOverview`, `fitWebWorkouts`, `fitWebSleep` in `packages/i18n`, Indonesian ("kamu") and English. Slices 3 and 4 add their own namespaces.

## Auth and CORS

The session cookie is `sameSite: none; secure; httpOnly` on `api.joyorogo.com` (host only), so the app calls the API with `credentials: "include"`. The origin must be in `CORS_ORIGIN` of the server, which feeds both the Hono CORS allowlist and Better Auth `trustedOrigins`:

- `apps/server/wrangler.jsonc` `vars.CORS_ORIGIN` now lists `https://app.fit.joyorogo.com` and `http://localhost:3003` (the local dev port). The CORS methods now include `PUT` (workout upload) and `DELETE` (watch face delete), which a browser preflights.
- `scripts/deploy.sh` rewrites that var from `apps/server/.env` before it deploys the server, so the same two origins must be in the `CORS_ORIGIN` line of `apps/server/.env` or the next full deploy removes them.

A session that ends mid-use (`UNAUTHORIZED`) clears the cache and goes to `/login`. The 5-minute session cookie cache of the API applies, as everywhere.

## Local development

```bash
# JoyoRogo API with a local D1 (apps/server/.dev.vars: DEV_LOGIN=1, CORS_ORIGIN=http://localhost:3003, JOYOFIT_API_URL=http://localhost:3004)
cd apps/server && bunx wrangler d1 migrations apply DB --local && bunx wrangler dev --port 3000

# JoyoFit cloud API (repo watch-fit), only for sleep stages and the watch face library
cd watch-fit/server && bunx wrangler d1 migrations apply joyofit --local \
  && bunx wrangler dev --port 3004 --var JOYOROGO_AUTH_URL:http://localhost:3000

# the app, http://localhost:3003
cd apps/fit && VITE_SERVER_URL=http://localhost:3000 VITE_DEV_LOGIN=1 bun run dev:bare   # or: bun run dev:fit
```

`VITE_SERVER_URL` is required (an absolute URL; the app refuses to start without it). `VITE_DEV_LOGIN=1` shows "Masuk (dev)" on the Vite dev server only. The dev user is free: to see the app instead of the wall, set its tier in the local D1 (`UPDATE user SET tier = 'founder' WHERE email = 'dev@joyorogo.local'`). Workouts reach the local API through the real `PUT /api/watch-workouts/<start>` route; the JoyoFit API verifies the dev session against the local JoyoRogo.

## Deploy

Two Cloudflare accounts: the JoyoRogo API (`apps/server`) deploys with `CLOUDFLARE_ACCOUNT_ID=3268f27664d77716b648b00c8850469e`; the web apps (`apps/web`, `apps/fit`) deploy on `b7e6f8457bd39fa37a7eea5249799754`, where the zone `joyorogo.com` lives (set as `account_id` in their `wrangler.jsonc`). **Order matters:** the web app calls the JoyoRogo API, which calls the JoyoFit API.

1. **JoyoFit cloud API** (repo `watch-fit`, `server/`), first, because the proxy forwards to it and a missing route would answer 404:
   ```bash
   cd watch-fit/server
   bun run db:migrate:remote     # migration 0010_web_watchfaces (a new table: safe before the code)
   bunx wrangler deploy          # /v1/sleep and /v1/watchfaces; nothing existing changes
   ```
   This account is `b7e6f8457bd39fa37a7eea5249799754` in that repo's `wrangler.jsonc`; deploy it the way the JoyoFit API is normally deployed.
2. **JoyoRogo API** (`apps/server`): the `/api/fit/*` proxy, `JOYOFIT_API_URL`, CORS methods `PUT`/`DELETE`, the `fitWeb` procedures. Put `https://app.fit.joyorogo.com` in the `CORS_ORIGIN` line of `apps/server/.env` too (`scripts/deploy.sh` rewrites the var from it), then `scripts/deploy.sh` or `cd apps/server && bunx wrangler deploy`.
3. **JoyoFit web app**:
   ```bash
   scripts/deploy-fit.sh
   # which is: cd apps/fit && VITE_SERVER_URL=https://api.joyorogo.com bunx vite build && bunx wrangler deploy
   ```
   `apps/fit/wrangler.jsonc` is assets only (`dist`, SPA fallback, no script) with the custom domain `app.fit.joyorogo.com` (`workers_dev` is off: a `workers.dev` origin would not pass CORS).
4. **JoyoFit phone app** ("Dari web" in Watchfaces, JS only): the usual OTA (`scripts/ota.sh "message"` in `watch-fit`; no native change, no runtime version bump). Until it is out the library works on the web and the phone ignores it.

A step can go out alone: the web app without the JoyoFit API shows an error card with a retry on the stage and watch face parts only; the phone section is independent.

## Checks

```bash
bun test packages/api/src/routers/fit-web.test.ts apps/fit/src apps/server/src/fit-proxy.test.ts packages/workout-view/src
cd packages/workout-view && bunx tsc --noEmit
cd apps/fit && bunx tsc -b ../../packages/api && bunx vite build && bunx tsc --noEmit   # check-types does all three
cd apps/web && bun run check-types                                                      # still builds with the moved map
bun run i18n:check
```

## Koneksi (`/koneksi`)

One page, three sections, namespace `fitWebConnect`. Code: `routes/_auth/koneksi.tsx`, `components/connect/*`, `lib/coach/*`, `lib/export/*`.

### 1. AI apps (MCP)

The existing connector (`docs/mcp-connector.md`) managed from the web: `mcpConnection.info` (address + whether Pro is active), `.list` (authorized OAuth clients: name, redirect hosts, scopes, first consent, last call, calls in 30 days), `.revoke({ clientId })` (behind a confirm sheet, then the list reloads) and `.activity({ limit: 30 })` (the `mcp_audit` log: tool, app, time, outcome, the dates it asked for; a table from 1280 px, cards below). The page shows the address with a copy button (Clipboard API, `execCommand` fallback, the address stays selectable), the Claude and ChatGPT steps worded as on `joyorogo.com/panduan/ai` (consent happens in the AI app and on `joyorogo.com/koneksi/izin`, not here; Pro is needed for any tool call to answer), the seven tools and what is never shared, and the limits (60 calls per minute, 1000 per 24 h, audit kept 90 days, revoke is immediate). Nothing new on the server.

**API keys: none, on purpose.** Better Auth in `packages/auth` has no API-key plugin (`@better-auth/api-key` is not installed, the plugins are `expo`, `dev-login`, `mcp` and `jwt`). The oRPC router is also served as OpenAPI under `/api-reference` (`apps/server/src/index.ts`), but every procedure authenticates with the session cookie only, so a script cannot call it with a token. The only token-based access to a person's data is MCP over OAuth 2.1 (read only, Pro only, scoped, revocable, audited). The page says so in one sentence with a link to the guide. Adding personal keys would be a new auth feature (plugin, table, a Bearer path in `createContext`, scopes, audit), not a web page.

### 2. Coach chat

A chat on `coach.chat` / `coach.status` (`docs/coach.md`). Enter sends, Shift+Enter is a new line (an IME confirmation is not a send), the log is a `role="log"` live region, the newest message scrolls into view, the daily allowance (`chatUsedToday` of `chatDailyCap`, from `coach.status` and each reply's `used` / `cap`) sits above it. Answers: a **flagged** reply (injury or medical, answered by the server without the model and without spending the cap) is shown as the server wrote it, marked "Jawaban khusus keselamatan"; `FORBIDDEN` with `data.paywall` replaces the chat with the Pro card; `TOO_MANY_REQUESTS` with `data.coachCapReached` locks the input with the reset time (00:00 WIB); `cap` 0 or `SERVICE_UNAVAILABLE` shows "switched off"; a model failure shows the server's localized message and a retry that re-sends the same conversation; a network failure says so. Nothing is stored on the server. The conversation lives in the tab: React state mirrored to `sessionStorage` under `joyofit-web:coach:<user id>` (gone when the tab closes, never `localStorage`), "Hapus percakapan" empties both. It is not wiped by sign-out until the tab closes, but another account in the same tab reads another key.

The `snapshot` the phone normally builds is built by `lib/coach/snapshot.ts` (pure, tested, validated against the server's `coachChatInputSchema` in the test) from `fitWeb.recovery` (last 60 days) and `fitWeb.workouts` (last 30 days): readiness, load status and ratio, HRV state with its recent and baseline means, last night's sleep with need and 14-day debt, strain yesterday, today and the 7-day mean, resting heart rate, VO2max and the ten newest workouts. Not guessed: `suggestion` and `plan` are null (the server fills the plan from the stored document), workout `strain` is null and `matchedPlan` false, HRV is left out without a status or enough readings, a word outside the server's enums is dropped. A failed read sends an all-null snapshot rather than blocking the chat.

### 3. Export

Files are built in the browser from the stored document, `GET {API}/api/watch-workouts/<start>/blob` (cookie, gunzipped with the server's size ceiling and validated with the server's own `readDoc`), and handed over as a Blob URL (revoked after 30 s). Nothing is uploaded. The encoders load on demand (`lib/export/run.ts` is a lazy chunk).

| Format | What | Notes |
|---|---|---|
| GPX | Track with elevation, UTC time, `gpxtpx:hr` and `gpxtpx:cad` (Garmin TrackPointExtension v1) and `gpxpx:PowerInWatts` (Garmin PowerExtension v1) | Only samples with a GPS fix are track points; an indoor workout has no GPX (the button is off, bulk skips it). Cadence is JoyoFit's (steps per minute on foot, rpm on a bike). |
| FIT | Activity file: file_id, device_info, timer events, one `record` per sample (position, distance, altitude, heart rate, cadence, speed, power), one `lap` per recorded lap (one for the workout when fewer than two), session, activity | `lib/export/fit-encoder.ts` is JoyoFit's own writer (`src/features/strava/fitEncoder.ts` in the JoyoFit app repo), `fit-activity.ts` follows its Strava file layout without pause detection (the document does not say where the watch paused, so there are no pause events; total timer time is the watch's active time when it is 30 s or more under the elapsed time). Foot cadence is halved to strides per minute with the odd step in `fractional_cadence`. Distance per record is the GPS path scaled so the last fix is the watch's total. Local time is WIB. |
| JSON | `joyofit-workout` v1: the watch's record, the list-row summary, the full `WorkoutAnalysis` and every decoded point (one per line) | The stored document made readable. |

**One workout:** the "Ekspor" buttons (GPX, FIT, JSON) in the header of `/latihan/<start>`. **Many:** the card on `/koneksi`: range (7, 30, 90 or 365 days of `fitWeb.workouts`) and format, at most **100** workouts per archive (newest first, the page says so), fetched one after the other with a progress bar and a cancel (cancel or sign-out downloads nothing), one `joyofit-export-<from>_<to>-<format>.zip` (`lib/export/zip.ts`, a store-only writer, no zip64, names UTF-8, tested against JSZip and `unzip -t`). A workout that fails (deleted, unreadable, no GPS) is skipped and listed with its reason; one file is downloaded as it is.

### Tests

`apps/fit/src/lib/export/*.test.ts`: the FIT file decodes with `@garmin/fitsdk` to the same samples, laps and totals (run with laps, ride with power, treadmill without GPS, a pause), GPX parses strictly with `@xmldom/xmldom` (positions, times, heart rate, cadence, power, escaping), the ZIP reads with `jszip` and `unzip -t`, the blob fetch maps every API answer, the bulk runner (skips, failures, cancel, sign-out, name clashes). `lib/coach/snapshot.test.ts`: the snapshot builder, the payload rules, stored-message parsing and the error classes. Test-only dependencies of `apps/fit`: `@xmldom/xmldom`, `jszip`.

Not covered: the chat against the real model (the local `AI` binding is remote and may bill; the page was checked with `**/rpc/coach/chat` fulfilled by Playwright), and Garmin Connect / Strava importing the FIT and GPX files (checked with the Garmin SDK and `xmllint`, not with those services).
