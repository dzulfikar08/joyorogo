# Conversion audit: JoyoRogo, JoyoFit, Joyo Pro (17 Nov 2026)

Scope: the product's own surfaces, the path a visitor or a download takes to becoming an active, paying Joyo Pro
user. Social content is out of scope (`growth-reset-2026-11.md` owns it). Every line below follows the claim ledger in
`marketing-plan.md` 1.1 and the wording rules in `social-playbook.md`.

Sources:
- Nevo David's playbooks, through the `nevos-brain` MCP.
- Postiz's own site.
- RevenueCat's State of Subscription Apps 2026 and Apple's developer documentation.
- Revklik (site JoyoRogo, last 30 days) and the code in both repos as of `origin/main` / `origin/master` on 17 Nov 2026.

---

## 1. What the numbers say (Revklik, 18 Oct to 17 Nov 2026)

| Metric | Value |
| --- | --- |
| Visitors | 645 |
| Pageviews | 1,339 |
| Bounce rate | 34% |
| Sales | 17 (Rp663.000 gross, Rp580.138 net), almost all Rp29.000 monthly |
| Revenue by source | 100% "direct" |
| Visitors on `/harga` | 21 |
| Visitors on `/login` | 73 |
| Referrers | direct 58%, Threads 17%, Google 9%, GitHub 4%, Facebook 3%, ChatGPT 3% |

Findings:

