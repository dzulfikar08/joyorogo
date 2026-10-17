# Clef probe: can `@cf/cloudflare/clef` improve food recognition?

Probe run on 2026-10-17 with `scripts/clef-probe.ts`. Nothing in production changed: the script calls Workers AI over REST and reuses `analyzeFoodPhoto` unchanged for the Gemma baseline.

Constraints from the owner: Clef must **not replace Gemma**; it is only a candidate side tool (confidence/alternatives, pre-checks), worth it only if it stays off the critical path; **over-estimated kcal is acceptable, under-estimated is the worse error**.

## Verdict

1. **Replace Gemma: no.** Clef cannot name a dish by itself and is worse as a picker (see below).
2. **Blocking reranker after Gemma: no.** It adds +0.5 to +0.9 s (p50) to every scan, and its flags are noisy: at the useful operating point half of the flagged dishes were actually right.
3. **Pre-checks (not food / blurry / dark): no.** Gemma already says no to non-food and heavily blurred photos in about 0.7 s, so there is nothing to save. Clef's blur/dark flags fire on mild degradation that Gemma still reads as accurately as a clean photo.
4. **Portion score: no, unproven.** It is stable, but there is no ground truth in the bench set and nothing here shows it is accurate. It cannot address the under-estimation concern.
5. **One experiment that stays off the critical path: yes, in shadow mode only.** Run `clef` (not `clef-flash`) with an open menu of dishes **in parallel** with the Gemma call and compare its top choice with Gemma's first item. It was done before Gemma in 21 of 22 runs and added 0.0 ms (p50) / 0.1 ms (p95) of waiting. On this set, disagreement flagged 40% of scans, caught 21 of 24 Gemma first-item errors, and the three best other menu options held the true dish for 15 of those 21. That is the only result here that looks useful, but it rests on 24 errors from hand-picked look-alike photos. It needs the real-photo eval set before any UI. Do not build the "Bukan ini?" chips until that run confirms it.

If a parallel call cannot be kept off the response path (it must never be awaited before returning the scan, and a Clef failure or timeout must be ignored), the answer reverts to **not worth it**.

## Setup

* **API**: `POST /accounts/{id}/ai/run/@cf/cloudflare/{clef,clef-flash}` with the wrangler OAuth token, account `b7e6f8457bd39fa37a7eea5249799754` (the one in `apps/server/wrangler.jsonc`). Image sent as a base64 data URL, one image, 960 px thumbnails (the clients send at most 1024 px).
* **Gemma baseline**: the real `analyzeFoodPhoto` (prompt, thinking off, parsing, TKPI calibration, retry rule) with a REST-backed `AiRunner`.
* **Photos** (all Wikimedia Commons, 960 px thumbnails, eyeballed on contact sheets and pruned when the label was doubtful):
  * 109 single-dish photos in 27 dishes, including the 8 photos of `scripts/bench-accuracy.ts`. The set leans on look-alikes on purpose.
  * 14 multi-item plates labelled by hand with the visible dishes.
  * 10 non-food photos (8 clear non-food, 2 empty plates).
  * Degraded copies (ImageMagick) of 22 of the single photos: blur sigma 3, blur sigma 12, brightness x0.45, brightness x0.15.
* **Candidate sets**: look-alike groups defined in the script (gorengan: perkedel, bakwan, tahu isi, tahu goreng, tempe goreng, risoles, rolade, lumpia, pisang goreng; ayam; nasi; mie; kuah; sate; minuman; ...), 2 to 10 options each, including decoys with no photos (rolade, nasi putih, sop buntut, ...). The "open menu" is every dish in the vocabulary plus common extras, 102 options.
* **Ground truth**: one label per single photo. Gemma's free-text name is mapped to a dish by regex (`canon` in the script); "first item" is the item Gemma lists first.
* **Clef question**: `choice`, Indonesian instruction, option descriptions ("described") or names only ("terse"). Option order is a seeded shuffle.
* **Pricing** (Workers AI pricing page, 2026-10-15): clef $0.24/M input tokens, **clef-flash $0.038/M**, Gemma 4 $0.10/M input + $0.30/M output. Clef has no output cost.

