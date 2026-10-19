# Rencana makan (meal plan)

A Pro feature that plans meals which hit the day's eat budget and protein target, prefers food the person already eats
(it proves the food is available to them), and offers lighter versions of their habits. Every number on a plan is
computed from TKPI 2019 (or, for foods the person logs themselves, from their own logs). The recipe *text* is
AI-assisted; the nutrition never is.

Code: `packages/api/src/lib/meal/`, router `packages/api/src/routers/meal-plan.ts`, tables `packages/db/src/schema/meal.ts`
(migration `0050_meal_plan`), copy `packages/i18n/src/locales/{id,en}/mealPlan.json` (namespace `mealPlan`).

## Data in

| What | Where it comes from |
| --- | --- |
| Day budget | `buildPlan` (profile, calibration, deficit/surplus, Hamil/Menyusui) like `day.summary`. **Today** uses the live budget (base + counted workout credit, `loadDayCredit`/`budgetKcal`). **Future days** use the plan's base target without credit. |
| Protein target | `proteinGoalG` (1.5 g/kg of the lesser of weight and healthy max, 1.6 on strength days, gain/maternal goals). Today knows about a strength day, later days use the non-training figure. |
| Carbs and fat | Ranges of the day's kcal (`CARB_RANGE` 40-60 %, `FAT_RANGE` 20-35 %, AMDR-style). Protein is a floor, not a range. |
| Slots | Normal: sarapan 25 %, makan siang 35 %, makan malam 30 %, snack 10 %. Ramadan: the app's `ramadanSplit` (berbuka, snack, sahur). Intermittent fasting: the eating schedule of `buildSchedule` (buka, camilan = snack slot, terakhir). Hamil/Menyusui never fast. |
| History | `food_log` of the last 60 days, grouped to plates (components of one plate summed, named by the plate). A food eaten 3+ times (with a protein figure, 60-1100 kcal) is a *habit*. |
| Preferences | `meal_prefs`: allergens, free-text dislikes, budget-friendly, cook/warung. |

## Recipe catalog

`lib/meal/ingredients.ts` (base registry) + `recipes-1..3.ts` (data) merged by `catalog.ts`.

* **180 dishes** (128 main, 38 breakfast, 39 snack; some fit more than one), **151 ingredients**, each ingredient bound to one
  nutrition source: a TKPI 2019 row (`lib/tkpi2019-data.ts`, Kemenkes) for all but one, and USDA FoodData Central for skinless chicken
  breast (below). The source is data on the ingredient (`usda` or the TKPI `code`) and shows per recipe as "Sumber gizi". Warung dishes and home cooking, 113 budget (cost tier 1), 178 cookable
  at home, 106 findable ready-made.
* A recipe is `ing: [[ingredientKey, grams]]`. `computePortion` sums `per-100 g x grams` over the TKPI row of every ingredient;
  amounts are snapped first (half pieces for countable items, 5 g steps) and the sum is taken over the snapped amounts, so the
  numbers on screen are exactly what the listed grams contain. Nothing is typed by hand; a null TKPI column counts as 0.
* Tags are derived: high protein (>= 25 g, or >= 30 % of kcal; snacks >= 10 g), budget, warung, home, quick (<= 15 min),
  low fat, high fibre. Allergens (seafood, kacang, telur, susu, gluten, kedelai) are the union over the ingredients.
* Text (names, 3-7 steps, one tip) is `{ id, en }` data, drafted with AI and reviewed by the validator (`catalogProblems`).
* Habit matching: `aka` (names people log for the dish) and `betterOf` (habit foods a dish is a lighter version of).

TKPI caveats worth knowing:

* **Chicken has three sources.** TKPI has no skinless breast. Its one raw chicken row is FR005 "Ayam, daging, segar" (298 kcal, 18.2 g
  protein, 25 g fat per 100 g: meat with skin); it stays for thigh and mixed-piece dishes (`ayam`: kecap bawang bombay, balado paha,
  woku, opor). Breast dishes (26: bakar, panggang, tim, pepes, soto, sop, sup, capcay, tumis, mie/bihun/bubur ayam, nasi goreng...) use
  `ayam-dada-tanpa-kulit`, sourced from **USDA FoodData Central, SR Legacy, FDC 171077** "Chicken, broiler or fryers, breast,
  skinless, boneless, meat only, raw" (120 kcal, 22.5 g protein, 2.62 g fat, 0 g carbs, 0 g fibre per 100 g, public domain; values read
  from the FDC API; note FDC 171477 is the *cooked, roasted* breast, 165 kcal / 31 g protein), raw grams 50-130 a portion. Fried
  chicken uses the explicit fried TKPI row FP024 (`ayam-goreng`), which already contains the frying oil (no `minyak` next to it).
  `IngredientDef.usda` holds the record (id, exact description, per-100 g values); `catalogProblems` checks it, the recipe detail
  lists each ingredient's source ("Sumber gizi", `recipe.sources`).
