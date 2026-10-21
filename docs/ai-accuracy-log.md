# AI scan accuracy log

Running notes on how accurate the photo scan is, what the data says, and what to change next. Newest entry first. Numbers come from prod D1 (read-only) and from `scripts/eval-scans.ts`; no user ids, emails, names or photos appear here. Proposals are proposals: nothing in `vision.ts` or `tkpi.ts` behavior was changed for the first entry (the only code change is the optional, prod-neutral `promptTransform` hook the harness uses).

Owner preference to keep in mind: an over-estimated kcal is acceptable, an under-estimate is the worse error, yet users do write "kalori kelewat tinggi". Over and under are always reported separately.

## 2026-10-20: the card as a ruler in code (geometry) built, measured, switched OFF by the owner; shipped: the sambal line and no literal confidence in the card prompt

What was built and removed (not in the code any more; this entry is the record to rebuild it from). The model only pointed: the card's `box` and, per food item, the `box` it already writes plus one `"shape"` word (`flat|mound|piece|sauce|leafy|liquid`); code turned that into grams: boxes on the 0-1000 grid (x stretched by the photo's width/height read from the file header) -> cm through the card's 8.56 cm long side -> cm2 x fill (0.6-0.785 by shape) x mean height (flat 1 cm, mound 0.25 x equivalent diameter within 1.5-4.5 cm, piece 0.4 x short side within 1-4 cm, sauce 1 cm, leafy 3 cm) x density by food name (nasi 0.73, noodles 0.6, egg 0.95, tofu/tempeh 0.95, meat 1.0, cooked veg 0.5, raw leaves 0.12, sambal matah 0.6, sauces 1.0, crisps 0.15, else 0.75-1.0 by shape; rounded household-measure values written from memory and docs/portion-depth-research.md, never fitted) -> clamp per shape (flat 8-250 g, mound 20-700, piece 10-500, sauce 3-150, leafy 3-150); kcal through `itemAtGrams`. It kept the model's grams for: no card / confidence under 0.6 / no card box / card box not card-shaped (long over short side outside 1.27-2.06) / card span outside 4-70% of the photo / drinks / soup / no shape or box / footprint under 1 cm or over 34 cm / computed grams outside 0.6x-2x of the model's; a fried egg, omelette, lettuce, sambal-first and nasi/bubur/mie names overrode the model's shape word; ledger `usage_json.card {seen, confidence, used: geometry|prompt|false, box, skip, items[{shape, lenCm, widCm, cards, covered, volumeCm3, density, modelG, geoG, applied, skip}]}`. Decision (owner): off until weighed photos with a card exist in number, so grams stay the model's, the "Kartu terdeteksi" line is back to meaning "the model saw a card with confidence >= 0.6", and the ledger is back to `card {seen, used, confidence}`. The answer also grew from about 175 to about 360 completion tokens (boxes, shapes, extra items), roughly 4-6 s per scan, which is why it was not kept as log-only.

**The one weighed photo with a card** (owner, boiled egg white in a bag on a kitchen scale reading 102 g, a gym card beside the scale; kept locally as `.tmp/dataset/owner/egg-white-card` with `scale.json`, run with `--cards .tmp/dataset/cards.json`). 5 runs through the harness, `card-ref` vs `card-geometry` (same model call):

| run | model grams (name) | geometry grams | applied |
|---|---|---|---|
| 1 | 150 (lontong) | 103 | yes |
| 2 | 100 (lemper) | 105 | yes |
| 3 | 100 (lemper) | - | no: the item came back without a box |
| 4 | 80 (lemper) | 106 | yes |
| 5 | 100 (lemper) | 107 | yes |

Truth 102 g: the geometry was within +1 to +5% in the 4 runs where it applied, against the model's 80-150 g (the model's own median 100 g, spread -22% to +47%). With the final prompt (card block without box/shape) 6 more runs gave 80, 60, 150, 50, 60, 60 g. The egg white is named lontong / lemper (kcal per gram of those, not of egg white: 120-263 kcal for ~53 true), so kcal were wrong whatever the grams, a naming problem the correction-memory feature addresses, not the card. One photo, one shape (a plain bag on a flat scale, nothing overlapping); it is the favourable case.

