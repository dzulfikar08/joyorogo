# Energy model: TDEE target, counted activity, Sisa

**Sisa = base eat target + counted activity − eaten.** The base is **TDEE less the plan's deficit**, with TDEE = BMR ×
the activity factor of the level the person chose. Measured activity (watch, Health, logged workouts) only **raises**
the day's budget, and only by what goes **beyond** the movement the factor already contains. One pure function decides
the activity (`packages/api/src/lib/exercise-credit.ts`); `day.summary` puts the budget into `targets.eatKcal` and the
counted part into `targets.exerciseKcal`. Clients render those numbers and never compute them.

## Base target (`computeTargets`, `computeMaternalTargets`)

- **BMR** is Mifflin-St Jeor: `10 × kg + 6.25 × cm − 5 × age + 5` (male) or `− 161` (female).
- **Activity level** (`profile.activityLevel`) is chosen by the person from five standard factors:

  | level | factor | for whom |
  |---|---|---|
  | `sedentary` | 1.2 | mostly sitting (desk job, little walking) |
  | `light` | 1.375 | light daily movement, on their feet some of the day |
  | `moderate` | 1.55 | on their feet much of the day, or a physical job |
  | `active` | 1.725 | heavy physical work most of the day |
  | `very_active` | 1.9 | very heavy labour, athlete-level daily load |

  **The level describes daily life WITHOUT the workouts the person logs.** Logged workouts and measured activity are
  added separately (below); picking a high level because of workouts would count them twice. Every place that asks for
  the level says so (`energy:pickRule`).
- **TDEE = BMR × factor.** The thermic effect of food (TEF, about 5 to 15% of daily expenditure, Westerterp 2004) is
  already inside these factors, because they come from total expenditure: it is **not added separately**.
- Loss: base = max(round5(TDEE − deficit), floor). Deficit rules are unchanged: needed deficit =
  (weight − target) × 7700 / days, clamped to 250..1000 kcal a day. Floors: 1500 male, 1200 female. The floor still
  binds for low factors on a heavy cut (`PLAN_CLAMPED`), and the level picker says so (`floored`).
- Gain: base = round5(TDEE) + surplus (+200 to +700).
- Maintenance (at or below the target weight, or the goal is to hold): base = round5(TDEE).
- Hamil / Menyusui: the AKG-based target keeps **its own multipliers** (`MATERNAL_ACTIVITY_FACTOR`: 1.25 / 1.35 / 1.45
  for the levels migrated from low / mid / high, i.e. sedentary / light / moderate; 1.55 and 1.65 continue the same
  steps for active / very active), so the maternal target does **not** change numerically. Counted activity is added on
  top and can only raise it.
- The measured TDEE (`adaptiveTdee`, energy balance over 28 days) is never applied to the plan. It only produces a
  *recommended level* the person may apply (see Recommendations).
- `Targets` exposes `bmr`, `level`, `factor`, `tdee` and `includedKcal`; `needsBreakdown` exposes the same for the
  "Kebutuhan harianmu" sheet. `Targets.burnKcal` stays as a movement goal for the exercise screens, not part of the
  eat target.

### Worked example

Male, 26 years, 171.5 cm, 107.7 kg, target 78 kg by 2027-06-04 (on 2026-10-19): BMR = 10 × 107.7 + 6.25 × 171.5 − 5 ×
26 + 5 = 2023.9. The deficit asks for 29.7 kg × 7700 / 228 days = 1003, clamped to 1000.

| level | factor | TDEE | TDEE − 1000 | base target | movement inside the factor |
|---|---|---|---|---|---|
| sedentary | 1.2 | 2429 | 1429 | **1500** (floor) | 162 |
| light | 1.375 | 2783 | 1783 | **1785** | 481 |
| moderate | 1.55 | 3137 | 2137 | **2135** | 799 |
| active | 1.725 | 3491 | 2491 | **2490** | 1118 |
| very active | 1.9 | 3845 | 2845 | **2845** | 1437 |

The old model (bare BMR − 1000 = 1024, floor) gave 1500 for everybody.

## The day's activity (`exerciseCredit`)

Real data only, and it can only **raise** the budget.

- **Movement the factor already contains** (`Targets.includedKcal`, `movementInFactorKcal`):
  `included = max(0, TDEE − BMR − 10% of TDEE)` (the 10% is the TEF share). Light, owner example: 2783 − 2024 − 278 =
  481 kcal.
- **All-day active energy** (the energy above rest of the whole day): the watch's own total from JoyoFit
  (`fitness_score.active_kcal`, pushed with `fitness.upsertScores`) or the health store's
  (`daily_activity.active_calories`, Health Connect / Apple Health read by the JoyoRogo app). They are two views of the
  same energy and are never added: the larger valid one counts. A reading is **ignored** when it is empty, above 6000
  kcal, or absurdly low for the day's steps (under 0.01 kcal per step from 3000 steps, e.g. 0 active on a day with 15 000
  steps). The rule is the same for phone-only Health data and for watches.
