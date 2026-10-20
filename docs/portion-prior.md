# Porsi kebiasaanmu (portion prior)

After the photo model answers, an item whose food the user has a consistent weighed history for starts at the user's **usual grams**; the model's own number stays on the item, one tap away ("AI: 150 g" / "Biasanya kamu: 100 g"). Why: the model answers about 150 g of rice where a weighed eater takes about 100 g (`docs/ai-accuracy-log.md`, 2026-10-20). A post-hoc default, never a prompt change.

## Flag

`PORTION_PRIOR_USER_IDS`: comma-separated user ids (a Worker var in `apps/server/wrangler.jsonc`, like `DATASET_USER_IDS`; owner only today). Unset, empty or any other user: `ai.analyzeFood` / `analyzeFoodStream` do not read the diary and return exactly what they returned before (no `portionPrior` key on any item). To switch on for QA add the user id to the var and deploy; to switch off remove it. The retry (`analyzeFoodRetry`), Cerita and correction paths do not apply the prior.

## Rules (`packages/api/src/lib/portion-prior.ts`)

- **History**: `food_log` rows of the last 60 days with grams, only grams the user set: `source = manual` rows (meal-planner rows excluded), and `source = ai` rows whose grams differ from the AI answer kept in `items_json` for the same dish. Unedited AI rows, Cerita rows (no `items_json`), copies and barcode rows never count, or the prior would echo the model.
- **Food key** (`canonicalFood` in `tkpi.ts`): every plain rice (nasi putih, uduk, kuning, liwet, merah, hangat, ...) is `nasi`; an exact library dish or alias is that dish; anything else its own normalized name.
- **Gate**: at least 5 user-set entries and a coefficient of variation (stdev / mean) up to 25%. Prior = the median, rounded to a gram.
- **Big-plate guard**: when the model answers more than 1.4 times the usual grams, its number is kept (`PRIOR_BIG_PLATE`). Model and usual within 3% of each other: no chip. Items without grams and hidden cups are left alone.
- **Numbers**: kcal and macros scale by usual / model grams, then pass through `calibrateItems` (library or TKPI 2019 band scaled to the grams, density cap). `portion` text is dropped for the usual side and restored for the model side.

## Response and clients

An item with a prior carries `portionPrior: { active: "prior" | "ai", other: { grams, kcal, protein?, carbs?, fat?, fiber?, portion? }, n }`; the item's own numbers are the `active` side. `portion-chip.ts` (`swapPortionPrior`, `chipGrams`, `modelNumbers`, `withoutPortionPrior`) is shared by `apps/web` (`components/scan/portion-prior-chips.tsx`) and `apps/native` (same name). The chip renders only when the server sent `portionPrior`.

What stays true to the model's answer: the `ai_usage` ledger row (`aiItems`) and the owner dataset keep the model's numbers; the miss log (`ai.logCorrections`) sends the model's grams and kcal (`modelNumbers`); `items_json` of the saved rows carries the displayed list without the chip, so a row saved as shown is not read as an edit. Consequence: accepting the usual portion never adds to the history; only typed or edited weights do (rows age out after 60 days).

## Eval

`bun run scripts/eval-scans.ts --only external --only owner --variant baseline --variant portion-prior` (tuning variants `portion-prior-1.6`, `portion-prior-noguard`). History per case = the same person's other cases (leave-one-out). Numbers in the accuracy log.
