# AI scan accuracy log

Running notes on how accurate the photo scan is, what the data says, and what to change next. Newest entry first. Numbers come from prod D1 (read-only) and from `scripts/eval-scans.ts`; no user ids, emails, names or photos appear here. Proposals are proposals: nothing in `vision.ts` or `tkpi.ts` behavior was changed for this entry (the only code change is the optional, prod-neutral `promptTransform` hook the harness uses).

Owner preference to keep in mind: an over-estimated kcal is acceptable, an under-estimate is the worse error, yet users do write "kalori kelewat tinggi". Over and under are always reported separately.

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
