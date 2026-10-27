# Badges and weekly consistency leaderboard (backend)

Flag: `BADGES_USER_IDS` (apps/server wrangler vars): comma-separated user ids, or `*`; empty = nobody. One flag gates both
features (the routers answer `enabled: false` / FORBIDDEN, the write hooks and cron skip the user). Default: owner only.

Hard rule: no badge and no rank is derived from weight, kg lost, waist or calories against a target. Weigh-ins are never
logged days. The protein goal reads the latest weigh-in only to size the goal; the weight is not stored or returned.

## Logged day (`lib/badges.ts isLoggedFood`, SQL twin `lib/badge-store.ts LOGGED_DAY_WHERE`)
A `food_log` row with `kcal > 0`, `source != 'huawei'` (imports), written 0 to 2 days after the day it names in the person's
zone (never before it: no future days). Badge and board streaks use this stricter rule; the home streak chip is unchanged.

## Badges (`lib/badges.ts BADGES`)
12 ids, tiers by threshold, awarded rows are never removed. Image per id: `/badge/<id>.webp` (web), `assets/badge/<id>.webp`
(native). Copy: i18n namespace `badges` (`<id>.name`, `<id>.desc` with `{{n}}` = tier threshold).
Write path (`awardAfterFood`, `awardOnWrite`, waitUntil): catatan-pertama, pemindai-pertama, perbaikan-pertama, latihan-pertama.
Nightly (WIB 00:10 tick): everything, evaluated from history (so the first run is also the backfill for allowlisted users).
Ramadan: `RAMADAN_WINDOWS` in code (1448 H: 2027-02-08..2027-03-09, [INFERENCE]: Umm al-Qura says ..03-08, the extra day covers
a 30-day Sidang Isbat), 20 logged days inside a window, only for people with `ramadanMode = 'on'` or a fasting pattern, decided
the day after the window closes. Add the next Hijri year to the list.

## Leaderboard
Opt-in (`leaderboard_pref`), alias 3-20 chars `[a-z0-9_.-]`, unique. Week = Monday to Sunday in WIB. Order: days logged, workout
days (device/JoyoFit only), protein days, streak (all desc), alias asc, user id. Hamil / Menyusui users are excluded and cannot
opt in. Snapshot `leaderboard_week` is rewritten every 30 minutes for the running week and once more Monday 00:30 WIB for the
closed week. Opting out deletes all of the person's snapshot rows; account wipe (`deleteAllUserData`) removes badges, pref and rows.

## Backfill and cost
Nightly cron and `POST /api/admin/badges/backfill?after=<userId>&limit=50` (admin console auth, max limit 200) both call
`awardGroups`: users in groups of 25; per group about 9 queries (profile+weight, logged days, workout days, water, scans,
corrections, team, challenges), each sliced to at most ~97 ids; the logged-day query reads each user's `food_log` rows of the
last 1000 days through `food_log_user_date_idx`. 50 users is about 20 to 25 D1 queries and one batched insert; the response
carries `next` (null = done). Owner-only rollout: the first nightly run is the backfill, no call needed. With `*` the nightly
job evaluates at most `NIGHTLY_MAX_USERS` (1000) recently active users per night; run the backfill once at launch.