- **Recorded workouts** (`exercise_log`, `source = 'rest'` excluded) fall in two buckets:
  - *inside the all-day total*: the watch's workouts (`joyofit` `watch:` rows) and the health store's imports
    (`health_connect`, `apple_health`). When a valid all-day total exists they are not counted separately (an imported
    workout can carry an inflated estimate: 15 Okt, all-day 254, two Apple Health walks of 471 and 650 kcal). JoyoFit
    strength and phone-recorded rows (`strength:`, `phone:`) are in this bucket only when the all-day total is the
    watch's own; with a health-store total they add on top.
  - *never inside all-day*: `manual` and `strava`.
- `extra` = what the budget is raised from:
  - day with a valid all-day total: `max(0, allDay − included) + other workouts`
  - day without one: `device workouts + other workouts` (they are on top of the factor, which is daily life without
    logged workouts)
- `counted = min(cap, pct × extra)` (or 0 when the switch is off).
- `activeKcal` (the day's measured activity: all-day total, else the device workouts, plus other workouts) is what the
  "Terbakar" ring of the Olahraga screens shows; it is not what is counted.

A phone left on a desk that logs 10 kcal is below the factor's movement, so `extra = 0` and the day is exactly the
base. A watch day of 700 kcal for a person whose factor contains 481 adds `pct × 219`.

Known approximation: a manual or Strava row for something the watch also measured is counted twice (delete it, or turn it
off). A watch workout reaching JoyoRogo twice (from JoyoFit and from Health Connect) is already one row
(`import-dedupe.ts`).

Settings (Profil > Target & tubuh > Kalori olahraga; synced rogo prefs in `rogo-prefs.ts`; the server reads them from
`sync_record` ns `rogo`, kind `pref`; a missing or tombstoned record means the default):

| key | values | default |
|---|---|---|
| `exercise.addBack.enabled` | on / off | on |
| `exercise.addBack.pct` | 50 to 100, step 5 | 75 |
| `exercise.addBack.cap` | 500, 1000, 1500, `none` | 1000 |

The earlier `exercise.assumedActive` ("Aktivitas harian (perkiraan)": +0/150/300/500 kcal) is **removed**: the factor
replaces it. Records of it, of `exercise.addBack.source` / `.stepThreshold` and of the dismissals
`dismissed.addBackNotice` / `dismissed.addBackNotice2` that older builds wrote are ignored.

Why pct is below 100 and why activity only raises: wrist devices are not accurate for energy. Of seven devices tested,
none got its energy error below 20% (Shcherbina et al. 2017), so by default 75% of the extra counts, and a low reading
never lowers a target built on a standard factor.

## Recommendations ("lebih akurat")

Shown where the level is chosen (onboarding, Profil > Target & tubuh). They are recommendations: the person taps
"Pakai". Nothing is ever applied automatically. Server: `profile.activityGuide` (read), `profile.setActivityLevel`
(write). Pure logic: `lib/activity-guide.ts`.

- **From steps.** With at least 5 days with steps (> 0) in `daily_activity` in the 14 days before today (today is
  partial and left out), the average steps map to a level by the Tudor-Locke & Bassett (2004) step index:
  under 5000 `sedentary`, 5000 to 7499 `light`, 7500 to 9999 `moderate`, 10 000 to 12 499 `active`, 12 500 and up
  `very_active`. (The paper writes "above 12 500" for highly active; exactly 12 500 is a coin flip we settle upward.)
  Onboarding only shows it when the data already exists; it never adds a permission flow.
- **From the weight trend** (calibration). `adaptiveTdee` over the 28 complete days before today needs at least 14 logged
  days and 6 weigh-ins spanning 14 days; on top of that the recommendation requires the weigh-ins to span **at least 21
  days** and **at least 70% of the 28 days logged** (20 days; a day under 800 kcal is not logged). Then:
  `implied factor = (measured TDEE − average logged workout kcal per day) / BMR`, where measured TDEE is `adaptiveTdee`
  without subtracting workouts (so they come out exactly once). Rest and Strava rows never take part (Strava's API terms
  keep its data out of weight and food analytics). The recommended level is the one whose factor is nearest; the UI shows
  measured kcal against the formula's (BMR × the current factor). Hamil / Menyusui get no calibration: weight is
  expected to move. The 7700 kcal/kg used for the weight slope is an approximation (Hall et al. 2011), which is why this
  stays a suggestion.

The level picker lists all five levels with factor, explanation, example and **the target that level would give this
person** (`profile.activityGuide.options`, or `activityOptions` computed locally in onboarding).

## Where the number is used

`day.summary` (Beranda, Makan, widgets), `fasting.today` and the daily fasting push reminder, readiness guidance (carb bar
and room), the weekly recap (each judged day against its own budget), and the MCP `get_daily_totals` (`activeKcal`,
`activeSource`, `exerciseAddedKcal` per day; `get_profile` carries `activityLevel`, `activityFactor`, `tdeeKcal` and
`includedActivityKcal`; **Strava rows never count there**). Callers that build a plan pass
`plan.targets.includedKcal` to `exerciseCredit` / `loadDayCredit`. Gain streaks, challenge and group targets and diary day
colours use the base plan target: they are per-plan, not per-day.

The ring and number "Terbakar" on the Olahraga screens (web and native) is `activeKcal` of `day.summary`'s credit
(`dayActiveKcal`), not the sum of the listed rows. Without the summary the ring falls back to the sum of the rows.

**Seeing it.** The native app refetches its stale queries (older than 2 minutes) when it returns to the foreground
(`src/lib/query-focus.ts`). The web keeps its query cache in localStorage and drops it when the build, the WIB day or the
account changes (`src/lib/cache-buster.ts`).

**Why an imported row can be high.** An Apple Health / Health Connect workout without recorded energy is imported as a
MET estimate, `MET × 3.5 × kg × minutes / 200` at the latest weight, gross of resting energy: a 50 min walk at 107.7 kg
is 471 kcal, where the watch measured 188.

## Migration and the one-time notice

Migration `0048_activity_levels.sql` renames the stored levels: `low` to `sedentary`, `mid` to `light`, `high` to
`moderate`. The old values are not accepted by the API any more.

Accounts created before `ENERGY_NOTICE_BEFORE_MS` (`lib/energy-notice.ts`) see a dismissible Beranda card once
(`day.summary.energyNotice`; the dismissal is the synced pref `dismissed.energyModel`). It says in plain words that the
target is now built on TDEE, shows **old base target → new base target** for that person (the old model is the same plan
with factor 1, the bare BMR), their migrated level with its factor, and a button to the activity-level settings. Hamil /
Menyusui users see their target did not change. Accounts created later never see it. Set `ENERGY_NOTICE_BEFORE_MS` to the
moment of the deploy.

## Sources

Every one was checked against its PubMed / FAO page; the same list is shown in the app ("Sumber", `energy:sources.*`,
`lib/energy-sources.ts`).

1. Mifflin MD et al. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr
   1990;51(2):241-247. (BMR)
2. FAO/WHO/UNU. Human energy requirements: report of a Joint FAO/WHO/UNU Expert Consultation. FAO Food and Nutrition
   Technical Report Series 1, Rome, 2004. (total energy expenditure as a multiple of BMR, PAL; Table 5.3 lifestyle
   ranges 1.40 to 1.69 / 1.70 to 1.99 / 2.00 to 2.40.) The 1.2 / 1.375 / 1.55 / 1.725 / 1.9 steps are the standard
   multipliers commonly used with a BMR equation; no single primary source for those exact numbers could be verified, so
   the report is cited for the concept, not for the five numbers.
3. Westerterp KR. Diet induced thermogenesis. Nutr Metab (Lond) 2004;1:5. (a mixed diet at energy balance costs 5 to 15%
   of daily expenditure; 10% is used for the TEF share.)
4. Shcherbina A et al. Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a
   diverse cohort. J Pers Med 2017;7(2):3. (no device achieved an energy error below 20%.)
5. Tudor-Locke C, Bassett DR Jr. How many steps/day are enough? Preliminary pedometer indices for public health. Sports
   Med 2004;34(1):1-8. (step indices.)
6. Hall KD et al. Quantification of the effect of energy imbalance on bodyweight. Lancet 2011;378(9793):826-837.
   (weight change from an energy gap is dynamic, so 7700 kcal/kg is an approximation.)

## Compatibility with clients already in the field

Native builds up to 1932 (until they update over the air) and web tabs opened before the deploy keep working. The API
accepts and returns the old shapes at the boundary only; each point is marked `COMPAT` in the code and pinned by
`routers/legacy-clients.test.ts`. Remove them once those builds are gone.

- Input: `profile.upsert` (onboarding) still accepts `low` / `mid` / `high` and stores `sedentary` / `light` /
  `moderate` (`activityLevelInputSchema`). The new `profile.setActivityLevel` takes only the new levels.
- Output: `Targets.assumedKcal` (always 0), `Targets.formulaTdee` (= `tdee`), `ExerciseCredit.assumedKcal` (always 0) and
  `day.summary.addBackNotice` (always false; the retired card, `energyNotice` replaces it) are still present, so the old
  needs sheet, snack advice and Beranda do their sums with numbers instead of `NaN`.
- Preferences: an old build that writes `exercise.assumedActive` or `dismissed.addBackNotice2` syncs without error
  (the server stores any `pref` id); neither changes the budget, and the old dismissal does not hide the new notice.
- An old client shows the new levels it does not know (`sedentary`, ...) as empty or the raw value in its read-only
  "activity" row; it does not crash (its label lookup returns undefined). Its own "Aktivitas harian (perkiraan)" setting
  becomes inert: the server ignores it.
