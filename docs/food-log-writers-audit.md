# food_log writers and readers: dropped-field audit

Follow-up to `quick-log-macros.md`. Every path that creates a `food_log` row now goes through `insertFoodRows`
(`packages/api/src/lib/food-rows.ts`): its row type makes `grams`, `protein`, `carbs`, `fat`, `fiber` required keys (a number
or an explicit `null`), so a writer that forgets them does not type-check. `lib/food-rows.test.ts` also fails when any other file
under `packages/api/src`, `apps/server/src` or `packages/db/src` inserts into `food_log`. A new writer: call `insertFoodRows`,
and say what it does with each macro.

## Findings

| Path | Dropped or wrong | Severity | Fix |
|---|---|---|---|
| Recent-food chips (native, web) | logged as `manual`, so an AI meal repeated by chip counted as a typed meal (portion prior learns its grams, `aiMeals` unaffected the other way) | low | chips log as `copy` |
| `food.add` estimate | fibre never estimated; `copy` rows (chips of an old macro-less row, story copies) were left NULL | med | estimate covers `copy`; table and parse also give fibre |
| Cerita review (native, web) | a kcal typed over the estimate kept the old macros (halve 500 kcal, still log the full protein) | med | `macrosForTypedKcal` (same ratio as `food.update`); weight untouched |
| Photo scan review (native, web) | same | med | same |
| Favorit save | starring the same dish again returned the stored favorite, so one saved from a macro-less row stayed macro-less after the row was filled in | low | the favorite takes the copy that carries more nutrition (`carriesMoreNutrition`), never a poorer one |
| `mealPlan.eat` / `undoEat` | not mirrored to Health Connect: the response had no row to write and no id to delete | med | `eat` returns `row`, `undoEat` returns `removedLogId` |
| Health Connect mirror | favorite and place re-logs not mirrored; `eatenAt` ignored; a real 0 g dropped | med | `mirrorFoodCall` covers `savedFood.relog`, `place.relog`, `mealPlan.eat/undoEat`; record starts at `eatenAt` when set; null left out, 0 written |
| `plate.update` date move | rows kept an `eatenAt` of the old day | low | rows that change day lose it |
| `food.importHistory` | schema had no grams / fibre | low | optional `grams`, `fiber` |
| Coach context `avgProtein7`, MCP `get_daily_totals` average | days with kcal but no protein averaged in as 0 g | med | average over the days with a known protein (null when none) |
| Backfill | only `manual` rows, no fibre | n/a | script also covers `copy`/`ai` all-NULL rows and a fibre-only pass (dry run by default) |

Checked and consistent: `food.addScan`, barcode save (native and web carry grams and every macro), manual form, `food.update`
portion maths (everything scales linearly, NULL stays NULL), `recalculatePlate`, `meal-plan eat`, place and favorite re-logs
(faithful copies), story copy (`copyLoggedMeal` carries grams and P/K/L/fibre), plate/place/day aggregates (`sum()` is NULL only
when every row is NULL), challenge facts (protein NULL as 0 is by design and tested).

Left as designed: Huawei-import rows (`source = "huawei"`) are kept out of streaks and challenge days only; charts, coach and totals
include them. Totals and rings count an unknown macro as 0 g: those rows are marked in the diary ("Makro belum diisi").
