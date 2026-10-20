# Weekly recap reflection ("Refleksi minggu ini")

A short, honest read of the week under the numbers on `/rekap`: what went well (2-3 wins) and what to work on (up to 3 focus points). Everyone gets a deterministic template text; Pro accounts get the same facts rewritten by Workers AI, once a week, behind a validator that refuses anything that is not in the facts.

Code: `packages/api/src/lib/recap-facts.ts` (facts), `food-patterns.ts`, `recap-text.ts` (wording), `recap-ai.ts` (prompt, validator, model run), `recap-reflection.ts` (data, cache, orchestration), `recap-store.ts` (the recap queries shared with `stats.weekRecap`). Wording: `packages/i18n/src/locales/{id,en}/reflection.json`. Table: `week_reflection` (migration 0049).

## Flow

1. `stats.weekReflection({ weekStart })` loads the recap of the week (`loadWeekRecap`, **Strava rows left out of the day budgets**), then the food item names, weigh-ins, waist, JoyoFit watch workouts (heart-rate zones read from the stored analysis in R2), `fitness_score` load ratio and sleep, `sleep_log`, and steps. `buildFacts` turns them into typed facts, `selectFacts` keeps the wins and the focus points, `renderSelection` words them. Returns the view; **never calls the model**. `null` when the week has no data, fewer than 2 judged days, or no profile.
2. Free account: `ai: "locked"`, `source: "template"`.
3. Pro account: reads the `week_reflection` row of (user, week, language). Current text -> `ai: "ready"`, `source: "ai"`. Nothing stored (or due again) -> `ai: "pending"`: the clients show the template and call `stats.generateWeekReflection({ weekStart })` once, then swap in the result.
4. `generateWeekReflection` re-checks Pro (FORBIDDEN with `data.paywall` otherwise), claims the run in the row (so two devices never start two), calls the model, validates, stores, and writes one `ai_usage` row per model call (`scan_type = 'recap'`, tokens in `usage_json`). It is safe to call on every open: when nothing is due it returns the cached view without touching the model.

There is no Monday cron: a text is written on the first view of the week. The `*/5` cron exists, but generating for every Pro account whether or not they open the app would pay for texts nobody reads.

## Facts

Thresholds live in `T` in `recap-facts.ts` (tests pin every boundary). A fact is `{ code, variant, role: win | focus, severity, priority, domain, params }`; `params` are the numbers the text may use, already rounded the way they are written. The week is judged on days before today only.

