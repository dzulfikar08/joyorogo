# Datasets and consent

Every photo the accuracy work uses, where it lives, who agreed to what, and how to remove it. This repo is public: **no photo, no weight table and no post text of any contributor is committed here**, only code, formats and this register.

| Set | R2 key (bucket `joyorogo-scans`, binding `STICKERS`) | Whose | Truth |
|---|---|---|---|
| owner | `dataset/<userId>/<scanId>/{photo.jpg,meta.json}` | the owner's own scans (`DATASET_USER_IDS`), see `packages/api/src/lib/dataset.ts` | the diary save |
| feedback | `feedback/<userId>/<photoId>/…` | users who opted in with a negative rating | the saved items |
| **external** | `dataset/external/<source>/<caseId>/{photo.jpg,meta.json}` | people outside the app who weighed what they ate and agreed (register below) | their own grams |

All three are read through the key-gated `/ai/dataset/*` routes (`apps/server/src/dataset-export.ts`) and run by `scripts/eval-scans.ts`. The daily in-Worker regression (`accuracy-job.ts`) skips `dataset/external/`: those cases have no diary save and carry another person's weights.

## External labelled cases

A contributor weighs every food in grams and posts photos. We keep the photo and turn their words into labelled truth, so the harness can score **portion grams per item** and **kcal against a TKPI/library reference for their grams**.

### Layout

`<source>` is the contributor's handle without `@`; `<caseId>` is `<postId>-<photo index>` (1-based position in the post's carousel).

- `photo.jpg`: what the model sees. The importer resizes to 1024 px long side, JPEG q75, EXIF stripped, which is what `apps/native/app/makan-ai.tsx` uploads. The original is never stored.
- `meta.json` (`ExternalMeta`, `packages/api/src/lib/external-case.ts`, `version: "external-1"`): source (handle, post id, photo index, day, meal, posted at), the consent block, his words for the meal (`said`), how sure the meal-to-photo mapping is (`mapping`), `trust`, the items, combined-weight `groups`, `extras`, and the `truth` block the harness scores. It has no `final`, so it can never be mistaken for a diary save.

Each item: `name` (as the model would say it), `said` (his words), `grams` (weighed; `null` when not weighed on its own), `assumedGrams` (counted items such as "1 butir": feeds kcal only, never scored as grams), `cooking`, `inPhoto` (`yes` scored, `uncertain` set aside unless `--external-uncertain`, `no` eaten but elsewhere), `group` (id of a combined weight), `ref`, `note`.

- **`ref` is where the kcal comes from**: `{source:"tkpi2019", row}` (an exact row of `tkpi2019-data.ts`), `{source:"library", dish}` (an exact dish of `TKPI_DISHES`), or `{source:"manual", kcalPer100g, note}`. kcal = per-100 g x his grams, computed at import. Never his number, never the model's. `proxy:true` marks a row that only stands in for the real dish, with a `note` saying why; the report prints the row for every item. An item with no honest row has no `ref` and no kcal.
- **`trust`** says how far his weights describe *this photo*: `high` = the plate in the photo is what he weighed; `medium` = partly (items elsewhere, or a combined weight); `low` = the photo may not be his plate (for example a picture of a screen). The harness runs `medium` and `high` by default.
- **`groups`**: when he gives one weight for several foods (rice + lodeh + tempe in one number), the members have no per-item grams or kcal. The case is scored on item names and plate grams only.
- **`extras`**: visible in the photo but not in his weights (not eaten, lalapan, a garnish). An answer item matching one is set aside, neither right nor wrong.
- **`mapping`**: `certain`, `likely` or `uncertain` for the meal-to-photo match when the post does not say which photo is which.
- **`comparators`** (optional, case level): another estimator's answer to the same meal or day, for example a chatbot the contributor asked with the photo and his grams: `{source, scope: "meal"|"day", kcalLow, kcalHigh, note}`. A day total goes on one case of that day. A comparator is **never truth and never scored**; it is shown beside ours (`--comparators`) to see whether kcal per gram agrees when the grams are known.

- **`plate`** (optional, case level): the plate or bowl the meal was eaten from, as the contributor measured it: `{name, kind: "flat"|"bowl"|"rattan"|"lunchbox", diameterCm, widthCm?, description?, inPhoto?}`. `inPhoto: false` marks a plate that is NOT in this photo (a check that the model answers "none"). It only feeds the `plate-ref` variant ("Piring saya", `docs/dishware.md`); it is never truth about the food.

### Labels file

The hand-checked input of the importer: `version`, `source`, `consent`, `cases[]` (`photo {post, index, file}`, `day`, `meal`, `mealRaw`, `said`, `mapping`, `trust`, `trustWhy`, `items`, `groups`, `extras`, `notes`), `unmapped[]` (meals with no photo yet). Copy `scripts/external-cases/example.labels.json` (invented data) to `scripts/external-cases/<handle>.labels.json` and replace everything. Real labels files are git-ignored: they hold a person's weights and post text. The importer rejects a file whose refs do not resolve, whose groups are dangling, or with no scorable item.

