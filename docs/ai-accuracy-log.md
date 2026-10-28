# AI scan accuracy log

Running notes on how accurate the photo scan is, what the data says, and what to change next. Newest entry first. Numbers come from prod D1 (read-only) and from `scripts/eval-scans.ts`; no user ids, emails, names or photos appear here. Proposals are proposals: nothing in `vision.ts` or `tkpi.ts` behavior was changed for the first entry (the only code change is the optional, prod-neutral `promptTransform` hook the harness uses).

Owner preference to keep in mind: an over-estimated kcal is acceptable, an under-estimate is the worse error, yet users do write "kalori kelewat tinggi". Over and under are always reported separately.

## 2026-10-28: is it the model or the prompt? Haiku 5.5, DeepSeek V4.1 Flash, GLM-5.3 Flash, a lean prompt and per-rule ablations (nothing shipped)

**Ask.** "The model is too weak, or the prompt is too rigid and overfits; would GPT-6 Luna or Claude Haiku be better, and at what cost?"

**Run.** `scripts/eval-scans.ts --wrongfood --reps 2`, sets owner 46, feedback 6, external 8 (weighed, trust >= medium), wrong-food 12 (30 checks over 2 reps). Same prompt and TKPI calibration for every model unless the variant says otherwise. The harness now routes `openai/<model>:<effort>` and `anthropic/<model>:<effort>` to those APIs and reports tokens and USD per scan. GPT-6 Luna was not run: there was no working OpenAI key (the only one found was a placeholder). Kimi K2.6 was dropped because it overran the 40 s deadline. Owner "all" favours Gemma by construction, because unedited saves are Gemma's own answer. Read owner edited-only, feedback, external and wrong-food. Noise from the 2026-10-24 entry: about 3 F1 points on owner and 5 on the small sets.

| variant | owner edited F1 / plate MAE | feedback F1 / MAE | external F1 / MAE (weighed) | wrong-food checks | refusals (owner) | USD per 1,000 scans | p50 |
|---|---|---|---|---|---|---|---|
| baseline (Gemma 4 26B, shipped prompt) | 49% / 97 | 43% / 101 | 67% / 109 | 16 | 10 | 0.30 | 4.4 s |
| `lean` (Gemma, 7 rules removed) | 49% / 69 | 47% / 106 | 61% / 103 | 12 | 10 | 0.14 | 3.3 s |
| `lean-printed` (lean + printed-text rule) | 49% / 82 | 44% / 100 | 63% / 97 | 13 | 6 | 0.18 | 3.8 s |
| `no-copy` (shipped + "examples are not answers") | 54% / 96 | 43% / 108 | 67% / 103 | 13 | 8 | 0.30 | 4.1 s |
| `m-haiku` (Haiku 5.5, thinking off) | 38% / 116 | 29% / 159 | 61% / 75 | 15 | 0 | 0.58 | 1.8 s |
| `m-haiku-low` (Haiku 5.5, effort low) | 51% / 105 | 37% / 69 | 62% / 74 | 12 | 0 | 0.90 | 4.9 s |
| `m-haiku-lean` (Haiku, thinking off, lean) | 43% / 102 | 36% / 107 | 57% / 77 | 14 | 0 | 0.31 | 2.0 s |
| `m-dsv4` (DeepSeek V4.1 Flash) | 48% / 107 | 34% / 86 | 59% / 72 | 12 | 0 | 1.07 | 3.3 s |
| `m-glm` (GLM-5.3 Flash) | 33% / 129 | 17% / 154 | 58% / 100 | 4 | 35 failed | 0.98 | 20 s |

Tokens per scan (mean): Gemma 2,395 in / 206 out, lean 841 / 195, Haiku 4,561 / 243 (images cost Haiku about twice the input tokens), Haiku low 4,563 / 890, DeepSeek 2,789 / 198. GLM thinks whatever `enable_thinking` says (936 out, 1,600-token cut-offs), so it fails within production's budget. Cost counts the last attempt of each run only, not retries.

**Reading it.**

- **No model beats Gemma on dish names, the main complaint.** Every model misses the same photos: the egg-white bags, nasi jagung and nasi liwet.
- **The other models are better on kcal, inside the noise.** Haiku and DeepSeek have a lower weighed kcal MAE (72-77 against 109). They never refuse a photo, while Gemma says `not_food` on the egg-white bags 10 of 92 times. Haiku over-estimates more often (owner over 63 against 41).
- **The prompt is not overfit as a whole.** Removing all seven rules leaves names flat and loses 4 of 30 wrong-food checks: the 3-egg count, papaya, omelette and urap. It lowers owner edited kcal MAE (97 to 69) and doubles rice grams error (20 to 43 g).
- **Per-rule ablation (2 reps, same sets).** Without the printed-text rule, wrong-food checks drop from 16 to 11. Without the sauce rule, they drop to 13 and owner edited F1 drops to 42%. Without package, count or lookalike/juice, results are within noise (15 checks each).
- **One concrete interference.** Gemma with the full prompt answers "Es kopi susu 193 kcal" on owner case 4f3ae4a517, an iced Americano, in 2 of 2 runs. With `lean` or `lean-printed` it answers "Americano 7 kcal" in 2 of 2. Every other model reads it right with the full prompt. Removing the printed-text rule alone does not fix it, and each single-rule removal fixes it in 1 or 2 runs out of 2. So the cause is the combined length of the rules (the prompt mentions es kopi susu at 175 kcal) on a small model, not one rule.
- **`no-copy` does not fix it.** It is fud-ai's "schema examples only; never copy them" idea; it fixed 1 of 2 runs and cost 3 wrong-food checks.

**Decision.** No change to the model, prompt or flags. Haiku 5.5 with effort low is the only candidate level with Gemma on names and better on kcal, at 3x the cost; DeepSeek costs 3.5x. Neither shows a gain beyond the noise on the sets that carry signal: 8 weighed photos and 6 feedback photos. More weighed photos would move this question more than another model swap. `lean-printed` (one third of the input tokens, Americano fixed) is the prompt candidate to re-run when that set is larger. Reports are in `.tmp/eval/{models,ablation,nocopy}-2026-10-28.md`.

**Addendum, same day: Annas's Days 1-2 and 6-14 added.** Labels were drafted per photo by sub-agents from his post text and photos, and each post passed the importer's validation. Only one label was checked against its photo by hand (Day 12 eggs: six halves against his "2 telor", so trust is medium). The labels are in `scripts/external-cases/annasfatahillah.labels.json` (git-ignored); the cases are local only. That is 35 new cases: 17 high trust, 22 medium and 5 low over all 44 cases. The external set at trust >= medium is now 39 cases, 78 runs at 2 reps.

| variant | name F1 | rice grams MAE | side-dish grams MAE | plate kcal MAE (n) | under / over |
|---|---|---|---|---|---|
| baseline | 63% | 59 g | 83 g | 153 (63) | 21 / 38 |
| `lean-printed` | 59% | 73 g | 67 g | 146 (63) | 22 / 36 |
| `m-dsv4` | 54% | 50 g | 64 g | 125 (64) | 20 / 37 |
| `m-haiku-low` (54 of 78 runs) | 60% | 55 g | 70 g | 124 (46) | 8 / 35 |

The Anthropic key returned 401 partway through, so the Haiku rows are unpaired. On the larger set, Gemma keeps the best name F1. DeepSeek is about 30 kcal closer on plate kcal and 9 points worse on names, at 3.5x the cost. `lean-printed` loses 4 points of F1 and is not a win. The decision stands: no change. The 35 cases were uploaded to R2 the same day.

The harness `baseline` leaves out the kitchen-scale readout, which has been on for everyone since 2026-10-24. With it (`scale-readout`, same answers, same 39 cases), plate kcal MAE is 133 against 153 and side-dish grams MAE is 61 against 83 g. Five of his photos show a scale display:

- Avocado: 346 g becomes 96 g (he wrote 100 g).
- Lapis legit: right in 1 of 2 runs (12 g); the other run kept 90 g.

Read production's error on weighed photos as the `scale-readout` row, not `baseline`.

