# JoyoFit cloud workouts (Pro)

Every workout JoyoFit records, with its per-sample streams and the analysis, is kept in JoyoRogo for Pro accounts. It survives a lost phone, shows on the JoyoRogo web page `/jam` and restores onto a new phone after login.

## Where it lives and why

**JoyoRogo is the canonical store** (D1 `watch_workout` for the list numbers, R2 for the document of each workout, in the existing media bucket under `watch/<user id>/`).

- The shared-post workout detail (`post_workout_detail`, the analysis a post carries) already lives here, and so do `WorkoutAnalysis` (types, strict zod schema) and the web components that draw it. The new web page reuses them as they are.
- The Pro rule (`premiumUnlocked`), the account wipe (`/api/privacy/delete-my-data`, `privacy.deleteMyAccount`) and the privacy copy are JoyoRogo's. One more table and one more R2 prefix join the same wipe, no second place to forget.
- JoyoFit's own cloud (`joyofit-api`) keeps steps, sleep, devices, imports, family and Strava. It had a copy of workouts and GPS points (id, lat, lon, altitude, HR only, no analysis, no web reader); new app builds stop sending workouts there. The old table is dropped once those builds are gone.
- A shared post stays a snapshot (the author may hide the route or the heart rate); the cloud copy is private and complete. They are not merged.

## One document per workout

`PUT /api/watch-workouts/<start>` with a gzip body. The document (`WatchWorkoutDoc`, `packages/api/src/lib/watch-workout.ts`) holds the local `workouts` row, every `workout_points` row by column (GPS, HR, altitude, speed, cadence, stride, power, delta coded) and the `WorkoutAnalysis`. The D1 row is read out of the document, so a list row can never show other numbers than the analysis: distance, moving time, elapsed time, elevation gain/loss, heart rate all come from `analysis` when there is one.

| Piece | Rule |
|---|---|
| Key | `(user, start)` where `start` is unix seconds; the local table is `UNIQUE(start)` too. A second upload of a start replaces the first. |
| Dedupe | Same gzip bytes (sha-256): `unchanged`, nothing written. Different bytes: replaced, `version + 1`. |
| Edits | The phone uploads again when its row changed (`rev`) or its analysis engine is newer (`engineRev`). |
| Delete | `watchWorkout.remove` deletes the document and keeps the row as a tombstone (`deletedAt`). Phones pull it as a delete and drop their copy; an upload of that start answers `410 deleted`. |
| Wipe | `watchWorkout.wipe` deletes rows and documents with no tombstone. Phones stop syncing (the app turns sync off) so nothing is quietly uploaded again. |
| Pro gate | Uploads need Pro (`402 {error: "founder_required", paywall: true}`). Reading, downloading, deleting and wiping stay open, so data is never locked away. |
| Limits | 6 MB per upload, 30 MB after gunzip, 100 000 points, 400 MB per account. |
| Size | An hour at 1 Hz with GPS, HR and cadence is about 25 to 40 KB compressed; the app shows an estimate before uploading. |

## API

oRPC `watchWorkout.*` (JSON, cookie session):

- `status` -> `{ unlocked, count, bytes, quotaBytes, lastChangeAt }`
- `list({ cursor? })` -> `{ items, nextCursor }`, newest first, 30 per page, `cursor` = `start` of the last item.
- `detail({ start })` -> `{ item, analysis }`
- `changes({ since })` -> `{ items, cursor, hasMore }`: oldest change first, tombstones included (`deletedAt` set), 100 per page. `since` is `null` or the `cursor` of the previous page `{ updatedAt, start }`.
- `remove({ start })` -> `{ removed }`, `wipe()` -> `{ deleted }`.

REST (`apps/server/src/watch-workout.ts`):

- `PUT /api/watch-workouts/:start` -> `{ start, version, status: "created" | "updated" | "unchanged", bytes }`. Errors: `401`, `402 founder_required`, `400` (`bad_gzip`, `bad_json`, `bad_doc`, `analysis_invalid`, `analysis_mismatch`), `410 deleted`, `413` (`too_large`, `quota`), `503`.
- `GET /api/watch-workouts/:start/blob` -> the stored gzip document (`404` when missing or deleted).

## On the phone

- `cloud_workout` (migration 13 of the shared schema): one row per uploaded or restored workout (`start`, `rev` uploaded, `engine_rev`, `version`, `hash`, `bytes`). A workout is pending when it has no row, its `rev` moved, or its `engine_rev` is below `ANALYSIS_ENGINE_REV`. Progress is kept per workout, so the backfill of existing history is resumable after any interruption.
- Restore: `changes` from the stored cursor, download each document, insert the local rows (skipping a `start` that exists), record it in `cloud_workout` so it is not uploaded again; a tombstone deletes the local copy.
- Settings, Cloud sync: last sync, workouts in the cloud and bytes, manual sync, upload on Wi-Fi only, estimate of what is waiting, wipe.
