# PRD: Joyorogo MVP (AI Weight-Loss Companion)

> Generated per ralph/skills/prd. Atur project: Joyorogo (`b00a31c6-cf01-400d-a0a5-4d8349e5c0df`, workspace `joyodigitama`).
> Decisions locked with owner (2026-09-13): antislop DURING, calm-minimal design, AI on Cloudflare Workers AI (Neuron-priced vision model), UI in Bahasa Indonesia.

## Introduction

Joyorogo is a personal, AI-assisted weight-loss companion for an Indonesian user (Android first). It answers exactly three questions per day, nothing more nerdy:

1. Berapa kalori boleh dimakan hari ini? (eat)
2. Berapa kalori harus dibakar? (burn)
3. Butuh tidur berapa jam? (sleep)

Everything else is bookkeeping behind those numbers: food photos recognized by AI, manual food entries, workouts from Strava and Health Connect (Huawei Watch Fit path), weigh-ins, and sleep logs. The same data and actions work on the phone (React Native/Expo) and on a big-screen web dashboard (SPA).

## Goals

- Onboarding finishes in under 2 minutes: age, gender, height, current weight, target weight (with healthy-range recommendation), target date, daily activity level; result is the 3 daily numbers.
- Food logging in under 15 seconds: snap a photo, AI identifies the dishes (must handle Indonesian food: nasi goreng, ayam geprek, soto, gudeg, sambal, kerupuk, ...), user confirms portions, done.
- Home screen shows the 3 numbers with progress for today (WIB), no data-science dashboard.
- Full parity on web: login, onboarding, 3 numbers, logging all domains.
- Bookkeep everything: every food item, exercise, weigh-in, and sleep entry is persisted and listed per day.
- Calorie math is safe by construction: deficit capped, intake floored, warnings when target is unhealthy or too aggressive.

## User Stories

### US-001: Google login on web and native

**Description:** As a user, I want to sign in with my Google account on both the web dashboard and the Android app so that my data follows me across devices.

**Acceptance Criteria:**

- [ ] Web `/login` shows one primary action: "Masuk dengan Google"; email/password UI is gone
- [ ] Native login screen does the same via Better Auth Expo client (deep link `joyorogo://`)
- [ ] After sign-in, unauthenticated users land on the app; session persists across app restarts and browser reloads
- [ ] Polar payment scaffolding (plugin, client, success route, env vars) is fully removed
- [ ] Dev-only credentialless sign-in exists for local verification (enabled only when `DEV_LOGIN` binding is set)
- [ ] Typecheck passes

### US-002: Fitness domain database schema

**Description:** As a developer, I need tables for the fitness domain so all bookkeeping persists in D1.

**Acceptance Criteria:**

- [ ] Drizzle tables in `packages/db/src/schema/fitness.ts`: `profile` (1:1 user), `weight_log`, `food_log`, `exercise_log`, `sleep_log`, `strava_account`
- [ ] Unique constraints: one profile per user; one weight/sleep row per user+date; exercise dedup on (user, source, external_id)
- [ ] Migration generated with `bun run db:generate` and applied locally
- [ ] Typecheck passes

### US-003: Calorie engine (pure functions + tests)

**Description:** As a developer, I need one pure calorie engine shared by server and clients so the 3 daily numbers are consistent everywhere.

**Acceptance Criteria:**

- [ ] `computeTargets(profile, weightNow?)` implements: Mifflin-St Jeor BMR; TDEE = BMR x activity (low 1.25 / mid 1.35 / high 1.45, exercise excluded); needed deficit = (weight - target) x 7700 / days; total deficit clamped 250..1000 kcal (0 when weight <= target: maintenance mode); eat = TDEE - (totalDeficit - burnTarget), floored at 1200 (female) / 1500 (male); burnTarget = clamp(round(3.3 x weight, to 5), 200..400); sleep = 8 h; ideal range = BMI 18.5..24.9 x height squared
- [ ] Returns note flags: target below healthy range, plan clamped for safety, maintenance mode
- [ ] WIB (UTC+7) date helpers: `jakartaToday()`, days-to-target; 23:30 UTC resolves to the next WIB day
- [ ] Bun tests cover: known BMR value (male 70 kg / 170 cm / 30 y = 1617.5), floors, clamps, maintenance mode, ideal-range bounds, WIB rollover
- [ ] Tests pass; typecheck passes

### US-004: Onboarding flow (web + native)

**Description:** As a new user, I want to answer a few basic questions (age, gender, height, weight, target weight, target date, activity) and immediately see my 3 daily numbers.

**Acceptance Criteria:**

- [ ] Multi-step form (web route + native stack), all fields in Bahasa Indonesia with metric units
- [ ] Height required for BMI/BMR (user did not list it but the math needs it)
- [ ] Target weight field shows live healthy-range hint "Berat sehat untuk tinggimu: 53-72 kg" as height/target change
- [ ] Target below healthy range shows a warning but is not blocked; overly aggressive plan shows "Rencana disesuaikan agar aman" note
- [ ] Saving creates the profile AND the first weigh-in; result screen shows eat/burn/sleep with one-line explanations
- [ ] Typecheck passes
- [ ] Verify in browser (web onboarding end to end)