### Commands

```sh
# 1. Dry run: validates, resolves every reference, prints what would be written. Writes nothing.
bun run scripts/external-import.ts <photos-dir> scripts/external-cases/<handle>.labels.json

# 2. Local copy for the harness (same layout as the R2 keys, without the dataset/ prefix)
bun run scripts/external-import.ts <photos-dir> <labels.json> --out .tmp/dataset/external

# 3. Upload (puts photo.jpg + meta.json of every case with `wrangler r2 object put --remote`;
#    needs the wrangler login for the account of apps/server/wrangler.jsonc)
bun run scripts/external-import.ts <photos-dir> <labels.json> --upload        # bucket joyorogo-scans

# 4. Score
bun run scripts/eval-scans.ts --only external --dry-run      # list cases, truth, model calls; no calls
bun run scripts/eval-scans.ts --only external --reps 2       # production prompt/model; a few cents
#    --external-trust low        include low-trust cases (names only, grams not comparable)
#    --external-uncertain        also score the items marked uncertain
#    --variant baseline --variant scale-cues ...   compare variants (see `--list-variants`); variants that
#                                differ in calibration only replay the same model answer (.tmp/eval/raw)
#    --only owner --only external   run the owner set next to the external one
#    --variant plate-ref --plates <file>   "Piring saya": cases that carry a `plate` (labels, or a JSON file of
#                                { "<caseId>" | "group:<group>": plate }) get that plate in the prompt as text;
#                                all variants of the run are limited to those cases so the comparison is paired
#    --comparators               for cases with comparators: also run our text path ("Ceritakan") on his own
#                                words with his grams and print per meal: reference kcal for his grams vs
#                                the comparator vs our photo answer vs our text answer, plus the text path
#                                item by item (grams kept? kcal per 100 g vs the reference?)

# Pull what is in R2 back down: fills .tmp/dataset/{owner,feedback,external}/ and summary.jsonl.
# With AI_BENCH_KEY it goes through the server routes; without it, straight from the R2 bucket
# with the wrangler login (read-only).
bun run scripts/dataset-export.ts
```

The report (`.tmp/eval/report-<date>-external.md`, git-ignored) carries a table item by item: his grams, the model's grams, grams error, kcal model / reference, and the reference row used.

### Adding a new day

1. Save the new post's photos as `<postId>-<n>.jpg` in the photos folder (n = carousel position).
2. In the labels file add one `cases[]` entry per photo: copy his meal lines into `said`, split them into `items`, pick a `ref` for each (look the row up in `packages/api/src/lib/tkpi2019-data.ts`; flag proxies), set `inPhoto`, `trust` and `mapping`, list `extras`. Move a meal out of `unmapped` once its photo is in.
3. Dry run, read every line against the photo, then `--out` / `--upload`.
4. Re-running an upload overwrites the same keys; cases already uploaded are not duplicated.

## Consent register

### Annas, Threads @annasfatahillah

- **Who**: Annas, public Threads account [`@annasfatahillah`](https://www.threads.com/@annasfatahillah).
- **What**: the photos and food weights of his public thread "Masih ganyangka berat badan nyentuh 78kg. Coba track makanan sebulan kedepan. Day N" (30 days; he weighs every food in grams). Days 3, 4 and 5 imported so far (9 photos, uploaded to R2 on 2026-10-20); Days 1 and 2 were not found on his profile; later days are added as he posts them.
- **Scope**: internal use only, to test and improve JoyoRogo's food-scan AI accuracy. Not published, not shared outside the team, not used for marketing. Deletable on request.
- **Given**: Threads DM, 2026-10-19 to 2026-10-20 (the DM stays in the owner's Threads inbox; it is not copied here).
- **Source**: https://www.threads.com/@annasfatahillah (posts `DemGR4JCSUy` Day 3, `Deol0jcCQh9` Day 4, `Derp6N2ibHP` Day 5).
- **Where it lives**: R2 `joyorogo-scans` (account in `apps/server/wrangler.jsonc`) under `dataset/external/annasfatahillah/`; local copies under `.tmp/dataset/external/annasfatahillah/` and reports under `.tmp/eval/` (git-ignored); his labels file stays outside git (this repo is public).
- **How to delete**: on his request, through any channel:
  1. `bun run scripts/external-import.ts --delete scripts/external-cases/annasfatahillah.labels.json` (removes `photo.jpg` and `meta.json` of every case in the file from R2; add `--only <caseId>` for one). Cases added later must be in that file to be deleted this way; otherwise delete the keys under `dataset/external/annasfatahillah/` with `bunx wrangler r2 object delete joyorogo-scans/<key> --remote`.
  2. Delete `.tmp/dataset/external/annasfatahillah/`, his labels file, and any `.tmp/eval/` report or cache made from it (`rm -rf .tmp/eval` is enough).
  3. Nothing of his is in git history: photos, weights and post text were never committed.
- **Use so far**: harness runs in `docs/ai-accuracy-log.md` (two 2026-10-20 entries); aggregates only, no photos or post text.