Caveats that apply to everything below:

* Latencies are REST calls from a laptop, not the Worker AI binding, so absolute numbers include network round trips (Gemma alone here: p50 2.4 to 3.7 s, p95 about 8 s, in line with the ~4 s production average). Comparisons between models in the same run are fair.
* Accuracy phases ran with 2 requests in flight. The latency and "where Clef sits" phases ran alone, strictly one photo at a time.
* Small numbers: 24 Gemma first-item errors and 109 photos. Treat percentages as +-10 to 15 points.
* The set is curated look-alikes from Wikimedia, not user photos. Gemma's 73% first-item accuracy here is not a production accuracy.

## 1. Gemma alone on the same photos

| metric | value |
| --- | --- |
| photos / scan errors | 109 / 0 |
| first item is the true dish | 73% (80/109) |
| true dish anywhere in the items | 74% (81/109) |
| first item outside the vocabulary (no judgement possible) | 5% (5/109) |
| bench kcal hit rate (the 8 bench photos) | 75% (6/8) |
| latency p50 / p95 (concurrency 2) | 2762 / 8760 ms |
| mean tokens in / out | 743 / 184 |
| mean cost per scan | $0.00013 |

* Gemma's own `confidence` is useless as a flag: AUROC **0.54**, mean 0.98 when right and 0.97 when wrong. There is currently no confidence signal in the scan result.
* **kcal direction.** On the 8 bench photos Gemma was above the band twice (nasi goreng 1860 kcal, gado-gado 645) and below it never; the 2 misses are both over-estimates. Of the 11 wrongly named first items where a reference exists (the median kcal Gemma gives that dish when it names it correctly), 3 were under-estimates (ratio < 0.85) and 8 were not. No Clef use below changes kcal by itself, in either direction, so none of them helps the owner's under-estimation concern directly.

## 2. Clef closed-set choice (candidates = look-alike group of the true dish)

This is the best case for the reranker: the right answer is always among the options.

| model | options | order | top-1 accuracy | mean P(true) | AUROC P(true) vs P(wrong option) | ECE of top prob | ms p50 / p95 | tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clef | names only | fwd | 78% (85/109) | 0.63 | 0.968 | 0.089 | 859 / 2127 | 893 |
| clef | described | fwd | 81% (88/109) | 0.67 | 0.962 | 0.085 | 936 / 2428 | 988 |
| clef | described | rev | 81% (88/109) | 0.67 | 0.962 | 0.085 | 847 / 2688 | 988 |
| clef-flash | names only | fwd | 69% (75/109) | 0.54 | 0.915 | 0.046 | 631 / 1450 | 893 |
| clef-flash | described | fwd | 72% (79/109) | 0.58 | 0.947 | 0.067 | 681 / 1634 | 988 |
| clef-flash | described | rev | 72% (79/109) | 0.58 | 0.947 | 0.067 | 643 / 1707 | 988 |

* Even with the right answer always offered, `clef` gets 81% against Gemma's open-vocabulary 73% on the same photos. That is not a fair head-to-head (Gemma has to name the dish from nothing), but it shows the gap on the hardest look-alikes is not large and `clef-flash` is clearly worse (72%).
* Option order does not matter: probabilities are identical to the last digit for `fwd` and `rev` on all 109 photos, so the model scores each option independently. No position bias to manage.
* Describing the options helps by 3 points on both models.
* Weak groups: gado-gado is called pecel 3 of 3 times (the groups need care: pecel is a legitimate neighbour), pempek/batagor, gorengan 73% (pisang goreng, perkedel, tahu isi), nasi uduk/nasi putih, soto/coto, mie goreng/mie ayam.

