# AI scan accuracy review, 2026-10-17

## Status (2026-10-17, later the same day)

| Change | Status |
|---|---|
| 1. Calibration guard (`lib/tkpi.ts`) + 2019 reverse containment (`lib/tkpi2019.ts`) | **Shipped.** Unit tests from the table below. |
| 3. Density bands (mayones, bumbu/saus kacang, kacang tanah, nugget) | **Shipped** with the guard (`applyDensityBand`). |
| 5. Numeric-string coercion (`visionItemSchema`) + backslash-escaped answers (`unescapeQuotes` in `repairKeys`) | **Shipped.** Same parser for stream and plain; fixtures `vision-quoted.json`. |
| Gram edit check ("Findings outside the model") | **Fixed where broken**: unlinked diary portion sheet (web + native), `ai.correctScan` rename with stated grams. The 99 g / 300 kcal row was not a user edit, see below. |
| 4. Prompt: sauce reference values | **Shipped.** A/B below. |
| 4. Prompt: dish identity rules (trimmed) + temperature 0.1 | **Not shipped. Running as a shadow test** (`lib/shadow-scan.ts`, `SHADOW_SAMPLE_RATE` default 0.2, `0` = off). Compared with what users save in the daily digest ("Uji bayangan"). Decide after about a week. |
| Rice-weight priors, "visible only" rule | Not shipped (unchanged). |

**99 g / 300 kcal was calibration, not an edit.** `calibrateItems` clamps kcal into the dish's band for a *typical* portion and the vision path does not pass `scaleBand`: `nasi goreng` 99 g with 170 kcal becomes 300, `ayam goreng` 70 g becomes 300, `tempe goreng` 24 g becomes 120 (reproduced with `calibrateItems` after the guard shipped). These are the grams and kcal of scan #4, so the "weighed" grams in the user's note are most likely the grams the app showed, next to a floor-lifted kcal (H1 in `docs/ai-accuracy-log.md`). It over-estimates small portions, which the owner tolerates, so it was left alone; `scaleBand: true` in `calibrateRaw` would be the fix if it should go.

### A/B for the sauce prompt (2026-10-17)

Same code path as the review (`scripts/review-scans-ab.ts`, real `analyzeFoodPhoto`, `gemma-4-26b-a4b-it`), both arms with the new calibration so only the prompt differs. Photos: the 23 negative scans still in `scan-src/` (21 scored against the ranges in the table below, 3 runs each; temporary local copies, deleted afterwards) and the 8 Wikimedia bench photos (3 runs each, kcal bands from `scripts/eval-scans.ts`). The owner dataset (`dataset/`) and consented feedback photos (`feedback/`) were empty.

| Arm | Photos | Runs | in range | under | over | MAPE vs range midpoint | bias | severe under (<75% of low end) |
|---|---|---|---|---|---|---|---|---|
| prompt before | 21 negative scans | 63 | 37% | 41% | 22% | 24.1% | +0.3% | 1.6% (1 run) |
| **prompt with sauce values** | 21 negative scans | 61 (2 failed: 1 timeout, 1 `too_many`) | **48%** | **36%** | **16%** | **19.5%** | -4.6% | 4.9% (3 runs) |
| prompt before | 8 Wikimedia | 24 | 75% | 0% | 25% | 45.2% | - | 0 |
| **prompt with sauce values** | 8 Wikimedia | 24 | 75% | 0% | 25% | 52.7% | - | 0 |

Paired per photo (closer to range, 3% tie band): 11 better, 3 worse, 7 unchanged.

Under-estimates did not increase (41% to 36% of runs). Bias and the severe-under count did move the wrong way, and both come from one photo: #13 (siomay/batagor in peanut sauce) answered "tahu tek" 300 g twice and `matchDish` clamped it to the "tahu" band, 150 kcal (the old prompt named it gado-gado or ketoprak, 350-536). That is a dish-name calibration trap, not something the sauce text asks for (fixed afterwards: a longer name that only matches a single-ingredient library row — tahu, tempe, kerupuk, perkedel, sambal — now takes the generic band; 8 re-runs of #13 gave 450-536 kcal, none named tahu tek, so the fix is covered by unit tests only); without #13 the bias is about -2%. On Wikimedia nothing was under and the MAPE rise is the nasi goreng photo (1270-1990 kcal in both arms) plus es teh 70 to 90. 3 runs per photo, so read differences under ~10 points as noise.