**Three bowl photos** (the owner's beef / egg / sambal matah bowl, `latest`, `prev`, `prev2`; truth = visual estimates, not weighed: nasi 140, daging 80, telur 55, sambal matah 30), `card-ref` vs `card-geometry`, 10 runs each:

| photo | item | estimate | model g median (range) | final g median (range) | computed from the card | geometry alone |
|---|---|---|---|---|---|---|
| prev | nasi | 140 | 150 (150-150) | 150 (150-150) | 0/10 | 32 (24-36) |
| prev | telur | 55 | 50 (50-60) | 58 (55-59) | 10/10 | 58 (55-59) |
| prev | sambal | 30 | 30 (30-30) | 22 (18-30) | 9/10 | 22 (18-25) |
| latest | nasi | 140 | 150 (150-150) | 150 (150-150) | 0/10 | 31 (29-34) |
| latest | telur | 55 | 50 (50-60) | 59 (50-60) | 8/10 | 59 (58-60) |
| latest | daging | 80 | 80 (80-100) | 80 (80-183) | 3/10 | 179 (171-352) |
| latest | sambal | 30 | 15 (15-20) | 15 (9-25) | 7/10 | 13 (9-25) |
| prev2 | nasi | 140 | 150 (150-150) | 150 (102-150) | 1/10 | 38 (24-102) |
| prev2 | telur | 55 | 50 (50-60) | 57 (50-59) | 6/10 | 59 (56-138) |
| prev2 | sambal | 30 | 20 (20-30) | 22 (17-35) | 10/10 | 22 (17-35) |

- An isolated flat item is measured well (fried egg 55-60 g in all 24 applied runs; the model was already at 50-60). Anything the camera cannot fully see is under-measured: rice under toppings computes 24-38 g (the visible crescent) against ~140, which the 0.6x-2x window rejects (so the model's 150 stays); beef under sambal and lettuce computes 171-352 g (the box takes in the lettuce) against ~80 and passed the window in 3 of 10 runs (183 g). In the harness report side-dish grams MAE against the estimates went 6 g to 10 g, plate kcal MAE 55 to 86 kcal. No net-improvement claim from these.
- The card's own box is wrong sometimes: truncated (card 148 high instead of 250 grid units) in 2 of 10 runs on `latest` (the shape test rejected it), and on `prev2` a tall card written as a wide, plausibly shaped box (height 70 instead of 168) in 3 of 10 runs, which scales every item 1.5x in length. Extra fields to catch that failed: `"long":"tegak|mendatar"` (wrong on `latest` in 6 of 8, still wide on `prev2` in 8 of 8) and the box's own `h`/`w` (still wrong on `prev2` in 7 of 8, derived from the same box). A skip rule for items whose box is mostly covered by other boxes removed almost every item (loose overlapping rectangles).
- Asking the model for "size in multiples of the card" instead of boxes failed: it wrote 1.2 / 1.5 / 1.0 for nearly everything. Its boxes were steady (egg 1.09 x 0.99 cards in 4 of 4 on `prev`).
- **To turn it back on**: weighed meals with a card, among them plates with separate items (nasi campur compartments, tempe pieces, a boiled egg) where nothing is hidden, and the egg-white case above; compare `modelG` against `geoG`. Toppings and hidden rice are the known failures.

**What stays in the code (card block of `CARD_INSTRUCTION`):**
- The literal `0.9` is gone from the example (`"confidence":number`). The model still answers 0.95 in 25 of 29 runs (1.0 x3, 0.98 x1): a habit, not a calibrated number, so it says almost nothing about the card.
- **Sambal matah**: with the production prompt alone (18 baseline runs on the three bowl photos) no run listed a sambal item (0 of 18), most answers merged the bowl into one "nasi putih dengan telur ... 350 g" line plus a duplicate egg. With the card block's added line ("sambal or raw sliced seasoning on top of a side dish is its own item with its own box"): 18 of 18 runs listed one (typically 15-30 g; "sambal matah", "sambal irisan" or "irisan cabai dan bawang"). The line is only in the allowlisted users' block; the production prompt (SAUCE_RULE, "Pisahkan ... sambal") is untouched. The card block's grams are still the model's.

## 2026-10-20: card seen at 0.95 yet 150 g on a 100 g egg white; asking for the size in cm made it worse (n=1 photo, not shipped)

What happened: the owner's first real card scan (egg white in a plastic bag, a gym membership card beside it, truth 100 g, 52 kcal by the owner's own correction). The model answered lontong 150 g / 195-200 kcal, card seen at 0.95. `confidence` there is card detection, not portion accuracy.

Cause, checked: the scan prompt has no 150 g anchor (no gram default anywhere in `visionPrompt`, `DRINK_RULE`, `SAUCE_RULE`, `CARD_INSTRUCTION`). The card block says to compare the food's length and width with the card, but the answer is single-line JSON with thinking off: nothing in the output holds the comparison, so grams come out as the model's usual 100/150 portion. In the photo the bag is about 1.25 card-lengths (~10.5 cm) long, ~4.5 cm wide, rounded; 150 g is a third too high, not a wild guess for that size.

Harness (`--variant baseline --variant card-ref`, one case = the owner's photo with `card: true`, Workers AI, same model): baseline 8 runs: grams 100 x5, 150 x1, 3 answered `bukan_makanan`; names es lilin / es mambo / es krim. card-ref with the shipped prompt, 6 runs: grams 150 x5, 100 x1; names lontong x4, es krim x2; card seen 6 of 6 (0.9-1.0). The card did not move grams toward 100 here, and the dish was never egg white.

Tried, not shipped: the card block asks each item for `"cm":[panjang,lebar,tebal]` before `grams`, grams derived from it. 8 runs: sizes 11-15 x 5-6.5 x 4 cm (length a little high, so the ruler was read decently) but grams 250 x5, 200 x2, 150 x1, all further from 100 g than before: length x width x thickness over-counts a rounded bag. Reverted; the shipped prompt is unchanged. One photo, one shape: no conclusion beyond that.

Egg white as lontong / es krim: a pale bag of soft white matter is ambiguous even to a person; no cheap prompt fix that would not overfit one photo. The owner's text correction ("putih telur 100 g") is the path that fixed it.

## 2026-10-20: a card in the scan photo as the size reference (flag, mechanism checked on photos WITHOUT a card; grams NOT measured)

Why: a thing of known size on the same surface as the food is the best scale a photo can have. Any ID-1 card (ATM, KTP, SIM, e-money, 85.6 x 54 mm) beside the food now goes into the scan prompt for allowlisted users (`DISHWARE_USER_IDS`, same flag as Piring saya): the model reports `card {seen, confidence}`, a confident one is the size reference and the result says "Kartu terdeteksi", otherwise the matched registered plate, otherwise the scan as before. The ledger keeps `usage_json.card {seen, used, confidence}`. Harness: `--variant card-ref`, only on photos someone checked for a card (labels `card`, or `--cards <file>`); docs/dishware.md.

What was run: 8 external photos x baseline and card-ref = 16 Workers AI calls, a few cents. I looked at every one of the 8 photos: none has a card lying beside the food, so all 8 are labelled `card: false` (my own check of the photos, not a guess about the contributor). Several have card-shaped distractors: a phone held up behind a drink, two milk cartons, a laptop and keyboard with coins and a boxed item.

| Check | Result |
|---|---|
| card seen on a photo with no card (false detection) | 0 of 8 |
| card-ref answers without the `card` field | 0 of 8 |
| answers that still returned items | 8 of 8 |

Reading it: the field format works with Gemma 4, and it did not take a phone, cartons or a keyboard for a card in these 8. That is all this says: no photo here HAS a card, so it tells nothing about whether the model finds a real one (glare, a card half under the plate, on a different plane than the food, perspective) or whether scaling by it moves grams toward the weighed value. n=8, one contributor, one run per variant.

**What the answer needs**: photos of weighed food with a card lying flat beside it, plus the same kind of meal without one. Roughly 10 weighed meals with a card and 10 without, from the owner or the contributor, labelled `card: true|false`, would give a first read of detection (seen on the ones with, not on the ones without) and a paired grams error, baseline vs `card-ref`. Until then the line "Kartu terdeteksi" only means the model said so with confidence 0.6 or more.

## 2026-10-20: Piring saya (registered plates) built behind a flag; mechanism checked, accuracy NOT measured yet

Why: the portion entry below shows the photo has no scale, so grams (rice above all) are guessed. Piring saya lets the owner register his plates and bowls with a measured diameter; the scan prompt then carries those sizes as text and the model says which one it sees (docs/dishware.md). Flag `DISHWARE_USER_IDS` (owner only), nothing changes for anyone else.

Harness: `--variant plate-ref` (labels `plate` or `--plates <file>`), paired on the cases that have a plate, reports recognised / wrongly claimed.

What was run (mechanism only, 8 external cases x baseline and plate-ref = 16 Workers AI calls, a few cents): one case got a plate described from what is visible in its photo (a clear scalloped glass plate), the other seven got a deliberately wrong plate (blue melamine) marked `inPhoto: false`. The diameters in this file were invented for the check, so the grams and kcal columns of that run mean nothing and are not quoted here.

| Check | Result |
|---|---|
| plate in the photo recognised (P1) | 1 of 1 |
| wrong plate claimed where it is not in the photo | 0 of 7 |
| plate-ref answers that left out the `plate` field | 0 of 8 |
| items still returned, JSON intact | yes in all 8; dish lists identical to baseline in 3 of 8, otherwise a renamed or merged side dish (one run per variant, so run-to-run drift is not separated from any effect of the prompt) |

Reading it: the field format works with Gemma 4 and no answer lost its item list to it; the model does not claim a plate it cannot see on this small sample (n=7 negatives, one positive, one contributor). It says nothing yet about whether a known diameter brings the rice from 150 g toward 100 g.

**What the answer needs**: a handful of photos of food on a plate whose diameter is measured, with the food weighed. Either the owner registers a plate and weighs a few meals on it (the harness takes a `plate` per owner case via `--plates`, e.g. `{"group:owner": {...}}` for a window of meals), or the external contributor adds `plate` to his labels (name, kind, measured diameter). About 15 weighed meals on two or three plates would give a first paired read of grams error, baseline vs `plate-ref`.

## 2026-10-20: reading a kitchen scale's display (`scale-readout`, flagged off for users)

Built the read-the-display path: a second tiny vision call beside the scan reads a scale display, its grams replace the model's on the item that was weighed, and the row shows "Terbaca dari timbangan: 100 g" with the photo estimate one tap away. Rules, flag (`SCALE_READOUT_USER_IDS`), response shape and why it is a separate call instead of a prompt rule: `docs/scale-readout.md`.

**How many photos show a display: none.** All 35 photo files looked at by eye (the contributor's 9, the owner's 24 scans, 2 consented feedback photos; one meal appears in both the owner and feedback sets): plates, cups, hand-held items, a laptop keyboard and coins as distractors, no scale anywhere. So the measurement the task asked for (digits exact and grams error on the user's own display photos) cannot be made yet. What was run instead, and it is not the user's data:

- **False reads on photos without a display:** `scale-readout` on the 28 labelled cases that run (2 reps, 58 runs): 0 readings written, 0 used. One of them is an office meal next to a keyboard numpad and a tray of coins, the likeliest place for a misread. The other 6 photos (5 unsaved owner scans, 1 low-trust case) were looked at but not run.
- **Read accuracy on real public photos of scale displays** (`--scale-photos`: three CC-licensed Wikimedia Commons photos, display read off by hand: flour bag 243 g with "500 GRAM" printed on the package, egg 61 g, tomato 314 g): digits and unit exact in 35 of 35 runs (egg 15, tomato 15 through the harness; flour 5 through a direct call, because the scan itself answers `not_food` for a flour bag so the harness run fails whatever the scale call does). The model read the display, not the package. Confidence 0.95-1.0 each time; the scale call failed in 0 of 62 runs.
- **Grams error before / after on those photos: 0% and 0%.** The baseline scan already answers the displayed number as the grams for a single item on a scale (egg 61 g and tomato 314 g in 15 of 15 runs each), so the readout shows no gain here. Where it should matter (several items on the plate, a plate total to share, an ounce display, a low-confidence digit to set aside) no photo exists; those paths are covered by unit tests only.
- **Food accuracy on the dataset photos is unchanged by construction:** the scan request in the variant is baseline's own, its answer replayed, so owner / feedback / external numbers are identical row by row (the variant summary rows are equal).

Cost: 507 prompt tokens and about 6 completion tokens per scan when there is no display (about 4.5 neurons against 13 for the scan, 101 calls). A first version put the rule inside the scan prompt; on the egg photo the item list lost its keys in 8 of 15 runs (baseline 0 of 15), which is why it is a separate call.

Next: when the owner (or the contributor) weighs a plate with the scale in the photo, drop a `scale.json` beside the photo (see `docs/scale-readout.md`) and rerun `--variant baseline --variant scale-readout`; the "scale display visible" rows in the variant summary and the Scale readout section then carry the real before / after.

## 2026-10-20: when the grams are known, does our kcal per gram agree with Meta AI? (comparator, not truth)

The external contributor also asks Meta AI (meta.ai) in his thread, giving it the photo, his grams and a nutrition-tracker prompt. Its answer for one day (Day 3, four meals) was copied into the case labels as a **comparator** (`comparators` on the case: source, meal or day scope, kcal range). It is shown beside ours and never scored: Meta AI is not ground truth. Days 4 and 5 have no Meta answer (hidden under "Show replies").

`bun run scripts/eval-scans.ts --only external --reps 2 --comparators` prints per meal: reference kcal for his grams (TKPI 2019 / library, proxy rows flagged), the comparator, our photo answer (baseline, photo alone), and our text answer (`parseFoodStory`, what "Ceritakan" runs, fed his own words with his grams). 8 extra Workers AI calls (4 meals x 2 reps), fixed clock so the text prompt is cacheable. Percentages below are against the reference; the absolute numbers stay in the git-ignored labels and report (they follow from his weights).

| Day 3 meal | Meta AI vs ref | Our text vs ref | Our photo vs ref | Our text vs Meta |
|---|---|---|---|---|
| breakfast (rice + breaded chicken breast) | -18% | -21% | -10% | -4% |
| lunch (rice, pan-seared breast, vegetables) | +7% | +4% | +23% | -2% |
| snack (a cafe drink + potato nuggets) | no reference row | no reference row | no reference row | +130% (ours is about 2.3 times Meta's) |
| dinner (rice, fried thighs, vegetables) | -21% | -6% | -28% | +19% |

Day total: Meta says 1650-1750 and its four meal answers add to 1630; our text answers add to about 1.2 times Meta's day (the snack alone is most of it).

Our text path item by item (kcal per 100 g against the reference row): rice 0%, pan-seared chicken breast +5%, vegetables +25%, fried thigh -9%, breaded chicken breast -28%. It kept his grams exactly in all 20 item rows (2 reps x 10 items): the model never re-estimates a gram it was given.

Reading it:

- **With grams known, the text path and Meta agree on the plain meals** (breakfast -4%, lunch -2%) and both sit below the reference on the two fried-chicken meals. The shortfall is in the fried chicken: the reference rows for fried chicken (about 275-340 kcal per 100 g) give 10-30% more than either model. [INFERENCE] part of that is the reference: the TKPI fried-chicken rows are proxies, and a weight that includes bone (the thighs, the katsu pieces?) makes any per-100 g edible figure too high. Worth asking the contributor whether his chicken weights include bone before treating our reference as the better number.
- **The photo path is the loose one** (-28% to +23%), because it also guesses the grams (see the portion entry below); the text path only has to turn grams into kcal.
- **The snack is a real disagreement.** The model read "Mont Blanc" as a dessert and answered about 190 kcal per 100 g (a 240 ml drink at roughly 450 kcal), about twice what Meta gave for the drink plus nuggets. Neither has a reference. The photo shows a cafe coffee with a cream foam cap; [INFERENCE] the text path has no photo to correct the dish name, so a branded or unusual name drives it. Not acted on.
- **Limits.** One day, four meals, one contributor; Meta's meal figures are single values ("sekitar 410") or narrow ranges; the reference uses proxy rows. This says our kcal per gram is in the same range as Meta's when grams are known, not that either is right.

## 2026-10-20: "Porsi kebiasaanmu" prototype (flagged off for users) and its harness numbers

Built the post-hoc default recommended below: `lib/portion-prior.ts` (rules and maths), `portion-prior-store.ts` (flag, diary read), `portion-chip.ts` (the two-number chip both apps use), wired in `ai.analyzeFood` / `analyzeFoodStream`. Details and how to switch it on: `docs/portion-prior.md`. Flag `PORTION_PRIOR_USER_IDS` (allowlist, owner only for now); without it the answer is byte-identical to before. Harness: `--variant portion-prior` now runs the real code on the baseline answers (replacing the simulated prompt line `user-prior`), history = the user's OTHER cases (leave-one-out).

Run: `bun run scripts/eval-scans.ts --only external --only owner --reps 2 --variant baseline --variant portion-prior --variant portion-prior-1.6 --variant portion-prior-noguard` (54 new Workers AI calls; the prior variants replay the baseline answers, so they are paired with it exactly). External: 8 photos of one contributor, 5 of them with rice; owner: 19 labelled scans.

| Set | Variant | Rice grams signed / MAE | Plate kcal signed / MAE | Plate kcal under / over |
|---|---|---|---|---|
| external | baseline | +45% / 43 g (n 10) | +20% / 86 kcal (n 12) | 4 / 6 |
| external | portion-prior (big-plate 1.4, shipped) | +14% / 13 g | +14% / 103 kcal | 6 / 6 |
| external | portion-prior-1.6 | +7% / 23 g | +11% / 101 kcal | 7 / 4 |
| external | portion-prior-noguard | +7% / 23 g | +11% / 101 kcal | 7 / 4 |
| owner (19 scans, 38 runs) | all prior variants | same as baseline | same | 7 / 14 |

- **Rice moves as predicted** (+45% to +14%, 43 g to 13 g MAE), side dishes are untouched (they have no history of 5).
- **Plates do not get better.** Plate kcal MAE goes 86 to 103 kcal and under-estimates 4 to 6 of 12, because the model's plates were often already under (455 against 501, 540 against 730): taking 40 kcal of rice off an under-estimated plate makes it worse. Paired against baseline: closer on 1, further on 4 of 6 plates. Over-estimates shrink (+20% to +14%), which is not what the owner wants to trade for under-estimates.
- **The big-plate guard earns its place on exactly one case.** The leave-one-out prior for the 150 g plate (truth 150 g) is 100 g, the model answered 150 g, ratio 1.5: at 1.4 the model's number stays (correct), at 1.6 and above the prior pulls it to 100 g (-33%, the under-estimate seen before). All other rice plates had a prior of 113 g (ratio 1.33), so they are changed at every setting. One plate decides this; 1.4 kept as the shipped default until there is more weighed data.
- **A rice answer of 150 g against a usual 100 g is not replaced at 1.4** (ratio 1.5): the chip only appears when the usual portion is at least about 107 g, or the model answered less. That is the guard doing what it is for and the main reason the effect is smaller than the simulated prompt line's.
- **Owner: no effect, by data, not by design.** None of the 19 owner scans has a food with 5 user-set weights, and the owner's real diary (read-only count, last 60 days: 68 rows with grams, 59 unedited AI answers, 4 barcode, 5 copies) holds zero user-set weights, so the flag does nothing for the owner until typed or edited weights accumulate.
- **Limits.** One contributor, a very regular eater, 5 rice plates, run-to-run noise at reps 2. Not evidence that the prior helps plate kcal; evidence that it fixes the rice grams when the history is clean.

## 2026-10-21: printed text outranks appearance (prompt rule PRINTED_TEXT_RULE)

Owner scans of 2026-10-21 that the model got wrong: a cup labelled "Americano ICE" answered as es kopi susu (193 kcal, the hidden-cup table, because the prompt names Kopi Kenangan cups), a "NASI KEBULI" wrapper answered as nasi putih, fried tempe answered as tahu goreng. `visionPrompt` now ends with a rule: read every printed label, cup print, wrapper, menu or package text first and trust it over how the food looks; a packaged item uses the label serving; dark iced coffee with no visible milk is Americano/kopi hitam (5-15 kcal), not es kopi susu; a cup whose liquid is visible or whose label names the drink is not a hidden cup (no `cup` field); tempe vs tahu by texture.

**Cases.** The photos stay in the git-ignored `.tmp/dataset/owner/` (export with `scripts/dataset-export.ts`). Their labels are committed in `scripts/eval-owner-labels.json` (case id -> truth), which `eval-scans.ts` applies over the diary save, so a re-export keeps them: `0b77da8d16` Americano 08:12 (americano es 350 ml, 10 kcal; the diary save said 35), `cd0ea7f062` kebuli 12:57 (nasi kebuli 200 g 340 kcal, ayam panggang 150 g 315 kcal; never saved), `a54c2cb125` tempe plate 13:00 (nasi putih, ayam goreng, selada, sambal, tempe goreng 40 g; never saved). The two egg-white bag photos (`475baac630` 08:47, `d838091f5f` 12:27) were already in the set with the saved 100 g / 52 kcal.

**Run.** `bun run scripts/eval-scans.ts --only owner --only external --reps 2 --variant baseline --variant no-printed-text` (variant `no-printed-text` = the shipped prompt minus the rule; owner 29 cases, external 8; Workers AI, TKPI calibration). The "before" answers were mostly replayed from the raw cache of the unchanged prompt, so the pairing is not same-minute.

| Set | Variant | Name F1 | Plate kcal signed / MAE | Plate kcal under / over |
|---|---|---|---|---|
| owner | before | 68% | 60% / 74 kcal | 11 / 25 |
| owner | after | 65% | 81% / 66 kcal | 10 / 27 |
| external | before | 72% | 20% / 84 kcal | 4 / 5 |
| external | after | 63% | 15% / 74 kcal | 4 / 6 |

Target cases: kebuli names nasi kebuli 2 of 2 reps (before 0 of 2: nasi putih). Americano cup: after 1 of 2 reps (the other rep still answers es kopi susu 193 kcal), before 2 of 2 on the cached answers: the rule did not fix this photo reliably, and the model sampling varies run to run; the clause that a visible or labelled cup is not a hidden cup is what moved it from 0 of 2 to 1 of 2 across iterations. Tempe plate: still tahu goreng in 3 of 4 reps (the model does not read the texture at this size); not fixed.

No regression found elsewhere, and none excluded: the F1 differences on owner and external come from generic vegetable names (tumis sayuran / capcay sayur, kol mentah, ayam suwir vs dada ayam) in photos with no printed text, which also move between two runs of the same prompt; kcal MAE is lower in both sets. At reps 2 and these n a 3 to 9 point F1 swing is inside run-to-run noise. A larger rep count or a photo set with printed labels is needed before claiming more.

## 2026-10-20: do the portion errors come from the clamp, the prompt or the lack of a personal prior? (eval only, production untouched)

Question: on the weighed external cases the model answers 150 g of rice where the contributor ate about 100 g. Three candidate fixes were run through `scripts/eval-scans.ts`, none shipped: `band-wide` / `band-off` (the library kcal band of the 2026-10-18 change widened by 50% / removed), `scale-cues` (prompt: "porsi umum" becomes "porsi yang TERLIHAT" plus a rule to read grams from plate or bowl diameter, spoon, fork, hand, and not default to typical portions), `user-prior` (one prompt line with the median of the contributor's OTHER weighed meals per dish eaten at least twice, leave-one-out; external cases only, since it needs a weighed history).

Run: `bun run scripts/eval-scans.ts --only external --only owner --reps 2 --variant baseline --variant band-wide --variant band-off --variant scale-cues --variant user-prior`. Sets: external 8 photos (trust medium or higher; 9 uploaded, the screen photo is low trust and left out), owner 19 labelled scans (5 unsaved skipped; 14 of the 38 owner runs are corrected or retried scans, the rest saved as the AI answered). 124 Workers AI calls (production prompt and model, REST), 145k prompt + 22k completion tokens in all; the three calibration variants replay the baseline answers, so they cost nothing and are paired with it exactly. Hooks added, prod-neutral: `calibrateItems(items, { bandSlack })` and `analyzeFoodPhoto({ calibration })`, `--variant` registry entries, a raw-answer cache, `scripts/dataset-export.ts` reading R2 directly with the wrangler login when no `AI_BENCH_KEY` is set.

| Set | Variant | Runs | Name F1 | Rice grams signed / MAE | Side-dish grams signed / MAE | Plate kcal signed / MAE | Plate kcal under / over |
|---|---|---|---|---|---|---|---|
| external | baseline | 16 | 68% | +45% / 43 g (n 10) | +11% / 31 g (n 11) | +20% / 83 kcal (n 12) | 4 / 6 |
| external | band-wide | 16 | 68% | +45% / 43 g | +11% / 31 g | +19% / 82 kcal | 4 / 6 |
| external | band-off | 16 | 68% | +45% / 43 g | +11% / 31 g | +19% / 82 kcal | 4 / 6 |
| external | scale-cues | 16 | 72% | +42% / 40 g (n 10) | +9% / 33 g (n 13) | +13% / 92 kcal (n 12) | 4 / 6 |
| external | user-prior | 16 | 70% | -3% / 13 g (n 10) | +6% / 36 g (n 13) | -8% / 90 kcal (n 12) | 6 / 4 |
| owner (all) | baseline | 38 | 72% | -8% / 15 g (n 10) | -3% / 9 g (n 46) | +6% / 35 kcal (n 38) | 9 / 9 |
| owner (all) | band-wide, band-off | 38 | 72% | same as baseline | same | same | 9 / 9 |
| owner (all) | scale-cues | 38 | 70% | -10% / 20 g | -3% / 11 g (n 44) | +2% / 43 kcal | 11 / 10 |
| owner, edited only | baseline | 14 | 49% | -8% / 13 g (n 4) | -9% / 9 g (n 16) | +20% / 56 kcal (n 14) | 4 / 6 |
| owner, edited only | band-wide, band-off | 14 | 49% | same as baseline | same | same | 4 / 6 |
| owner, edited only | scale-cues | 14 | 51% | -13% / 25 g | -13% / 10 g (n 17) | +13% / 62 kcal | 5 / 7 |

Paired plate |error| per case against baseline: band-wide and band-off closer on 1 of 19 owner and 1 of 6 external cases, further on none; scale-cues closer on 5, further on 8 (owner) and closer on 2, further on 4 (external); user-prior closer on 4, further on 2 (external). Run-to-run noise at reps 2 is visible (a case's plate moves 10 to 60 kcal between reps), so differences of that size are not signals.

Reading it:

- **The clamp is not the cause.** The band changes at most one case, by a few kcal. The rice error is in `grams` (the model says 150 g), which the band never touches: it only moves kcal, and only when the model's kcal is far from grams times density. Keep it: it is what catches a hallucinated kcal (the 2026-10-17 findings), and widening it buys nothing measurable.
- **`scale-cues` does nothing for rice** (+45% to +42%, same 150 g in 9 of 10 runs) and makes the owner set slightly worse (more under-estimates, 4 closer / 8 further plates; edited scans 4 to 5 under). The model does not turn plate size into grams on its own. No evidence for shipping it.
- **`user-prior` is the only thing that moves rice**: +45% to -3%, MAE 43 to 13 g. Side dishes are untouched (they were never the problem: bone-in chicken is the outlier, 80 to 120 g answered against about 200 g weighed, which includes bone, so its TKPI reference kcal is itself an upper bound). The cost is visible too: on the one plate with 150 g of rice the prior pulled the answer to 100 g (-33%), and plate kcal went from +20% to -8%, 6 under / 4 over. The owner treats under-estimates as the worse error.
- **Limits.** 8 external photos from one person (9 weighed meals in the history), leave-one-out on a very regular eater (rice about 100 g in most meals, which is the best case for a prior); owner truth is mostly the model's own answer; kcal references use proxy rows (flagged in the case files). The owner set has no weighed history, so `user-prior` was not run on it: the warteg plates are only checked against the clamp and `scale-cues`.

Recommendation:

1. **Do not ship the clamp change or `scale-cues`.** No gain, small harm for `scale-cues`.
2. **Prototype the per-user portion prior, not as a prompt line to the model but as a post-hoc default**, and only when the history is consistent. [INFERENCE] design, untested: for a dish the user has logged at least 5 times with weights that were typed or edited (never counting unedited AI answers, or the prior would echo the model's own 150 g back), take the median grams when the spread is small (for example the interquartile range under 25% of the median); show it as the starting grams the user can change, instead of silently overriding the model; leave dishes with no history alone. Risk: a typical-looking prior applied to an unusually big plate under-estimates it (seen once here, -33%), and a prior learned from tiny n is noise. Validate on the diary history of consenting users, or on more of this contributor's days (30 are expected), before any prompt or calibration change. The same labels file keeps growing, so `--variant user-prior` can be re-run unchanged.
3. **Next evidence worth getting:** more weighed days; a bone-in flag on the chicken items so the reference stops overstating them; the owner's saved rice weights over time to see whether a personal rice prior exists for the owner too.

## 2026-10-20: first weighed ground truth (external contributor), harness run

A contributor who weighs every food in grams agreed to let us use his public photos and weights for internal testing (`docs/datasets.md`: consent, format, commands). Five photos from two days were labelled by hand (`scripts/external-import.ts`; truth = his grams, kcal = TKPI 2019 / library reference for those grams, proxy rows flagged). `scripts/eval-scans.ts` now has an `external` group: grams error per item, plate grams error, kcal against that reference, an item-by-item table. No change to `vision.ts` or `tkpi.ts`.

Run: `bun run scripts/eval-scans.ts --only external --reps 2` (baseline = production prompt, model `@cf/google/gemma-4-26b-a4b-it`, TKPI calibration; Workers AI REST on 1024 px photos, 10 calls including the low-trust case; cost not measured, [INFERENCE] well under a few cents). Cases at trust medium or higher: 4 photos, 8 runs, 0 failures. The fifth photo is a picture of a phone screen (low trust), run for names only.

| Metric (trust ≥ medium) | Result |
|---|---|
| item names P / R / F1 | 75% / 75% / 75% |
| grams, matched items (11 pairs over 8 runs) | 9 over (mean +57%), 2 under (mean -13%), 0 within ±5%; signed mean +44%, MAE 29 g |
| plate grams (8 runs) | 6 over (mean +28%), 2 under (mean -54%); signed mean +7%, MAE 154 g |
| plate kcal vs reference (6 runs with a complete reference) | 4 over (mean +78%), 0 under, 2 within ±5%; MAE 79 kcal |

What the item table shows (n is tiny; these are leads, not findings):

- **Rice is +50% every time** (H2 above, now with weights): `nasi putih` answered 150 g on both rice plates, in all 4 runs, +50% against the weighed portion (195 kcal against a 130 kcal reference).
- **Raw cabbage** +56% and **sambal** +85% in both runs.
- **Fried chicken thigh** -13% in both runs (260 kcal against a 329 kcal reference).
- **The serundeng-chicken plate is +147 and +187 kcal over** (reference 418): rice +65, sambal +52, the chicken named `ayam goreng bumbu 120 g` (+19) and `ayam bumbu kuning 150 g` (+59; this name does not pair with his, so that run has no grams error for it), cabbage +11.
- **A vegetable bowl** answered `capcay sayur 250 g, 125 kcal`; the reference (TKPI "Sayur sop" proxy, a soup) is 2.2 times lower, so part of the gap is the reference.
- **Combined weight case** (one weight for rice + lodeh + tempe, chicken apart): the answers add up to about half of the weighed total. That weight looks large for the photo and is unverified, so treat this one as unresolved, not as an under-estimate.
- **Low-trust screen photo**: `nasi uduk` was answered as `nasi putih` in both runs, the liver skewer as `ayam goreng 100-120 g`, the tofu -40%.

Limits to keep in mind: name pairing is strict, so a same-dish rename (`ayam goreng` for his `ayam kecap dada`) shows as "not in the answer" plus "not in his list" instead of a grams error; items that cannot be separated in his weighing have no per-item grams; reference rows marked PROXY stand in for the real dish. Four photos from one person say nothing about prompt changes; they become useful as he posts the rest of his 30 days.

## 2026-10-18: small portions clamped up to the typical portion's minimum

Owner report: "martabak telur 50 g (1 potong)" logged as 300 kcal (6 kcal/g; the library has 250 kcal/100 g, so 125). The row's own macros (4 P, 12 C, 9 F) add up to about 145 kcal.

Root cause: not the data row and not the model. `calibrateOne` clamped a library-matched dish into `plausibleKcalRange`, which is written for `typicalPortionG` (150 g here: 300-600 kcal), without scaling it to the item's grams; only the scan-correct (portion edit) path scaled the band. Any matched item smaller than the typical portion was lifted to the portion's minimum, any larger one cut to its maximum. The library rows themselves are consistent (per-100 g x typical portion falls inside the band for every dish).

Fix: the band always scales with grams (`grams / typicalPortionG`, `scaleBand` option removed), and every item is capped at 9 kcal per gram of its weight (pure fat), also for unmatched dishes (the old 400 kcal floor allowed a 10 g item 400 kcal). Tests in `tkpi.test.ts`.

Prod audit (read-only, AI rows with a gram weight): 461 rows, 196 matched to a library dish; about 90-105 of those (31 users) sit exactly on an unscaled band edge for a portion well off the typical one (nasi putih, ayam goreng, tempe, telur dadar, tempe orek, ...), so they are inflated (or, for big portions, deflated). Not rewritten in bulk; instead each plate's edit sheet (web and native) has "Hitung ulang kalori": `food.recalculatePlate` previews old -> new kcal per item, plate total included, and "Simpan" applies it (`lib/plate-recalc.ts`: AI rows with a weight only; manual, barcode and rows whose name, weight or kcal no longer match the saved `items_json` are skipped; a kcal the calibration moves becomes the library's per-100 g value x grams, macros follow only when they no longer fit it). The action is hidden when nothing would change.

## 2026-10-18: drinks (zero-calorie, plain water, a cup whose contents are hidden)

Owner report: logging a Coke Zero failed by photo and by text; the photo was a McDonald's paper cup with a lid.

Reproduced on prod (qa account, Pro granted for the run and reverted):

| Input | Before |
|---|---|
| typed "coke zero 1 kaleng" | 20 kcal (the generic band floors any drink at 20) |
| typed "coke zero" / "Coca-Cola Zero 330 ml" | 20 kcal, or the "Belum ada makanan yang dikenali" error when the model answered 0 |
| typed "air putih", "minum coke zero", "es teh tawar" | the same "no food" error (0 kcal dropped) |
| photo: Coke Zero can | "AI tidak menemukan makanan" (the model answered `bukan_makanan`) |
| photo: lidded McD-style cup | one guess ("minuman bersoda" 210 kcal, 500 g) the user could only fix by hand |

Root causes: (photo) the scan prompt only knew food: for a Coke Zero can and for a lidded cup the model answered `{"items":[],"problem":"bukan_makanan"}` (read locally with the old prompt against Workers AI, 2026-10-18), so the scan failed with "no food" before any parser ran; (text and photo) `storyItemsFromText` and `parseAnswer` dropped every item with `kcal <= 0` (a unit test even pinned "Air putih 0 kcal is dropped"); `calibrateOne` floored any unmatched item at 20 kcal; the library had no rows for zero-calorie drinks, so "teh tawar" was an alias of es teh (20-90 kcal band); `applyCorrection` ignored a zero for a drink and kept the previous item's kcal.

Changes: zero is valid for drinks (name or the model's `kind`), anywhere else it is still a miss. New library rows (`teh tawar`, `kopi hitam`, `air putih`, `minuman zero`, `minuman soda`) pull a wrong guess back to the real value, and an exact library name is no longer taken over by a longer name that contains it. The scan prompt now says drinks are items, 0 kcal is correct for zero drinks and the unit is ml. A lidded cup whose contents are not visible comes back with `cup: S|M|L`; the server then builds the item from `lib/drink-options.ts` (Coca-Cola by default, 35% confidence) and the result screens show chips for Coca-Cola / Coke Zero / Sprite / es teh manis / es kopi susu / air mineral and S / M / L (250 / 350 / 450 ml). Cup volumes and per-100 ml values are estimates, not McDonald's Indonesia menu data. "Hitung ulang" with a hint and the correction box ("coke zero") override the guess.

Fixtures: `packages/api/src/lib/fixtures/vision-drinks.json` (live answers for the can and the cup, constructed ones for the rest), tests in `lib/drink.test.ts`.

## 2026-10-17: first analysis

### What data exists (and what it cannot say)

| Source | n | Window | Notes |
|---|---|---|---|
| `scan_feedback` | 28 rows, 17 users | 2026-10-15 to 10-17 | 22 `kurang_akurat`, 1 `salah`, 5 `dilewati`, **0 `akurat`** |
| `ai_usage` retry rows ("Hitung ulang") | 27, 13 users (22 carry the user's hint text) | 2026-10-15 to 10-17 | 176 successful scans by 44 users in the same window, so roughly 1 scan in 6 got a retry |
| `scan_correction` miss log | 420 rows, 40 users | 2026-09-15 to 10-17 | 405 saved unchanged, only **15 edited** |
| Owner dataset (R2 `dataset/`) | **0 objects** | - | listed through the R2 API on 2026-10-17; prefix `feedback/` is also empty |
| `scan-src/` photos | 1000+ | last ~2 days | not consented, deliberately not used |

Limits, stated plainly:

- **Why there are 0 "akurat" ratings.** The "Hitung ulang" tap used to send an implicit `kurang_akurat`, so the explicit negatives are mostly retry taps (18 of the 22 `kurang_akurat` rows carry neither a reason nor a note; the 13 users with retry rows and the 13 users behind the `kurang_akurat` rows line up, [INFERENCE] that these are the same events). Satisfied users never tap "Akurat": they save and leave, or dismiss the prompt (5 `dilewati`). So the feedback table measures dissatisfaction only; there is no positive class and no rate can be computed from it.
- **Explicit, informative ratings are tiny.** 3 rows carry a reason (`kcal_tinggi` x3, `porsi` x1), 3 carry a note, all on native, all since 2026-10-16.
- **The miss log mostly records acceptance.** 96% of rows are saved as the AI answered. That says users tap save, not that the answer was right. It also stores the calibrated `ai_kcal`, so the model's raw number and the TKPI clamp cannot be separated in it. Dish-level means over 15 edited rows are meaningless (`nasi putih` has 4 edits in 47 rows; `nasi goreng` 2 rows, `siomay` 2 rows, `kangkung` 4 rows, none edited).
- **The owner dataset is empty, so there are no labelled eval cases yet.** Cause not determined: the allowlist var is in `wrangler.jsonc`, but either that build is not deployed yet or the owner has not scanned since. Until labelled photos exist the harness can only run the 8-photo Wikimedia set, whose truth is a kcal band for one serving.
- The prod `AI_BENCH_KEY` is not on this machine (the dev value in `apps/server/.env` gets 404 from `/ai/bench` and `/ai/dataset/list` on prod), so the export script has not run against prod; emptiness above was read through the R2 API with the wrangler login.

### Recurring failure patterns

From the 22 retry hints (what users type after "Hitung ulang"; mentions overlap):

| Pattern | Mentions | Examples (paraphrased) |
|---|---|---|
| Component misidentified | 6 | "bukan ayam tapi bebek"; tempe geprek / tempe bacem read as ayam suwir / daging sapi; a pear read as kerupuk; siomay read as batagor |
| User retypes the whole plate | 8 | terong balado + telur orak-arik + udang; tumis tahu telur kecap; soto mie ayam with rice and kroket; bakmi Jawa with telur bebek; nasi liwet |
| A gram figure for a component | 7 | rice at 80 to 100 g (5 of the 7); labu siam 60 g; ikan goreng 50 g |
| A count of pieces | 3 | "ayam nya 2 dada"; basreng 15 tusuk; siomay 2 pcs + telur 1 + tahu 1 |
| Item not eaten / shared | 3 | timun and sambal not eaten; "tanpa saus sambal"; a duck portion shared by two |

Plus the explicit notes: users listing the grams the app displayed (nasi goreng 99 g, ayam goreng 70 g, kangkung 66 g, tempe goreng 24 g) next to a `kcal_tinggi` reason, and one `salah` about siomay pieces being cut in halves.

### Hypotheses and evidence

**H1. The TKPI kcal band floor lifts small portions (strongest, "kalori kelewat tinggi").**
`calibrateItems` clamps the model's kcal into the dish's `plausibleKcalRange` for a *typical* portion, and the vision path calls it without `scaleBand` (only `ai.correctScan` passes `scaleBand: true`). A 70 g ayam goreng is therefore floored to 300 kcal (library density gives about 182). In the miss log, of the 146 rows (of 420) whose dish name is exactly a library dish or alias:
- 71 sit exactly on the band floor; in 57 of them the library's own density x the stated grams is more than 10% below that floor (13 nasi putih, 9 tempe, 5 orek tempe, 5 mie goreng, 5 ayam goreng, 3 kangkung, ...).
- Those 57 are on average +57% (median +41%, about +59 kcal) above density x grams; the other 89 library-named rows have a median error of 0%.
- Rows in this group (nasi goreng 99 g -> 300 kcal, ayam goreng 70 g -> 300, tempe 24 g -> 120) carry the same weights as one user's note. [INFERENCE] the note is the user reading the displayed grams against the displayed kcal.
- The harness reproduces it live: on the Wikimedia nasi goreng photo the baseline answers "ayam goreng 80 g -> 300 kcal" (both reps).
- Counter-evidence: only 3 of those 57 rows were edited before saving, and the library density is itself a rough number. This is over-estimation, which the owner tolerates better than under; the risk of fixing it is under-estimating when the model mis-reads grams low.

**H2. Rice portion prior is high.** 5 of 22 hints give rice as 80 to 100 g. The model's `nasi putih` answers (n=47): median 150 g, 34 at 150 g or more, 13 at 100 g or less; only 4 rows edited. A typed "100 g" may simply be a round number, and without photos plus weights this cannot be separated from a correct 150 g. Weak, untested.

**H3. Piece counting (siomay, basreng, ayam 2 dada).** 3 hint mentions and 1 `salah` note (the same siomay plate, [INFERENCE]); the miss log has only 2 siomay rows. Anecdote, not a pattern yet.

**H4. Component identification (ayam vs bebek, tempe vs ayam).** 6 mentions. A model limitation of the plate photo, not something a portion hint fixes.

Not supported by the data: nasi goreng / ayam goreng / kangkung being over-estimated *as dishes* beyond H1. The miss log has 2 / 18 / 4 rows for them, none edited, and no photos to re-run.

### Proposed changes (not applied)

1. **Scale the band with grams in the vision path** (call `calibrateItems(..., { scaleBand: true })`, or clamp to density x grams x [0.8, 1.4]). Expected: removes the floor inflation on small portions (H1). To protect against under-estimates keep the floor at about 0.8 x density x grams rather than at the density itself.
2. **Show grams and kcal together in feedback prompts** so `kcal_tinggi` notes can be tied to a plate.
3. **Rice prior (H2)**: only after labelled photos exist; test as a `promptTransform` variant (`prompt-b` in the harness is a placeholder of this shape, the wording is not a recommendation).
4. **Piece-count line in the prompt (H3)**: "sebut jumlah buah/potong di portion"; only after more cases.
5. Collect data first: consent photos (`feedback/`) plus the owner dataset are what unlock real numbers. Aim for 30+ labelled corrected/retried cases before judging any prompt change.

### Harness seed run

`bun run scripts/eval-scans.ts --wikimedia --variant baseline --variant prompt-b --reps 2` (32 runs, 31 model calls, Workers AI REST, production prompt, model and TKPI calibration); owner and feedback sets contributed 0 cases. Reports: `.tmp/eval/report-2026-10-17.md` and `.json` (gitignored).

| Variant | Runs | Failed | Dish named | In band | Plate over / under / close | p50 / p95 |
|---|---|---|---|---|---|---|
| baseline | 16 | 0 | 14 of 16 | 12 of 16 | 4 / 0 / 12 | 3.7 s / 19.6 s |
| prompt-b | 16 | 0 | 15 of 16 | 13 of 16 | 2 / 0 / 14 | 3.2 s / 19.2 s |

Read this as a check that the harness works, not as a result: 8 photos, band truth for one serving, and the nasi goreng photo holds several plates (both variants over-count it by 950 to 1070 kcal; the other over-estimate is gado-gado, +77 kcal). The 1-to-2 case difference between the variants is inside run-to-run noise at this n. No claim about any prompt change can be made from it.