### US-005: Home dashboard with the 3 numbers (web + native)

**Description:** As a user, I open the app and see today's eat/burn/sleep progress without reading any charts.

**Acceptance Criteria:**

- [ ] Eat: budget vs eaten today (from food logs), remaining is the hero number
- [ ] Burn: target vs burned today (exercise logs from all sources)
- [ ] Sleep: 8 h need vs last logged night (shows "belum dicatat" when empty)
- [ ] Today = WIB day; after 00:00 WIB the counters reset
- [ ] Empty states (no profile -> redirect to onboarding; no logs -> zeroed numbers with hint), loading and error states present
- [ ] Typecheck passes
- [ ] Verify in browser (web dashboard with seeded data)

### US-006: Manual food logging (web + native)

**Description:** As a user, I want to quick-add food by name and calories (macros optional) under a meal slot when I don't have a photo.

**Acceptance Criteria:**

- [ ] Meal slots: Sarapan / Makan Siang / Makan Malam / Snack
- [ ] Add form: name + kcal required, protein/carbs/fat optional; entry appears in today's list grouped by meal; deletable
- [ ] Day list endpoint supports date param (defaults to today WIB)
- [ ] Typecheck passes
- [ ] Verify in browser (add + delete a food entry)

### US-007: AI camera food logging (web + native)

**Description:** As a user, I want to point my camera at a meal, have AI identify the food and estimate calories, confirm, and log it.

**Acceptance Criteria:**

- [ ] Native: expo-camera capture; web: file input with `capture="environment"`; image resized client-side (<= 1024 px JPEG)
- [ ] Server procedure sends the image to Workers AI via the `AI` binding, default model `@cf/google/gemma-4-26b-a4b-it` (Neuron-priced, vision-capable), overridable by `AI_VISION_MODEL`
- [ ] Prompt forces strict JSON: items with Indonesian dish name, portion estimate, kcal, protein/carbs/fat, confidence; parser tolerates fenced/prose-wrapped JSON and returns 503-with-message when binding/model unavailable
- [ ] Confirm screen lets the user adjust meal slot and kcal before logging; logging writes one food_log row per item with source='ai'
- [ ] Photos are NOT persisted in MVP (analysis is ephemeral)
- [ ] Typecheck passes
- [ ] Verify in browser (upload a food photo, see items, confirm, verify kcal lands on dashboard)

### US-008: Exercise logging + Strava

**Description:** As a user, I want my workouts counted toward Burn: manual entries plus automatic import from Strava.

**Acceptance Criteria:**

- [ ] Manual add: type/name, duration, kcal (kcal pre-filled from MET estimate when user picks an activity type)
- [ ] Strava connect via OAuth in settings/profile screen (browser flow; native returns to app via deep link)
- [ ] Sync imports recent activities (type, name, moving time, kcal when Strava provides it, else MET estimate from type), deduped by (source, external_id)
- [ ] Token refresh handled server-side; disconnect removes stored tokens
- [ ] Today's Burn totals include manual + strava + health_connect sources
- [ ] Typecheck passes
- [ ] Verify in browser (manual exercise add updates Burn; Strava connect screens render; without Strava credentials the connect button shows a clear "belum dikonfigurasi" state)

### US-009: Health Connect import (Android)

**Description:** As a Huawei Watch Fit owner, I want workouts tracked in Huawei Health (synced to Health Connect) to appear as burned calories.

**Acceptance Criteria:**

- [ ] `react-native-health-connect` wired with config plugin; permissions screen requests ExerciseSession (+ SleepSession for US-011 display)
- [ ] Import maps completed exercise sessions to exercise_log rows (source='health_connect', deduped)
- [ ] Graceful no-op on web/non-supporting devices (screen hidden on web)
- [ ] Note documented: requires a dev build (not Expo Go); device verification pending (open question)
- [ ] Typecheck passes; Android JS bundle export succeeds

### US-010: Weight check-ins and progress

**Description:** As a user, I want to log my weight regularly and see progress from start weight toward target.

**Acceptance Criteria:**

- [ ] Quick check-in on home (pre-filled with last weight); one row per user+date (same-day overwrite)
- [ ] Progress view: start weight, latest, delta, remaining to target, simple chronological list
- [ ] Updating weight today recomputes today's 3 numbers (targets use latest known weight)
- [ ] Typecheck passes
- [ ] Verify in browser (check-in updates progress and eat number when weight changed)

### US-011: Sleep logging

**Description:** As a user, I want to record last night's sleep hours so the sleep number becomes a streak, not wallpaper.

**Acceptance Criteria:**

- [ ] One-tap presets (5..9 h) + manual input; one row per user+date
- [ ] Home shows need (8 h) vs actual last night
- [ ] Typecheck passes
- [ ] Verify in browser (log sleep, dashboard reflects it)