Review of the negatively rated food scans whose photos were still in R2
(`scan-src/`, ~2 day expiry). Everything below this status section was written before any of it shipped: every fix was tested as a
local variant with `scripts/review-scans-ab.ts`, which runs the real
`analyzeFoodPhoto` (same parser, same TKPI calibration, `gemma-4-26b-a4b-it`)
over the Workers AI REST API and only rewrites the prompt text or request body
on the way out. Scans are numbered #1-#23, newest first; no user data is kept in
this repo.

## Data and method

- 23 negative ratings (22 `kurang_akurat`, 1 `salah`); 5 `dilewati` rows were
  not negative. All 23 photos were still in R2 (0 expired).
- 5 of 23 had a user note or reason chips (`kcal_tinggi` on 3, `porsi` on 1).
- The saved diary rows are not linked to `photo_id`; I matched them to the
  scan by user and time. 19 of 23 had a saved row from the same scan. Those rows
  hold the AI items as the user finally saved them (some were renamed or
  re-weighed by the user), so they are "saved AI list", not necessarily the
  first answer. No `scan_correction` row existed for these scans.
- "My estimate" is my own reading of the photo (dishes, piece counts, rough
  grams, standard TKPI-style kcal), as a range. It is not weighed food; treat it
  as +-15%. Where the user gave grams I used those. #3 and #23 are too
  ambiguous to score (excluded from the numbers below).