| Code (variants) | Role | Rule |
|---|---|---|
| `LOG_STREAK` (`streak`, `streak_gain`, `logged`, `some`) | win | streak of 3+ days (not in Hamil / Menyusui; Naikin BB counts days at 90% of target); else food logged on 5+ of 5+ judged days; else 2+ days |
| `LOG_GAPS` | focus | 4+ judged days and food logged on half of them or fewer |
| `WEIGHT_PACE` (`on_pace`, `behind`, `gaining`, `flat`, `too_fast`, `week_down`, `steady`, `drifting`, `gain_on_pace`, `gain_stalled`) | both | 28-day weekly rate against the pace the target date needs (`neededKgPerWeek`, with `projectedDate`). Lose: on pace from 60% of the needed pace, flat within 0.1 kg/week, too fast above max(1 kg, 1% of weight). Maintain: steady within 0.25 kg/week. Gain: 0.1 to max(0.75 kg, 1%). Not in Hamil / Menyusui |
| `WEIGH_INS` (`regular`, `few`, `none`) | both | 4+ is a win; 0-2 on a finished week (or 5+ judged days) is a nudge |
| `MEASURE_ANOMALY` (`waist`, `weight`) | focus | waist moved 5 cm or more between readings at most 7 days apart; weight 2.5 kg within 2 days (a measuring slip, not a change) |
| `INTAKE_AVG_VS_TARGET` (`on_target`, `over`, `under`, `under_gain`, `under_maternal`) | both | average of logged days against the mean of **each day's own budget** (`recap.targetKcal`). Lose / maintain: 85-105% on target, over from 110%, under below 70%. Gain: 90-115%, under below 90%. Hamil / Menyusui: 85-115%, only "under" below 80%, never "over". Needs 3 logged days |
| `INTAKE_SWING` (`swing`, `steady`) | both | 4+ usable days; spread of 1000 kcal or a coefficient of variation of 0.3. Days under 40% of their budget are forgotten logs and stay out |
| `PROTEIN_LOW` / `PROTEIN_OK` | focus / win | average under 70% (under 60% ranks higher) / from 95% of the target; 4+ days with protein. Its own selection domain, ranked above the calorie average and sleep, so a person who asks about macros hears about it first |
| `FOOD_PATTERN` (`fried`, `double_carb`, `sweet`) | focus | from item names, word lists id + en (`food-patterns.ts`): 4 fried items on 3 days, 4 sweets on 3 days, 3 meals with two different starches. Naikin BB only hears about fried food, Hamil / Menyusui not about starch. Only our own list terms leave the module |
| `ACTIVE_WEEK` (`active`, `maternal`) | win | 3 sessions, 3 active days or 150 minutes, Strava excluded |
| `RUN_INTENSITY` (`hard_run`, `hard_other`, `hard_check_doctor`, `hard_maternal`) | focus | a watch workout with 5+ minutes in zones 4-5 and 40%+ of the session (3 minutes in Hamil / Menyusui). BMI 30+ with an average heart rate of 85% of the zone maximum (or 160 bpm) says "cek dokter" before more intensity. Carries the load ratio when that is a spike too |
| `LOAD_SPIKE` | focus | JoyoFit acute:chronic load ratio of 1.5 or more (2.5 = alert) |
| `RUN_EASY` | win | 20+ zoned minutes with under 20% in zones 4-5 |
| `SLEEP_SHORT` / `SLEEP_OK` | focus / win | 3+ nights; average under 7 h / 7 h or more with 4+ nights |
| `SLEEP_FACTOR` (`caffeine`, `regularity`, `temperature`, `humidity`, `dinner`, `workout`) | focus | Pro account with the sleep insights switch on only (`sleepFindingsFor`, docs/sleep-insights-design.md; the pauses for Hamil / Menyusui and Ramadan live there). The unfavourable direction only (less sleep after caffeine or an irregular bedtime, more time awake after a warm or humid room, a late dinner or workout), at most one per week: leaning before maybe, then more exposed nights, then the factor order above; the variant the previous week's stored reflection showed is skipped when another exists. Priority 58 in the sleep domain, so every safety and food / weight point and `SLEEP_SHORT` rank above it. No alcohol variant. Params: `exposed`, `other`, `minutes` and `confidence` (`maybe` / `leaning`), plus `value` (the cut-off) for the room factors. The wording is fixed per variant and confidence ("mungkin" / "cenderung"), describes and never explains |
| `LOW_STEPS` / `STEPS_GOOD` | focus / win | average under 5000 / from 8000 on days with 500+ steps; days under 500 are counted aside (watch left at home) and the advice says the number may read low |

Selection: up to 3 wins, best first. Focus points: the best point of each domain (food, protein, weight, movement, sleep, data) before a second one of any domain, at most 2 per domain, at most 3, safest first (an alert-level movement point outranks everything). `selectionSignature` fingerprints the selected facts with numbers rounded to half a power of ten; a text is only rewritten when it changes. The signature of a reflection that shows a sleep pattern ends in `~<variant>`; the next week reads it from the stored row to pick another pattern.

Hamil / Menyusui: no weight pace, weigh-in, measurement, steps or streak facts, never "eat less", gentler intensity wording that points to the doctor or bidan, and a closing note that the numbers are no targets.

## Text

Every selected fact has a title, an observation and (focus) one piece of advice per `(code, variant)` in `reflection.json` (casual "kamu" / "you", no emojis). The template is: wins paragraph, focus paragraph, then `Fokus minggu depan:` and the numbered advice. Numbers are formatted per language (1.950 / 1,950).

## AI text (Pro)

