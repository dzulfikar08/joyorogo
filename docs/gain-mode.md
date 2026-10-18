# Naikin BB (weight gain / lean bulk)

JoyoRogo plans for a lower weight by default. When the target weight is **above** the current weight the plan
does the opposite: the daily target is the TDEE **plus a surplus**, "Sisa" becomes "Kurang X kkal lagi", the
coach stops saying "kurangi", and every loss-only text (recaps, milestones, share cards, group view, public
page) says "naik" instead of "turun". All the math is one pure module, `packages/api/src/lib/gain.ts` (tests:
`gain.test.ts`), shared by the server and both clients, built on `engine.ts` the same way `maternal.ts` is.
Nothing here is medical advice; the UI carries `gain:notes.disclaimer`.

## What existed before

There was **no** gain support: no goal column, no surplus. `computeTargets` only knew "weight above target =
deficit" and "weight at or below target = hold" (`MAINTENANCE`). A target above the weight therefore produced a
plain maintenance plan and told the user their weight "is already in the healthy range". The 7700 kcal/kg
constant (`KCAL_PER_KG_FAT`), the TDEE, the target-date sheet and "Sisa" (`remainingKcal`) were all loss-shaped.
Gain extends those instead of duplicating them: `computeTargets` gets one more branch, `checkTargetDate` gets
three more statuses, `remainingKcal` gets a sibling (`gainRemaining`).

## How the mode is chosen

- The profile stores the plan's direction, `profile.goal` (`lose` | `maintain` | `gain`, migration 0039, default
  `lose` so every existing account keeps today's plan) and `profile.goal_start_kg` (the weight when the plan became
  a gain: the baseline of "naik X kg").
