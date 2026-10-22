# History import endpoints (JoyoFit's Huawei Health import)

JoyoFit reads a Huawei Health Privacy Centre export on the phone and, when the person is signed in, sends the parts that belong in
JoyoRogo's own history through three endpoints (`packages/api/src/routers/{weight,food,water}.ts`). All three take past days only
(before today in the person's zone, not before 2012), cap a call at 100 items, and **never write over** what the person has.

| Endpoint | Writes | Idempotency / dedupe | Streaks and challenges |
| --- | --- | --- | --- |
| `weight.importHistory` | `weight_log` rows, `source = "huawei"`, body values when given | one row per day: a day that has a row is skipped, so a person's own entry or a scale reading wins and a second run adds nothing | `day.today` and the group streak leave `source = "huawei"` out |
| `food.importHistory` | `food_log` rows, `source = "huawei"`, id `huawei:<user>:<key>` | the same `key` is a no-op; a meal with the same day, slot and kcal (to the kcal) that the person logged is not added again; `eatenAt` is kept only when it falls on the diary day | `day.today` and group streaks and `challenge-db.loadFacts` (calories, protein) leave `source = "huawei"` out, so a backdated import cannot make or break a streak or a challenge day |
| `water.importHistory` | `water_log` glasses per day | a day with a row is skipped | water has no streak |

Why a backdated weight cannot become "the current weight": every reader (`weight.history`, the group trend, the day card) takes the
newest `date`, an imported row is only ever added on a day that had none, and the profile's `startWeightKg` is not touched. Only a
person with no newer weigh-in at all sees the imported newest one as their latest.

Tests: `packages/api/src/routers/history-import.test.ts`. Deploy: the API Worker (no migration: `source` is plain text).