- Model: `AI_RECAP_MODEL`, default `@cf/google/gemma-4-26b-a4b-it` (the scan / coach model). Thinking off, 25 s deadline, `runCoachModel` is reused.
- The model gets **only the selected facts** as JSON (`code`, `topic`, `numbers` as written in the person's language, the fixed `observation`, focus `advice`) plus strict rules: only the facts, no number invented / computed / rounded, no medical claims, advice only from `advice`, casual voice, no emojis or markdown, 150-220 words, a wins paragraph, a focus paragraph and the closing label with exactly one numbered line per focus fact. Hamil / Menyusui and Naikin BB add their own rule. Free text from the person (food names) never reaches the prompt.
- Validator (`validateRecapText`), first problem wins: empty; length (110-280 words); emoji; markdown or bullets; leaked `FACTS` / `JSON` / fact codes; forbidden terms (diseases, medication, supplements, diagnosis, body-shaming; weight-loss talk in Hamil / Menyusui, "eat less" in Naikin BB); **every number must be one the model was given**, in any locale format and rounded to the digits written (`1.950`, `1,950`, `108` for 107.7, but not `2.000` for 1950); when the facts hold a `SLEEP_FACTOR`: causal wording (menyebabkan, penyebab, gara-gara, akibat, karena kopi / makan / latihan, causes, because of, due to, leads to) and claims stronger than the confidence (pasti, jelas, terbukti, proves, definitely); language heuristic; exactly one numbered line per focus fact at the end (the closing label is inserted when the model leaves it out).
- One retry with the reason when an answer is refused (or the call is empty / fails); a timeout stops at once. Two refusals = the template stays and the row is stored as `failed`.

## Cache

`week_reflection` (user, week, language) holds the AI text, `signature`, `generations` and `generated_at`. Rules (`decideAi`, tested): a stored text with the current signature is shown forever and never rerun; changed facts are rewritten at most every 6 h; at most 4 model runs per account, week and language (failures included); a failed run waits 3 h; a run claimed more than 90 s ago and never finished can be claimed again. A text whose facts changed and cannot be rewritten yet is not shown: the (accurate) template is.

## Strava

Strava's API terms keep its data out of AI. The reflection loads the recap with `excludeStrava` (Strava rows leave each day's budget, exercise totals and steps are never read from Strava), so no fact or number depends on a Strava activity. The recap screen's own numbers still include Strava, so a budget can differ slightly for someone with Strava activities.

## Configuration

- `AI_RECAP_MODEL` (optional var, unset = Gemma 4). Without an `AI` binding Pro accounts get the template and `ai: "unavailable"`.
- The paywall rule is the coach's (`premiumUnlocked`): Pro, or everyone on a server without a paywall.

## Cost

Gemma 4 26B A4B on Workers AI is $0.10 / M input and $0.30 / M output tokens (9091 / 27273 neurons per M). The measured runs used about 1150-1280 input and 320-400 output tokens, 19-23 neurons, so about **$0.00025 per generated text** (usually one run per account and week, a retry is a second). 1000 Pro accounts opening the recap every week is around $1.10-1.40 a month. SEA-LION v4 27B gave an equally valid text for about 3x the neurons (60.8), Qwen3 30B A3B answered empty with thinking off, so Gemma 4 stays the default.

## UI

Web `/rekap` (`apps/web/src/components/recap-reflection.tsx`) and native `rekap` (`apps/native/components/recap-reflection.tsx`): the text, a label saying whether it is AI or the automatic summary, the wins and focus titles, a muted "based on the days so far" note on a running week, the disclaimer, a quiet Pro upsell for free accounts, and a "writing your reflection" row while the AI text is generated. The Monday recap card shows the first focus title as one line.

## Example: the owner's week

Fixture `ownerWeek()` in `recap-fixtures.ts`: male 107.7 kg, target 1500 kcal, average 1950 (daily 1400-2600), protein 58 of 110 g, a 1 km run with average heart rate 163 and max 177 and 8 minutes in zones 4-5, load ratio 4, sleep 5-6.4 h, 5 weigh-ins, waist 112 -> 102 cm in 5 days, a logging streak of 9 days.

