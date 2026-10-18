# Strength training moved to JoyoFit

JoyoRogo is food tracking only. Strength training (sets, reps, routines, rest timer) lives in JoyoFit. JoyoRogo shows a
"Latihan sekarang di JoyoFit" card with open / install links (`packages/i18n/src/joyofit-links.ts`, copy under `moved` in
`locales/{id,en}/olahraga.json`) where the logger used to be.

## What stays

- **Nothing is deleted** from D1: `workout_session`, `workout_set`, `workout_custom_exercise`, `workout_routine` and their kcal
  mirror rows in `exercise_log` are kept as a read-only archive. No oRPC procedure was removed.
- **Reads stay**: `workout.catalog|templates|listSessions|getSession|lastSession|previous|exerciseHistory|status|exportAll` and
  `workout.routines.listRoutines`. `exportAll` is what JoyoFit imports old logs from.
- `workout.deleteSession` stays allowed always: people can remove their own data, and it still deletes the kcal mirror.
- The manual quick entry on the Olahraga screen (`exercise.add`, type `angkat_beban` included) is unchanged.
- `social.createPost` kind `latihan` with a `workout_session` id still reads the archive session. Unchanged.
- MCP connector (`lib/fit-data.ts`) only reads `workout_session`; unchanged and still correct for the archive.

## Write lock

Legacy strength writes stay open for a grace period so installed app builds keep working, then reject.

- Grace ends **2026-11-01 00:00 WIB** (UTC+7) = `Date.UTC(2026, 9, 31, 17, 0, 0)`.
- `packages/api/src/lib/strength-lock.ts`: `STRENGTH_WRITES_LOCKED_AT` and `strengthWritesLocked(now = Date.now())`
  (pure; `now` is a parameter so tests pick the clock). Locked from the instant on, inclusive.
- `routers/workout.ts` calls `assertStrengthWritable(context.locale)` first in `saveSession`, `createCustomExercise`,
  `deleteCustomExercise`, `routines.saveRoutine` and `routines.deleteRoutine`. After the instant they throw
  `ORPCError('FORBIDDEN')` with the localized `olahraga:moved.blocked` message and `data: { reason: 'moved_to_joyofit' }`.
  Old builds surface `error.message`, so people read "Latihan beban pindah ke JoyoFit".
- Tests: `lib/strength-lock.test.ts` (before, at, after) and `routers/workout-lock.test.ts` (router, both sides, uses
  `setSystemTime`).

To extend the grace period, move `STRENGTH_WRITES_LOCKED_AT` (and the date in this doc). To remove the lock for good, delete
`strength-lock.ts`, its test, the five `assertStrengthWritable` calls and the helper in `routers/workout.ts`, and
`routers/workout-lock.test.ts`.

## JoyoFit rows in JoyoRogo

JoyoFit mirrors each strength workout into `exercise_log` through `exercise.upsertJoyofit`: `source = 'joyofit'`,
`type = 'angkat_beban'`, `external_id = strength:<workout id>`.

- **Verified source for challenges**: `joyofit` is in `VERIFIED_EXERCISE_SOURCES` (`lib/challenge-db.ts`) next to
  `health_connect` and `apple_health`. It comes from the owner's own tracked workout, so a `workouts` challenge day counts as
  device-backed when verified rows reach the target. `strava` stays excluded from challenges.
- **Protein boost**: a training day raises the protein target to 1.6 g/kg (`proteinGoalG(..., trainingDay)`). A day is a training
  day when there is a legacy `workout_session` that date **or** an `exercise_log` row with `source = 'joyofit'` and
  `type = 'angkat_beban'` (`trainingDayQuery` in `lib/plan.ts`, used by `day.summary` and `day.readinessGuidance`). Manual quick
  entries and other JoyoFit types never count. It is one `UNION ALL ... LIMIT 1` statement in the existing batch, both halves on a
  `(user_id, date)` index. Tested in `routers/day.test.ts`.
