# Joyo AI (JoyoRogo)

Written 2026-10-22. A nutrition chat inside JoyoRogo, ported from JoyoFit's Joyo AI (`watch-fit/src/features/ai`, `docs/coach.md` "Joyo AI (own key)"). It answers (1) questions about the person's own data (diary, kcal/macros against the day's targets, weight trend, water, fasting, scans) and (2) food-choice questions before eating ("Mana yang seratnya paling tinggi: pepaya, melon, atau semangka?", "Lebih baik nasi merah atau nasi putih buat target saya?") with numbers from our own food data. None of it is medical advice.

| | Hosted | Own key |
| --- | --- | --- |
| Where | native app and web (`/joyo`) | native app only (a browser key is not SecureStore, and provider CORS) |
| Who | Pro (same rule as `lib/readiness-food.ts`: founder tier, or paywall off), 18 or older | everyone 18 or older, free |
| Request goes | app -> JoyoRogo `joyo.chat` (SSE through an oRPC event iterator) -> Workers AI | phone -> the provider the person chose; JoyoRogo is not in the path |
| Limit | `JOYO_AI_DAILY_CAP` messages per user per day (default 20, `0` = off), ledger `ai_usage.scan_type = 'joyo'` | `dailyCeiling` provider calls a day counted on the phone (default 40, 5 to 200) |
| Consent | one-time hosted consent (`CONSENT_VERSION`, the server refuses a different `consentVersion`) | per provider and endpoint host, plus "I am 18 or older" |

## Code map

| Part | Code |
| --- | --- |
| Shared pure lib (Workers, Expo, Vite) | `packages/api/src/lib/joyo-ai/` |
| Provider adapters (OpenAI chat completions, Anthropic Messages, SSE, thinking models) | `adapters/*`, `providers.ts`, `models.ts` |
| Answer loop (engine-agnostic: safety pass, digest, tool rounds, finish) | `answer.ts` |
| Safety pass and system prompt | `safety.ts` |
| Food facts: resolver, compare, fits today | `foods.ts`, `food-block.ts` |
| Tools, digest, data seam | `tools.ts`, `digest.ts`, `tool-data.ts` |
| Settings, consent, usage, chats, markdown | `settings.ts`, `consent.ts`, `usage.ts`, `chat-state.ts`, `conversations.ts`, `markdown/parse.ts` |
| Hosted engine | `routers/joyo.ts`, `lib/joyo-ai/server-{chat,limit,rpc}.ts`, `workers-ai-fetch.ts` |
| New read endpoint | `ai.diaryRange` (`routers/ai.ts`) |
| Native | `apps/native/app/joyo*.tsx`, `components/joyo/*`, `src/lib/joyo-ai/*` |
| Web | `apps/web/src/routes/_auth/joyo.tsx`, `components/joyo/*`, `lib/joyo-chat.ts`, `lib/joyo-store.ts` |
| Strings | i18n namespaces `joyoAi` (shared), `joyoAiApp`, `joyoAiWeb` |

## Tools (all read-only)

`get_day`, `get_range` (up to 90 days), `get_weight_trend`, `get_targets`, `search_foods`, `compare_foods`, `fits_today`. Both engines run the same implementation (`createToolData`) over the same existing oRPC procedures (`day.summary`, `food.listByDate`, `day.kcalSeries`, `water.series`, `weight.history`, `profile.myProfile`, `fasting.today`, plus `ai.diaryRange`): the phone through the oRPC client (`rpcFromClient`), the server through `call()` (`rpcFromContext`). Each tool copies named fields only, so maternal, cycle, name, email, photo and place fields that those procedures carry can never reach a result or the digest (a test checks it). The app's own numbers decide "remaining": the eat budget includes counted exercise, never recomputed.

`ai.diaryRange` returns known per-day macro sums for logged days. When it is missing (an older server answers NOT_FOUND), `get_range` falls back to `day.kcalSeries` for kcal and `food.listByDate` for macros and fiber of the last 14 days only; older days have macros `null`. A macro that a row does not have is unknown, never 0 (`{ g, missingRows }`).

## Food data: grounded, "unknown" when we have no row

- Primary source: TKPI 2019 (`tkpi2019-data.ts`, per 100 g: kcal, protein, carbs, fat, fiber). Names resolve exactly (normalized), then by the name before the comma preferring "segar" rows, then by a unique long prefix; id and en names and a few aliases (papaya, betik, tembikai) only pick the row, the numbers come from it. TKPI codes work too. An ambiguous or unmatched name is **unknown**: no loose substring guess, no number, never ranked. Secondary: USDA rows of the ingredient registry.
- Sugar: TKPI has no column, so sugar is always unknown.
- A TKPI row that fails the Atwater check (|4P + 4C + 9F - kcal| > max(25, 35 % of kcal)) keeps kcal and fiber and withholds protein/carbs/fat (`dataNote: macros_inconsistent`). The real case is `ER073 Pepaya, segar` (fat 12.0 g against 46 kcal).
- Typical portion, only from our data and in this order: the person's own latest grams for that food (both engines, from `food.recent`: the last 10 distinct foods), the dish library `typicalPortionG`, an ingredient's piece weight; otherwise none, and the answer compares per 100 g or uses grams the person gave. No portion is invented.
- `food-block.ts` pre-seeds a "FOOD DATA (ours)" block into the system prompt when the question has a food-choice cue (id/en/ms) and names foods, so a model without tool calling still answers from our numbers.

## Safety and privacy

- Keyword safety pass first (injury, symptoms, medication, eating-disorder, minor extreme diets): a worrying last message gets a fixed localized answer, **no model call**, no slot reserved. The disclaimer line is added in code for medical-ish answers, allergy/condition messages get a caveat, no diet extremes, no restriction advice for under-18 or eating-disorder signals. A leaked system prompt (canary) is replaced.
- Never read or sent: menstrual-cycle data, pregnancy/breastfeeding mode (a user's own message that mentions it only makes the prompt conservative), name, email, photos, GPS/places, Strava, device ids. `createToolData` reads `maternalMode` only to withhold the weight goal and its date; the kcal budget the app already shows is used as is (in a maternal plan it contains the plan's addition; the mode itself is not sent), except that the own-key engine gets it without the activity credit (next item).
- **Health Connect / Apple Health data never goes to a third party (own-key engine).** `createToolData(rpc, { today, engine })` is the single place that enforces it (`engine: "byok"` is built only by the phone's own-key path in `apps/native/src/lib/joyo-ai/engine.ts`; the hosted engine is `engine: "hosted"` in `routers/joyo.ts`), so the digest, every tool result and the food block inherit it. What can carry health-store data in or behind `day.summary`: `dailyActivity` (steps, distance, active kcal, exercise minutes; source `health_connect`/`apple_health`), `exerciseCredit` / `exerciseSources` / `burnedKcal` (all-day active energy and imported workouts), `sleepHoursLastNight`, and the exercise credit inside `targets.eatKcal`; weigh-ins and `myProfile.latestWeightKg` can in principle carry a `health_connect`/`apple_health` source. The seam copies named fields only, so the first group never appears; enforced on top: (1) the own-key eat budget is `eatKcal - exerciseKcal`, the base budget with no activity credit (macro targets, `remaining` and `fits_today` follow from it), and with no `exerciseKcal` from the server there is no target at all; (2) weigh-ins whose `source` is `health_connect` or `apple_health` are dropped, and the own-key `latestWeightKg` is the last weigh-in it may read; (3) `get_day`, `get_targets` and `fits_today` results carry `healthDataNote` and the own-key system prompt carries the same sentence (`BYOK_HEALTH_NOTE`): that data is not shared, it is unknown and **not zero**, never assume the person did or did not exercise; the tool descriptions say "base eat budget" (`toolSpecsFor("byok")`). Weight logged in JoyoRogo or from the JoyoRogo/JoyoFit scale (`manual`, `scale`) and the Huawei Health import (`huawei`) are not health-store sources and stay. The base target itself (TDEE, calibrated from earlier logged workouts) is a number JoyoRogo computes and stays. Tests: `byok-health.test.ts` (fixtures with Health Connect rows; the hosted engine keeps the credit and the weigh-in).
- The hosted engine keeps everything the server already reads (the budget with the activity credit, a Health Connect weigh-in). JoyoRogo's server is the service provider there: Cloudflare Workers AI processes the question for us, nothing is stored or used for training; it is not a transfer to a third party that decides what to do with the data.
- `CONSENT_VERSION` is 2: the own-key consent text (`joyoAiApp:consent.notSentOwnKey`, id/en/ms) lists "Data from Health Connect / Apple Health (steps, workouts, sleep, heart rate)" under never sent, so every earlier consent is asked again. The digest's field list is unchanged (`CONSENT_FIELDS_HASH[2]` equals version 1's). The hosted consent shares the constant and is asked again too, and the server refuses a client still sending version 1, so ship the app update with the server.
- Under 18 (known age from the profile) is off for both engines. Unknown age is allowed after the 18+ confirmation, with the conservative prompt.
- Own key: SecureStore only (`joyorogo.ai.key.<provider>`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never sent to JoyoRogo, never synced; settings, usage and chats are small files under the documents folder `joyo-ai/` on the phone (conversations: 30 chats x 80 messages). Hosted chats are stored on the device/browser only; the server stores nothing but a counter row (`ai_usage`: outcome, latency, tokens).
- Consent screen lists the digest's data categories (`CONSENT_CATEGORIES`); `CONSENT_VERSION` is pinned to `DIGEST_FIELDS` by a hash in `digest.test.ts`, so changing what is sent without a new version fails the build.

## Entry points

Native: Lainnya row, sparkle button in the Beranda and Makan headers, "Tanya Joyo AI" in the food portion sheet and "Mau makan ini? Tanya dulu" in the scan result (a new chat with the question typed into the composer, not sent). With no ready engine each opens setup or the engine switch. Web: bottom/desktop nav icon, Lainnya row, header sparkle on Beranda and Makan, "Tanya Joyo AI" on the portion sheet and the scan result (`/joyo?ask=`, composer prefilled and unsent). Privacy text: `routes/privasi.tsx` section "Joyo AI di JoyoRogo (Pro)" (and the Malay/English notices in `lib/legal-my.ts`).

## Deploy and release notes

- **Server deploy:** `joyo.status`/`joyo.chat`, `ai.diaryRange`, `JOYO_AI_DAILY_CAP` var (wrangler.jsonc), optional `AI_JOYO_MODEL` (falls back to `AI_COACH_MODEL`, `AI_CORRECT_MODEL`, then the default text model); `ai_usage.scan_type` gains `'joyo'` (TypeScript enum only, the column is text, no migration). Own key works without the deploy except 90-day macros (fallback above).
- **Web deploy:** `/joyo` page, nav entries, privacy text.
- **Native:** JS only (no dependency, plugin or config change), OTA-able in the mechanical sense. docs/ota.md lists "new data collection or sharing (Play Data safety, App Store privacy labels)" as **not** OTA material: Joyo AI sends diary data to a third-party provider the person chooses (own key) and to Workers AI (hosted). Whether the store listings/labels already cover that is the owner's call before an OTA.
- **[NOT VERIFIED]:** live Workers AI behavior on `@cf/google/gemma-4-26b-a4b-it` for streamed `delta.tool_calls`, `chat_template_kwargs.enable_thinking: false` together with `tools`, and streamed `usage` (tested only against fake bindings); provider default models/endpoints (copied from JoyoFit, unverified); every screen was typechecked and unit-tested but not run on a device or in a browser.