1. **Revenue cannot be traced to a page or a channel.** All 17 sales show as "direct".
   - The server forwards each paid order (`packages/api/src/lib/revklik.ts`), but nothing ties it to the visit that led to it.
   - Nevo moved Postiz off Plausible to DataFast for exactly this reason: to see which blog pages and free tools make money, then invest in those ([X, Feb 2026](https://x.com/wickedguro/status/2022361200932315279)).
2. **`checkout_start` from the in-app paywall is probably lost.** It is a plain event, and the inline filter (`apps/web/blog/revklik.ts`, `TRACKED_PATHS`) only passes plain events on marketing paths. `/pro`, where onboarding, quota and banners send people, is not one of them. Read from the code, not confirmed in Revklik.
3. **The "JoyoRogo" Revklik site is mostly JoyoFit traffic.**
   - fit.joyorogo.com loads the same tag, and the export's `hostname` column is empty, so the two sites can't be split.
   - In the last 1,000 events (12 to 17 Nov), the top click was "JoyoFit untuk Android" on Google Play (44 clicks, counting the Chinese-language page).
   - "Unduh di Google Play" for JoyoRogo got 1 click, and "Ambil JoyoRogo Pro" on the JoyoFit site got 1.
4. **Search only works for the brand name.**
   - Google Search Console: "joyorogo" gets 13 clicks at position 1, and "joyofit" and "joyofit github" a few.
   - Every food query ("kalori 1 gorengan tempe", "kalori mie ayam pangsit", "kalori kopi susu gula aren") sits at position 26 to 98 with 1 impression.
   - Nevo: SEO pays off once a page reaches the top results for a long-tail query; a new domain needs backlinks first ([Research vs browse](https://www.youtube.com/watch?v=V7CAsrkK4ys)).
5. **The funnel narrows hardest between the landing page and pricing.** 503 visitors saw `/`, 21 saw `/harga`. Most buyers reach the paywall inside the app (onboarding, quota), which Revklik cannot see (item 2).

---

## 2. Ranked list

Impact is my estimate of the effect on paying users. Effort: S = under half a day, M = 1–3 days, L = more.
"Done" means implemented in this branch (section 4). "Owner" means it needs a decision from you (section 5).

| # | Change | Surface | Impact | Effort | Status | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Onboarding ends at the first photo scan, not at Beranda | Web onboarding | High | S | Done (web); native: owner | Nevo: push onboarding to the first success, not just "connect" ([X, Nov 2025](https://x.com/wickedguro/status/1995059114465243523)); RevenueCat: "deliver an aha! moment in the first 60 minutes" ([SOSA 2026 summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)) |
| 2 | Paywall sells outcomes, not scan counts; trust notes next to the button | `/pro` (web), native paywall subheads | High | S | Done | Nevo: sell outcomes, not the tool ([X, Sep 2026](https://x.com/wickedguro/status/2099802787542638837)); plan and payment on one page with credibility elements ([X, Jan 2026](https://x.com/wickedguro/status/2017216658251673996)); don't separate tiers by one metric ([gitroom](https://gitroom.com/blog/opensource-pricing)) |
| 3 | Make revenue traceable to its page and channel | Revklik, checkout | High | M | Owner | Nevo on attribution ([X, Feb 2026](https://x.com/wickedguro/status/2022361200932315279)) |
| 4 | Outcome video on the homepage, and the same video in onboarding and on the paywall | Landing, onboarding | High | M (needs footage) | Owner | Postiz added a homepage video showing what users can achieve, then the same video as an onboarding step; revenue went from $15k to $18k without more traffic ([X, Jan 2026](https://x.com/wickedguro/status/2017216658251673996)) |
| 5 | Free trial on the store yearly plan (test) | App Store, Play | High | S (console) | Owner | RevenueCat 2026: in Health & Fitness, trial-to-paid median is 37.7%, and 82.1% of trials start on install day; freemium download-to-paid by day 35 is 2.1% against 10.7% for hard paywalls ([SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)); 5–9-day trials beat 10–16 in fitness ([trial length](https://www.revenuecat.com/blog/growth/free-trial-length)). Nevo: free tier gets more users, trial converts better ([pricing talk](https://www.youtube.com/watch?v=6Mu7JKgegek)) |
| 6 | "Alternatif X" and "X vs JoyoRogo" pages | Blog | Medium | S each | 1 done | Postiz runs `/alternatives` and `/compare` hubs ([postiz.com/alternatives](https://postiz.com/alternatives)); mirrord sent competitor-keyword ads to a comparison page ([interview](https://www.youtube.com/watch?v=B8TvTSpA44E)); competitors rank "Postiz vs X" content ([X, Jul 2026](https://x.com/wickedguro/status/2072625864685359612)) |
| 7 | Fix stale price and "tanpa batas" claim in a blog post; JoyoRogo Pro → Joyo Pro in posts | Blog | Medium (claim risk) | S | Done | Claim ledger 1.1 |
| 8 | JoyoFit site: price from `/api/config`, "Joyo Pro" name, JoyoArto in the bundle | fit.joyorogo.com | Medium | S | Done (build-time) | Claim ledger 1.1 ("prices follow the ladder") |
| 9 | Cancellation and win-back offer for people who paid at least one month | Profil > Langganan, Polar, stores | Medium | M | Owner | Nevo's Postiz plan: 50% off the next 3 months for anyone who paid a month ([X, Nov 2025](https://x.com/wickedguro/status/1995059114465243523)); RevenueCat: run win-back in the first two months ([SOSA 2026 summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)) |
| 10 | Google Play grace period and account hold, checked on | Play Console | Medium | S | Owner | RevenueCat 2026: billing failures cause 31% of Play cancellations, and retries and grace periods recover 15–20% of that revenue ([SOSA 2026 summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)) |
| 11 | Short tutorial clip per feature on each `panduan` page | Blog, `/panduan` | Medium | M | Open | Nevo: proper FAQ and YouTube tutorials for every product section ([X, Nov 2025](https://x.com/wickedguro/status/1995059114465243523)) |
| 12 | JoyoFit → Joyo Pro path: outcome copy in the JoyoFit onboarding Pro step and the site's Pro card | JoyoFit app, site | Medium | S | Open (app build) | JoyoFit sends most of the traffic (section 1); same sources as #2 |
| 13 | A second paid tier, e.g. for a group host, PT or family | Pricing | Medium | L | Owner | Nevo: avoid a two-package structure because LTV can't grow; add features per tier ([gitroom](https://gitroom.com/blog/opensource-pricing)) |
| 14 | Apple custom product pages per audience (diet bareng, Ramadan, warteg) | App Store | Low–Medium | S (no build) | Owner | Up to 70 pages, each with its own screenshots, promotional text and keywords; Apple reports +2.5 points of conversion on average ([Apple](https://developer.apple.com/app-store/custom-product-pages/)) |
| 15 | Store the App Store subtitle, keywords and description in the repo, like `docs/play-store.md` | Docs | Low | S | Open | Needed to audit or test listing copy at all |
| 16 | Add fit.joyorogo.com to the API's `CORS_ORIGIN` so the site can show the live price and slot count | Server config | Low | S | Owner (deploy) | Build-time price (item 8) goes stale between deploys |
| 17 | Auto-applied coupon on the paywall | `/pro` | Unknown | S | Owner, not recommended now | Postiz auto-applies 20% for urgency ([X, Jan 2026](https://x.com/wickedguro/status/2017216658251673996)). The buyer ladder already gives honest urgency ("sisa N slot", 31 of 60 taken on 17 Nov), and the ledger bans countdowns not tied to the buyer count |

Already in place, and matching the playbooks (no change needed):

- **Streak warning before it breaks:** an evening push at 20:00–20:45 when a streak of 3+ days is at risk (`packages/api/src/lib/reminders.ts`). Postiz does the same by email two hours before expiry ([X, Jan 2026](https://x.com/wickedguro/status/2017216658251673996)).
- **Pricing page:** public, with a comparison table and FAQ. Nevo: always have one ([pricing talk](https://www.youtube.com/watch?v=6Mu7JKgegek)).
- **Yearly plan:** selected by default on `/pro` and highlighted on `/harga`. RevenueCat warns that 35% of annual cancellations happen in month 1, so the first week decides year 2 ([SOSA 2026 summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)); this is another reason for item 1.
- **Landing hero:** names a pain and an outcome ("Diet yang paham porsi warteg"), in line with Nevo's headline rules ([gitroom](https://gitroom.com/blog/perfect-company-messaging)).
- **Guest scan without signing up:** `ANON_SCANS`, `#coba`. This is the "just in time auth" idea ([X, Mar 2026](https://x.com/wickedguro/status/2035008532026990633)).

---

## 3. Per surface

### 3.1 joyorogo.com landing (`apps/web/src/routes/index.tsx`)

- **Strong:** the hero copy, the try-without-signup scan, and honest facts ("8-15 detik", TKPI, no stored photos).
- **Gap:** no video. The page shows the app (screenshots, the scan demo), not the outcome (a friend's colek arriving, a week of logging that took seconds per meal). Nevo's version is a short video of what users achieve, placed on the homepage and again inside onboarding (#4). The founder shoot in `growth-reset-2026-11.md` section 3 can supply the footage: one 30–45 s cut of real use, with no body shots and nothing about kilograms.
- **Gap:** the pricing block said "Pro membantu JoyoRogo tetap independen", which asks for support instead of naming what Pro gets you. Changed to outcome copy (section 4).
- **Order:** the page has 20 sections. Pricing sits 16th, and only 21 of 503 visitors reached `/harga`.
  - Don't move pricing up blindly. Instead, add the video (#4) and measure how many visitors reach the pricing section. The landing sections carry `data-section`, and `scroll_section` events arrive in Revklik, but until the hostname is split (finding 3) they can't be told apart from the JoyoFit site's.
  - Treat this as a test, not a rewrite.

### 3.2 `/harga` and `/pro` (Pro paywall)

- **One page already:** `/pro` puts plan choice and payment in one place (yearly/monthly toggle, then a QRIS/transfer picker), which is what Nevo describes. `/harga` is the comparison page and sends people to checkout from its cards.
- **Gap:** every subhead was about scan counts ("Pro dapat scan AI jauh lebih banyak"). Nevo warns against tiers that differ by one metric, because people upgrade only when they hit the limit.
  - Rewritten to the outcome: every meal by photo, a weekly menu with a shopping list, JoyoFit backup.
  - The quota subhead now also says manual logging stays free, which is true and lowers the "am I trapped" worry.
- **Gap:** nothing next to the button answered "is this safe to pay".
  - Added three rupiah-only notes: the price lock (`docs/pricing.md` grandfathering), no ads plus open source, and a link to the refund policy.
  - No refund promise is made beyond the existing policy.
- **Coupon (#17):** not done, owner decision. Recommendation: don't add one while the ladder is running.

### 3.3 Onboarding (web `apps/web/src/routes/_auth/onboarding.tsx`, native `apps/native/app/onboarding.tsx`)

- **Before:** profile questions, result screen, "Buka Beranda", the skippable paywall, then Beranda.
  - Beranda is a dashboard of zeros for a new account.
  - The activation metric in `marketing-plan.md` 11.3 is logging food on 3+ days, which starts with the first log.
- **Web after:** the button reads "Lanjut: foto makan pertamamu". It still shows the paywall first, so day-0 buyers are not lost (RevenueCat: 82.1% of Health & Fitness trials start on install day). "Nanti saja" and the invite step's skip now land on `/makan/ai` instead of Beranda.
- **Native:** same change needed in `startApp` and in what `founder.tsx` does on dismiss. Not done: native code is out of scope for this branch, and it needs a build or OTA.
- **Measure:** first-day food logs per new account (SQL in `marketing-plan.md` 11.4, filtered to `created_at >= <deploy>`), compared with the two weeks before.

### 3.4 Blog and SEO (`apps/web/blog`)

- **Comparison pages: none existed.** Added `alternatif-myfitnesspal-makanan-indonesia`.
  - MyFitnessPal's features and prices are quoted from its own Premium page, read on 17 Nov 2026 (IDR 149,000/month, IDR 599,000/year, 7-day trial, auto-renew; barcode scan, meal scan, voice log, ad-free and intermittent fasting are Premium-only).
  - JoyoRogo's side uses only ledger claims, and prices are given as a ceiling ("di bawah Rp50.000/bulan", true on every step of the ladder) plus a link to `/harga`, so the page can't go stale like the post fixed below.
- **Next pages:** FatSecret (its Premium page returned 403 to my fetch, so I didn't quote it) and a neutral guide, "aplikasi hitung kalori untuk makanan Indonesia: cara memilih".
  - A page naming Pantau Kalori is your call (section 5): it is the closest lookalike (`marketing-plan.md` section 0).
- **Stale claim fixed:** `catat-kalori-lewat-foto-dan-cerita` said "Paket Pro Rp15.000 per bulan membuka scan tanpa batas". That price is two ladder steps old, and Pro is capped at 100 scans a day.
- **Rank:** food posts sit at positions 26–98. Nevo's fix is backlinks to the pages that almost rank, and borrowing authority (Medium, dev.to) while the domain is young ([Research vs browse](https://www.youtube.com/watch?v=V7CAsrkK4ys); [X, Nov 2025](https://x.com/wickedguro/status/1992878156886560794)). Not a code change.
- **CTA card:** offers sign-up and the guest scan. It is fine as is. Revenue per post needs #3 first.

### 3.5 fit.joyorogo.com (`joyofit/site`)

- **Traffic:** this is the suite's real front door right now (section 1, finding 3).
- **Problem:** the Pro card hardcoded "Rp29.000 / Rp199.000 / Rp49.000 / 60 slots / ~Rp16.600" and the old name "JoyoRogo Pro", and its bundle line left out JoyoArto. Fixed in the joyofit PR (section 4).
- **Limit:** the price is read at build time, because the API refuses fit.joyorogo.com in CORS (#16).
- **Copy:** the Pro card lists eight features. Lead with the one outcome JoyoFit owners care about (their watch data is backed up and comes back on a new phone), then the rest (#12).

### 3.6 apps/fit (app.fit.joyorogo.com)

- **Pro wall** (`apps/fit/src/components/pro-wall.tsx`): one line and a "Lihat harga Pro" button to `/harga`.
- **Gap:** it says what is blocked, not what you get. Show one screenshot of the dashboard with your own data blurred, and link to `/pro?from=joyofit` (one-page checkout) instead of `/harga` (comparison).
- **Effort:** S. Not done, because `/pro` needs a JoyoRogo session on joyorogo.com, which a JoyoFit-web visitor may not have. Check sign-in hand-off first.

### 3.7 Store listings

- **JoyoRogo Play** (`docs/play-store.md` section 4): the short description "Foto makananmu, hitung kalorinya, dan capai target berat bareng teman." is fine.
- **JoyoRogo App Store:** the listing text is not in the repo, so it can't be audited (#15).
- **Custom product pages (#14)** let one listing speak to three audiences without a build, for example:
  - "diet bareng teman" for invite links;
  - Ramadan, from January;
  - "kalori warteg" for food-content traffic.

### 3.8 Retention, cancellation, streaks

- **Cancellation today:**
  - Web rupiah is one-off, with no renewal to cancel.
  - Polar, Play and Apple cancellations go to their own portals.
  - There is no in-app moment to ask why or to make an offer.
- **Proposal (#9):**
  - A "Kenapa berhenti?" step before the portal link: one tap from 4 reasons, stored with the account.
  - For accounts that paid at least one month, an offer.
  - For rupiah buyers whose period is ending, a reminder 3 days before with a "Perpanjang" link. They have no auto-renew, so their churn is passive.
  - Needs your decision on the offer and on storing the reason.
- **Churn measurement:**
  - Nevo measures churn only for customers who paid at least once, and per ICP cohort, not globally ([X, Oct 2026](https://x.com/wickedguro/status/2110786062490431852)).
  - With 17 sales a month, track renewal per buyer by hand for now: Admin > Orders, ladder step, renewed yes/no.

---

## 4. Implemented in this round

joyorogo (branch `marketing/conversion-audit-2026-11`):

1. **`/pro` and native paywall copy** (`packages/i18n/src/locales/{id,en,ms}/billing.json`, `paywall.subhead.*`):
   - Outcome-led subheads for onboarding, quota, banner, profile, scanleft and streak.
   - The native paywall reads the same keys, so it picks them up in the next build or OTA.
2. **Trust notes on `/pro`** for rupiah buyers (`paywall.trust.*`, `apps/web/src/routes/_auth/pro.tsx`): price lock, no ads plus open source, and the refund policy link.
3. **Onboarding ends at the first scan** (`apps/web/src/routes/_auth/onboarding.tsx`, `ONBOARDING_NEXT` in `apps/web/src/lib/paywall-search.ts`): the button reads "Lanjut: foto makan pertamamu", and after the skippable paywall the user lands on `/makan/ai`. Test: `apps/web/src/lib/paywall-search.test.ts`.
4. **Landing pricing block:** outcome copy instead of "Pro membantu JoyoRogo tetap independen".
5. **Blog:** new `alternatif-myfitnesspal-makanan-indonesia` (with FAQPage JSON-LD); stale price and "tanpa batas" removed from `catat-kalori-lewat-foto-dan-cerita`; JoyoRogo Pro → Joyo Pro in two posts.

joyofit (branch `marketing/site-joyo-pro-price`):

1. **Live price at build time:** `site/src/joyo-price.ts`, read by `site/vite.config.ts`, with a fallback to the 17 Nov values. Test: `site/scripts/joyo-price.test.ts`.
2. **"Joyo Pro" on the site:** landing, FAQ, Panduan, support line and blog. `Privasi.tsx` is left for you (a versioned legal page).

No release entry: none of these adds or changes a feature. They are copy, a marketing page and a price that now follows the existing ladder.

---

## 5. Decisions for you

1. **Attribution (#3):**
   - Allow `checkout_start` through the Revklik filter from `/pro` (event name only, path normalised to `/pro`, no ids).
   - Find out why forwarded sales lose their visitor (all "direct").
   - Add `hostname` to the tag or split fit.joyorogo.com into its own Revklik site.
   - Each of these changes what is collected, so it's your call.
2. **Homepage and onboarding video (#4):** cut one 30–45 s outcome video from the founder shoot, then place it on the landing hero, the onboarding result screen and `/pro`.
3. **Trial (#5):** test a 7-day free trial on the store yearly plan only (App Store introductory offer, Play free trial). Rupiah web stays as is. This is a pricing change, so it's yours.
4. **Cancellation offer (#9):** whether to offer one (e.g. 50% off 3 months to anyone who paid a month), and whether to store the cancellation reason.
5. **Play grace period and account hold (#10):** a Play Console setting, no code.
6. **Native onboarding:** the same first-scan change in `apps/native/app/onboarding.tsx` and `founder.tsx` dismissal, in the next build.
7. **Comparison pages naming Pantau Kalori:** yes or no. If yes, quote only their public page with a date.
8. **A second paid tier (#13):** e.g. a group or PT tier. Nevo's argument is LTV, but with 17 sales a month this can wait until the trial test reads out.
9. **CORS (#16):** add `https://fit.joyorogo.com` to `CORS_ORIGIN` so the JoyoFit site can show the live price and slots without a rebuild.
10. **Coupon (#17):** recommended no while the ladder runs.