Selected: wins `LOG_STREAK/streak`, `WEIGH_INS/regular`; focus `RUN_INTENSITY/hard_check_doctor` (carrying the load), `PROTEIN_LOW/low`, `INTAKE_AVG_VS_TARGET/over`. Also computed but not selected: `SLEEP_SHORT`, `MEASURE_ANOMALY/waist`, `FOOD_PATTERN/fried` and `sweet`, `INTAKE_SWING/swing`, `WEIGHT_PACE/behind`, `LOW_STEPS`, `LOAD_SPIKE`.

AI (id), real Workers AI run, Gemma 4, accepted on the first attempt (1239 in / 313 out tokens, 19.8 neurons):

```text
Hebat banget kamu sudah konsisten mencatat makan selama 9 hari berturut-turut. Kamu juga sudah menimbang berat badan sebanyak 5 kali minggu ini, jadi data perkembanganmu benar-benar bisa dipercaya.

Minggu ini ada beberapa hal yang perlu diperhatikan. Saat sesi lari, kamu menghabiskan 8 menit di zona 4 sampai 5, atau sekitar 69% dari total durasi lari. Detak jantung rata-ratamu berada di 163 bpm dan sempat mencapai 177 bpm, dengan beban latihan 4 kali lipat dari biasanya. Selain itu, rata-rata asupan proteinmu adalah 58 g per hari, padahal targetmu adalah 110 g, sehingga masih kurang 52 g. Terakhir, rata-rata asupan kalorimu adalah 1.950 kkal per hari, yang berarti sekitar 450 kkal atau 30% di atas target 1.500 kkal.

Fokus minggu depan:
1. Cek dulu ke dokter sebelum menambah intensitas, lalu mulai dengan jalan cepat atau selang-seling lari dan jalan di tempo yang masih bisa ngobrol, serta beri 1 sampai 2 hari istirahat penuh.
2. Tambahkan satu sumber protein di tiap kali makan seperti telur, ikan, ayam tanpa kulit, tahu, atau tempe.
3. Pilih satu waktu makan yang paling gampang dipangkas untuk dikurangi sedikit saja.
```

AI (en), same week:

```text
You have built some wonderful momentum with your data this week. You logged your food for 9 days in a row, which makes your progress so much easier to track. You also weighed in 5 times, so the trends we see are reliable.

Regarding your training, you had 1 run where you spent 8 minutes in zones 4 to 5. This accounted for 69% of that session, with an average heart rate of 163 and a peak of 177 bpm. Your training load this week was 4 times your usual. Because your heart rate was this high at a hard pace, please see a doctor before adding more intensity. If you experience chest pain, shortness of breath, or dizziness, stop and get checked. You should also try brisk walking or alternating running and walking at a pace where you can still talk, and take 1 to 2 full rest days next week. For nutrition, you averaged 58 g of protein, which is 52 g short of your 110 g target. Additionally, you averaged 1,950 kcal, which is 450 kcal above your 1,500 kcal target.

Focus for next week:
1. See a doctor before adding intensity, then try walking or alternating running and walking, and take 1 to 2 rest days.
2. Add one protein source like eggs, fish, skinless chicken, tofu, or tempeh to every meal.
3. Pick one meal that is easiest to trim, like dinner or snacks, and cut just a little.
```