- Rerun = the current prod prompt 3 times per photo, prod calibration.
- Scores count a run as *in range* if its total kcal is inside my range,
  *under*/*over* if outside. Samples are 62-63 runs over 21 photos, so
  differences under ~10 percentage points are noise.

## Per-scan table

kcal columns are totals for the whole plate. "Saved" = saved AI list (user may
have edited it). "Rerun" = mean (min-max) of 3 prod-prompt runs.

| # | Plate (my reading) | User signal | Saved | Rerun | My est. | Failure classes | User wrong? |
|---|---|---|---|---|---|---|---|
| 1 | Siomay (4 pieces), halved egg, tofu, thick peanut sauce, lime | `salah`; note lists the above | 487 | 801 (795-805) | 500-650 | wrong dish (gado-gado 3/3), extra item (kerupuk, lontong), sauce | no |
| 2 | Box: ~4 fried tofu, tempe, sambal; kangkung-corn; 2 eggs in soy gravy | none | - | 565 (465-755) | 520-680 | kcal density (eggs 85 kcal), piece count | no |
| 3 | Bag of skewered chewy tapioca/fish balls, ~10-15 sticks | none | 450 | 350 (350) | unscored | other (cilok vs basreng vs sempol unreadable, stick count) | cannot tell |
| 4 | Fried rice, fried chicken, kangkung, tempe, large fried batter sheet | `kcal_tinggi`; user weighed: rice 99 g, chicken 70 g, tempe 24 g | 830* | 941 (912-990) | 400-650 | portion too high (rice 200-250 g), extra/mis-split items (bakwan, perkedel) | no |
| 5 | Fruit salad in creamy dressing with cheese, melon, grapes | none | 180, then user changed to salad buah 280 | 193 (180-220) | 230-340 | wrong dish (es buah 3/3), sauce | no |
| 6 | Bowl of mango, pear, apple, red fruit strip | none | - | 313 (298-320) | 150-240 | extra item (kerupuk 3/3, pale pear read as crackers) | no |
| 7 | Large plate of oily mie goreng with meat, sweet iced tea | none | 640 | 580 (520-640) | 650-900 | kcal density (150 kcal/100 g low for oily street mie), portion | maybe |
| 8 | Whole fried duck with serundeng, rice mound, lalapan | none | 790 | 1030 (1030) | 750-1050 | portion inconsistent between runs ("half" 250 g vs "whole" 350 g) | likely yes |
| 9 | Rice, small mie goreng, big greens pile, large crispy fried-chicken crumbs, cucumber | note: rice 100, mie 100, greens 300, crispy chicken 300 g | 695 | 820 (815-825) | 780-1150 | portion too low (greens, crispy chicken 60 g), wrong dish (crispy chicken read as egg/single piece) | partly |
| 10 | Rice + diced balado chicken | none | 570* | 445 (445) | 480-620 | portion too low (chicken 100 g vs ~200 g) | no |
| 11 | Rice, tofu-egg stir fry, 3 chayote wedges | none | 395 | 412 (395-445) | 430-540 | wrong ingredient (tempe vs egg; chayote read as cucumber), portion low | no |
| 12 | Bento: rice, 2 nuggets + 2 fried pieces, mayo dollop, closed mayo sachet | none | 525 | 627 (615-645) | 560-700 | piece count (3 vs 4), sauce (mayo 100 kcal vs ~170-200), extra (sachet) | total fine |
| 13 | Siomay/batagor with peanut sauce | none | 550 | 445 (350-536) | 450-600 | wrong dish, unstable (gado-gado / lontong sayur / ketoprak) | no |
| 14 | Box: 7 grilled chicken pieces, omelette, rice, shredded sambal-matah chicken | none | 425 | 762 (725-785) | 900-1100 | missed item (grilled chicken missing from saved list), kcal density (80 kcal for 100 g chicken), piece count | no |
| 15 | Rice, fried duck leg, kangkung with ~35 g peanuts, cucumber | none | 640 | 596 (585-605) | 700-900 | wrong protein (duck read as chicken), missed topping (peanuts 10-15 g vs ~35 g) | no |
| 16 | Rice, tempe orek, chicken thigh, cabbage, big sambal dollop | none | 725 | 785 (725-870) | 770-950 | other (run spread +-70 kcal; one run adds invented capcay) | likely yes |
| 17 | Large rice portion (~250 g) + egg with sambal | `kcal_tinggi` | 375, user kept rice only | 358 (345-375) | 450-600 | portion too low (rice 150 vs ~250 g) | likely yes (says high, reading says low; may have eaten part) |
| 18 | Bowl of noodles, braised chicken leg, bok choy | `porsi` + `kcal_tinggi` | - | 557 (370-670) | 600-800 | wrong dish ("nasi ayam" 3/3), hallucinated extras in 1/3 runs (nasi goreng, mie goreng) | no |
| 19 | Box: rice, green-chili sambal over fried chicken, tempe, tofu | none | 960 | 575 (475-775) | 700-900 | kcal density (chicken 80 kcal in 2/3 runs), sauce, prod grams high (2 "breasts" 300 g) | no |
| 20 | Rice, fried egg, spicy shredded chicken, grilled tempe | none | 540 | 648 (522-746) | 500-640 | wrong dish (tempe read as beef 2/3), kcal density ("kecap" 57 kcal) | saved list ok |
| 21 | Chayote, 3 boiled eggs, tempe, sambal teri | none | 385 | 446 (397-470) | 390-480 | wrong ingredient (chayote read as melon / lodeh), missed sambal | likely yes |
| 22 | Large rice + balado eggplant with egg and shrimp | none | 395 | 412 (345-445) | 470-600 | portion too low (rice 150 vs ~220 g, mixed dish 70-100 g vs ~170 g) | no |
| 23 | Box of sweet potato, cassava, banana, corn; 4 raw eggs beside the box | none | - | 771 (525-911) | unscored | extra item (raw eggs counted as boiled, ~310 kcal), tuber names | cannot tell |

\* user-edited grams or items; kcal not rescaled (see Findings outside the model).

## Pattern counts

A scan can carry several classes.

| Failure class | Scans | Count |
|---|---|---|
| Wrong dish or ingredient | #1 #5 #9 #11 #13 #15 #18 #20 #21 | 9 |
| kcal density wrong for a correct dish (calibration) | #2 #7 #9 #14 #19 #20 | 6 |
| Sauce / oil / topping handling | #1 #5 #12 #15 #19 | 5 |
| Portion too low | #9 #10 #11 #17 #22 | 5 |
| Extra or hallucinated item | #1 #4 #6 #12 #18 #23 | 6 |
| Piece count | #2 #12 #14 | 3 |
| Missed item | #14 #15 #21 | 3 |
| Portion too high | #4 #19 (saved list) | 2 |
| Other: unreadable photo, unstable run | #3 #8 #16 | 3 |
| User possibly wrong or unverifiable | #3 #8 #12 #16 #17 #21 (+#7, #9 partly) | 6-8 |

Direction, prod prompt, 62 runs vs my ranges: **48% under, 32% in range, 19% over.**
Underestimates dominate, but the overestimates are the same ones users name:
#4 (+70-100%), #6 (+30%), #1 (+30%), #23 (if the eggs were not eaten).

The calibration bug behind 4 of 6 density cases (#2 #14 #19 #20) is exact:
a condiment word at the tail of a dish name wins the TKPI lookup, and the whole
dish is clamped to the condiment's band.

| Model item | Model kcal | Prod after calibration | With guard |
|---|---|---|---|
| ayam penyet sambal ijo, 150 g | 350 | **80** | 350 |
| ayam suwir sambal matah, 100 g | 170 | **80** | 170 |
| daging sapi bumbu kecap, 80 g | 220 | **57** | 220 |
| telur rebus kuah kecap, 120 g | 190 | **85** (TKPI "Kecap" 71 kcal/100 g) | 190 |
| kacang tanah, 40 g | 230 | **53** (matches "Oncom kacang tanah pepes") | 230 |

`matchDish` finds the library row `sambal` (band 5-80 kcal, not scaled by grams)
because "ayam penyet" is not in the library, so `isCombination` sees one dish.

## Fixes tested (A/B on the same 21 scored photos, 3 runs each)

Calibration variants are replayed on the stored raw model answers, so only
calibration differs. Prompt variants are fresh model runs, scored with the
guard on. "dish OK" = the dish the photo shows is named (6 photos x 3 runs
where I can check it); "halluc" = runs with a known wrong extra item.

| Variant | in range | under | over | MAPE | bias | run spread | dish OK | halluc |
|---|---|---|---|---|---|---|---|---|
| prod (prompt + calibration) | 32% | 48% | 19% | 25% | -3% | 16% | 1/18 | 11 |
| 1. calibration guard + density bands, prod prompt | 37% | 42% | 21% | 25% | 0% | 16% | 1/18 | 11 |
| 2. temperature 0.1 | 39% | 42% | 19% | 23% | -4% | 8% | 0/17 | 10 |
| 3. "count only what is visible" rule | 44% | 40% | 16% | 22% | -3% | 14% | 2/18 | 12 |
| 4. dish identity rules | 35% | 51% | 14% | 22% | -8% | 12% | 11/18 | 9 |
| 5. portion + piece priors (rice 150-250 g, 100-130 g chicken) | 40% | 33% | 27% | 23% | +6% | 17% | 5/18 | 12 |
| 6. sauce / sambal / mayo / peanut reference kcal | 52% | 27% | 21% | 19% | +1% | 15% | 4/18 | 11 |
| 3+4+5+6 | 46% | 33% | 21% | 21% | -1% | 12% | 8/17 | 9 |
| 3+4+5+6 + temp 0.1 | 50% | 32% | 18% | 21% | -2% | 5% | 11/17 | 9 |
| **recommended: 4 (trimmed) + 6 + temp 0.1** | 52% | 27% | 21% | **18%** | 0% | **7%** | 9/18 | 9 |

Calibration-only (prod prompt, same answers): severe underestimates (<75% of the
low end) 6% to 3%, in range 32% to 37%. It changes the total of 8 photos but
only 3 move out of a 3% tie band (2 closer to range, 1 further).
With the recommended prompt but prod calibration the numbers are 49% in range /
38% under / 13% over / bias -6%, so the guard is what removes the remaining
underestimates.

Paired per photo (21 photos, closer-to-range): sauce+guard 10 better / 4 worse;
3+4+5+6+temp+guard 11 / 4; calibration alone 2 / 1 (18 unchanged).

What each fix did and did not do:

- **Calibration guard** (below): fixes the five items above exactly; no prompt
  risk. Density bands (mayones 680, bumbu kacang 250, kacang tanah 590, nugget
  260 kcal/100 g, +-30%) add almost nothing on these photos (bias -1% to 0%);
  keep them only as cheap insurance against low-balling ("saus mayones 30 g, 100
  kcal" becomes 143).
- **Sauce / reference kcal prompt**: best single prompt (MAPE 25% to 19%, bias
  +1% with guard). On the 13 hold-out photos it was stable except a satay plate
  (350-450 to 550, plausible with peanut sauce) and one bakso run that dropped
  to 90.
- **Dish identity rules**: dish named correctly 1/18 to 11/18 (siomay, mie vs
  nasi, bebek vs ayam). Cost: kcal bias -8% (the correct dishes are lower-kcal
  than the wrong ones the model picked). The "tempe is not meat" and "labu siam
  is not cucumber" clauses leaked: 3/3 runs of #23 invented a labu siam, and
  #20 stayed wrong. The trimmed version drops those two and keeps 9/18.
- **"Count only what is visible" rule: do not ship.** It did not remove the
  invented kerupuk (12 vs 11 runs) and on a hold-out sachet photo (a coffee
  sachet, not food) the bundle flips "Nescafe 70 kcal" into "not food", a
  behaviour change.
- **Portion priors (rice 200-250 g etc.): do not ship the rice priors.** They
  cut severe underestimates to 0 but raise over to 27% and push small nasi boxes
  up (hold-out nasi kuning boxes 666-850 to 890-1005 vs my 600-780). That is the
  "kalori kelewat tinggi" complaint. The piece-count clause was only tested
  inside bundles (which over-shot #4 to ~1250 and #14 to ~1160), not alone.
- **Temperature 0.1**: run-to-run spread 16% to 8% at equal bias. Scan #18 ranged
  370-1125 kcal between identical runs of the prod prompt, and #20 452-835. It also
  makes a wrong dish consistently wrong (#13 is ketoprak 3/3), so it needs the
  identity rules. Keep default temperature on "Hitung ulang", where sampling
  variety is part of the point.
- **Parse failures** (4 of ~800 A/B runs, plus 3 timeouts): the model sometimes
  quotes every number (`"grams":"200"`), `z.number()` rejects the item and the
  scan fails with `scan:failed`. Coercing numeric strings recovers 2 of 4 (#3
  twice); a backslash-escaped-quote answer is recoverable by unescaping (#21,
  not tested in the pipeline); one answer (#7) is not recoverable by a simple repair.

## Proposed changes (as written before shipping; see Status)

1. `lib/tkpi.ts`: condiment-tail guard in `calibrateItems`. If the normalized name
   contains `sambal|kecap|saus|bumbu|mayones|kuah` **and** a protein/staple
   head word (`ayam|bebek|daging|sapi|ikan|udang|telur|tahu|tempe|nasi|mie|...`) and
   is not itself a library name or alias, skip `matchDish` and `lookupTkpi2019`
   and apply the generic band (as unmatched dishes do today). Shipped as
   `isCondimentedDish` in `lib/tkpi.ts`.
2. `lib/tkpi2019.ts`: reverse containment (`key.includes(q)`) may match only a
   row that starts with the query (`kacang tanah` must not hit "Oncom kacang tanah pepes").
3. `lib/tkpi.ts`: density bands for mayones, bumbu kacang, kacang tanah, nugget (see above).
4. `lib/vision.ts` prompt: append the trimmed identity rules and the sauce
   reference values (text in `PROMPT_VARIANTS.rec`), and send `temperature: 0.1` on
   the first scan only.
5. `lib/vision.ts` schema: coerce numeric strings before `visionItemSchema`.

Not recommended: rice-weight priors, the "visible only" rule, any new rule that
names a specific dish as a counter-example without a hold-out check (identity
clauses written from these photos are in-sample; only 13 hold-out photos, of which
8 are public canonical dishes with no ground truth beyond the dish name).

## Ship order

1. Calibration guard + 2019 reverse-containment fix (changes 1-2): deterministic,
   unit-testable, only raises kcal where the prod answer was provably a condiment's
   band. Add tests from the table above.
2. Numeric-string coercion (change 5): removes a class of failed scans.
3. Sauce reference values (change 4, sauce part): best single prompt change.
4. Dish identity rules + temperature 0.1 on first scan (change 4, rest), after a
   week of shadow runs on live photos because the evidence is in-sample.
5. Density bands (change 3) when convenient.

## Findings outside the model

- In #4 the saved diary rows carry the user's weighed grams (99 g fried rice)
  with the AI's kcal (300) unchanged. A manual gram edit does not appear to
  rescale kcal on that path [INFERENCE: only the rows were inspected; check the
  edit flow].
- #10 and #11 are two different photos of one meal by one user (rated
  separately), so per-user counts overstate independent failures.

## Reproduce

`bun run scripts/review-scans-ab.ts <photo-dir> baseline rec` (REPS=3,
`CLOUDFLARE_ACCOUNT_ID`, wrangler OAuth). `replayRaw(rows)`
re-scores stored answers with the shipped calibration without API calls. Variants live in `PROMPT_VARIANTS`.