**Ask for the grams (track AskGramsWhenUnsure): signal found, small prompt shipped to code (not deployed).** Question: can a cheap per-item signal predict a grams error above 50%, so the app asks for the weight instead of trusting the model? Evidence: the 39 weighed external cases at 2 reps (78 runs) through the production path (`scale-readout`), replayed from the raw answer cache by a throwaway copy of the harness that also keeps `confidence`, `kind`, `box`, `pieces` (0 model calls); plus the owner (46 photos, 2 reps) and feedback (6) sets. 63 item pairs have a weighed gram truth: 24 are more than 50% off, all of them over. (a) **`confidence` is no signal**: every one of the 63 pairs says 0.9 or 1. (b) Box area of 0.12 or more (unscaled): precision 85%, recall 46% on external, but 16% on owner edited-only (19 flagged, 3 hit): it flags big accepted dishes. (c) Two or fewer items: 56% / 58%. (d) **Only one item in the whole answer, not read off a scale**: 10 of 10 pairs over 50% on external (recall 42%), but 0 of 5 on owner edited-only, because the owner's lone items are 350 ml coffee cups and pepaya he saved as the model said. (e) **The chosen rule: the answer has one item, 200 g or more, kind not `minuman`, no scale reading, no usual-portion chip, no hidden-cup choice.** Plate grams on the weighed runs it fires on: 8 of 10 runs more than 50% over (80%), 4 of 5 cases (spaghetti bolognese 300-350 g against 120, bubur kacang hijau 300 against 120, watermelon 240-250 against 100, battered mushroom 250 against 100; the miss is capcay 250 against 215, +16%). Recall of all runs more than 50% off (any item count): 8 of 21 (38%), cases 4 of 11 (36%). The cut-off is flat: 150, 200 and 250 g flag the same runs. Drinks are left out on purpose: the owner's 350 ml cups match what he saved, and the two weighed coffees (kopi susu 250 and 200 ml against 140 and 80) are the recall given up for them; cups also have the S / M / L chips. Fire rate: 12 of 77 external runs (16%), 10 of 82 owner runs (12%; 6 of the 10 are the soto 668 g and two pepaya photos whose weight prod reads off a scale, which this replay had no scale answer for, so about 5% in prod), 0 of 12 feedback; on the owner's 10 nothing is more than 50% off what he saved (pepaya 300 against 200 is +50%). Limits: one eater (27 weighed cases, 11 with a big miss), the rule and the drink exclusion were chosen after looking at them (the cut-off check above is the only guard), 4 of 5 is a wide interval, and the owner set cannot confirm it because his saves are mostly the model's own number. Nothing is measured about whether people tap it or whether the typed weight is closer. **Shipped (code only):** `lib/ask-grams.ts` (`shouldAskGrams`, `withAskGrams`, `itemAtTypedGrams`), `askGrams: true` on the answer's only row in `analyzeFood`, its stream and a bare retry (not a retry with a hint), and on both result screens a small "Berapa gram? Timbang biar akurat" button under that row. Neither screen had a grams box (rows only have kcal; grams were derived at save), so the button opens a one-number field (focus moves in, Enter or "Pakai" applies, Escape closes); the typed weight scales kcal and macros, drops the model's piece / bone / portion text and is stamped `typed`, so the portion prior learns it. The prompt ends on any weight chip or typed weight. The model's answer is not touched, so the owner, feedback and external harness numbers cannot move. Checked: `bun test` for the rule (boundaries 199 / 200 g, 2 items, drink, scale, chip, cup, no grams) and for the router, typecheck of api, web and native, and the web component driven in a browser on a throwaway page with the real helpers (300 g / 450 kcal to 120 g / 180 kcal, focus, Escape, Enter); the scan screen itself and the native build were not run.

**Ask for the grams, follow-up: Kecil / Sedang / Besar chips for people without a scale (track AskGramsWhenUnsure; code only).** Contract from the owner: beside the typed box, three chips = the matched dish's typical serving x 0.5 / 1 / 1.5, rounded to 5 g, labelled with their grams ("Kecil · 175 g"), computed on the server only when `askGrams` fires and a typical serving exists. Two facts about the source: the typical serving exists only in the curated library (`typicalPortionG`, now read by `typicalPortionG(name, region)` in `tkpi.ts` with the same matching as calibration: not for combinations, condimented dishes or compounds of an ingredient); the TKPI 2019 table has per-100 g rows and no serving size (`portionFromTkpi2019` only converts grams to kcal), so a food only that table knows gets the typed box alone. Evidence on the 10 flagged weighed runs (5 cases; script in `.tmp/eval/sig/sizes.ts`): spaghetti bolognese has no library row, so typing only (2 runs). For the other 8 the library typical is bubur kacang hijau 350 g (chips 175 / 350 / 525), the battered-mushroom answer named `ayam goreng tepung` 150 g (75 / 150 / 225), semangka 250 g (125 / 250 / 375), capcay 300 g (150 / 300 / 450). **The closest chip was Kecil in all 8**, at +25% (bubur, semangka), -25% (mushroom) and -30% (capcay), mean absolute error 26% against 106% for the model's grams. **Sedang is no better than the model** (97% against 106%): the library's typical serving is a restaurant serving (a 350 g bowl of bubur, a 250 g plate of watermelon) and the model's generic bowl default lands in the same place, while this eater's portions (100-140 g) are home and snack sized. "Closest chip" is an oracle pick, so 26% is a best case, not what people will tap. I did not tune the factors to these five dishes. Proposed fix, not built: derive the typical serving from what people weigh (the median of user-set grams per food from `food_log`, the data the portion prior already reads) and fall back to the library only where nobody has weighed; or, on this evidence alone, add a smaller step (x0.35) in front of Kecil. Either needs more weighed photos than one eater's 27 cases. Shipped: `lib/ask-grams.ts` `sizeOptionsOf` (client-safe) and `itemAtTypedGrams(item, grams, "size")`; `withAskGrams(items, region)` (named in the paragraph above) moved to `lib/ask-grams-server.ts` so the apps never import the food library; `sizeOptions` on the row; a new stamp `size` in `GRAMS_EDIT_SOURCES` (the report can tell a chip tap from typed grams; because `food.addScan` validates `gramsFrom` against that list, deploy the server before the web and native builds that send it); chips on web (36 px) and native (32 pt + 6 pt hit slop = 44 pt); id / en / ms copy. Tests: size rounding and bounds, library lookup, rows with and without a serving, the router answer; typecheck of api, web and native passes.

**Egg counts (track EggCount): a second "list the pieces" call, shipped to code (not deployed).** Boiled-egg counts read low (3 eggs answered as 1.5 to 2.5; the 2026-10-22 entries tried prompt examples, which get copied, and "pick the higher count", which did nothing). This time the prompt is untouched and the count comes from a separate tiny call, as the scale readout does: after the scan, when the answer has a boiled-egg row (`isBoiledEgg`: `telur` / `telur rebus`, not ceplok, mata sapi, goreng, orak, puyuh, dadar, balado, putih, or built into a dish), one more vision call at temperature 0 asks for every egg piece as `{"kind":"utuh|belahan","box":[...]}` (list the pieces one by one, with a box, instead of writing a number). Server side (`lib/egg-count.ts`): entries whose boxes overlap 0.6 IoU are one piece listed twice, a whole egg is two halves, the egg row takes count x 25 g (half) or 50 g (whole) and kcal and macros scale from the row's own numbers, a second boiled-egg row (the scan sometimes lists one pile twice) is merged into the first, and any failure, timeout (8 s) or empty list leaves the scan's count.

**Set and truth.** Seven photos, my own count by eye (counts, not weighed; yolks are in plain view): `De1zqW-CaQ1-1` (3, cut up in a bowl), `DezY83IGO1d-1` (3: six halves and one loose yolk), `wf-8167cabb04` (the same plate as DezY83IGO1d-1 as a feedback photo, 3), `De85VZIiVb9-1` (six halves, 3; he wrote 2), `DejA-JxiQOP-1` (2, four halves on rice with a scale), `DetVnzNCc1_-1` (1, two halves beside egg white and tofu), owner `0d89cc6c17` (1 whole egg in a hand, the "do not break a right answer" case). The low-trust `Derp6N2ibHP-2` (one half in gulai, a screenshot) was not used.

| photo | my count | baseline, 3 runs | list call (shipped) | two numbers (halves, whole) |
|---|---|---|---|---|
| De1zqW-CaQ1-1 | 3 | 2, 1.5, 1.5 | 2.5, 2.5, 2.5 | 1.5, 1.5, 1.5 |
| DezY83IGO1d-1 | 3 | 2.5, 2.5, 2.5 | 3, 3, 3 | 3, 3, 3 |
| wf-8167cabb04 | 3 | 2.5, 2.5, 2.5 | 3, 3, 3 | 3, 3.5, 3 |
| De85VZIiVb9-1 | 3 | 2, 2, 2 | 2.5, 3, 3 | 2.5, 2.5, 2.5 |
| DejA-JxiQOP-1 | 2 | 1, 2, 1 | 2, 2, 2 | 2, 2, 1.5 |
| DetVnzNCc1_-1 | 1 | 0.5, 1, 0.5 | 1, 1, 1 | 1, 1, 1 |
| owner 0d89cc6c17 | 1 | 1, 1, 1 | 1, 1, 1 | 1, 1, 1 |
| exact / 21 runs | | 5 | 17 | 13 |
| mean error, the 6 multi-egg photos (18 runs) | | 0.72 egg | 0.11 egg | 0.39 egg |

