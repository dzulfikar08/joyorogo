# Energy model: base target, counted activity, Sisa

**Sisa = base eat target (+ assumed activity on a day without watch data) + counted activity − eaten.** One pure
function decides the activity (`packages/api/src/lib/exercise-credit.ts`); `day.summary` puts the budget into
`targets.eatKcal` and its parts into `targets.assumedKcal` and `targets.exerciseKcal`. Clients render those numbers and
never compute them.

## Base target (`computeTargets`, `computeMaternalTargets`)

- Loss: base = max(round5(BMR − deficit), floor). BMR is Mifflin-St Jeor. **No daily movement is assumed**: there is no
  activity multiplier and no planned "Bakar" in the target. The whole planned deficit is a food cut. Floors: 1500 male,
  1200 female. The floor binds often (any male with BMR − deficit under 1500); `PLAN_CLAMPED` then shows and activity is
  what opens room above it.
- Gain: base = round5(BMR) + surplus (+200 to +700).
- Hamil / Menyusui: the AKG-based target keeps its old activity multiplier (1.25 / 1.35 / 1.45) so it never drops.
  Counted activity is added on top and can only raise it.
- The measured TDEE (`adaptiveTdee`, energy balance over 28 days) is **not applied** any more: it measures everything the
  person burns outside logged workouts, which is the daily movement that now comes from real data and would be
  counted twice. The function and its tests stay in `engine.ts`.
- `Targets.burnKcal` stays as a movement goal for the exercise screens. It is not part of the eat target.

## The day's activity (`exerciseCredit`)

Real data only.

- **All-day active energy** (the energy above rest of the whole day): the watch's own total from JoyoFit
  (`fitness_score.active_kcal`, pushed with `fitness.upsertScores`: the sum of the watch's minute step frames, the same
  data JoyoFit writes to Health Connect as ActiveCaloriesBurned) or the health store's (`daily_activity.active_calories`,
  Health Connect / Apple Health read by the JoyoRogo app). They are two views of the same energy and are never added:
  the larger valid one counts. A reading is **ignored** when it is empty, above 6000 kcal, or absurdly low for the day's
  steps (under 0.01 kcal per step from 3000 steps, e.g. 0 active on a day with 15 000 steps).
- **Recorded workouts** (`exercise_log`, `source = 'rest'` excluded) fall in two buckets:
  - *replaced by all-day*: the watch's workouts (`joyofit` `watch:` rows) and the health store's imports
    (`health_connect`, `apple_health`). When a valid all-day total exists it **is trusted over these entries**: they are
    inside it, and an imported workout can carry an inflated estimate (15 Okt: all-day 254, two Apple Health walks of 471
    and 650 kcal → active 254). JoyoFit strength and phone-recorded rows (`strength:`, `phone:`) are in this bucket only
    when the all-day total is the watch's own (JoyoFit); with a health-store total they add on top.
  - *never inside all-day*: `manual` and `strava`.
- `active = allDay + sum(other workouts)` on a day with a valid all-day total; without one, `active = sum(every workout)`.
  A watch workout reaching JoyoRogo twice (from JoyoFit and from Health Connect) is already one row
  (`import-dedupe.ts`). Known approximation: a manual or Strava row for something the watch also measured is counted
  twice (delete it, or turn it off).
- `counted = min(cap, pct × active)` (or 0 when the switch is off).
- **Assumed daily activity** (setting "Aktivitas harian (perkiraan)": none 0 default, light +150, moderate +300, active
  +500 kcal): added to the base **only on a day without valid all-day data**; not multiplied by `pct`, not capped by
  `cap`. It applies even when the exercise switch is off (it is part of the base).

Settings (Profil > Target & tubuh > Kalori olahraga; synced rogo prefs in `rogo-prefs.ts`; the server reads them from
`sync_record` ns `rogo`, kind `pref`; a missing or tombstoned record means the default):

| key | values | default |
|---|---|---|
| `exercise.addBack.enabled` | on / off | on |
| `exercise.addBack.pct` | 50 to 100, step 5 | 75 |
| `exercise.addBack.cap` | 500, 1000, 1500, `none` | 1000 |
| `exercise.assumedActive` | 0, 150, 300, 500 | 0 |

The earlier steps-above-threshold option (`exercise.addBack.source`, `.stepThreshold`) is dropped: all-day energy
replaces it. Records of those keys that older builds wrote are ignored.

## Where the number is used

`day.summary` (Beranda, Makan, widgets), `fasting.today` and the daily fasting push reminder, readiness guidance (carb
bar and room), and the MCP `get_daily_totals` (`activeKcal`, `activeSource`, `exerciseAddedKcal`, `assumedKcal` per day;
**Strava rows never count there** because Strava's API terms keep that data out of AI). Gain streaks, challenge and group
targets and diary day colours still use the base plan target: they are per-plan, not per-day.

## Notice

Accounts created before the change (`ADD_BACK_NOTICE_BEFORE_MS`) see a dismissible Beranda card once
(`day.summary.addBackNotice`; the dismissal is the synced pref `dismissed.addBackNotice2`). The id was bumped when the
base changed the second time, so everybody who closed the first notice sees this one.