Hamil / Menyusui (the same data forced into that mode, so the engine's maternal selection applies; the model is told to stay gentle):

```text
Wah, selamat ya karena kamu berhasil mencatat makan secara lengkap selama 7 dari 7 hari. Kamu bahkan sudah menjaga streak catatan ini selama 9 hari berturut-turut, jadi datanya sangat bagus untuk kita lihat bersama.

Namun, ada beberapa hal yang perlu diperhatikan untuk kenyamananmu. Saat melakukan run, kamu menghabiskan 8 menit di zona 4 sampai 5, atau sekitar 69% dari durasi latihanmu. Detak jantungmu rata-rata 163 dan sempat menyentuh 177 bpm, dengan beban latihan sekitar 4 kali dari biasanya. Selain itu, rata-rata asupan proteinmu adalah 58 g per hari, padahal targetnya adalah 110 g, jadi masih ada kekurangan sekitar 52 g. Terakhir, rata-rata waktu tidurmu adalah 5,9 jam per malam, dengan durasi antara 5 sampai 6,4 jam, sementara kamu butuh sekitar 8 jam.

Fokus minggu depan:
1. Turunkan tempo ke level yang masih bisa ngobrol atau pilih jalan santai, tanyakan ke dokter atau bidan seberapa berat latihan yang aman buat kondisimu, dan beri 1 sampai 2 hari istirahat penuh.
2. Tambahkan satu sumber protein di tiap kali makan seperti telur, ikan, ayam tanpa kulit, tahu, atau tempe.
3. Majukan jam tidur 15 menit tiap beberapa hari sampai mendekati kebutuhanmu, serta kurangi layar dan kafein di malam hari.
```

The template of the same week (no AI), id:

```text
Kabar baiknya: Kamu mencatat makan 9 hari berturut-turut. Kebiasaan ini yang bikin angka-angka lain bisa dipercaya. Kamu menimbang berat 5 kali minggu ini, jadi tren-nya bisa dipercaya.

Yang perlu diperhatikan: Latihanmu menghabiskan 8 menit di zona 4 sampai 5, sekitar 69% dari waktu sesi. Itu zona yang berat. Detak jantungmu rata-rata 163 dan sempat 177 bpm. Beban latihanmu minggu ini juga sekitar 4 kali dari biasanya. Rata-rata proteinmu 58 g per hari, target 110 g (kurang sekitar 52 g). Rata-rata makanmu 1.950 kkal per hari, sekitar 450 kkal (30%) di atas target 1.500 kkal.

Fokus minggu depan:
1. Detak jantung setinggi ini di tempo yang berat perlu diperhatikan. Cek dulu ke dokter sebelum menambah intensitas, lalu mulai dengan jalan cepat atau selang-seling lari dan jalan di tempo yang masih bisa ngobrol. Kalau ada nyeri dada, sesak, atau pusing, berhenti dan segera periksa. Beri juga 1 sampai 2 hari istirahat penuh minggu depan.
2. Tambahkan satu sumber protein di tiap kali makan: telur, ikan, ayam tanpa kulit, tahu, atau tempe.
3. Pilih satu waktu makan yang paling gampang dipangkas, biasanya makan malam atau camilan, dan kurangi sedikit saja. Selisih kecil tiap hari lebih awet daripada pantang total.
```

and en:

```text
The good news: You logged your food 9 days in a row. That habit is what makes every other number trustworthy. You weighed in 5 times this week, so the trend can be trusted.

Worth your attention: Your workout spent 8 minutes in zones 4 to 5, about 69% of the session. Those are hard zones. Your heart rate averaged 163 and peaked at 177 bpm. Your training load this week is also about 4 times your usual. You averaged 58 g of protein a day against a 110 g target (about 52 g short). You averaged 1,950 kcal a day, about 450 kcal (30%) above your 1,500 kcal target.

Focus for next week:
1. A heart rate this high at a hard pace deserves attention. See a doctor before adding intensity, then start with brisk walking or alternating running and walking at a pace where you can still talk. If you get chest pain, shortness of breath, or dizziness, stop and get checked. Also take 1 to 2 full rest days next week.
2. Add one protein source to every meal: eggs, fish, skinless chicken, tofu, or tempeh.
3. Pick the one meal that is easiest to trim, usually dinner or snacks, and cut only a little. A small gap every day lasts longer than quitting cold turkey.
```

## Tests

`recap-facts.test.ts` (each fact and its boundaries, selection, signature, the owner's week), `food-patterns.test.ts`, `recap-text.test.ts` (every variant reachable, worded and translated in both languages, plural forms, template shape), `recap-ai.test.ts` (number tolerance, every refusal, the prompt, retry and fallback with a fake model), `recap-reflection.test.ts` (in-memory D1: Pro gate, cache, regeneration gap and cap, failed runs, a run in flight, usage ledger, Strava). Run `cd packages/api && bun test src/lib`.

## Trying a model for real

A throwaway worker with `"ai": { "binding": "AI", "remote": true }` that imports `recap-ai.ts` and `recap-fixtures.ts` and calls `generateRecapText(env.AI, ...)` on `ownerWeek()`, started with `wrangler dev --remote`, produced the outputs above.
