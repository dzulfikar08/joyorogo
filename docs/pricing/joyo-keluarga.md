# Joyo Keluarga: design

Status: phases 1 to 3 built on branch `pricing/joyo-keluarga-design` (PR #42), behind `KELUARGA_ENABLED` (off), not
deployed. Phases 4 to 7 (Polar, native, Play, App Store, sibling apps) are not started. Written 2026-11-17 against
`origin/main` at `e750f24e`; section 10 lists what was built and where the code differs from the first draft.

Joyo Keluarga is a second paid plan. One person pays. Up to 5 people in one household get Joyo Pro, the payer included.
Everything below that is not read from the code or a cited page is marked [INFERENCE] or [TO VERIFY].

Related docs: `docs/pricing.md` (ladder, store prices, Polar), `docs/joyo-pro.md` (JoyoArto status endpoint),
`docs/play-billing.md`, `docs/revklik-forwarding.md`, `docs/marketing/marketing-plan.md` section 1.1 (claim ledger),
JoyoFit `docs/family-monitoring.md` (separate repo).

## 1. What people get

### The payer (owner of the household)

- Joyo Pro for themselves, the same as today (every item of `PRO_BENEFIT_GROUPS`, `packages/i18n/src/pro-benefits.ts`).
- Up to 4 more seats. Each seat is Joyo Pro for one JoyoRogo account.
- A "Keluarga" screen under Profil > Langganan: who is in, pending invites, invite, remove, renewal date.
- Priority support stays per account (`PRIORITY_SUPPORT`); members get it too, because they are Pro.

### Each member

- Joyo Pro on their own account, in all three apps, as long as the household's paid period runs:
  - JoyoRogo: every gate in section 3.
  - JoyoFit: reads the same JoyoRogo account rows, so it follows automatically. JoyoFit's own "Keluarga" monitoring
    (`joyofit/server/src/family/`, `docs/family-monitoring.md`) asks `POST /internal/joyofit/family/users`
    (`apps/server/src/family.ts`) for `pro`; once that endpoint uses the new check, a member counts as a Pro watcher
    (up to 5 watched people, `MAX_WATCHING_PRO` in `joyofit/server/src/family/plan.ts`).
  - JoyoArto: asks `POST /api/internal/joyo-pro/status` (`apps/server/src/joyo-pro.ts`, `joyoProStatus` in
    `packages/api/src/lib/joyo-pro.ts`). Once that uses the new check, each member is Pro in JoyoArto, matched by Google
    account id or verified email as today.

### Links to the two "household" features in sibling apps

- **JoyoArto household** (shared money ledger, `householdMember` / `householdInvite` in the JoyoArto repo): Joyo
  Keluarga does **not** create or join a JoyoArto household. Money data stays where each person put it. What changes:
  every Keluarga member is Pro in JoyoArto, so a JoyoArto household whose inviter is a member gets Pro limits
  (`PLAN_LIMITS.pro.members` = 6 in `joyoarto/packages/api/src/lib/billing/plans.ts`; the inviter's plan decides).
  A later, optional nicety: a "Buka JoyoArto" link on the Keluarga screen. No automatic data link.
- **JoyoFit Keluarga** (watch summary of a parent, with consent): Joyo Keluarga does **not** create a `family_link`.
  Consent stays in JoyoFit (per-category switches, revoke). A later, optional nicety: on the Keluarga screen, a
  "Pantau jam orang tua di JoyoFit" link that opens JoyoFit's own invite flow.

Naming clash: JoyoFit already uses "Keluarga" for monitoring and `fit.joyorogo.com/keluarga/<code>` for its invites,
and `joyorogo.com/privasi#keluarga` already describes JoyoFit monitoring (`apps/web/src/routes/privasi.tsx`). The plan
name "Joyo Keluarga" is fine; in copy, call the JoyoFit feature "Pantau keluarga (JoyoFit)" and use a new privacy
anchor `#joyo-keluarga` for the plan.

### What it is NOT

- Nobody sees anyone else's food diary, weight, sleep, workouts or chat because they share a household. Privacy stays
  per account. The household only carries: the member list (display name and photo), the paid period, and invites.
- Sharing food with family works as today: join a group (`team`, `routers/group.ts`, up to 20 people, `share_food`
  per member per group). The Keluarga screen may offer "Buat grup keluarga" as a shortcut that creates an ordinary group;
  that group follows group rules, not plan rules.
- The owner does not see a member's email, usage, scans or whether they also pay Pro themselves.
- Not a way to resell seats. See the churn limit in section 2.
- Not Apple Family Sharing (section 4.3).

## 2. Data model

New tables in `packages/db/src/schema/household.ts`, migration `0076_keluarga.sql` (built).
The pattern follows `team` / `team_member` (`packages/db/src/schema/social.ts`) but invites differ (below).

```
household
  id                text pk
  owner_id          text not null -> user.id (on delete cascade)
  paid_until        integer timestamp_ms null    -- the paid period; written only by billing code
  created_at        integer timestamp_ms
  unique(owner_id)

household_member
  household_id      text not null -> household.id (on delete cascade)
  user_id           text not null -> user.id (on delete cascade)
  role              text 'owner' | 'member'
  joined_at         integer timestamp_ms
  primary key(household_id, user_id)
  unique(user_id)                                -- one household per account

household_invite
  code_hash         text pk                      -- SHA-256 of the code, never the code itself
  household_id      text not null -> household.id (on delete cascade)
  created_by        text not null -> user.id (on delete cascade)
  created_at        integer timestamp_ms
  expires_at        integer timestamp_ms         -- created_at + 7 days
  used_by           text null -> user.id (on delete set null)
  used_at           integer timestamp_ms null
  revoked_at        integer timestamp_ms null

household_event                                  -- small audit log for seat churn and support
  id text pk, household_id (cascade), user_id null (on delete set null, so deleting a member's account never
  hands the household its join back), kind ('join'|'leave'|'removed'), at
```

D1 enforces foreign keys, so every reference to `user.id` needs an `on delete` rule or account deletion fails; the
first draft left `created_by`, `used_by` and the event's `user_id` without one.

`payment` gets one column, `product text` (`null` = Pro for every old row, `'keluarga'` for the new plan). It is
needed for: the price lock per product, the ladder count, RevKlik props, admin and receipts.

### Invites

- Groups use one long-lived capability code per group (`team.invite_code`, `newInviteCode` / `normalizeInviteCode`
  in `packages/api/src/lib/group.ts`, link `/gabung/<code>`, `rotateInvite` to change it). Anyone holding a `/gabung`
  link can join. That is fine for a free group, but a household seat is paid Pro, and a link forwarded into a WhatsApp
  group would give seats to strangers.
- So Keluarga invites are **single use and expire after 7 days**, like JoyoFit's (`docs/family-monitoring.md`: 8 chars,
  48 h, single use). Reuse the same alphabet and helpers (`INVITE_ALPHABET`, `newInviteCode`, `normalizeInviteCode`).
  Store only a hash [INFERENCE: JoyoFit's `family_invite(code_hash, ...)` does the same].
- Pending invites count against free seats: `members + pending invites <= 5`. The owner can cancel a pending invite.
- Link: `https://joyorogo.com/keluarga/<code>` (web route `apps/web/src/routes/keluarga/$code.tsx`, native
  `apps/native/app/keluarga/[code].tsx`, add `keluarga` to `SHARED_SEGMENTS` in `apps/web/src/lib/hosts.ts` and a
  match in `apps/native/src/lib/native-intent-path.ts`, as `gabung` does).
- Preview is public and rate limited with the existing `INVITE_PREVIEW_LIMITER` (as `group.preview` does). It shows
  only the owner's first name and "x of 5 seats used". Accepting needs a signed-in account.

### Rules

| Case | Behaviour |
| --- | --- |
| Max seats | 5 including the owner. Constant `HOUSEHOLD_MAX_SEATS = 5` in one place (owner decision; section 8). |
| One household per account | `unique(user_id)` on `household_member`. Accepting while in another household answers 409 "Kamu sudah di keluarga lain; keluar dulu". |
| Member leaves | Row deleted at once. Household Pro ends for them at once. Their own `founder_until` is untouched. Seat frees at once. Owner gets an in-app notice (same `notifyInBackground` pattern as `group.join`). |
| Owner removes a member | Same as leaving. The member gets an in-app notice. The email ("Kamu tidak lagi di Joyo Keluarga <nama>") is not built: email sending lives in `apps/server`, the router in `packages/api`. |
| Owner leaves | Not allowed while the household exists: the owner is the payer, and store subscriptions cannot move to another Apple/Google account. The owner can remove everyone, or turn off renewal and let the period end. |
| Owner deletes their account | `deleteUserSocialData`-style cleanup in `packages/api/src/lib/privacy.ts`: household and invites are deleted (cascade), members lose household Pro at once and get the notice. Unlike groups, there is no heir. The deletion screen must say "Langganan App Store/Google Play tetap jalan sampai kamu batalkan di toko" (as for Pro today). |
| Paid period ends | The household and its members stay. Pro is off for everyone until the owner pays again. Invites cannot be created while unpaid. |
| Seat churn | Each household may admit at most 8 joins in a rolling 12 months beyond the first fill (owner decision). Built as: member joins in the last 365 days must stay below 4 (seats minus the owner) + 8 = 12; checked when inviting and when accepting. Counted from `household_event`. |
| Member already pays Pro | See below. |

### A member who already pays Pro themselves

- No double charge from us at join time: joining costs the member nothing.
- Their own subscription is not touched and keeps running. Entitlement is the later of the two dates (section 3), so
  they lose nothing if they leave the household later.
- We cannot stop an Apple, Google Play or Polar renewal from our side. So, before accepting, the invite screen shows
  what we know about their own Pro, from data we already hold:
  - Web rupiah (DOKU/Pakasir): "Pro kamu sendiri aktif sampai 3 Mar 2027 dan tidak diperpanjang otomatis. Tidak ada
    yang perlu dibatalkan."
  - Polar (`polar_subscription`): "Langganan kartu kamu (Polar) diperpanjang otomatis pada 3 Mar. Batalkan di Kelola
    langganan kalau cukup pakai Keluarga." with the existing portal button (`POST /api/billing/polar/portal`).
  - Apple (`apple_subscription.state`) / Google Play (`google_purchase.state`): "Langganan App Store/Google Play kamu
    diperpanjang otomatis. Batalkan di pengaturan langganan toko kalau cukup pakai Keluarga." with the store's
    manage-subscriptions link on native.
- The same card stays on Profil > Langganan: two rows, "Pro dari Joyo Keluarga (<owner>) sampai X" and "Pro milikmu
  sendiri (<rail>) sampai Y, diperpanjang otomatis / tidak".
- No refund or time transfer of the member's own remaining days [INFERENCE: simplest honest rule; owner decision].
- The expiry mails (`runFounderEmails`, `founderEmailsDue` in `apps/server/src/email.ts`) must skip a person whose
  household still covers them past their own `founder_until`; otherwise they get "Pro kamu berakhir" while still Pro.

### The payer who already has Pro

Same rule: their own Pro period keeps running. Before checkout, `/pro` shows "Pro kamu masih sampai X; Keluarga mulai
hari ini". On Apple and Google Play the upgrade is a store plan change (section 4), so the store handles it.
On web rupiah, whether to credit the remaining own Pro days is an owner decision (section 8).

## 3. Entitlement

### Today

Every Pro gate funnels into `effectiveTier(row)` in `packages/api/src/lib/tiers.ts`: `tier = 'founder'` (manual comp)
or `founder_until > now`. The callers select `{ tier: user.tier, founderUntil: user.founderUntil }` themselves.

Gate functions found:

| Function | File | Rule |
| --- | --- | --- |
| `effectiveTier` | `packages/api/src/lib/tiers.ts` | comp or `founderUntil > now` |
| `premiumUnlocked` | `packages/api/src/lib/readiness-food.ts` | `effectiveTier === 'founder'` or no paywall |
| `cloudUnlocked` | `packages/api/src/lib/watch-workout-store.ts` | selects the user row, then `premiumUnlocked` |
| `canHostChallenge` | `packages/api/src/lib/challenge-host.ts` | same rule as `premiumUnlocked` |
| `requireAiQuota` | `packages/api/src/lib/quota.ts` | `effectiveTier` picks `founderDailyCap` vs `freeDailyScans` |
| `joyoProStatus` | `packages/api/src/lib/joyo-pro.ts` | `effectiveTier`, plus plan/source from the newest ledger row |

Sites that read `user.founder_until` for an entitlement decision (each must see household Pro):

| Site | How it reads |
| --- | --- |
| `lib/watch-workout-store.ts` `cloudUnlocked` | select. Covers `routers/coach.ts`, `strength.ts`, `joyo.ts`, `meal-plan.ts`, `sync.ts`, `watch-workout.ts`, `fit-web.ts`, `mcp-connection.ts`, `lib/recap-reflection.ts`, `apps/server/src/mcp.ts`, `apps/server/src/watch-workout.ts` |
| `lib/quota.ts` `requireAiQuota` | select. Covers `routers/ai.ts` and `routers/group.ts` (VAR) |
| `routers/day.ts` ~507 `readinessGuidance` | select + `premiumUnlocked` |
| `routers/challenge.ts` ~193, ~395 | select + `canHostChallenge` |
| `routers/fitness.ts` ~56 `cloudAccess` | select + `premiumUnlocked`, `effectiveTier` |
| `routers/sleep-insights.ts` ~171 | select + `premiumUnlocked` |
| `routers/social.ts` ~1109 (workout detail) | select + `premiumUnlocked` |
| `routers/profile.ts` `loadPlan` ~105, scan allowance ~158 | select + `effectiveTier`; also returns `founderUntil` to clients |
| `lib/reminders.ts` ~361 (`plan` reminder) | raw SQL `"user".founder_until` |
| `lib/strava-release.ts` ~106 | select + `effectiveTier` (protects Pro users' Strava slot) |
| `apps/server/src/family.ts` ~43 (JoyoFit) | select + `premiumUnlocked` |
| `apps/server/src/joyo-pro.ts` ~139, `lib/joyo-pro.ts` `userColumns` (JoyoArto) | select + `joyoProStatus` |
| `apps/server/src/admin.ts` ~183, `admin-scans.ts` ~84 | raw SQL "plan" columns (display only) |
| `apps/server/src/email.ts` `founderEmailsDue` | expiry mails (must exclude household-covered people) |

Sites that must keep reading the raw `user.founder_until`: every credit and refund path (`activateOrder` in
`apps/server/src/billing.ts`, `creditTransaction` / `revokeAppleTransaction` in `lib/apple-billing.ts`,
`lib/google-play-billing.ts`, `lib/polar-billing.ts`), admin edits (`apps/server/src/admin.ts` ~497), receipts.

### Minimal change: one derived column expression

Do not copy household time into each member's `founder_until`. That column stacks paid months
(`nextFounderUntil`) and is guarded by optimistic checks; mixing household time in would make leave/remove/refund
impossible to undo correctly.

Instead, add one SQL expression in `packages/api/src/lib/household.ts` (built):

```ts
const HOUSEHOLD_UNTIL_RAW_SQL = `select h.paid_until from household_member hm join household h
  on h.id = hm.household_id where hm.user_id = "user"."id"`;
export const PRO_UNTIL_RAW_SQL = `nullif(max(coalesce("user"."founder_until", 0),
  coalesce((${HOUSEHOLD_UNTIL_RAW_SQL}), 0)), 0)`;
export const proUntil = sql<Date | null>`${sql.raw(PRO_UNTIL_RAW_SQL)}`.mapWith(user.founderUntil);
```

Correction to the first draft: it interpolated `${user.id}` into the subquery. Drizzle writes a bare `"id"` in a
one-table select, and inside the subquery a bare `"id"` resolves to `household.id`, so the household date was always
null. The expression names `"user"."id"` explicitly, as `apps/server/src/admin-scans.ts` already does for its
correlated subqueries; it works as long as the user table is not aliased.

Then, at every site in the first table, replace `founderUntil: user.founderUntil` with `founderUntil: proUntil`.
`effectiveTier`, `premiumUnlocked`, `canHostChallenge` and `cloudUnlocked` keep their signatures; the row they get
already carries the later date. The raw-SQL sites (`reminders.ts`, `admin.ts`, `admin-scans.ts`) get the same
expression as a raw fragment exported next to it. The subquery hits `unique(user_id)` on `household_member` and the
primary key of `household`, so it is one index lookup per row [INFERENCE: cheap on D1; check with `EXPLAIN QUERY PLAN`].

To make sure no site is missed, `packages/api/src/lib/household-sites.test.ts` scans `packages/api/src` and
`apps/server/src` for `user.founderUntil` or `founder_until` on code lines and compares the count per file with an
allowlist that says why each raw read is right (billing credit/refund paths, admin edits, receipts, broadcast dates,
the person's own dates). A new raw read fails the test.

Raw reads that stay on purpose (beyond billing): `myProfile.founderUntil` (own period; the household comes apart as
`household`), the admin "founders" count (buyers, not members), the broadcast `{date}` merge field, the invite
screen's "your own Pro" card.

Extra changes beyond the swap:

- `joyoProStatus`: when the household date is the later one, answer `{ pro: true, until, plan: "keluarga", source:
  "keluarga" }`. Update the `plan`/`source` tables in `docs/joyo-pro.md` and tell JoyoArto (its `answerIsPro` reads
  `pro` and `until`, so it should work unchanged [INFERENCE: check `joyoarto/packages/api/src/lib/billing/joyo-pro.ts`]).
- `profile.ts`: add `household: { role, ownerName, until } | null` to the answer so clients can show "Pro dari Joyo
  Keluarga". Keep `founderUntil` as the person's own date.
- `founderEmailsDue`: add `coalesce(householdUntil, 0) <= founder_until` (built).
- The email "harga terkunci" line (`lockedMonthlyIdr`) counts a Keluarga row as half its amount, matching the shared
  lock (built).

### Expiry, renewal, refund, grace per rail

`household.paid_until` follows the same rules as `user.founder_until` does today on each rail. The credit code is the
same code with a different target row; the optimistic guard compares `household.paid_until` instead of
`user.founder_until`.

| Rail | Grant | Renewal | Refund / revoke | Grace / failure |
| --- | --- | --- | --- | --- |
| DOKU / Pakasir (rupiah) | `activateOrder`: months stack on the remaining period (`nextFounderUntil`) | none, one period; reminder mail 3 days before (owner only) | no reversal path today (`docs/revklik-forwarding.md`); manual via admin | none |
| Polar (card) | `order.paid`: 1 or 12 months stacked | Polar renews; each `order.paid` credits | `order.refunded` takes the months back (never below now); immediate `subscription.revoked` cuts to now | `subscription.past_due` recorded; no extra time |
| Apple | the store's `expiresDate` (`appleSubscriptionGrant`) | `DID_RENEW` | `REFUND` / `REVOKE` via `revokeAppleTransaction` | `DID_FAIL_TO_RENEW` records `grace` / `retry`, no extension (`handleAppleNotification`) |
| Google Play | per charged order, `addMonths` | RTDN renewal | voided order takes its months back (`addMonths(..., -months)`) | `grace` is an entitled state but grants nothing until Play charges (`docs/play-billing.md`) |

When a household's period ends, members keep their own `founder_until` if they have one.

## 4. Payment per rail

Shared server pieces:

- A product kind next to the plan: `type Product = "pro" | "keluarga"`. Each store/Polar mapping returns
  `{ product, plan }` instead of a bare `FounderPlan` (`APPLE_PRODUCTS` in `lib/apple.ts`, `GOOGLE_PLAY_PRODUCTS` in
  `lib/google-play.ts`, `polarProductPlan` in `lib/polar.ts`).
- A credit target: `product === "keluarga"` credits `household.paid_until` of the household the payer owns, created on
  first credit if missing. If a store purchase arrives for someone who is a *member* of another household, the server
  moves them out and makes them owner of a new one [INFERENCE: the store has already charged; refusing would strand
  the money]. Native blocks the buy button in that case, so this should be rare.
- `payment.product = 'keluarga'` on every Keluarga ledger row.

### 4.1 Web rupiah (DOKU, Pakasir)

- `POST /api/billing/checkout` takes `product: "keluarga"` next to `plan`. Item name "Joyo Keluarga 1 bulan" /
  "Joyo Keluarga 1 tahun". One period, no auto-renew, as today.
- Price (owner decision 1, 3): no new price vars. Keluarga = 2x the Pro amount this buyer would pay
  (`keluargaAmountIdr` in `lib/household.ts`), so it follows the `FOUNDER_PRICE_LADDER` step, or the flat
  `FOUNDER_PRICE_IDR` / `FOUNDER_YEARLY_PRICE_IDR` without a ladder.
- Price lock (owner decision 4, one lock shared with Pro): `grandfatheredMonthlyIdr` is fed every paid row of the buyer,
  with a Keluarga row counted as half its amount (`proEquivalentIdr`), for both plans. A Pro buyer at Rp15.000 gets
  Keluarga at Rp30.000; a Keluarga payer at Rp58.000 gets Pro at Rp29.000. (The first draft said per product; that
  was the option the owner did not pick.)
- Ladder count (decision 3): `ladderBuyers` counts distinct paying users, so a Keluarga payer counts once and members
  (who never pay) never count. No change was needed.
- No upgrade credit (decision 5): the payer's own `founder_until` is never touched by a Keluarga order.
- A member of someone else's household gets 409 at checkout; the owner renewing their own household is fine.
- `/api/config` adds `keluarga: { monthlyIdr, yearlyIdr, seats } | null` (null while the plan is off or no rupiah
  gateway is configured).
- Feature flag: `KELUARGA_ENABLED` var ("1"/"on"/"true"; `"off"` in `wrangler.jsonc`); off = checkout and every
  `household.*` procedure except `get` answer 404, `household.get` answers `enabled: false`, and the web hides every
  surface, the legal sections included.

### 4.2 Polar (card, outside Indonesia)

- Two new Polar products in org "Joyo Digitama Solusi": "Joyo Keluarga monthly" and "Joyo Keluarga yearly", USD
  prices (and MYR/SGD if the owner wants them, as for Pro). New vars `POLAR_PRODUCT_KELUARGA_MONTHLY_ID`,
  `POLAR_PRODUCT_KELUARGA_YEARLY_ID`, `POLAR_PRICE_KELUARGA_*`.
- `polar-billing.ts` today ignores every product that is not one of the two Pro products; it must map the two new ids
  to `product: "keluarga"`.
- The 409 "already has a live Polar subscription" check in `POST /api/billing/polar/checkout` must allow a Pro → Keluarga
  change through the customer portal instead. Whether the portal can switch between two different products [TO VERIFY
  in Polar's dashboard]; if not, the buyer cancels Pro and buys Keluarga.
- Proration charges already land as `months = 0`, Rp0 (`docs/pricing.md`, Polar ledger).

### 4.3 App Store

**Do not use Apple Family Sharing. Sell a separate auto-renewable subscription.** Reasons, from Apple's page
"Auto-renewable subscriptions" (https://developer.apple.com/app-store/subscriptions/, read 2026-11-17):

- Family Sharing shares a subscription "with up to five family members across their Apple devices": the Apple Family
  group, not people the payer chooses in JoyoRogo. Members on Android or web would get nothing.
- "You can enable Family Sharing for your subscription in App Store Connect. Please note that this can't be undone."
  Turning it on for the current `founder.*` products would give the Pro price to up to six people for good.
- Members of an Apple family get their own transactions; the app tells them apart by `ownershipType`. Our server binds
  one subscription to one JoyoRogo account (`linkSubscription` keyed on `originalTransactionId`, and
  `redeemAppleTransaction` refuses a mismatched `appAccountToken` with `other-account`) [INFERENCE: shared
  transactions would likely hit `other-account`; not tested].
- Apple's page also says that when a developer sells both shared and non-shared tiers they rank them within the same
  subscription level; we keep Family Sharing off on both.

Guideline text read 2026-11-17 (https://developer.apple.com/app-store/review/guidelines/):

- 3.1.3(c): "Consumer, single user, or family sales must use in-app purchase." So the iOS app must sell Keluarga with
  IAP if it sells it at all.
- 3.1.3(b): multiplatform services may let users access subscriptions "acquired in your app on other platforms or your
  web site ... provided those items are also available as in-app purchases within the app." A web-bought Keluarga
  working on iOS needs the IAP product to exist.
- 3.1.2(b): users "should not be able to inadvertently subscribe to multiple variations of the same thing." So put
  Keluarga in the **same** subscription group as Pro ("JoyoRogo Pro", group id 22482392 in `docs/pricing.md`), ranked
  above Pro, so a Pro subscriber upgrades instead of holding both.
- 3.1.1 allows gifting IAP items to others. No guideline text I read says whether one account's IAP may unlock Pro on
  *other* JoyoRogo accounts. [TO VERIFY: ask App Review through App Store Connect "Contact Us" before submitting; the
  JoyoArto 3.1.1 rejection in `docs/joyo-pro.md` shows review reads these flows closely.]
- How an upgrade inside a group bills (immediate, prorated refund) [TO VERIFY in Apple's "Offering auto-renewable
  subscriptions" docs; not read for this design].

New products (owner creates in App Store Connect, app 6823222101):

- `com.joyodigitama.joyorogo.keluarga.monthly`, `com.joyodigitama.joyorogo.keluarga.yearly`; group "JoyoRogo Pro";
  level above `founder.*`; Family Sharing **off**; display name "Joyo Keluarga". IDN price per section 8; other
  territories [owner decision]. Check that the chosen rupiah amount exists as an IDN price point [TO VERIFY].
- Add both to `APPLE_PRODUCTS` with `product: "keluarga"`.
- JoyoFit and JoyoArto iOS apps: no Keluarga products in phase 1. Members are Pro there anyway. Those apps should show
  "Pro aktif (Joyo Keluarga)" only, with no manage or buy screen for Keluarga [TO VERIFY with review: a household
  member on JoyoArto iOS sees Pro bought elsewhere; JoyoArto already sells Pro via IAP, which 3.1.3(b) asks for].
- Defensive guard: in `redeemAppleTransaction`, credit only `inAppOwnershipType === "PURCHASED"` transactions, so a
  Family Sharing toggle switched on by mistake cannot mint time.

### 4.4 Google Play

Google Play has no store-side family sharing for this case: its Family Library help page says "You can't share in-app
purchases and apps downloaded at no charge with your family members" (https://support.google.com/googleplay/answer/7007852,
read 2026-11-17). So Keluarga is our own seat model on Play too.

New product (owner creates in Play Console, `com.joyodigitama.joyorogo`): subscription `keluarga`, base plans
`monthly` and `yearly`, auto-renewing, ID price per section 8, same grace and account-hold defaults as `pro`
(`docs/play-billing.md`). Add `keluarga: { monthly: ..., yearly: ... }` under the package in `GOOGLE_PLAY_PRODUCTS`.
Pro → Keluarga on Android uses Play's subscription replacement [TO VERIFY: replacement mode and proration with a
different product id]. No Keluarga products in the JoyoFit Play app in phase 1.

### 4.5 Consoles: what the owner creates

| Where | What |
| --- | --- |
| App Store Connect (JoyoRogo) | 2 auto-renewable subscriptions in group "JoyoRogo Pro", Family Sharing off, prices, review screenshot, review note explaining seats |
| Play Console (JoyoRogo) | subscription `keluarga` with base plans `monthly`, `yearly`; prices |
| Polar | 2 products, prices (USD, optional MYR/SGD), add to the webhook's product scope (same endpoint) |
| `apps/server/wrangler.jsonc` | `KELUARGA_ENABLED` (already there, `"off"`), later the Polar ids and display prices |

## 5. UI touch points

Web (`apps/web`):

- `/harga` (`src/routes/harga.tsx`): a second column "Joyo Keluarga" next to Pro: "Pro untuk sampai 5 orang dalam
  satu rumah. Satu yang bayar." Benefit list = the Pro list (`PRO_BENEFIT_GROUPS`) plus three plan-level lines:
  seats, invite by link, each person's diary stays private. FAQ items: "Apakah keluarga bisa melihat catatan makanku?"
  (no), "Bagaimana kalau aku sudah Pro?" (section 2), "Kalau yang bayar berhenti?" (Pro off for all at period end).
  Same for the landing pricing block and `/my`, `/sg` only if Polar Keluarga prices exist.
- `/pro` (`src/routes/_auth/pro.tsx`) and the shared paywall: a Pro / Keluarga switch above the monthly/yearly
  switch. Default stays Pro. `?plan=keluarga` preselects it (for links from the Keluarga screen).
- `/pembayaran`: success copy "Joyo Keluarga aktif. Undang keluargamu" with a button to the Keluarga screen.
- Profil > Langganan (`src/routes/_auth/profil.langganan.tsx`, `src/components/profil/subscription-screen.tsx`):
  - Owner: seats used (x/5), member list (name, photo, joined date, Hapus), pending invites (expires in n days,
    Batalkan), "Undang" (share sheet via a `shareKeluargaInvite` modelled on `shareInvite` in
    `src/lib/group-invite.ts`), renewal row per rail as today.
  - Member: "Pro dari Joyo Keluarga <owner>, sampai X", "Keluar dari keluarga", and their own Pro row if any
    (section 2).
- `/keluarga/$code` (new): preview, the "you already pay Pro" card, Gabung, and sign-in redirect for signed-out users
  (the `_auth` guard keeps the query, `docs/joyo-pro.md`).
- `/privasi`: new section `#joyo-keluarga` (what the owner sees, what nobody sees), and `/syarat` (seat rules, owner pays,
  members lose Pro when the owner stops). `/my` legal pages too (`src/lib/legal-my.ts`).

Native (`apps/native`):

- Paywall `app/founder.tsx` and `components/billing.tsx`: add the Keluarga store products next to
  `com.joyodigitama.joyorogo.founder.monthly/yearly` (line ~330) and the Play `keluarga` product. iOS shows only IAP
  prices, never web prices or Polar (as today).
- `app/profil/langganan.tsx`: the same owner/member screens as web.
- `app/keluarga/[code].tsx` and `src/lib/native-intent-path.ts` for the deep link.
- Block "Beli Keluarga" while the person is a member of another household.

Server routes: a new oRPC router `packages/api/src/routers/household.ts` with `get`, `createInvite`, `cancelInvite`,
`preview` (public, rate limited), `accept`, `leave`, `removeMember`. Owner-only checks as in `routers/group.ts`.

## 6. Analytics and RevKlik

- RevKlik events today carry `props: { plan: "monthly" | "yearly" | "proration", months, environment }`
  (`buildLedgerEvent` in `packages/api/src/lib/revklik.ts`).
- For `payment.product = 'keluarga'` rows: `props.plan = "keluarga"`, plus `props.period = "monthly" | "yearly"`
  (or `"proration"`), `months`, `environment`. Pro rows stay exactly as now, so existing RevKlik reports do not change.
  `product` stays `"joyorogo"`; `rail` and `source` unchanged.
- Nothing else is added: no seat count, no member ids, no emails, no household id. The ledger keeps no new personal
  data; the household tables hold only what seat management needs.
- Web client events (`apps/web/src/lib/billing.ts`, `src/routes/pembayaran.tsx`): `checkout_start` and
  `founder_purchase` get `plan: "keluarga"` on Keluarga checkouts (no revenue; the server stays the only revenue source,
  `docs/revklik-forwarding.md`). Two plain counters with no props: `keluarga_invite_sent`, `keluarga_invite_accepted`.
- Admin: Orders list method label "Keluarga" (`apps/admin/src/sections/Orders.tsx`), user detail shows household role.

## 7. Marketing copy constraints (claim ledger)

From `docs/marketing/marketing-plan.md` section 1.1, applied to Keluarga:

- Never "akurat", "pasti", "100%" or an accuracy percentage for scans.
- No kg-per-week or "turun X kg" promises, for one person or a family. No medical outcomes.
- Never call a watch supported unless it was tested (JoyoFit Keluarga monitoring is Huawei-watch based per JoyoFit's
  doc; name no other brand for it).
- Never say Keluarga is available in the App Store or Google Play before the products are live and the release entry
  says so. Until then: "lewat web (QRIS/transfer)".
- Price copy only from `/api/config` the same day. No "harga naik besok" unless tied to a real buyer count.
- Say "sampai 5 orang dalam satu rumah, termasuk kamu". Do not say "unlimited family" or "semua keluarga".
- Say "catatan tiap orang tetap pribadi". Do not imply the payer can see members' food or health data.
- QRIS/transfer: "tidak diperpanjang otomatis"; card and stores: "diperpanjang otomatis, bisa dibatalkan kapan saja".
- New line for the claim ledger table when this ships: "Joyo Keluarga: satu pembayar, Pro untuk sampai 5 akun |
  `household.ts`, `HOUSEHOLD_MAX_SEATS`, `proUntil` | that members see each other's diary; that JoyoArto or JoyoFit
  data is shared".

## 8. Owner decisions

**Decided by the owner on 2026-11-17:**

| # | Decision |
| --- | --- |
| 1, 3 | **Price option C, tied to the ladder:** Keluarga is always 2x the current Pro step (step 2 today: Rp58.000/bulan, Rp398.000/tahun; step 3: Rp98.000 / Rp698.000). No separate Keluarga ladder. Derive it from `FOUNDER_PRICE_LADDER` in code, never a second ladder var. A Keluarga payer counts once in `ladderBuyers`, members never (recommendation, not contested). |
| 2 | **5 seats** including the payer. |
| 4 | **One price lock shared with Pro:** whoever has paid for either plan keeps the lowest Pro step they ever paid, and Keluarga is 2x that step. |
| 5–9 | The owner agreed to the design as written, so the recommendations stand: no upgrade credit on web rupiah (show the warning); churn limit 8 joins per 12 months beyond the first fill; launch order web rupiah, Polar, Google Play, then App Store after App Review answers; store prices Indonesia first; the owner cannot leave in phase 1. |

The options considered are kept below for the record.

1. **Price.** Options, relative to the current ladder (now step 2: Rp29.000 / Rp199.000 for Pro; step 3 Rp49.000 /
   Rp349.000):

   | Option | Monthly | Yearly | Per person at 5 seats (yearly) | Reasoning |
   | --- | --- | --- | --- | --- |
   | A. 2x Pro step 2 | Rp59.000 | Rp399.000 | Rp79.800 | Easy to explain ("dua kali Pro, untuk lima orang"). Beats separate Pro yearly from 3 people at step 2 (3 x Rp199.000), from 2 people at step 3 (2 x Rp349.000). |
   | B. 2.5x Pro step 2 | Rp69.000 | Rp499.000 | Rp99.800 | Leaves room for a launch promo. Still under 2 Pro yearly at step 3 (2 x Rp349.000). |
   | C. Tied to the ladder: 2x the current Pro step | Rp58k → Rp98k | Rp398k → Rp698k | grows with the step | Moves with Pro automatically on web; store prices must be changed by hand at each step (as for Pro, `docs/pricing.md` runbook). |

   One cited reference point: Spotify's Indonesian page lists Premium Standard at Rp59.900/bulan for 1 account and
   Premium Platinum at Rp119.900/bulan for up to 3 accounts, limited to people "yang tinggal di alamat yang sama"
   (https://www.spotify.com/id-id/premium/, read 2026-11-17): the multi-account plan is 2x the single plan.
   Cost side: AI scans are estimated at Rp5 each (`RP_PER_SCAN_ESTIMATE`, `lib/cost.ts`) with a Pro cap of 100 a day
   (`FOUNDER_DAILY_CAP`), so even 5 heavy users cost little next to any option [INFERENCE: real usage is far below
   the cap].
2. **Seat count.** 5 including the payer (the brief). Apple Family Sharing and Google Family Library both use the payer
   plus 5; 6 is an option.
3. **Ladder.** (a) flat Keluarga price; (b) its own ladder; (c) a multiple of the Pro step (option C). And: does a
   Keluarga payer count as a buyer in `ladderBuyers` (`apps/server/src/billing.ts`)? Recommendation: payer counts once,
   members never.
4. **Price lock.** Per product (recommended), or one lock across Pro and Keluarga.
5. **Upgrade credit on web rupiah.** Credit a payer's remaining own Pro days to the household, or not (recommended: not;
   show the warning).
6. **Seat churn limit.** 8 joins per 12 months beyond the first fill, another number, or none.
7. **Launch rails.** Recommended order: web rupiah first, then Polar, then Google Play, then App Store after App Review
   answers the cross-account question.
8. **Store prices outside Indonesia** for the new products (USD and equalized, as Pro, or Indonesia only at first).
9. **Owner leaving.** Confirm "owner cannot leave; delete or stop renewal" (no ownership transfer in phase 1).

## 9. Build plan

S = up to 1 day, M = 2 to 4 days, L = 5+ days (one developer).

| Phase | Scope | Effort |
| --- | --- | --- |
| 0 | Owner decisions (section 8). Ask App Review the cross-account question. | S (owner) |
| 1 | Schema + migration (`household`, `household_member`, `household_invite`, `household_event`, `payment.product`); `proUntil` expression; swap every read site in section 3; `founderEmailsDue` exclusion; `joyoProStatus` source `keluarga`; grep test for missed sites; tests for leave/remove/expiry. Ships dark (no way to buy). | M |
| 2 | `routers/household.ts` (invite, preview, accept, leave, remove, cancel); seat and churn limits; account deletion cleanup in `lib/privacy.ts`; notices and the removal email. | M |
| 3 | Web rupiah: `product` in checkout, per-product price lock, `/api/config.keluarga`, `KELUARGA_ENABLED`; `/harga`, `/pro`, `/pembayaran`, Profil > Langganan, `/keluarga/$code`; privacy and terms text; RevKlik props; admin labels. **Launch point 1.** | L |
| 4 | Polar products and webhook mapping; Pro → Keluarga via portal or cancel-and-buy. | S to M |
| 5 | Native: Langganan screens, deep link, paywall switch (web/Android first). Google Play product, mapping, replacement flow; Play review. | M |
| 6 | App Store products, `APPLE_PRODUCTS`, `inAppOwnershipType` guard, review note; submit. Depends on the App Review answer. | M |
| 7 | Sibling apps: JoyoArto copy for `source: "keluarga"`; JoyoFit check that `family/users` reflects household Pro; optional links to JoyoArto household and JoyoFit monitoring. | S |

Total about 3 to 4 weeks of one developer [INFERENCE], with store review time on top.

## 10. What was built (phases 1 to 3)

All behind `KELUARGA_ENABLED` (off). Nothing deployed, no migration run against remote, no store or Polar products.

| Phase | Built | Where |
| --- | --- | --- |
| 1 | Schema and migration 0076; `proUntil` / `PRO_UNTIL_RAW_SQL` swapped into every gate of section 3 (quota, cloud, readiness, challenge host, fitness, sleep insights, social, profile scan allowance, plan reminder, Strava release, JoyoFit family, admin tier and scans plan); `joyoProStatus` source `keluarga`; `myProfile.household`; expiry mails skip household-covered people; grep test | `packages/db/src/schema/household.ts`, `packages/api/src/lib/household.ts`, `household-sites.test.ts` |
| 2 | `household.get / createInvite / cancelInvite / preview / accept / leave / removeMember`; seats (members + pending invites <= 5); churn limit; one household per account; owner cannot leave; in-app notices (push category `group`, link `langganan`); account deletion removes the owner's household and notifies members | `packages/api/src/routers/household.ts`, `routers/privacy.ts` |
| 3 | Web rupiah checkout with `product: "keluarga"`, shared price lock, household credit with the same optimistic guard as `activateOrder`; `/api/config.keluarga`; receipt and admin mail; RevKlik `plan: "keluarga"` + `period`; admin order label; web `/pro` switch, `/pembayaran`, Profil > Langganan, `/keluarga/$code`, `/harga`, `/privasi#joyo-keluarga`, `/syarat#joyo-keluarga`; invite codes cut out of RevKlik like `/gabung` | `apps/server/src/billing.ts`, `apps/web/src/...` |

Not built in phases 1 to 3, still open:

- The removal email (in-app notice only, see section 2).
- A reminder mail to the owner 3 days before the household period ends (section 3 table).
- The deletion screen line about store subscriptions (no store Keluarga exists yet, so it is not needed before phase 5).
- Admin user detail showing the household role.
- `/my` legal pages: Keluarga is not sold in ringgit, so nothing there yet.
- Link previews (OG cards) for `/keluarga/<code>`: the page uses the generic head.
- Phases 4 to 7.
