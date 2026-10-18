# Energy model: base target, counted exercise, Sisa

**Sisa = base eat target − eaten + counted exercise.** One pure function decides the counted exercise
(`packages/api/src/lib/exercise-credit.ts`); `day.summary` puts it into `targets.eatKcal` (today's budget) and
`targets.exerciseKcal` (the part that came from exercise). Clients render those numbers and never compute them.

## Base target (`computeTargets`, `computeMaternalTargets`)

- Sedentary TDEE = BMR (Mifflin-St Jeor, unchanged) × **1.2**. The profile's old low/mid/high activity level no longer
  moves the number. The measured TDEE (28 days of intake, weight slope and logged exercise) still replaces it within
  ±15% of the new formula; because it subtracts logged exercise it is also a non-exercise figure.
- Loss: base = max(round5(TDEE − deficit), floor). The whole planned deficit is a food cut now; the old planned
  "Bakar" (200 to 400 kcal) is gone from the eat target. Floors are unchanged (1500 male, 1200 female). Because the
  base is lower than before, the floor binds more often and then `PLAN_CLAMPED` is set; exercise is what opens room
  above the floor.
- Gain: base = round5(TDEE) + surplus (+200 to +700), as before, on the sedentary TDEE.
- Hamil / Menyusui: the AKG-based target keeps its old activity multiplier (1.25 / 1.35 / 1.45) so it never drops.
  Counted exercise is added on top and can only raise the target.
- `Targets.burnKcal` stays as a daily movement goal for the exercise screens. It is not part of the eat target.

## Counted exercise (`exerciseCredit`)

`counted = min(cap, pct × (workoutKcal + stepKcal))`

- `workoutKcal`: today's `exercise_log` rows from every source (manual, JoyoFit watch and strength, Health Connect,
  Apple Health, Strava), except `source = 'rest'`. This is the same total as the "Olahraga hari ini" tile.
- `stepKcal` (only when the source setting is "workouts+steps" and a step count synced): steps above the threshold
  × 0.0005 kcal per kg of body weight per step. Walking on the flat costs about 0.5 kcal per kg per km (ACSM walking
  equation, ~0.1 ml O2/kg/m above rest); a step is 0.7 to 0.8 m, so 0.0004; 0.0005 allows for brisker walking and
  stairs. Steps inside recorded walks and runs are not counted twice: the steps counter does not say which steps belong
  to a workout, so `duration × cadence` (jalan 100, jalan cepat 115, lari 160 steps/min) is subtracted from the day's
  steps before the threshold. This is an approximation: workouts of other types, or without a duration (many Health
  Connect rows), subtract nothing.
- `pct` exists because watches and apps overestimate calories; 75% is the default middle.
- The cap bounds the day's addition (default 1000 kcal).

Settings (Profil > Target & tubuh > Kalori olahraga; synced rogo prefs, see `rogo-prefs.ts`; the server reads them from
`sync_record` ns `rogo`, kind `pref`, a missing or tombstoned record means the default):

| key | values | default |
|---|---|---|
| `exercise.addBack.enabled` | on / off | on |
| `exercise.addBack.pct` | 50 to 100, step 5 | 75 |
| `exercise.addBack.source` | `workouts`, `workouts+steps` | `workouts` |
| `exercise.addBack.stepThreshold` | 3000 to 10000, step 500 | 5000 |
| `exercise.addBack.cap` | 500, 1000, 1500, `none` | 1000 |

Off means Sisa is base − eaten.

## Where the number is used

`day.summary` (Beranda, Makan, widgets), `fasting.today` and the daily fasting push reminder, readiness guidance
(carb bar and room), and the MCP `get_daily_totals` (`exerciseAddedKcal` per day; **Strava rows never count there**
because Strava's API terms keep that data out of AI, so for a Strava user the MCP number can be lower than the app).
Gain streaks, challenge and group targets, and diary day colours still use the base plan target: they are
per-plan, not per-day.

## Notice

Accounts created before the change (`ADD_BACK_NOTICE_BEFORE_MS`) see a dismissible Beranda card once
(`day.summary.addBackNotice`; the dismissal is the synced pref `dismissed.addBackNotice`).