### US-012: Profile screen

**Description:** As a user, I want a single screen with my plan recap and all integrations.

**Acceptance Criteria:**

- [ ] Shows profile values, current 3-number plan with notes, and Google account
- [ ] Strava connect/disconnect, Health Connect permission entry (Android), sign out
- [ ] Editing target weight/date recomputes the plan (through US-003 engine)
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: All "today" boundaries use Asia/Jakarta (UTC+7, no DST).
- FR-2: Targets are computed from the profile plus the latest known weight; never stored stale.
- FR-3: One profile per user; onboarding runs whenever profile is missing; editing it later happens on the profile screen.
- FR-4: Food, exercise, weight, and sleep rows are all user-scoped; every list endpoint filters by session user.
- FR-5: Food and exercise entries support deletion; weight and sleep support same-day overwrite.
- FR-6: AI analysis returns structured items; nothing is auto-logged without user confirmation.
- FR-7: Burn target counts only logged exercise (manual, strava, health_connect); daily-life activity stays inside the TDEE multiplier.
- FR-8: The AI vision model is server-configured via `AI_VISION_MODEL` with the default pinned in infra; no client-side model choice.
- FR-9: Errors from external services (Workers AI, Strava, Health Connect) surface as readable Indonesian messages, never silent no-ops.
- FR-10: All UI text is Bahasa Indonesia; numbers use Indonesian-friendly formatting (kcal integer, kg one decimal).

## Non-Goals (Out of Scope)

- No payments/subscriptions (Polar scaffolding removed).
- No social features, sharing, or leaderboards.
- No AI chat coach.
- No barcode scanning or packaged-food database lookup.
- No iOS build (user is Android).
- No push notifications or reminders.
- No step-count-to-calorie conversion (steps excluded from Burn in MVP).
- No photo storage (analysis is ephemeral).
- No dark mode in MVP beyond what the unistyles scaffold already carries (light is the designed default; calm-minimal direction).

## Design Considerations

- Calm minimal (owner-chosen): light background, generous whitespace, one green accent reserved for progress and the primary action; the three numbers are the hero at ~40-48 pt; no gradients, no glass, no decoration.
- Deliberate type choice: system font stack on native, Inter on web is allowed but the numbers may use a tabular/rounded display face for weight-like feel; reason: numbers are scanned, not read.
- Empty/loading/error states are part of every screen (antislop R-27): they name the cause and the next action.
- Mobile web layout must hold (R-03): the dashboard is phone-first responsive.

## Technical Considerations

- Stack (Better-T-Stack 3.43 scaffold, bun workspaces + turbo): `apps/server` Hono on Cloudflare Workers, `apps/web` TanStack Router SPA (Vite, port 3001), `apps/native` Expo 57 / RN 0.86 / expo-router / unistyles, `packages/{api,auth,db,ui,infra,config}`, oRPC 1.15 end-to-end types, Better Auth 1.7.3, Drizzle 0.45 on D1, Alchemy for infra/deploy, varlock for env schemas.
- Auth: Better Auth `socialProviders.google`; native via `@better-auth/expo` (scheme `joyorogo://`); remove `emailAndPassword` and all Polar code/env (`POLAR_ACCESS_TOKEN`, `POLAR_SUCCESS_URL`, `/polar/success` route).
- AI: `env.AI` Workers AI binding declared in `packages/infra/alchemy.run.ts`; chat-completions style call with base64 image; model default `@cf/google/gemma-4-26b-a4b-it` (vision, on the Neuron pricing table, no paid-billing restriction); fallback candidate `@cf/zai-org/glm-5.3-flash` (vision, cheaper/stronger, but requires paid billing method).
- Health Connect: `react-native-health-connect` requires a dev build; Huawei path is Watch Fit -> Huawei Health app -> Health Connect -> app.
- Strava: server-side OAuth code exchange, tokens in `strava_account`, refresh on 401/expiry, activities from `/api/v3/athlete/activities`.
- Dev verification before Google/Strava credentials exist: `DEV_LOGIN` binding (only in alchemy dev env) enables a fixed-user sign-in procedure.
- 1 kg body fat approx 7700 kcal is the planning constant; this is a model, not physiology, and the app never displays it as scientific fact.

## Success Metrics

- Time from app open (fresh) to seeing the 3 numbers: under 2 minutes.
- Photo-to-logged food: under 15 seconds on 4G.
- A full day (3 meals photo-logged, 1 workout imported, weigh-in, sleep) fully bookkept and visible on web and phone.

## Open Questions

- Google OAuth client (Web + Android package `com.anonymous.joyorogo`) must be created in Google Cloud Console; blocked on owner (Needs You when the code is ready).
- Strava API application must be created for the OAuth credentials; blocked on owner.
- Health Connect availability on the owner's Huawei Health version needs on-device verification (no Android SDK on the dev machine; adb present, emulator absent).
- Final vision model after real-photo testing (gemma-4-26b vs glm-5.3-flash paid): compare Indonesian dish accuracy.