* Some rows are whole dishes that already contain their oil (`telur-dadar` HP001, rendang FP062, empal FP046, pepes rows):
  no `minyak` is added on top. Tempe/tahu "goreng" rows include the frying oil.
* Rows with data errors are not used: AP022 (mi kering, carbs 6.3 g), ER073 (pepaya, fat 12 g).
* No lontong, kwetiau, bakso or lele rows exist; recipes use the nearest honest stand-in (documented in the recipe data).
* Raw rows are raw weights (ikan, sayur), cooked rows cooked weights (nasi). The shopping list converts cooked rice to raw
  rice (`shop.ratio` 0.4).

## Planner (deterministic)

`planner.ts` (one day) and `week.ts` (the loop). Pure functions: same inputs and seed give the same plan.

1. **Candidates.** Every recipe in portion variants: whole portion x0.5 / 0.75 / 1 / 1.25 / 1.5 and carb ingredients x0.5 / 0.75
   / 1 / 1.5 ("nasi 1/2 porsi"), duplicates after snapping dropped. Plus the person's *unmatched* habit foods at x0.5 / 0.75 / 1
   with their own logged averages. Filters (hard): allergens (exact, from ingredients; word list for logged names),
   dislikes (words matched against recipe names and non-trace ingredient names), cook/warung.
2. **Shortlist per slot** (16 candidates, max 3 sizes of one dish) ranked by
   `40 x |kcal - slot budget| / budget + 28 x protein gap + item cost`, where item cost =
   preference (history: -(10 + 3 x min(times, 8)); lighter version of a habit: -(8 + 2 x min(times, 8)); unmatched habit food:
   -(12 + 3 x min(times, 8))) + portion penalty (3 per 0.25 off a whole portion, 2 per 0.25 off the carbs) + budget-friendly
   penalty (cost 3: +12, cost 2: +4) + previous-day repeat (+25) + week use (+6 each) + seeded jitter (0-6).
3. **Exhaustive search** over the shortlists' combinations (<= 16^4, branch-pruned: a partial day whose kcal can no longer land within
   +12 % / -12 % of the budget is dropped, and the search reruns unpruned if nothing lands inside) scored on the whole day: kcal error (over: 1.4/% and +30/% past
   +3 %; under: 1/% and +18/% past -5 %), protein shortfall 3.5/%, protein above 125 % of target 1.5/%, carbs/fat outside their
   ranges, a fibre bonus, +14 for the same main ingredient twice, at most 2 habit items a day. Weekly caps are hard and apply to habit foods too: a main
   twice, breakfast/snack three times; if a day cannot be filled the caps loosen by one use at a time.
4. **Week** = 7 days in a row from the generation day, planned in order so earlier days count toward later caps.
   "Meets the promise": kcal within +-5 % of the budget **and** protein at or above target (`dayMeets`).
5. **Today** plans only open slots: slots with food already logged are `covered`, slots whose time passed (normal days) are
   dropped, and what is already eaten counts toward the budget (`fixed`).

On the owner-like profile (1,500-2,100 kcal, 110 g protein, no history) every generated day (21 simulated days at 1,500, 1,800 and 2,100 kcal) is within +-1.6 % of its budget with
110-134 g protein, about 100-125 ms of CPU for a whole week (see `planner.test.ts` for the asserted bounds).

### Stable, on demand

The saved plan stores *references and portion factors* only (`meal_plan.days_json`); nutrition is recomputed from TKPI on read.
Opening the screen never changes it. `generate({regenerate: true})` bumps `generation` (part of the seed) and plans again;
meals eaten through the plan and meals the person swapped in (pinned) stay, unless a pinned meal now breaks an allergy or dislike.
`replanDay` plans one day again with a per-day salt.

### Ganti (swap)

`swapOptions` returns alternatives for one slot: same kind of meal, kcal within 20 % of the current one and protein at least
80 % of it (or at most 3 g less), not already on that day and not swapped away from that slot before, closest first.
`swap` accepts only an option the server would offer, pins it, stores the swap (`meal_plan_swap`), and when the day no longer
meets kcal/protein it plans the day's other open meals again around the pinned one, keeping the result only if it meets more of
the two promises.