## 3. Clef as a reranker after Gemma

Candidates are the look-alike group of the dish Gemma named first (104 of 109 photos had a name inside the vocabulary).

| model | photos covered | Gemma first item right | true dish inside candidate set | Clef argmax right | wrong -> fixed by Clef | right -> broken by Clef | AUROC P(Gemma label) vs Gemma right | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clef | 104 | 77% (80/104) | 90% (94/104) | 74% (77/104) | 29% (7/24) | 13% (10/80) | 0.792 | 0.138 |
| clef-flash | 104 | 77% (80/104) | 90% (94/104) | 65% (68/104) | 21% (5/24) | 21% (17/80) | 0.799 | 0.213 |

Letting Clef overrule Gemma makes things worse (74% and 65% against 77%): it fixes 7 and breaks 10. That matches the owner's expectation. As a **confidence signal** it is the first one available (AUROC about 0.8 against Gemma's 0.54).

Flag a scan when P(Gemma's label) is below a threshold and show the two best other options as one-tap alternatives:

| model | threshold | flagged | Gemma errors caught | flagged that were really wrong | precision among unflagged | errors whose true dish is in the 2 alternatives |
| --- | --- | --- | --- | --- | --- | --- |
| clef | 0.5 | 30% (31/104) | 67% (16/24) | 52% (16/31) | 89% (65/73) | 50% (8/16) |
| clef | 0.7 | 49% (51/104) | 83% (20/24) | 39% (20/51) | 92% (49/53) | 50% (10/20) |
| clef | 0.8 | 62% (64/104) | 83% (20/24) | 31% (20/64) | 90% (36/40) | 50% (10/20) |
| clef | 0.9 | 78% (81/104) | 92% (22/24) | 27% (22/81) | 91% (21/23) | 50% (11/22) |
| clef-flash | 0.5 | 38% (40/104) | 71% (17/24) | 43% (17/40) | 89% (57/64) | 47% (8/17) |
| clef-flash | 0.7 | 58% (60/104) | 88% (21/24) | 35% (21/60) | 93% (41/44) | 52% (11/21) |
| clef-flash | 0.9 | 92% (96/104) | 100% (24/24) | 25% (24/96) | 100% (8/8) | 50% (12/24) |

At the best point for `clef` (0.5) the chips would appear on 30% of scans, half of them for a dish Gemma had right, and the true dish is among the two alternatives for 8 of 104 scans (7.7%). The probabilities are calibrated well enough to rank (flagged precision beats the 23% base rate of errors) but not to act alone.

### Multi-item plates (14 plates, 35 judged Gemma items)

| model | image sent | Clef argmax = Gemma label | mean P(label), item on the plate | mean P(label), item not on the plate | AUROC | ms p50 |
| --- | --- | --- | --- | --- | --- | --- |
| clef | whole photo | 86% | 0.78 | 0.65 | 0.718 | 816 |
| clef | crop of Gemma's box | 66% | 0.68 | 0.36 | 0.799 | 620 |
| clef-flash | whole photo | 89% | 0.73 | 0.70 | 0.595 | 780 |
| clef-flash | crop of Gemma's box | 74% | 0.61 | 0.38 | 0.762 | 372 |

With several dishes the whole photo cannot say which item the question is about, so the probability barely separates real from false items. A crop per item helps (AUROC 0.80) but means one extra call and image per item. Only 60% of the judged Gemma items are on my label list (21 of 35), so the labels are incomplete too; this table is indicative at best.

## 4. Clef open menu in parallel with Gemma

One `choice` question over 102 dishes (vocabulary plus common extras), image only. It does not depend on Gemma's answer, so it can start together with the Gemma call.

| model | top-1 | top-3 | top-5 | tokens | ms p50 / p95 | agrees with Gemma | Gemma right when they agree | Gemma right when they disagree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clef | 61% (66/109) | 84% (92/109) | 89% (97/109) | 2320 | 1437 / 3692 | 60% (62/104) | 95% (59/62) | 50% (21/42) |
| clef-flash | 54% (59/109) | 73% (80/109) | 84% (92/109) | 2320 | 998 / 2015 | 56% (58/104) | 91% (53/58) | 59% (27/46) |

Flag on disagreement, and offer the 3 best other menu options:

* **clef**: flags 40% (42/104) of scans, catches **88% (21/24)** of Gemma's first-item errors, 50% of flags really wrong, and the true dish is among the 3 alternatives for **71% (15/21)** of the caught errors (about 14% of all scans get a correct one-tap fix).
* **clef-flash**: flags 44%, catches 79% (19/24), but the alternatives hold the true dish for only 37% (7/19). `clef-flash` is not good enough for this job despite costing a sixth.

Compared with the group reranker at the same flag rate (about 40% of scans) the menu agreement check catches more errors (88% vs about 75%) and its alternatives are more often right (71% vs 50%), because the candidates are not tied to Gemma's possibly wrong group. It also runs alongside Gemma instead of after it. The cost is token count: 2320 tokens per call ($0.00056), mostly the option list; a shorter menu would cut this.

## 5. Where Clef sits relative to Gemma (latency)

Sequential, 22 photos, one request at a time, REST from the laptop.

| model | Gemma alone p50 / p95 ms | Gemma while Clef runs beside it | Clef parallel call (3 yes/no checks + 102-option menu) | Clef done before Gemma | extra wait after Gemma, parallel (ms, p50 / p95) | blocking rerank call, added (p50 / p95 ms) | Gemma + blocking rerank total (p50 / p95 ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clef | 2367 / 8360 | 2469 / 6152 | 1120 / 2024 | 95% (21/22) | 0.0 / 0.1 | **914 / 1421** | 3176 / 9427 |
| clef-flash | 2470 / 7906 | 2519 / 6181 | 902 / 1498 | 95% (21/22) | 0.0 / 0.1 | **512 / 774** | 2956 / 8395 |

* **Blocking** (rerank after Gemma, needs Gemma's label): +0.9 s p50 / +1.4 s p95 with `clef`, +0.5 s / +0.8 s with `clef-flash`. About +30% on a typical scan.
* **In parallel** with Gemma: +0 on the response. Clef finished first in 21 of 22 runs, the worst extra wait was 0.1 s, and Gemma itself was not measurably slower with Clef beside it (2.47 s vs 2.37 s p50; run-to-run noise is larger than that).
* **After the result is shown** (fire the rerank once Gemma returned, update the UI when it lands): +0 to time-to-result; chips would arrive 0.5 to 0.9 s later.

Single-request latency by shape (22 photos, sequential):

| request | model | p50 ms | p95 ms | mean tokens | cost per call |
| --- | --- | --- | --- | --- | --- |
| text only, 1 choice | clef | 539 | 1042 | 184 | $0.00004 |
| text only, 1 choice | clef-flash | 301 | 621 | 184 | $0.00001 |
| image + 1 choice (group) | clef | 1000 | 1625 | 997 | $0.00024 |
| image + 1 choice (group) | clef-flash | 692 | 1369 | 997 | $0.00004 |
| image + 7 questions | clef | 963 | 1616 | 1849 | $0.00044 |
| image + 7 questions | clef-flash | 898 | 1484 | 1849 | $0.00007 |
| image + open menu (~100 options) | clef | 1164 | 1542 | 2331 | $0.00056 |
| image + open menu (~100 options) | clef-flash | 974 | 1404 | 2331 | $0.00009 |
| Gemma scan pipeline | gemma | 3743 | 8320 | 973 | $0.00014 |

Batching questions into one call is nearly free in latency (7 questions about the same as 1), since the image is read once. An unbatched design would pay the image tokens per call.

**Cost per scan**: Gemma $0.00013 to $0.00014. Clef adds $0.00024 (one group choice) to $0.00056 (menu) per scan, or 4 to 9 times less with `clef-flash`. At last week's 263 scans that is $0.06 to $0.15 per week: the cost is not the objection, the latency (blocking) and the weak flags are.

## 6. Pre-checks (3 yes/no questions in one call)

| model | photo set | n | P(food) >= 0.5 | blurry >= 0.5 | dark >= 0.5 | Gemma on the same photos |
| --- | --- | --- | --- | --- | --- | --- |
| clef | clean | 109 | 100% | 0% | 0% | scan succeeds 100% |
| clef | blur sigma 3 | 22 | 100% | 100% | 0% | 41% fail "unclear" |
| clef | blur sigma 12 | 22 | 100% | 100% | 0% | 100% fail "unclear" |
| clef | dark x0.45 | 22 | 100% | 0% | 91% | 5% fail |
| clef | dark x0.15 | 22 | 100% | 18% | 100% | 77% fail |
| clef | non-food | 8 | 0% | 0% | 0% | `not_food` 8/8 |
| clef | empty plate | 2 | 50% | 0% | 0% | `not_food` 1/2 |
| clef-flash | clean | 109 | 100% | 0% | 0% | |
| clef-flash | blur sigma 3 | 22 | 100% | 100% | 0% | |
| clef-flash | blur sigma 12 | 22 | 100% | 100% | 0% | |
| clef-flash | dark x0.45 | 22 | 100% | 0% | 5% | |
| clef-flash | dark x0.15 | 22 | 100% | 41% | 100% | |
| clef-flash | non-food | 8 | 0% | 0% | 0% | |
| clef-flash | empty plate | 2 | 0% | 0% | 0% | |

AUROC is 1.000 for both models on food vs non-food, heavy blur vs clean, and very dark vs clean. On this synthetic set Clef detects every degraded photo and never flags a clean one. That is not the issue. What Gemma already does, on the 22 degraded copies:

| photos | n | scan succeeds | first item right (of successes) | ms until a failure verdict (p50) | ms for a success (p50) |
| --- | --- | --- | --- | --- | --- |
| clean | 22 | 100% (22/22) | 77% (17/22) | - | 2246 |
| blur sigma 3 | 22 | 59% (13/22) | 77% (10/13) | 810 | 2385 |
| blur sigma 12 | 22 | 0% (0/22) | - | 657 | - |
| dark x0.45 | 22 | 95% (21/22) | 62% (13/21) | 729 | 3072 |
| dark x0.15 | 22 | 23% (5/22) | 60% (3/5) | 670 | 2098 |

* Gemma already refuses non-food and badly blurred or dark photos, and it does so **quickly** (0.7 s median to the verdict, 58 failures overall). A pre-check running first or in parallel would save well under a second on a rare path.
* Mild blur (sigma 3) is flagged by Clef 100% of the time, yet Gemma reads those photos as accurately as clean ones (77% against 77%). A blur warning there would be a false alarm. Moderately dark photos (x0.45) show a drop (62% against 77%, 13/21), so a "kurang terang" nudge is the one case Clef could add; `clef` flags 91% of them, `clef-flash` only 5%. The sample is too small and synthetic to decide.
* One of 2 empty plates was hallucinated as food by Gemma; the mean P(food) over the two plates was 0.59 for `clef` and 0.13 for `clef-flash`. Two photos prove nothing.

## 7. Portion score and item count

Both are consistency checks only: the bench set has no weighed portions and no per-item truth.

| model | photos | mean score (0 to 4) | stdev | range | Spearman vs Gemma grams (same-dish ratio) | mean abs change, mirrored | mean abs change, 512 px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clef | 37 | 2.27 | 0.67 | 1.29 to 3.85 | 0.51 | 0.13 | 0.13 |
| clef-flash | 37 | 2.11 | 0.68 | 0.96 to 3.75 | 0.52 | 0.09 | 0.11 |

* The score is stable (a mirrored or downscaled copy moves it by about 0.1 on a 0 to 4 scale) and it agrees moderately with Gemma's gram estimate (Spearman 0.5 against Gemma's within-dish size ratio).
* Agreeing with another estimator is not accuracy. The scores cluster around "normal" (mean 2.1 to 2.3). Nothing here shows it separates a small from a large serving in grams, or that it would reduce under-estimation. It needs weighed real photos.
* Item count on the 14 labelled plates: Clef MAE 0.86 (flash 0.88) vs Gemma's item count MAE 1.43. Counts of "visible items" are fuzzy and Gemma follows its own item rules (rice separate from the dish, etc.); this is not a product need.

## Recommendation

1. **Do not use Clef as the recogniser, a blocking reranker, a pre-check or a portion estimator.** None of the four earns its latency or evidence.
2. **Keep one Clef call as an optional shadow experiment**: the `clef` (full) open-menu `choice` question, fired in parallel with the Gemma call, result ignored on failure and never awaited before returning the scan. Log the agree/disagree flag and Clef's top 3 next to the scan; show nothing. If it holds on real photos (disagreement catching most of Gemma's errors, alternatives containing the truth for about two thirds of them), add a subtle "Bukan ini?" with Clef's alternatives, not a warning, because half the flags are false alarms. Added latency to scans: about 0 (Clef finishes first in 95% of runs); cost about $0.0006 per scan (shorten the menu to cut it).
3. **`clef-flash` is not suitable** for the dish question (72% closed-set, alternatives right for 37%). Its only plausible use is the cheap yes/no pre-checks, which showed no benefit.

## What the real-photo eval set should add

The set being collected from the owner's account changes what can be concluded:

* **A real error rate and confusion matrix.** Here 24 Gemma errors on curated look-alikes give +-15 points of uncertainty and bias the set towards confusions. Real data gives Gemma's true first-item accuracy, which dishes it actually mixes up, and the candidate groups can be mined from those confusions instead of hand-written.
* **Labels from the diary.** Gemma's named item vs the item the user saved after correcting it is a free label for every scan; the 22 "kurang akurat" ratings point at the hard cases.
* **Signed kcal error.** Compare Gemma's kcal with the saved item's kcal, split into under- and over-estimates, so any flag can be judged by how many under-estimates it catches (the error the owner cares about). Nothing in this probe can show that.
* **Real photo conditions**: low light, glare, partial plates, steam, top-down shots, several dishes with real boxes; the long tail of dishes outside this vocabulary (the open menu's honest accuracy, and whether Clef proposes sensible alternatives for unknown dishes).
* **Weighed portions** for a handful of dishes, which is the only way to judge the portion score.
* **Latency from the Worker binding** and on real traffic, instead of REST from a laptop, plus how often Clef finishes before Gemma under production load.
* Enough errors (about 100) to pick a threshold and report intervals.

To reuse the probe, point `SINGLES` (label + image) at the new set, `bun run scripts/clef-probe.ts run all`, then `report`.

## Reproduce

```sh
bun run scripts/clef-probe.ts check        # resolve photos, contact sheets in /tmp/clef-probe/sheets
bun run scripts/clef-probe.ts run gemma    # then oracle, menu, prechecks, rerank, portion
bun run scripts/clef-probe.ts run latency  # run alone: sequential timing
bun run scripts/clef-probe.ts run parallel # run alone
bun run scripts/clef-probe.ts report       # all tables above
```

The token is the wrangler OAuth token (refreshed on 401) unless `CLOUDFLARE_API_TOKEN` is set. Raw results land in `/tmp/clef-probe/*.json` (`CLEF_PROBE_OUT`). The whole run cost well under $1 of Workers AI usage.
