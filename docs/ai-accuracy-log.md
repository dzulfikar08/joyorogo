# AI scan accuracy log

Running notes on how accurate the photo scan is, what the data says, and what to change next. Newest entry first. Numbers come from prod D1 (read-only) and from `scripts/eval-scans.ts`; no user ids, emails, names or photos appear here. Proposals are proposals: nothing in `vision.ts` or `tkpi.ts` behavior was changed for the first entry (the only code change is the optional, prod-neutral `promptTransform` hook the harness uses).

Owner preference to keep in mind: an over-estimated kcal is acceptable, an under-estimate is the worse error, yet users do write "kalori kelewat tinggi". Over and under are always reported separately.

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