### Sudah makan

`eat` inserts one `food_log` row (source `manual`, the same table and fields as the diary's quick add) with the name, grams and
the TKPI-computed kcal/protein/carbs/fat/fibre of the planned portion and `items_json` = `{ from: "meal-plan", ref, scale, carbScale,
lines }`. Its id is deterministic, `meal-plan:<userId>:<date>:<slot>`, inserted with `ON CONFLICT DO NOTHING`: the primary key is the
claim, so concurrent taps or devices log the meal once and the others get `CONFLICT` (and the plan item is re-linked to that row if it
lost the link). The row id is stored on the plan item with a single `json_set` UPDATE guarded by the slot's position, so two meals
logged at the same time cannot overwrite each other. The item counts as eaten while the row exists (deleting it in the diary reverts
it). `undoEat` removes exactly that row. A logged meal cannot be swapped, future days cannot be logged. If the person logs something else
for a slot, the plan item becomes `covered` and leaves the day's totals.

### Shopping list

Ingredients of the plan's recipe items not yet eaten (today onward), summed per ingredient from the portions as planned,
converted to what is bought (`shop.ratio`), rounded up (5 g under 50 g, 10 g under 200 g, else 50 g) and shown as pieces
("6 butir (330 g)") or grams/kg, grouped karbo / protein / sayur / buah / susu / bumbu. Ticks are rows in
`meal_shopping_check` (row exists = bought). Foods the person logs themselves have no ingredient list and add nothing.

## Persistence (migration 0050)

`meal_prefs` (one row per user), `meal_plan` (user, start date; seed, generation, days JSON), `meal_plan_swap`,
`meal_shopping_check`. All cascade on user delete and are wiped by "delete all my data" (`lib/privacy.ts`).

## Pro gate

Server side, on every procedure except `overview`: `cloudUnlocked` (= `premiumUnlocked`: founder tier, or any account on a
server without a paywall) else `FORBIDDEN` with `data.paywall`. A free account's `overview` returns `{ status: "locked", preview }`:
today's first meal in full and the count of the others, never the plan, recipes or shopping list.

## API (`mealPlan.*`)

`overview`, `generate({regenerate})`, `replanDay({date})`, `swapOptions({date, slot})`, `swap({date, slot, ref, scale, carbScale})`,
`eat({date, slot})`, `undoEat({date, slot})`, `recipe({id, scale, carbScale})`, `shopping`, `checkItem({key, checked})`, `prefs`,
`setPrefs`. Names, portions, reasons ("kenapa rencana ini"), amounts and recipe steps come back localized (`x-locale`).

## Clients

* **Web** (`apps/web`): route `/rencana-makan` (`?tab=week|shopping`, `?date=`), components in `src/components/meal-plan/`; entry cards
  on the Makan page and Beranda (today only). Lucide icons.
* **Native** (`apps/native`): stack screen `app/rencana-makan.tsx`, components in `components/meal-plan/`; entry cards on the Makan tab
  and Beranda (today only). Ionicons. Swap, recipe, settings and rebuild are bottom sheets.
* Screens: Hari ini (day bars for kcal/protein/carbs range/fat range, one card per meal with Ganti, Sudah makan and the recipe,
  "Kenapa rencana ini"), Minggu (7 days), Belanja (grouped checklist), recipe detail, settings (allergies, dislikes, budget, cook/warung),
  free-account upsell with the one-meal teaser. Pro accounts without a plan are offered "Buat rencana 7 hari".

## Tests

`lib/meal/catalog.test.ts` (catalog soundness, TKPI codes, computed nutrition, allergens, scaling, tags), `planner.test.ts` (budget
+- 5 % and protein on 1,500/1,800/2,100 kcal weeks, carb/fat ranges, part-eaten day, exclusions, variety caps, history, seeds,
swap equivalence, Ramadan/fasting slots), `shopping.test.ts`, `routers/meal-plan.test.ts` (Pro gate, stable plans, logging rows,
swaps, prefs, recipe, shopping ticks, history, data deletion).

## Adding recipes

Add ingredients to a part's `EXTRA_INGREDIENTS_n` (key prefixed `pN-`, real TKPI code) and recipes to `RECIPES_n`; never type a
nutrition number. Run `catalogProblems()` (the catalog test) and check the computed kcal/protein look right for the dish.
