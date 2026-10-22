# Sleep insights

Opt-in patterns between a person's nights and their food and workout log. JoyoFit only pushes one row per night (and shows the consent switch);
JoyoRogo computes and shows everything. Design: JoyoFit `docs/sleep-insights-design.md`; owner decisions below override it.

## Consent

- One server switch, `sleep_insight_pref.enabled`, off by default. Editable from JoyoRogo (Profil > Privasi, Tidur) and JoyoFit (Settings > JoyoRogo);
  JoyoFit reads `sleepInsights.status` and pushes only when it is on.
- `consent_version` (current: `SLEEP_CONSENT_VERSION`); a changed field list needs a new yes.
- `upsertNights` answers `FORBIDDEN` / `consent_required` while the switch is off.

## Data

| Table | Key | Content |
| --- | --- | --- |
| `sleep_night` | user, `wake_date` | onset/wake ms, `tz_offset_min`, asleep/awake s, awakenings, `has_stages` + deep/rem/light s (null on stage-less watches), `watch_score`, `hrv_ms`, `rhr_bpm`, `naps_json` (max 4), bedroom aggregates `temp_c_mean/min/max`, `rh_pct_mean/min/max`, `env_samples`, `env_source` (null without a sensor), reserved `pm25_mean` (air purifier, later), `engine_rev`, `updated_at` |
| `sleep_insight_pref` | user | `enabled`, `consent_version`, `consented_at`, `free_days_mask` (bit i = weekday i, 0 = Sunday; default 65 = Sat+Sun), `dismissed_json` |
| `sleep_insight_cache` | user, factor | `signature` (hash of the factor's exposure/outcome vectors and context), `result_json` (evaluation, gate status, day a finding first showed), `computed_at` |

`food_log.eaten_at` (unix ms, nullable) is the optional "jam makan"; it is stored with the entry and goes with the food log. Workouts come from
the existing `watch_workout`; JoyoFit sends no workout data for this feature. Schema: `packages/db/src/schema/sleep-insights.ts`, migration `0054_sleep_insights.sql`.

## Router (`packages/api/src/routers/sleep-insights.ts`, `appRouter.sleepInsights`)

`status`, `setConsent`, `setFreeDays`, `upsertNights` (1..14 full snapshots, last wins per date), `get({ locale })`, `dismiss({ id })`.
Each night replaces its row; anything older than 90 nights is trimmed on every write. `upsertScores` and `pickNightSleep` are untouched, so Beranda,
Tidur and the other MCP tools never read `sleep_night`.

## Computation and gating

- On read, no cron: `lib/sleep-insights-store.ts` loads the 42-day window (main nights, food rows, `watch_workout`), `lib/sleep-insights.ts` (pure engine)
  builds the factor samples and evaluates them, `lib/sleep-insights-view.ts` renders `get`. `sleepFindingsFor(db, userId, now?)` returns visible personal
  findings (empty when off; pauses applied) and does not check Pro. Evaluations are cached per factor under a signature of their inputs.
- Personal factors and their fixed outcome: caffeine -> total sleep, dinner -> awake minutes, vigorous evening workout -> awake minutes, regularity ->
  total sleep, room temperature and humidity -> awake minutes (the person's own hottest/most humid third of nights against the rest). Alcohol is only a general tip.
- Gate (constants at the top of `sleep-insights.ts`): 14 main nights in 42 days; 5 exposed and 5 unexposed nights per factor; unexposed means a logged
  night (2 meals or 800 kcal in the 24 h before onset); a night with an unknown-time item of the factor is dropped; effect >= 0.5 of the person's own SD;
  permutation test stratified by work/free night, seeded by user and window, Benjamini-Hochberg over the tested factors; adjusted p <= 0.10 for "mungkin",
  <= 0.05 plus 28 nights plus the same sign in both halves for "cenderung" (dinner and workout never above "mungkin"). Leaves at a looser bar (hysteresis).
  At most one new personal finding becomes visible per day; at most 3 cards.
- Workout exposure: `watch_workout` rows (no new data from JoyoFit), 20 min or more, ended within 3 h of onset, vigorous = average HR at 80 % of the age-based
  max HR (220 - age). A late workout that is lighter or has no HR drops the night. Without any workout backup the factor does not exist.
- Free: general tips, progress, and a teaser count ("N pola ditemukan, buka dengan Pro"). Pro (`premiumUnlocked`): personal findings.
- Hamil/Menyusui: no personal caffeine factor and no caffeine or alcohol tips. Ramadan: dinner and caffeine nights paused.
- Free days setting drives the work/free strata and social jetlag (default Sat/Sun).
- Card text is rendered server side from `packages/i18n/src/locales/{id,en}/sleepInsights.json`, which also holds the UI labels.
- Weekly AI reflection: at most one sleep finding per week, Pro + consent only (docs/weekly-recap-ai.md). The model sees counts and averages only.
- Notifications are not in the MVP.

## Retention and wipe

90 nights. Turning the switch off deletes `sleep_night`, the cache and the dismissals immediately. `deleteAllUserData` ("Hapus semua data") and account
deletion (FK cascade) cover the tables. Not shared with groups, feed or family monitoring; the MCP connector reads it only through `get_sleep_nights` / `get_sleep_findings` while the switch is on (`docs/mcp-connector.md`). Logs carry counts only.

## Bedroom sensor, and air quality later

JoyoFit reads a Xiaomi LYWSD03MMC thermometer (community firmware) and sends per-night aggregates in `env` of the night payload (mean/min/max temperature and
humidity, sample count, `source`); raw samples stay on the phone. They fill the nullable `sleep_night` env columns (in migration 0054). A new factor is a
registry row in `buildFactorSamples`, the card copy and a cache entry, with no change to the statistics. The air purifier integration (PM2.5, air quality)
fits the reserved `pm25_mean` column (and further nullable columns, no redesign) when it arrives.