Baseline reps wander by 0.5 to 1 egg on the same photo (De1zqW 2 / 1.5, DejA 1 / 2), the list call sits at the right count or half an egg under it. The second variant (two numbers: "halves" and "whole") is better than baseline and worse than the list on the cut-up bowl and the overlapping halves, so asking for the boxes is what helps, not asking a second time. A first wording of the list prompt (also telling it to skip eggs inside gravy) gave the same pattern in 4 runs per photo (6, 6, 6, 4 halves on the bowl, 6 on both plates of halves, 5 or 6 on De85, 4 on DejA, 2 on DetV, 1 whole). Two variants were run of the three allowed: the third idea, cropping the egg row's box at the full photo resolution, was not built because the list already lands on the right count.

**Regression** (`bun run scripts/eval-scans.ts --only owner --only feedback --only external --reps 3 --variant baseline --variant egg-count --variant egg-yolks`, then `--wrongfood --only wrongfood`; the scan is replayed from the raw cache, so the comparison is paired and only plates with a boiled-egg row can differ):

| set | baseline | egg-count |
|---|---|---|
| owner (46 photos, 138 runs) | name F1 65%, edited-only 49%, plate MAE 76 / 89 kcal | identical: no run changed (the owner's one boiled egg is right; the other egg rows are dadar, mata sapi, martabak, putih telur) |
| feedback (6 photos, 18 runs) | plate MAE 99 kcal, signed +5%, under / over 7 / 7 | 97 kcal, +8%, 5 / 7 (the egg plate 188 / 260 / 188 kcal becomes 226 / 297 / 226 against 225) |
| external (39 cases, 117 runs, trust >= medium) | plate MAE 157 kcal (n 95), signed +123%, under / over 32 / 57 | 157 kcal, +127%, 29 / 61; name F1 63% both |
| wrong-food (12 photos, 36 runs) | 21 of 45 checks, "3 boiled eggs, >= 120 g" 3 of 3, plate under / over 7 / 12 | same checks, 3 of 3, 5 / 12 |

External plate kcal does not move: the eggs are right now (DejA 50 / 100 / 50 g becomes 100 g) but that plate's other rows were already over (315 / 345 / 270 against 267 kcal, now 390 / 345 / 345), and De85's truth is the label's 2 eggs (154 kcal) while the photo shows 3, so a correct count scores about 70 kcal worse there. Nothing regresses beyond the noise (owner F1 about 3 points, small sets about 5), and the target photos improve by more than the baseline's own run-to-run spread, so it ships.

**Cost and latency.** One extra call only on plates with a boiled-egg row, sequential after the scan: 1.1 to 4.0 s measured over the seven photos (single runs through the Workers AI REST API), 513 to 631 tokens (483 in, 28 to 148 out), 5.2 to 8.4 neurons. The ledger row keeps it as `usage_json.eggCount` (`ms`, `whole`, `halves`, `usage`, `error`).

**Shipped to code** (not deployed, nothing committed): `lib/egg-count.ts` (+ `egg-count.test.ts`, `routers/egg-count.test.ts`), `isBoiledEgg` / `EGG_GRAMS` in `lib/piece-count.ts`, the call in `ai.analyzeFood` / `analyzeFoodStream` (shared) and the retry path (a count in the hint still wins), the anonymous scan (`apps/server/src/anon.ts`) and the Threads bot scan (`apps/server/src/index.ts`). No flag. Harness variants `egg-count` and `egg-yolks` stay. **Limits:** counts are mine, not weighed; seven photos in six meals; the cut-up bowl still reads 5 halves against my 6 (broken yolks); the streamed preview still shows the scan's own count until the final answer replaces it; a retry with no hint asks the same temperature-0 question and gets the same count.

**Scale readout on Annas's photos (track ScaleReadoutSmall): the lapis-legit misses were 12 s timeouts, not misreads; a hedged second call shipped to code (not deployed).** All 44 external photos looked at by eye (case photos, and the full-size ones in `.tmp/annas-raw` for the cut-off displays): three show a readable display, `scale.json` written beside each (git-ignored): `DegyOEkCZdN-2` lapis legit 12 g (box, display zeroed: it equals his 12 gr), `DegyOEkCZdN-5` avocado 346 g (ceramic bowl, not tared, `foodGrams` 100), `DejA-JxiQOP-3` mango 70 g (plate, zeroed, `foodGrams` 70). Two more show a display cut by the frame and are left unlabelled: `De_NoSZks2N-2` (digits half out of frame, the model reads 199 g in 56 of 56 runs; 100 g rice + 100 g chicken from his text would be 199-200 g, but the plate also carries the 130 g tempeh, so I cannot say what it weighs) and `DejA-JxiQOP-1` (only a fragment of one digit shows; the model answers null 8 of 8 live, but 1 of 4 harness runs read "3 g" at 0.80 and the 10x ratio gate set it aside). The owner's five displays (668, 270, 313, 260, 258 g; read by me off the photos; the labels had gone missing, which made the harness call them false reads) are labelled again under `.tmp/dataset/owner/`. Run: `--only external --variant baseline --variant scale-readout --reps 4`, then again after the change (the scale call's raw answers dropped from `.tmp/eval/raw` and the scale-readout results from `.tmp/eval/cache`, so the second run called the model live; the scan answers replay from the raw cache, so the pair stays paired).

| Run | Display runs read / used | Digits exact | Scale call failed | Mean grams error on display photos (before to after) | False reads on photos without a display |
|---|---|---|---|---|---|
| before (stale 12 s timeout in the cache) | 11 of 12 | 11 of 12 | 2 of 155 | 419.5% to 55.5% | 0 of 135 runs on 34 photos (plus 199 g on the cut-off `De_NoSZks2N-2` 4 of 4, and the "3 g" above, set aside) |
| after (hedged call) | 12 of 12 | 12 of 12 | 0 of 155 | 419.5% to 1.3% | 0 of 139 on 35 photos, the cut-off `JxiQOP-1` included (199 g still 4 of 4; the "3 g" did not recur) |

Per photo after: lapis 12 g in 4 of 4 (baseline 90-120 g; the 12 g stays, the box is skipped as `too_light`), avocado 346 g becomes 96 g in 4 of 4 (truth 100), mango 70 g in 4 of 4 (baseline 150-250 g). Owner set, 2 reps, `--only owner`: 72 runs on 36 photos without a display, 0 false reads; 10 runs on the 5 displays, 9 read and used, digits exact 9 of 10, the one miss again a 12 s timeout (`1f46c991e3#1`); its mean distance from the display is 11.2% to 17.6% because the container weight comes off (soto 668 to 418 g), which is the correction, not an error.

**Diagnosis of each miss.** (1) Lapis legit "reads nothing" on the first run: not the prompt. The raw answer for that run is a correct `12 g, 0.90, box` (replayed from the raw cache); the run's recorded time is 12,002 ms, i.e. `SCALE_TIMEOUT_MS`: the call stalled and the answer arrived after the deadline, then sat in the results cache as "no reading" (2 of 155 external runs and 2 of 82 owner runs are exactly this; none was a wrong digit, low confidence, wrong `appliesTo` or a display under 20 g thrown out; the 12 g reading passes every gate: confidence 0.9, `too_light` skips the box, ratio 12 x 10 = 120 against the model's 120 g). (2) The stalls are per request, not a slow platform: in 40 live calls on five photos three took 9.4, 10.6 and 14.8 s while the other workers finished about 2 s calls beside them (median 1.9 s). (3) A real, smaller read-nothing mode: 4 of 208 live calls on the lapis photo answered `null` (about 1 s, all inside one concurrency-8 batch of 40; 0 of the other 168); digits were never wrong on a display photo (380 of 380 reads, 3 photos).

**Change.** `readScaleDisplay` sends the same request a second time when no answer is back after 4 s (`SCALE_HEDGE_MS`) and uses whichever answers first; the 12 s deadline and the retry on a malformed answer stay, never more than two calls, and the ledger's `scale.retried` says a second call went out. Live A/B in the same minutes, 200 calls per arm on the lapis, avocado, mango and cut-off photos: the hedge arm fired 4 times, each answered by 6.2 s at the latest; the plain arm's worst was 4.7 s. No stall past 9 s occurred in those 400 calls, so the live run cannot show timeouts removed, only that the second call goes out and answers; the unit tests cover the mechanism (stalled first call, answer in time with no second call and no timer left, both stalled, malformed twice = two calls). In the harness the hedge is a no-op: its raw-answer cache hands the second identical request the first one's pending promise (the owner run's two timeouts ran with the hedge on). Cost: a second call (about 4.5 neurons) on roughly 1 call in 50 (4 of 200). Files: `lib/scale-reading.ts`, `lib/scale-reading.test.ts`, `docs/scale-readout.md`.