- It is derived **when the target is set**: target above the weight (by at least 0.1 kg, compared at 0.01 kg) is
  `gain`, below is `lose`, level is `maintain` (`goalOf`). The onboarding and Settings chooser ("Turunin BB / Jaga
  BB / Naikin BB") sets the target on the right side and sends `goal`; typing a target on the other side flips
  the chooser. The server validates an explicit goal against the target (`goalTargetError`); "Jaga BB" holds
  today's weight with the target date a year out, like a held weight in Hamil.
- **Why a column and not "target > weight, always"**: a user who reaches a loss target and then weighs 0.5 kg
  under it would otherwise be told to start eating a surplus. The goal is stored at the moment the target is
  set, so a later weigh-in never changes it, and a date-only edit keeps it (`resolveGoal`). Once the weight
  reaches a gain target the plan holds (`MAINTENANCE`, `targets.gain = null`).
- **Hamil / Menyusui take precedence.** `buildPlan` branches on the maternal row first, so `targets.gain` is
  always null while they are on. Turning them on stores `goal = maintain` and the held weight; turning them off
  returns to a maintenance plan (the gain is only set again on purpose). `profile.updateTargets` refuses a gain
  goal while a maternal mode is on (`profile.gainMaternal`). Tests: `planGoal` and `buildPlan` in `gain.test.ts`.

## Energy

Target = **TDEE + surplus** (`computeTargets`, `Targets.gain`):

- TDEE is the usual Mifflin-St Jeor x activity multiplier (or the measured TDEE within +-15%), rounded to 5 in
  this mode so `tdee + surplus` is exactly the target on screen. Planned exercise (Bakar) is not added to the
  eating target; if a user trains hard and the weight does not move in 2 to 3 weeks the copy says to eat a
  little more (`gain:plan.burnNote`).
- **Surplus = gap x 7700 / days to the target date, rounded to 5, clamped to +200..+700 kcal/day.**
  The 7700 kcal/kg figure is the usual approximation (Wishnofsky 1958: 3500 kcal per pound of body weight gained
  or lost). It is an approximation: gained weight is partly lean mass and the real cost per kg moves with the mix
  and with the person. That is why the plan watches the trend and the app keeps measured TDEE, instead of trusting
  the constant.
- Pace = surplus x 7 / 7700 kg per week, shown also as percent of body weight (`GainInfo.paceKgPerWeek`,
  `pacePct`).

| Pace (% body weight / week) | Reading | Source / status |
| --- | --- | --- |
| 0.25 to 0.5 | lean band (novice/intermediate) | Iraki 2019, Table 1: "~0.25-0.5" |
| above 0.5 up to 1.0 | "brisk": allowed without a warning, with a note that more of it may be fat; beginners and underweight people (BMI under 18.5) get no note up to 1.0 | app choice, informed by Iraki 2019 (larger surpluses suit novices; a faster early gain is reasonable when restoring weight). The review does not state a number for it. |
| above 1.0, or a date that needs more than +700 kcal | "fast": warning and a suggested later date | app choice |

- Surplus window: the cap of +700 and floor of +200 are product choices bracketing the evidence: Iraki 2019
  recommends +10-20% above maintenance for novice/intermediate bodybuilders (+5-10% advanced), which is about
  +200 to +500 kcal on a 2000-2500 kcal TDEE. It also reports Garthe et al. 2013: elite athletes eating about 600
  kcal more than an ad libitum group gained 1.7 vs 1.2 kg lean mass (not significant) but 1.1 vs 0.2 kg fat, and
  the authors concluded a 200-300 kcal surplus suits highly trained people better than 500. A typical 60 kg man (TDEE 2050) gaining 6 kg in 180 days:
  6 x 7700 / 180 = 257 -> **+255 kcal, target 2305 kcal, 0.23 kg/week, 0.39% of body weight/week (lean)**.
- Suggested later date for a "fast" verdict: the pace of 0.5% of body weight per week (0.75% when underweight),
  never faster than the +700 cap allows (`suggestedDays`). For a 60 kg body gaining 6 kg that is 0.3 kg/week, 140
  days. The slow verdict (`gainSlow`: under +200 kcal asked) keeps the +200 floor and finishes earlier than the
  date, like the loss floor.
- The scale is noisy: a target within 0.1 kg above the weight is "maintain", not a gain.

## Target-date sheet in reverse

`checkTargetDate` (shared by the server and both clients, tests in `gain.test.ts`) returns `gainOk` (lean or
brisk band), `gainFast` (more than 1% of body weight a week, or more than +700 kcal: warning plus the suggested
later date) or `gainSlow` (under +200 kcal: the plan holds the floor and reaches the target earlier). The
existing date sheet shows the verdict and the new daily numbers before saving (`profile.previewTargets`, which
now returns the derived `goal` too). Past, too-far and invalid dates are refused as before.

## Protein

**1.6 to 2.2 g/kg/day, target 1.8** (`PROTEIN_G_PER_KG`), on the lesser of the current weight and the top of the
healthy range (the same rule as the cut target, so a heavy body is not asked for impossible grams). Sources:
Iraki 2019 Table 1 (1.6-2.2 g/kg); ISSN protein and exercise position stand, Jager et al. 2017 (1.4-2.0
g/kg/day is sufficient for most exercising people); Morton et al. 2018 (no further training-induced fat-free
mass gain above 1.62 g/kg/day, upper 95% CI 2.2). The target 1.8 sits above Morton's breakpoint and inside ISSN's
upper bound. Fat 0.5-1.5 g/kg (Iraki) is not tracked as a target.

## "Sisa" flips

Under-eating is now the problem (`gainRemaining`, `gainEatTone`):

- below the target: **"Kurang X kkal lagi"** (still to eat);
- at the target and up to **+300 kcal over it** (`REACHED_MARGIN_KCAL`, the width of a cap step: surplus plus the
  margin never exceeds about the top of the surplus clamp): **"Target tercapai"**;
- more than +300 over: "Lebih X kkal dari target" with a "that's fine" line, no red, no "kurangi".
- The eat ring is never red in this mode: amber only past the margin.
- Streak = **days at 90% or more of the target** (`gainDayHit`, `gainStreak`), server-side in `day.summary`,
  the weekly recap, the group view and the public page. Recap days are `on_target` from 90% and never `over`.

## Coach and AI

- The scan prompt gets one line (`GAIN_PROMPT_NOTE`, loaded with `loadUserNote` in `routers/ai.ts`, Hamil first):
  it forbids calorie/portion/weight-reduction coaching and judging food "too much". It does not touch the kcal
  estimate.
- Restrictive advice is replaced: the snack/portion advice shows a positive line (`gain:coach.scan*`), the
  deficit explainer becomes the surplus explainer, the fat-loss tip becomes a "eat a little, often" tip, and the
  strength tips talk about turning the gain into muscle. `workout.status` no longer returns the "slow the cut"
  hint while gaining. Meal ideas come from a calorie-dense catalog (`gainMealIdeas`: nasi, telur, tempe, ayam,
  tahu, susu, kacang, alpukat, pisang; portions rounded from TKPI 2019 per-100 g values, noted in `ideas.ts`).

## Nudges

An evening reminder when still under the target: native only, a new `gainEvening` row in the existing
reminders card (default off, 20:00, "meals" channel, visible only under a gain plan, same permission gating as
the other reminders, skipped for the day once the target is reached). Web has no meal reminders (Web Push exists
only for intermittent fasting), so web users get the in-app "Kurang X kkal lagi" state.

## Weight chart, recap, shares, groups

- Chart: an upward target line from the weight when the gain began to the target at the target date, plus the
  weekly pace band (0.25-0.5% of body weight per week, 0.5-1% when underweight, `paceBandKgPerWeek`);
  `weight.history().summary.gain`.
- Weekly recap and milestones celebrate the gain ("Naik X kg minggu ini", milestones `gained` at 1, 3, 5 kg); a
  drop is worded neutrally.
- Loss-only copy paths checked: the Beranda recap chips, milestones, the weekly recap (screen and share card), the
  story/share cards, the group view, the feed chips, the public profile page `/u/<code>` (server-rendered:
  "Aku sudah naik X kg"), the strength "slow the cut" hint, the fasting push copy (already neutral), email and
  broadcast templates (none mention weight loss; the admin accuracy digest is not user-facing).

## Safety

Info cards, never alarm colors, never blocking (`GainFlag`):

- **BMI under 17** (WHO moderate thinness): gentle "konsultasi ke dokter atau ahli gizi" note.
- **Rapid unexplained loss**: the smoothed trend falling at 0.5% of body weight a week or faster while the plan
  is to gain: the same note.
- **Target BMI over 25**: "the target is above the healthy range", noted, not blocked.
- Language avoids body-shaming and numeric pressure; the copy never calls anyone "kurus" or sets a score.

## Calorie estimates from photos: the interaction with gain mode

The scan estimator is deliberately **unchanged**. The owner accepts an over-estimate for people losing weight (an
over-estimated meal only makes the plan a little safer; under-estimating is the worse error). In gain mode the
same error flips: an over-estimate means the user ate less than the diary says, so they can sit below the
surplus without seeing it. The accuracy log shows the estimator is not biased high overall (2026-10-17 A/B:
bias about -5% to 0%, 36-41% of runs under, 16-22% over), so the effect depends on the dish, but it matters for
this mode. What the app does: `gain:estimate.*` tells gain users that photo calories are estimates and to judge by
the weight trend over 2 to 3 weeks, and measured TDEE (clamped to +-15%) absorbs a steady bias.

**Proposed option (not built):** an `estimateLean` per-user setting with `high` (today's behavior, default for
lose and maintain) and `neutral` (default for gain). `neutral` would not re-prompt the model; it would only change
the two places that already bias upward on purpose: the density-band upper edge in `applyDensityBand` and the
"serve the larger plate" rounding of ambiguous portions, switching both to the band midpoint. Measure it first with
`scripts/review-scans-ab.ts` (it reports over and under separately) before shipping. A lighter alternative is to
show the scan result as a range and let gain users log the high end by default.

## Data and API

Migration `0039_goal_mode`: `profile.goal` (text, default `lose`, not null) and `profile.goal_start_kg` (real,
null). API: `profile.upsert` / `updateTargets` / `previewTargets` accept `goal`; `profile.myProfile` returns
`profile.goal`, `targets.gain` (`GainInfo`: surplus, raw surplus, gap, pace, band, days and date to target, protein,
BMI, flags), `day.summary` returns `weightGainedKg`, gain milestones, gain ideas and the gain streak,
`stats.weekRecap` returns `gain`, `weight.history().summary.gain`, `group.detail` members carry `today.gaining`.

## Sources

- Iraki J, Fitschen P, Espinar S, Helms E. Nutrition Recommendations for Bodybuilders in the Off-Season: A
  Narrative Review. Sports 2019;7(7):154. doi:10.3390/sports7070154 (Table 1: weekly gain ~0.25-0.5% body weight,
  +10-20% above maintenance, protein 1.6-2.2 g/kg, fat 0.5-1.5 g/kg; advanced lifters more conservative).
  Checked against the PMC full text.
- Aragon AA et al. International Society of Sports Nutrition position stand: diets and body composition. J Int
  Soc Sports Nutr 2017;14:16 (gaining lean mass is driven by a sustained surplus; its size and the trainee's
  experience shape what is gained).
- Jager R et al. International Society of Sports Nutrition position stand: protein and exercise. J Int Soc Sports
  Nutr 2017;14:20 (1.4-2.0 g/kg/day).
- Morton RW et al. Br J Sports Med 2018;52:376-384 (protein beyond 1.62 g/kg/day, upper CI 2.2, adds no further
  training-induced fat-free mass).
- Garthe I et al. Effect of nutritional intervention on body composition and performance in elite athletes. Eur J
  Sport Sci 2013;13:295-303 (numbers as reported in Iraki 2019, not read from the paper).
- Wishnofsky M. Caloric equivalents of gained or lost weight. Am J Clin Nutr 1958;6(5):542-546 (3500 kcal/lb,
  7700 kcal/kg).
- WHO BMI cut-offs: underweight under 18.5, moderate thinness 16.0-16.99, upper healthy limit 24.9.
- TKPI 2019 (`packages/api/src/data/tkpi2019.json`) for the idea portions.

## Known limits

- Measured TDEE (28-day energy balance) uses 7700 kcal/kg for the weight slope, so a lean-heavy gain (cheaper per
  kg) reads the TDEE a little low; the +-15% clamp bounds it.
- The streak counts diary kcal, so under-logging breaks it without meaning under-eating.
- No web push for the evening reminder (see Nudges). The reminder and every native screen need a native build to
  be seen on a device; the web and server parts are live without one.

## Production check (2026-10-18, qa@joyorogo.com, web, English UI, headless Chromium)

Female, 160 cm, 62 kg. Goal chooser to Gain weight, target 66 kg, date 2026-12-03: eating target 2,320 = TDEE 1,650
+ 670 (4 kg x 7700 / 46 days); the target-above-healthy note showed (BMI 25.8). Sisa states with logged food:
1,300 eaten "1,020 kcal still to go"; 2,320 and 2,620 "Target reached"; 2,720 "400 kcal over target" with the
reassurance line; the ring was never red. Target-date sheet, 1 month: "too fast" at 0.9 kg a week (1.5%), suggested
later date 2027-01-17 (91 days), preview surplus +700. Weight page: upward dashed target line and the "Gentle gain
band" (0.2 to 0.3 kg a week). Weekly recap: "Up 0.2 kg this week", "5 of 6 days eating up to target", streak 2
days, no loss wording. Screenshots: `~/.cache/gain-verify/`. The qa profile and its test food rows were reset
afterwards. Not run: native screens (need a native build), the first-run onboarding on a fresh account.