**Not changed, worth knowing.** The lapis reading sits exactly on `SCALE_MAX_RATIO`: the model's lapis answers were 90, 120, 120, 120 g, and a 130 g guess would set the correct 12 g aside as `implausible` (the same gate caught the clipped "3 g"), so a 12 g slice on a scale remains the next place a correct reading can be lost; a looser ratio costs the clipped-digit protection and there is no data yet. `tared` was read right on 4 of 12 external display runs (the model says not-zeroed for the lapis box and the mango plate, whose displays equal his weights); harmless there only because `too_light` skips the container, a zeroed display of 400 g of food on a 300 g plate would lose 300 g. `De_NoSZks2N-2` reads 199 g on a half-cropped display at confidence 1.0 despite the prompt's rule that clipped digits stay under 0.5.

**Clef as a side step (experiment only, nothing built, nothing shipped).** Question: can `@cf/cloudflare/clef` (`clef` $0.24/M input, `clef-flash` $0.038/M, no output cost) sit beside Gemma, never in front of the scan and never replacing it, and improve (1) the ask-grams signal, (2) the wrong-name check (the 2026-10-17 probe's open "shadow disagreement" item), (3) one more use? Method: Gemma's answers are the production path (scale-readout) replayed from the raw cache, 0 Gemma calls (wrong-food replayed through `analyzeFoodPhoto` the same way); Clef gets the full 1024 px photo and, per row, the name, the box as text (`[ymin, xmin, ymax, xmax]`, 0-1000) and Gemma's grams. Every Clef call except the probe's menu needs Gemma's answer, so these run after the result is on screen. Total spend about $0.38 (1,720 distinct calls). Code and raw answers: `.tmp/clef/` (git-ignored). Thresholds below were picked from a sweep on the same data; the leave-one-photo-out line is the only guard. **(1) Grams.** Per row, three questions in one call: `lt` noul "less than 0.67 x grams g?" (the 50%-over line), `sm` noul "clearly smaller than {grams} g?" (the wording asked for) and `bk`, a `score` over six absolute gram buckets (expected grams against Gemma's). Weighed set: 77 runs of 39 cases, 21 runs more than 50% off in plate grams, 55 matched rows (24 more than 50% off, all over) from 22 photos, 11 of which hold a big miss, so read every interval wide. Current rule: asks on 12 runs (16%), catches 8 of 21 (38%) with 2 false asks. Clef beats it on this set at plate level: rule OR `clef` `sm` >= 0.8 asks on 27 runs (35%) and catches 15 of 21 (71%) for 3 false asks (+7 catches, +1 false ask); rule OR `clef-flash` `sm` >= 0.8 asks on 21 (27%), catches 13 of 21 (62%), 2 false asks (+5, +0); rule OR `clef` `bk` >= 0.3 asks on 16 (21%), catches 12 (57%), 2 false (+4, +0). The free alternative of relaxing the lone-row rule to "any non-drink row of 200 g or more" asks on 30 (39%) for +3 catches and +11 false asks, so Clef is better than that. On single rows it is not clearly better than Gemma's own number: AUROC for "more than 50% off" is 0.85 (`clef` `sm`), 0.83 (`clef-flash` `sm`), 0.82 (`clef` `bk`) against 0.75 for Gemma's grams and 0.70 for box area, and the photo-clustered bootstrap difference `clef` `sm` minus Gemma grams is +0.09, 95% interval [-0.16, +0.36]; "any row >= 200 g" alone flags 15 rows with 14 right. Leave-one-photo-out threshold: `clef` `sm` precision 78%, recall 75%; `clef-flash` `sm` 76% / 54%. The 6 rows `clef` `sm` >= 0.8 catches beyond the rule are 3 weighed coffees (drinks the rule leaves out on purpose), a nasi putih 150 g against 80, and two sambal rows of 30 g against 16 g (a 14 g miss, nothing in kcal); its extra false asks are a 15 g sambal, tahu 120 against 140 g and cucumber 20 g. The drawn red box variant (one image per row) was worse than the text box (AUROC 0.67 to 0.77). As a portion estimator the bucket score is no better than Gemma (Spearman against weighed grams 0.31 `clef`, 0.47 `clef-flash`, 0.16 Gemma; median |log ratio| 0.42, 0.36, 0.41). The owner side cannot confirm it: his saves are mostly Gemma's own numbers. Corrected / retried owner cases (46 rows, 4 more than 50% off his saved grams): the rule flags 2 and hits 0; `clef` `sm` >= 0.8 flags 5 and hits 2; all owner rows (122, 13 big): `clef` `sm` >= 0.8 flags 17 and hits 3 (18%). The rule plus `sm` >= 0.8 would ask on 37 of 82 owner scans (45%; `clef-flash` 27, 33%) against 10 (12%) now, and there is no evidence those asks are right or wrong. **(2) Name check.** 127 judged rows from 22 photos (wrong-food 11 photos, owner corrected / retried 18 photos, overlap counted once): 40 wrong names (15 photos) and 87 right (labels by hand against the saved names and the wrong-food checks; extras the saved list omits left out). Candidates are Gemma's name, its `alt` names and the probe's look-alike group; the true dish is among them for only 7 of 40 wrong names (18%), because the miss is usually outside the vocabulary (putih telur read as es mambo, nasi jagung as nasi kuning, terang bulan as kue lapis legit). Gemma's alt chips hold the truth for 5 of 40 (13%); `clef`'s top pick is the truth for 4 of 40 (10%; 4 of the 7 where it was offered). Disagreement (top pick is not Gemma's name) flags 43% of wrong names (17 of 40) and 16% of right ones (14 of 87), precision 55%; P(Gemma's name) < 0.7 flags 75% against 53%. AUROC wrong against right: `clef` closed 0.63, `clef` with a "lainnya" option 0.65, a yes/no question per row 0.59, `clef-flash` 0.57 / 0.68 / 0.50, and the free signal "Gemma wrote an alt for this row" (88% of wrong rows, 44% of right ones) 0.78. The open 102-dish menu in parallel (shadow; first row of 55 runs, only 28 of them with a name inside the vocabulary): disagreement flags 90% of wrong first rows (27 of 30) and 76% of right ones (19 of 25); its top pick is the truth for 5 of 30 (`clef-flash` 0). **(3) "Anything on the plate not listed?"** A noul over the photo plus Gemma's list. 45 of 77 external runs have a weighed item Gemma did not name (many of these are mis-named dishes, not absent ones, so the label is noisy), 32 do not. `clef` "main" AUROC 0.71 (`clef-flash` 0.73); at >= 0.5 it flags 8 of 45 (18%) with 0 of 32 false, at >= 0.3 11 of 45 with 2 of 32. Owner corrected, 36 runs (28 with a missing item): AUROC 0.80 to 0.84, but only 3 of 28 flagged at >= 0.5. Low recall on a noisy label. **Cost and latency** (36 external photos, one request at a time, REST from a laptop; Gemma for comparison: 4.4 s p50 and $0.30 per 1,000 scans from the table above): the grams call runs after Gemma, so the scan itself waits 0 ms more and the button would arrive about 0.75 s (p95 1.3 to 1.4 s) after the result; putting all three questions in one call costs almost no extra time.

| Call shape (after Gemma) | Model | Input tokens | p50 / p95 ms | $ per 1,000 scans |
|---|---|---|---|---|
| grams (`lt` + `sm` per row) | clef | 1,199 | 753 / 1,445 | 0.29 |
| grams (`lt` + `sm` per row) | clef-flash | 1,199 | 755 / 1,309 | 0.046 |
| grams + name yes/no + unlisted, one call | clef | 1,510 | 790 / 1,150 | 0.36 |
| grams + name yes/no + unlisted, one call | clef-flash | 1,510 | 777 / 2,231 | 0.057 |
| 102-dish menu, image only (parallel to Gemma) | clef | 3,105 | 964 / 1,509 | 0.75 |
| 102-dish menu, image only (parallel to Gemma) | clef-flash | 3,105 | 1,063 / 1,934 | 0.12 |

| Use | Set (n) | Today | Clef | Verdict |
|---|---|---|---|---|
| 1 grams | weighed, 77 runs, 21 big | rule: 12 asks, 8 of 21 caught, 2 false | rule OR `sm` >= 0.8: 27 asks, 15 caught, 3 false (`clef-flash`: 21 asks, 13 caught, 2 false) | Better on the weighed set at plate level, level with Gemma's own grams per row, doubles the scan's AI cost with `clef`: not now; at most a `clef-flash` shadow log |
| 2 name | 127 rows, 40 wrong, 22 photos | alt chips hold the truth 5 of 40 | top pick is the truth 4 of 40, flags 43% of wrong and 16% of right | No: not better than the alt chips, and the free "has alt" flag ranks as well (AUROC 0.78 against 0.63) |
| 3 unlisted | 77 runs, 45 with a missed item | nothing | flags 18% of them at 0% false (AUROC 0.71) | No |

**Verdicts.** (1) Clef beats the current ask-grams rule on the weighed set, catching 4 to 7 more of the 21 big plates for 0 to 1 more false asks, but the data cannot separate it from Gemma's own grams on single rows, the extra catches are drinks and a 14 g sambal, the owner set cannot confirm it, and the asks would grow from 12% to 33-45% of his scans; with `clef` the call costs as much as the scan itself ($0.29 against $0.30 per 1,000). Not worth building yet. The typed weights from the shipped "Berapa gram?" button are the labelled data that would settle it, and `clef-flash` (about $0.05 per 1,000, same signal within the noise) is the only version worth logging beside it. (2) Not worth building: Clef does not beat Gemma's alt chips at proposing the true dish (10% against 13%) and its flag is no better than whether Gemma wrote an alt. (3) Not worth building. Limits: 11 photos hold the big misses, one eater, thresholds picked on the same rows, hand labels for names, REST latency from a laptop.

## 2026-10-24: "wrong food" answers: a labelled set, what moves it, what does not (nothing shipped to the scan)

**Ask.** Wrong dish names are the largest remaining complaint in scan feedback (14 days). Find causes, ship only what improves them without hurting the existing sets.

**Where the wrong names come from (prod D1, read-only).** 185 saved scan sessions of 21 users (10-17 to 10-24): 69 name corrections ("the photo said X, the diary got Y") in 48 sessions. They are spread thin: 8 are rice varieties (yellow rice read as white rice twice, nasi kuning for nasi jagung 3 times, for nasi liwet, nasi putih for nasi uduk and nasi padang; 5 users), about 9 are fried snacks that look alike (bakwan / corn fritter / risoles / combro / tempe or tahu tepung), the rest are one-offs (juice flavour, soup type, chicken fried / boiled, a toast that was a waffle). Ledger refusals: 20 `not_food` of ~940 scans (7 users). Chips/crackers answers on a fritter: `crackers 100 g 500 kcal` and `corn snacks 50 g` (one user, who also renamed a "corn fritter" to "vegetable fritter"), `snack 85 g` and `crackers 15 g` (another), `potato chips 10 g`; none of those photos is kept, so none could be measured.

**The set** (`.tmp/dataset/wrong-food.json`, git-ignored; photos never committed; harness `scripts/eval-scans.ts --wrongfood`, group `wrongfood`). Only photos people agreed to keep: 12 photos, 16 checks ("an answer item's name contains X", one check also needs 120 g or more), truth = the user's note or diary save. Sources: 2 kept feedback photos with a note or diary save (nasi uduk with shredded egg + anchovy; 3 boiled eggs cut in halves), 1 kept feedback photo of the owner (nasi kuning box: omelette wedge, urap), 9 owner photos whose diary save renamed the dish (bakwan held in hand; 3 bags of boiled egg white read as lontong / es mambo susu; papaya read as watermelon; terang bulan read as kue lapis legit; a cup printed "Americano ICE" read as es kopi susu; nasi jagung read as nasi kuning; nasi liwet + ayam bakar read as nasi kuning + ayam goreng). Not measurable (no kept photo): mango juice no sugar read as orange juice, sayur bening as sayur asem, tempe tepung as bakwan, Pizza Hut as roti panggang keju, Fadhil's fritter as crackers. One kept photo (a battered piece held in a hand, rated "makanan", no note) has no known truth and is left out. Reps: 8 per variant (4 for the ablation and the model swap); the owner's own scan memory ("Ingat koreksimu") is not in these runs, so his usual egg-white corrections are not applied.

**Baseline** (HEAD prompt, harness, same model): checks hit 50 of 120 (42%). Per check over 8 runs: nasi uduk 0, 3 boiled eggs named and 120 g or more 8 and 8 (the count rule works on this photo), bakwan 8, egg white 0 / 0 / 0, papaya 8, terang bulan 0, Americano 5, nasi jagung 0, nasi liwet 2, ayam bakar 0, telur dadar 5, urap 6. Two findings. (1) The egg-white bag photo with a card beside it comes back `bukan_makanan` (a refusal on food) in 8 of 8 baseline runs; the bag held in a hand comes back `es krim plastik 100 g 210 kcal` or `susu 250 g` (truth 52 kcal). In the owner set this is 24 of 276 baseline runs failing, all on 5 egg-white photos, and the refusal is fragile rather than tied to one rule: failures out of 48 runs were baseline 4, no-package 4, no-count 4, no-drink 4, no-lookalike 3, no-sauce 2, no-printed-text 1 (each variant is the shipped prompt minus that rule), and an unrelated appended sentence (the `prompt-b` control) gave 16 of 276 on the owner set, `uduk-rule` 8. (2) The bakwan photo that was read as chips twice today is read right in every baseline run here (8 of 8 in the table) and in about 150 runs over all variants the only misses were two `tempe goreng tepung` (printed-text rule removed) and two refusals: the harness does not reproduce the chips answer.

**Baseline sets** (owner 46 photos, feedback 6, external 8; HEAD prompt, 6 reps = 276 / 36 / 48 runs): item-name F1 owner 66.6% (edited only, i.e. corrected + retried: 52.7%), feedback 42.2%, external 64.6%. The 24 egg-white refusals are scored as nothing, which flatters owner plate kcal and lowers owner F1 when a variant answers them, so F1 is also given without the egg-white photos: owner 71.7% (edited 59.3%). Noise: first half of the reps against the second half moves owner F1 by 1 point, feedback and external by 4; a control run that appends one unrelated line (the placeholder `prompt-b` portion sentence) moved owner F1 +3.1, feedback -0.2, external +3.8, so a prompt change is not shown until it beats about 3 points on owner and 5 on the small sets.

**Tried** (variants in the harness, same model; wrong-food checks hit of 120 / owner F1 without egg white, edited-only / feedback F1 / external F1):

| variant | what | wrong-food | owner (edited) | feedback | external |
|---|---|---|---|---|---|
| baseline | HEAD | 50 (42%) | 71.7 (59.3) | 42.2 | 64.6 |
| control `prompt-b` | an unrelated appended sentence | - | 74.8 (60.0) | 42.0 | 68.4 |
| `bag-rule` | a bag/wrapper holding food or drink is food, never bukan_makanan | 52 | 71.7 (55.7)* | 38.9* | 64.9* |
| `rice-rule` | how to tell kuning / uduk / jagung / liwet / putih apart | 55 | 70.2 (52.3) | 41.8 | 66.1 |
| `chicken-rule` | goreng vs bakar by the skin | 55 | 73.4 (62.8) | 46.4 | 67.0 |
| `uduk-rule` | glossy rice + fried shallots + dry toppings on banana leaf is nasi uduk | 56 | 67.9 (52.3) | 45.4 | 66.4 |
| `uduk-kuning-rule` | uduk rule + "kuning only when evenly yellow" | 50 | 70.9 (54.2) | 47.4 | 65.5 |
| `t01` / `t03` | temperature 0.1 / 0.3 (production: model default) | 50 / 48 | 71.8 (60.2) / 71.7 (60.4) | 47.2 / 46.7 | 68.4 / 69.0 |
| `m-scout` (4 reps, wrong-food only) | Llama 4 Scout instead of Gemma 4 | 20 of 60 against 24 of 60 | - | - | - |

\* 3 reps; the baseline on the same 3 reps is owner 70.9 (58.1), feedback 40.0, external 62.5. Mistral Small 3.1 cannot take the request as built (`chat_template_kwargs` is refused), not tried further. `wf-rules` (bag + rice + chicken together) hit 60 of 120 on the wrong-food set and was not run on the baseline sets.

Reading it. The prompt rules do what they say on their own photo and nowhere else: `uduk-rule` makes the nasi uduk photo 8 of 8 (from 0 of 8), `chicken-rule` finds the ayam bakar in 3 of 8 (from 0), `bag-rule` takes the refusals from 8 to 1. Each is either inside the noise or costs something elsewhere. `uduk-rule` and `rice-rule` lower owner F1 (edited-only about -7 points both times, against +0.7 for the control): `uduk-rule` answers "nasi uduk" in 3 of 6 runs of a plain nasi putih + serundeng plate the owner saved as nasi putih, and drops the sambal of a nasi kuning plate. `chicken-rule` is +1.7 on owner (control +3.1), +4.2 feedback, +2.4 external: not distinguishable from an unrelated line. `bag-rule` turns a refusal, which already offers a hinted recount (`HINT_RECOVERABLE`), into a confident wrong answer (`es lilin susu 150 kcal`, `air mineral 0 kcal`) with no gain in checks hit (50 to 52). Temperature moves F1 by +0 to +5 (inside the noise of the 6 and 8 photo sets) and the wrong-food checks not at all (50 / 50 / 48): at 0.1 the 8 runs of a photo are nearly identical and still wrong, so what remains is the model's reading of the photo, not sampling. Llama 4 Scout is not better on this set (it finds the terang bulan 4 of 4 and loses the papaya and the omelette).

**Correction memory for everyone (`CORRECTION_MEMORY_USER_IDS`): not enabled.** Replayed chronologically over the 185 sessions with the real `correction-memory.ts` (memory built from each user's earlier sessions only): only 1 of 21 users (the owner) has any pair seen twice, so the prompt block would change nothing for the other 20. The block would have been added to 24 of 164 replayed sessions, all the owner's. The one-tap chips (a single correction is enough, gated by a shared word with the model's top answer) were offered 10 times and the user saved that dish once; the other 9 are loose matches ("ayam goreng tepung" offered "ayam bakar", "spicy fish" offered "rice and sayur asem", "Risoles" offered "combro"). It also costs two ledger queries (up to 300 session rows with their JSON) per scan for every user. Revisit when users have repeated corrections of the same dish (the owner's putih telur is the only such case today).

**Also checked and dropped.** The shadow A/B (identity rule, temperature 0.1) stored on 37 saved sessions cannot score: a scan saved unedited carries the production answer as truth, so the shadow loses by construction (12 sessions better for production, 1 for the shadow, 24 equal) and neither fixed any of the corrected ones. A server-side guard on a "chips / crackers" item with high grams would be a rule without a single photo it was measured on (the four ledger cases are not kept), so none was written.

**Decision.** No change to the scan prompt, calibration, flags or `wrangler.jsonc`: no candidate beat the noise on the wrong-food set without a visible cost on the baseline sets. What shipped is the measuring tool: `scripts/eval-scans.ts --wrongfood` (group `wrongfood`, checks, failed runs count as misses), the ablation variants (`no-count`, `no-package`, `no-drink`, `no-sauce`), the candidate variants above, `t01` / `t03` (a variant temperature, part of the cache key), `m-scout`. Not measured: anything about the five production photos that are not kept; whether users on the production binding see the `not_food` refusal on egg-white bags as often as the REST harness does; the real rate of the chips misread (the harness did not reproduce it). To make progress, the cheapest next data is more kept photos: the keep-photo consent only fires on a negative rating with the tick, and 5 of the 7 wrong-food reports this fortnight carried no kept photo.

## 2026-10-22 (night): the usual portion that never applied (owner's putih telur, 50 g every scan, saved 100 g every time)

**Symptom.** Boiled egg white scans came out at 50 g (25 kcal); the owner corrected to 100 g (52 kcal) on every save and the next scan said 50 g again, although "Porsi kebiasaanmu" has been on for everyone since df1eddc.

**Production data** (D1 read-only, his `food_log` rows named putih telur and his `scan_correction` rows; no other user). Model answer then saved grams, oldest first: 100/100 (unedited), 50/100, 60/100, 100/100 (unedited), "2 plastik kecil" 100/200, then 50/100 three times; `scan_correction` agrees (ai_grams 50, saved 52 kcal). Three earlier rows on 10-20 were scans the model named another dish (es mambo susu, lontong), renamed to putih telur: not known to be edited, never counted.

**Why the learned 100 g was not used.** Not name normalisation (`canonicalFood` joins "Putih Telur" with "putih telur rebus"), not the source (all `ai` rows with an `items_json` list that differs), not the model leaving grams out. The history that existed before each of the last three scans was 200, 100, 100 (and then 100, 200, 100, 100 and 100, 100, 200, 100, 100): the 200 g he saved for two pieces made the coefficient of variation 32-35% against the 25% limit, so the food had no usual portion at all. Before that one save, two agreeing saves (100, 100) only put a chip on the row, and the model's own 100 g matched it, so nothing showed. Separately the retry ("Hitung ulang") and Cerita paths never applied the portion prior; the photo scan and its stream's `done` event did.

**Change.** (1) Saved weights are per piece (200 g for the AI's "2 plastik kecil" = 100 g a piece); the usual grams are multiplied by the pieces on the next photo ("3 buah" starts at 300 g). (2) A usual portion is the cluster of the newest 12 weights within 15% of one value, when it has 2 or more and is more than half of them: one odd save no longer hides the habit, and 2 agreeing saves start the row at the usual grams (a looser spread keeps the old 3-to-start, 2-to-offer rule). (3) Cooking-state words and brackets no longer split a food's history. (4) The retry and Cerita (rows that start at the usual grams) apply it too. Replayed on his 8 real scans: before the 2nd save nothing changes, from the 5th the row starts at the weight he saved (the "2 plastik kecil" one at 200 g), and the three 50 g scans start at 100 g, 52 kcal, with "AI: 50 g" one tap away. Detail in `docs/portion-prior.md`.

## 2026-10-22 (later): Jumlah stepper, Dengan tulang switch, retry hint, bias check (scan prompt unchanged)

Feedback behind it: a tester's 3 boiled eggs read as 1, bone-in chicken weights ("dada ayam goreng 140 g bertulang, total 560 g"), retries that "return the same", and users writing the AI skews high.

**1. Egg counts after db6a70c.** The tester's photo is not kept, so I used public Wikimedia Commons photos and my own count (3 reps each, production model and prompt, `db6a70c^` against HEAD). Whole eggs were already right before the change; halves and piles were not:

| photo (my count) | before db6a70c | after |
|---|---|---|
| 3 whole eggs, wood table / bowl | 3 butir (3 of 3) | 3 butir (4 of 4, both photos) |
| 6 eggs in a carton | 6 butir | 6 butir (4 of 4) |
| 4 egg halves + 1 whole egg (3 eggs) | "4 belahan" + 1 / "2 butir" + 1 / "1 butir utuh, 4 belah" (60 g) | "4 belahan (2 butir)" + "1 butir" (4 of 4) |
| 2 halves of 1 egg | "2 butir" (100 g, 2x too much) in 3 of 3 | "2 belahan" 50 g (4 of 4) |
| deviled eggs, about 8 halves | "porsi sedang" / "7 butir" / "7 butir telur 350 g" | 7, 7, 8, 7 belahan |
| telur balado pile, about 4 eggs | "beberapa butir" (no number) x2, "tiga butir" | "4 butir" (4 of 4) |
| 2 fried eggs, 1 boiled egg | right | right |

So the counting rule holds on these 11 photos (every miss is 1 on the busiest plates, none is 3 as 1). It cannot fix a count the model reads wrong, so the fix for the reported case is the user's: every countable row now carries `pieces` ({count, unit, unitGrams}) and shows a "Jumlah" stepper (minus, "3 butir", plus): one tap sets the count, grams = count x one piece and kcal and macros scale from the row's current numbers (`lib/piece-chip.ts` itemAtCount, used by web and native). Rows of the weight table get it (egg, quail egg, sate, nugget, siomay/dimsum, pangsit, bakso, roti tawar, pisang goreng, plus bakwan 50 g, pastel 60 g, onde-onde 40 g from the Joyo AI typical portions); a name outside the table gets it when the model wrote a count with a unit of pieces ("telur balado 4 butir", "ayam goreng 2 potong", "kerupuk 3 keping"), with grams as the model gave them (one piece = grams / count). Egg white, yolk, duck and salted egg are not "butir of 50 g" and get no table row. Corrections (`ai.correctScan`) echo and re-derive `pieces` and the bone weights. No prompt change.

**2. Bone-in meat.** The scan already priced the edible part of ayam goreng / bakar and ikan goreng (one fixed 0.65). Now the share follows the named part (`lib/bone-in.ts`: sayap 0.5, paha bawah/drumstick 0.6, paha 0.65, paha atas 0.7, dada 0.7, iga 0.5, whole fish (lele, nila, gurame, bandeng, kembung, bawal, ikan mas, kakap) 0.55; fillet, katsu, soups, rice plates and combinations are never bone-in). These are estimates from usual poultry, rib and whole-fish yields, labelled "perkiraan". Library dishes keep the kcal cap on the edible grams; ribs and whole fish with no library row keep the model's kcal and only state the edible part. The item carries `grossGrams`, `edibleGrams` and `withBone`; the row says "±200 g dengan tulang, ±130 g bisa dimakan" and a "Dengan tulang / Tanpa tulang" pair moves `grams` between the two (kcal do not change: they are the meat's), saved grams follow the choice (`lib/bone-chip.ts`). Probe on 5 photos x 3 to 4 runs: the weights with bone the model answers are the weak part: the two weighed external photos (205 g for two drumsticks, 115 g for one thigh, whether with bone is not stated) were answered 100 to 150 g for two pieces and 100 g for the thigh; the wing plate 7 to 8 pieces 400 to 450 g; two rib photos 250 to 450 g, now with edible 125 to 225 g shown. A prompt rule with per-part weights with bone (sayap 60, paha bawah 100, paha atas 130, dada 180 g, name the part, count the pieces) was tried and rejected: the model called the drumsticks "sayap" in 3 of 3 runs and answered 120 g for them, and the thigh moved from 100 to 130 g. Not shipped.

**3. "Coba lagi" / Hitung ulang.** Diagnosis from prod (`ai_usage` sessions with retries, 14 sessions, 16 passes): 13 of 16 passes carried a typed hint already ("Nasi putih 75 g", "telurnya", "itu nugget 2pcs", "10 pcs"), and 15 of 16 changed the item names or the kcal by more than 5%, so retries are not near-identical. The four "retry_tap" rows in the admin feedback table are the implicit rating older clients send with the tap, not reports. What does fail is a count in the hint ("2pcs" nugget answered 30 g, "10 pcs" macaroni with no count, sosis "2 tusuk" 80 g). Shipped: the hint field says "Kasih tahu AI yang benar (opsional)" with the placeholder "mis. ini bakwan, telurnya 3"; the retry prompt says names, counts and weights written by the user win over the photo; the server puts counts written in the hint ("telurnya 3", "3 butir telur", "ada 4 butir") on the one row of pieces they name (`applyHintCounts`). Hint probe (model plus that server step), 5 photos x 3 runs, answers with the count the hint asked for: 15 of 15 (eggs 3 -> 2, balado 4 -> 6, nasi uduk "ini bakwan, telurnya 3", carton 6 -> "cuma 4 butir", deviled 8 -> 10). Tried and not shipped: quoting the previous answer back in the retry prompt ("do not repeat it"): on 9 labelled owner cases the retry changed materially in 8 of 9 (old text) against 7 of 9 (quoted), closer to the saved truth in 4 against 3, further in 2 against 2, and it added a martabak that was not there once. The extra text is a coin flip, so retry keeps its short prompt.

**4. "AI skews high?"** Prod `scan_correction` (read-only, 1059 rows, 12 days): 96 rows (9%) were edited, 60 down and 36 up, median saved/AI 0.86 on those; over everything saved kcal is 187,687 against 190,857 asked: -1.7%. The heaviest dishes are flat: nasi putih 83 saves ratio 1.003, white rice 37 ratio 0.96, telur dadar 21 and tempe goreng 16 never edited, fried chicken 1.055, and the one dish that moves a lot is putih telur, edited UP (6 up, 1 down, ratio 1.21). Daily ratios 0.95 to 1.00. Feedback reasons: kcal_tinggi 4, kcal_rendah 0 of 49 ratings, 2 of them "akurat". Most saves are accepted as is, which is not proof of accuracy, so the weighed external set is the only truth: rice grams +45% (n 10), side grams +25% (n 11), plate kcal +26% / MAE 78 kcal, 6 under and 5 over; the owner set's edited scans +111% / 103 kcal over (24 runs) are mostly misnamed foods (egg white read as ice cream). The calibration paths for that were already run on 2026-10-21 (`scale-cues`, `typical-tap`, band changes) and broke the owner set; one weighed eater is not enough to move the global default again, and the owner prefers over to under. So no prompt calibration change; the typical-rice chip stays the lever. Harness before/after this change (calibration code only, same raw answers, 40 labelled photos, 2 reps): identical, plate kcal over 28 / under 17 (owner), 5 / 6 (external); no dataset item is a named chicken part or rib. Added: a negative rating (Kurang akurat / Salah) sent with no reason and no note is held back once and the four reason chips are asked again, small ("Apa yang kurang pas? Pilih satu atau lebih."); the second Send goes through whatever is chosen (web and native).

Limits: the egg and bone photos are public Commons photos and two weighed contributor photos, my counts, 3 to 4 runs; the model answers nearly identically run to run, so reps show little noise but also little coverage. Reproduce with `.tmp` probes of `analyzeFoodPhoto` and `scripts/eval-scans.ts --reps 2` (cached raw answers replay the unchanged prompt).

## 2026-10-22: counted pieces (egg halves answered as one egg), confidence percent removed from the result

Tester photo (web Safari, 30-day challenge): a plate of 7 boiled-egg halves (3.5 eggs) answered "telur rebus, setengah potong, 60 g, 78 kcal" = one egg, shown with "100% sure". The photo is not committed; the case is covered by a synthetic answer in `lib/piece-count.test.ts`.

Changed: (1) `COUNT_RULE` in the scan prompt: separate pieces (egg, egg half, satay stick, nugget, dumpling, meatball, bread slice, fried banana) are counted first; the item carries `count` and `unit`, the portion text carries the count ("N belahan (N/2 butir)"), grams = count x unit weight. (2) `lib/piece-count.ts` holds the same unit weights (egg 50 g, half 25 g, sate 30 g, nugget 20 g, siomay/dimsum 25 g, pangsit 15 g, bakso 25 g, roti tawar 30 g, pisang goreng 60 g) and `reconcileCount` runs in `boundItem` (final parse and stream preview alike): grams more than 20% off count x unit weight are replaced by it and kcal and macros scale with them; names or units outside the table (ayam goreng "2 potong", martabak telur, nasi goreng telur, telur dadar) are untouched. (3) The per-item "yakin N%" / "N% sure" text is gone from the web and native result lists (`result.items.confidenceShort` deleted in id/en/ms); the cue that stays is "perkiraan AI" next to the grams. The model still returns `confidence` (feeds `aiConfidence` and feedback data); only its display went.

Photo (production model, no thinking, same config as prod, 4 to 6 runs per variant):

| prompt | runs |
|---|---|
| before | 1 egg, 50 / 60 / 60 / 75 g, 75 to 110 kcal (never counts) |
| after | "4 belahan (2 butir)" 100 g 150 kcal in 4 of 6, "5 belahan (2,5 butir)" 125 g 188 kcal in 2 of 6 |

The count is still low (true count 7, the model reads 3 to 6; halves that touch or overlap are missed) so the answer moves from 1 egg to 2 to 2.5 eggs, not to 3.5. Server-side grams now always agree with the count the model gives; they cannot fix the count. Wording notes from the probes: an example number in the prompt is copied (an example of "7 belahan" made the model answer 7-ish for any photo with eggs, "6 belahan (3 butir)" made it answer 6), so the examples are a satay count and "N belahan (N/2 butir)"; naming quail egg in the weights list made the model call chicken-egg halves quail eggs, so it is only in the server table; "when in doubt pick the higher count" did nothing measurable.

Regression (harness, owner + feedback + external, baseline variant, 2 reps each, same model; before = HEAD, after = HEAD + this change; 40 labelled photos, none of them an egg count case): plate kcal error, owner median +3.4% / MAE 64 kcal before vs +4.9% / 70 after; external median +1.6% / 102 vs -1.6% / 78. 26 of 40 photos answered differently from one run to the next in both arms (prompts that differ in any way re-roll the model), none because of the count rule: no item in the set was reconciled by `reconcileCount`. One printed-label case (Americano ICE, truth 10 kcal) flipped to "es kopi susu 193 kcal" in one run when `COUNT_RULE` was placed after `PRINTED_TEXT_RULE`; with the count rule first, the printed-text rule last it answered Americano 5 kcal in 2 of 2.

## 2026-10-21: small packaged items and bone-in meat (clamp checked; edible fraction + package prompt rule shipped to code)

Where the clamp is: `calibrateOne` in `lib/tkpi.ts` clamps **kcal** only, never grams. A matched dish's kcal band scales with the item's grams (`bandFor`), the unmatched fallback is 20 to max(400, 7 x grams) kcal, and nothing anywhere sets a gram minimum (grams missing = the dish's typical portion). So the 50-60 g egg white of the owner's photo came from the model itself (earlier log: 80, 60, 150, 50, 60, 60), not from a floor; the prompt had no rule about packages. "Putih telur" had no library row, so a bag named lontong/lemper was priced per gram of those.

Changed: (1) `PACKAGE_RULE` in the scan prompt: a printed net weight is the grams, otherwise the contents of the pack by its visible size, and bone-in meat is answered as seen with the bone. (2) `TdpiDish.edibleFraction` (ayam goreng, ayam bakar, ikan goreng/bakar: 0.65) in the library: for scan estimates only (`asSeen`), the kcal band follows the edible grams and kcal are capped at the library per-100 g of the edible part x 1.35; names with fillet / suwir / tanpa tulang get no fraction; grams a person typed or weighed are priced whole. The item carries `edibleGrams` and its portion says "dengan tulang" / "with bone". (3) a "putih telur rebus" library row (52 kcal/100 g, band 30-150 per 100 g). Unit tests in `tkpi.test.ts`, `vision.test.ts`.

Eval (harness, owner + external, baseline variant, 3 reps, `--no-cache`, same model; before = HEAD, after = HEAD + this change; the `egg-white-card` case was added to the owner set for both). Plate kcal over/under on the 35 common cases (owner 27 + egg + the later hand labels, external 8):

| set | before kcal signed / MAE, under, over | after |
|---|---|---|
| owner | +86% / 96%, 10, 42 | +72% / 84%, 20, 41 |
| external | +22% / 36%, 6, 9 | +23% / 37%, 9, 9 |

Read this with the noise in mind: the model is re-asked every run (owner "under" moved 10 to 20 on plates that have no bone-in item, e.g. the egg white and an ice cream bag). On the 21 matched ayam/ikan items alone the mean kcal error moved -5% to -6%. The three owner plates with ayam goreng tepung came down 40-50 kcal (one nearer the saved number, one farther); on the external weighed "ayam goreng paha" plates the reference counts the weighed grams as meat, so the lower number reads as more under there. Egg-white-card: grams 100, 100, 100 before (named lemper) against 180, 102, 102 after (named lontong); the name is still wrong, so the kcal are still wrong (240/135/130 vs 53 true), and 3 runs cannot say the package rule moved the grams (102 is also what the scale display reads). Nothing here proves an accuracy gain; the edible fraction is the user's stated product decision, applied with a 0.65 prior (not measured on weighed bone-in plates).

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

## 2026-10-21: "Porsi kebiasaanmu" for everyone, plus a "Biasanya: 100 g" chip for plain rice (global rice default NOT changed)

Question: the prior fixed rice for the one weighed eater but was allowlisted to the owner, whose diary holds no user-set weights. What reaches everyone else, and is 150 g the wrong global answer for rice?

**Production data** (read-only, counts only, last 60 days, 2026-10-21): 796 diary rows with grams from 46 users. 10 users have any user-set weight (typed, or an AI row whose grams were edited); the most for one food is 4 (one user, identical typed weights); plain rice has 5 user-set weights from 5 users. The prototype's 5-entry gate would have switched on for nobody. The model's saved rice rows (64): 150 g 27 times (the median), 100 g 16, 200 g 6, the rest 50-300 g.

**Shipped** (details `docs/portion-prior.md`): no flag, every user, every photo scan. Three tiers: 3 or more consistent user-set weights (CV up to 25%) start the item at the usual grams; 2 only put them on the chip; plain rice with no history gets a chip "AI: 150 g / Biasanya: 100 g" when the model answered 120 g or more, the model's number staying until the tap. A usual portion above the big-plate ratio (1.4) also stays on the chip now instead of vanishing.

**Threshold from data.** The contributor's rice plates (86, 100 x3, 125 x2, 150 g): the median of any k other plates misses a held-out plate by 22.8 g (k 2), 21.3 (k 3), 21.3 (k 4), 23.4 (k 5), against 37.7 g for the model's flat 150. So 3 is as good as 5 and 2 beats the model. In the harness the 3-entry and 5-entry gates give the same numbers in both sets (no case sits at 3 or 4 entries): the choice rests on the contributor's plates alone, one eater.

Run: `bun run scripts/eval-scans.ts --only external --only owner --reps 2 --variant baseline --variant portion-prior-v1 --variant portion-prior --variant portion-prior-min5 --variant portion-prior-tap --variant typical-tap` (74 new Workers AI calls: the shared answers were re-asked because the prompt changed under this run; all variants replay them, so every row is paired). External: 8 photos of one contributor; owner: 30 labelled scans (60 runs, 4 not_food).

| Set | Variant | Rice grams signed / MAE | Plate kcal signed / MAE | Plate under / over |
|---|---|---|---|---|
| external | baseline | +45% / 43 g (n 10) | +19% / 104 kcal | 6 / 6 |
| external | portion-prior-v1 (prototype, 5 entries) | +14% / 13 g | +13% / 120 kcal | 6 / 6 |
| external | portion-prior (shipped, 3 entries + chips, untapped) | +14% / 13 g | +13% / 120 kcal | 6 / 6 |
| external | portion-prior-tap (every offered chip tapped) | +7% / 23 g | +10% / 121 kcal | 8 / 4 |
| external | typical-tap (no history, everyone taps the 100 g chip = a global 100 g default) | -3% / 13 g | +7% / 126 kcal | 8 / 4 |
| owner | baseline, v1, shipped, min5 (all identical) | 0% / 16 g (n 17) | 72 kcal MAE | 15 / 25 |
| owner | portion-prior-tap | +15% / 43 g | 67 kcal MAE | 9 / 29 |
| owner | typical-tap | -34% / 57 g | 79 kcal MAE | 23 / 19 |
| owner, edited only (24 runs) | baseline, shipped | -6% / 13 g (n 4) | 85 kcal MAE | 5 / 13 |
| owner, edited only | typical-tap | -42% / 75 g | 90 kcal MAE | 9 / 10 |

(The owner's plate signed % is dominated by hand-labelled outliers such as ice cream against egg white, so for the owner only grams, MAE and under / over are compared.) Chips on the shipped variant: owner 16 of 120 items "yours" (history) and 2 typical, external 12 of 39 "yours" and 0 typical (every external rice already has a history of its own). With nobody having a history the typical chip shows on 17 owner and 12 external items.

Reading it:

- **Do not lower the global rice default.** Putting 100 g on every rice (typical-tap) fixes the external eater (+45% to -3%) and breaks the owner set: rice -34% / 57 g, under-estimated plates 15 to 23 of 60 (the worse error for the owner), edited rice -6% to -42%. The owner's saved rice weights are 150 g (as answered), 162, 200 and 200, the contributor's 100 g; one fixed number is wrong for one of them whatever it is. That is the case for a chip and a personal median, not a new default. Not tried as a prompt change: the same numbers are reachable post-hoc and a prompt edit would move every other food too.
- **Shipped numbers equal the prototype's in both sets** (untapped chips change no number): external rice +14% / 13 g, owner unchanged. Nothing is worse for the owner until he taps, by design.
- **What a tap buys** for someone with no history: on the external eater rice +45% to -3%, plate kcal +19% to +7%. On the owner set the same tap on every rice costs -34% rice, which is why the model's number is the one showing and the user decides.
- **Tapping the personal chips on the owner set** (portion-prior-tap) raises the error too (+15% / 43 g). [INFERENCE] an owner scan saved unedited has the model's answer as truth, so any chip that offers another number is scored as a miss there; not evidence against the chip.
- **Limits.** One weighed contributor sets the 100 g; 5 user-set rice weights exist in production; leave-one-out on a very regular eater; owner truth is mostly the model's own answer. 100 g is a hypothesis the chip lets people check by tapping, not a population average. Nothing here measures how often people actually tap: the chip's taps are not logged.

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
