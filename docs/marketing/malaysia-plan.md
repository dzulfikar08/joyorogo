# JoyoRogo in Malaysia: what is built, what is decided, what is left

Written 2026-10-21. Research dates and URL access dates are 2026-10-21. Nothing here is legal or tax advice. `[UNVERIFIED]` means a primary source could not be read; `[INFERENCE]` means reasoning, not a source statement. Nothing in this plan is deployed, published to a store, or sent by OTA: every user-visible item is `available: code` in `releases/` (JRG-351, JRG-352, JRG-353, JRG-355).

## 0. Status at a glance

| Area | State | Where |
| --- | --- | --- |
| Bahasa Melayu `ms` locale (42 namespaces, 0 missing keys vs `id`) | Built, machine draft, not reviewed by a native speaker | `packages/i18n/src/locales/ms/` |
| Detection (`ms`, `ms-MY`, `zsm`, Malaysian region) | Built and tested | `packages/i18n/src/locale.ts` |
| `kcal`, `ms-MY` numbers and dates, `fmtMyr` | Built and tested | `packages/i18n/src/format.ts` |
| Region (`MY`/`ID`) on every API request | Built and tested | `packages/i18n/src/region.ts`, `apps/server/src/context.ts` |
| Region-aware nutrient table (200 Malaysian dishes) | Built and tested; source is Singapore HPB, not MyFCD (section 2) | `packages/api/src/lib/myfcd-dishes.ts`, `tkpi.ts` |
| Scan prompts with Malaysian context | Built and tested; not eval'd on real Malaysian photos | `packages/api/src/lib/region-prompt.ts` |
| Equivalence line (roti canai instead of Indomie) and Malaysian facts | Built and tested | `packages/api/src/lib/facts.ts` |
| Data source notice (HPB attribution) in the apps | Built (Tentang / About) | `settings:dataSources` |
| Polar MYR display config, customer IP to Polar | Built, off until env vars set; MYR prices not created in Polar | `polar.ts`, `billing.ts` |
| `/my` landing, og image, hreflang, sitemap | Built by the landing task, see section 4 | `apps/web` |
| Timezone: per-user day zone | `profile.timezone`, server and apps cut days in it (section 5) | `packages/i18n/src/day-zone.ts`, `packages/api/src/lib/user-zone.ts` |
| PDPA privacy notice and terms (Malay and English), WhatsApp support | Built, see section 6. Street address of the company is missing (owner must supply it) | `/my/privasi`, `/my/privacy`, `/my/syarat`, `/my/terms`, `apps/web/src/lib/contact.ts` |
| Malay store listings, MyFCD permission, RM prices, creators | Planned (sections 3 to 8) | |

Owner decisions that block the plan are collected in section 9.

## 1. Language

Built:

- `LOCALES` is `id`, `en`, `ms`. The language picker lists `LOCALES`, so Profil, Tampilan & bahasa shows "Bahasa Melayu" on web, native and JoyoFit with no other wiring.
- Detection, first match wins (`docs/i18n.md`): saved account choice, device choice, device language, then region, then `id`. `ms`, `ms-MY`, `ms_MY`, `ms-BN`, `ms-Latn-MY`, `zsm`, `msa` give `ms`. `en-MY` stays `en`. A Malaysian region with a language we do not ship (`zh-MY`, `ta-MY`) gives `ms`, but only when no listed language is shipped: `["zh-MY", "en"]` is `en`. This reads "Malaysian region defaults to ms; keep en" as: never override a language the person chose, never fall back to Indonesian for Malaysians. Tests: `packages/i18n/src/locale.test.ts`.
- The Malay is Malaysian: `kalori`, `makan tengah hari`, `hidangan` for portion, `imbas` for scan, `kumpulan`, `kawan`, `percuma`, `anda`, `RM`, `Isnin` to `Ahad`, `Mac`/`Ogos`/`Disember`. `packages/i18n/src/ms-malay.test.ts` fails when any `ms` string contains a word that exists only in Indonesian (`kamu`, `bisa`, `olahraga`, `kkal`, `pengaturan`, `unduh`, ...), an em or en dash, or `kkal`. `kcal` is the unit (Malaysian labels print kcal).
- Formats: `ms-MY` via `Intl` (`1,234.5`, `Isnin, 14 September 2026`, `01:05 PTG`). `fmtMyr(49.9)` is `RM49.90`. Calendar days, the sticker card engine (`packages/sticker`), recap day names, weekday labels in native, e-mail footers and the TestFlight notice all have an `ms` entry.
- AI output language: `ai-locale.ts` asks for Malaysian Malay (`localName`, portion text), the coach and weekly reflection prompts ask for `anda` and `kcal`. The prompts themselves stay Indonesian (model quality and the baselined text).

Left:

1. A native speaker reviews all 42 files. Things the translators flagged: `koneksi` as "Sambungan", `kalibrasi` as "penentukuran", "Naik Berat" for the weight-gain mode, `LMP/EDD` for pregnancy dates, "doktor atau ustaz" in the Ramadan pregnancy note, "pasukan" vs "kumpulan" in server group errors, delivery apps (GoFood, GrabFood, ShopeeFood in the meal plan; foodpanda would be the Malaysian choice but needs a key change in `id`).
2. Strings that are still Indonesian-specific: `scan:idle.info.how` ("masakan Indonesia"), the AKG 2019 (Permenkes 28/2019) pregnancy targets in `maternal` (cite the Malaysian RNI instead once its table is loaded), the TKPI citations in `tips`, "Buku KIA" becoming a generic phrase (Malaysia: Buku Kesihatan Ibu dan Anak), and the coach reset time "00:00 WIB" (now the person's own midnight; the string still says WIB).
3. Meal-plan recipes and names (`packages/api/src/lib/meal/`) are Indonesian dishes with `id`/`en` text; `ms` users see the `id` text. A Malaysian recipe set is separate work.
4. iPhone: iOS only reports a language to the app when the bundle declares it. Test a TestFlight build on an iPhone set to Bahasa Melayu; if the app reports `en`, add `ms` to `CFBundleLocalizations` in `apps/native/app.json` (native build, not OTA).
5. Public web pages other than `/my`, `/my/privasi`, `/my/privacy`, `/my/syarat` and `/my/terms` (`/harga`, `/pengembalian-dana`, blog) are Indonesian only. The Malay and English privacy notice and terms are built (section 6).

## 2. Food data

### What Malaysia uses

- MyFCD (Malaysian Food Composition Database, Ministry of Health Malaysia, Nutrition Division, run with the Institute for Medical Research): 1997 table of 783 foods and 19 nutrients, current database adds 441 raw and processed foods and 668 prepared foods, up to 29 mandatory and 11 optional nutrients per food, last copyright line 2015 [1][2].
- Policy references: Malaysian Dietary Guidelines 2020 and Recommended Nutrient Intakes for Malaysia (NCCFN, Ministry of Health) [3]. Neither is a per-dish table. MDG PDF download timed out, so no per-dish value is taken from it [UNVERIFIED].

### Licence: MyFCD is not usable without permission

The only legal text on the site is a copyright line (1997 to 2015, Malaysian Food Composition Database Programme, c/o Institute for Medical Research) and "The Government shall not be liable for any loss or damage caused by the usage of any information obtained from this web site." [1][4]. There is no licence grant, no re-use statement, no bulk download and no API. Without a grant, copyright applies, so no MyFCD figure is copied into the app. Whether MyFCD holds nasi lemak, laksa and the rest could not be checked: the search endpoint ignored queries [1].

Who to ask (no e-mail is published; addresses from the MyFCD directory [5]): Nutrition Division, Ministry of Health Malaysia, Level 1, Block E3, Complex E, Federal Government Administration Centre, 62590 Putrajaya (tel 03-8888 9245); Nutrition Unit, IMR, NIH Complex, Level 3, Block C7, Jalan Setia Murni U13/52, Setia Alam, 40170 Shah Alam (tel 03-3362 7835). Ask in writing for (a) permission to embed per-100 g energy and fibre values of about 100 dishes in a commercial app, (b) the attribution wording, (c) whether registered users can export.

### What the app uses instead: Singapore HPB SG FoodID

The Singapore Health Promotion Board's Singapore Food Insights Database (SG FoodID) Terms of Use, section 10, grant "a worldwide, perpetual, royalty-free, non-exclusive licence to use the Data" including commercially, with a conspicuous source notice (section 11) [6]. HPB measures many dishes that are Malaysian hawker dishes (nasi lemak components, prata as roti canai, laksa, char kway teow, teh tarik, kuih). Caveats the owner should know:

- HPB measures dishes as sold in Singapore: portions and recipes are Singapore's. Hokkien mee is the pale Singapore version, mee goreng and laksa are Singapore formulations.
- Section 6 of the same terms restricts commercial reuse of the site's materials; section 10 is the grant for the Data. Confirm the reading with HPB in writing [6].
- USDA FoodData Central (public domain) has none of the named dishes (checked against FNDDS 2024-10-31: no nasi lemak, roti canai or prata, laksa, satay, teh tarik, char kway teow, mee goreng, kuih). Open Food Facts (ODbL) holds packaged products only, and is already the barcode source [7][8].
- Absent from every open source, so left out rather than estimated: nasi kandar, laksa Johor, kuih keria, keropok lekor, nasi kerabu, nasi dagang.

### Built

- `packages/api/src/lib/myfcd-dishes.ts`: 199 rows (197 HPB, 2 derived: nasi lemak from four HPB entries at HPB's own weights, karipap as the mean of five HPB curry puffs). Every row has `source.cite` with the HPB entry id and vintage, and `url`. The file keeps the name the brief used; no row is `db: "myfcd"`. `plausibleKcalRange` is a heuristic band (0.6x to 1.6x the portion), not a source value; `tkpi.ts` clamps the model's kcal into it, so review the bands for the dishes that matter. Fibre is stored as 0 for 26 rows where HPB reports none (23 drinks and three dishes); the cite says so.
- Coverage of the named dishes, all with a row: nasi lemak (plain, with chicken, wing, fish, derived bungkus), roti canai (plain, egg, set with curry), teh tarik, mee goreng mamak, char kuey teow, laksa (curry and Penang), satay (chicken, beef), kuih (lapis, seri muka, onde-onde and more), Milo ais, cendol, nasi goreng, bak kut teh, wantan mee, nasi ayam, roti bakar kaya, mee rebus, lontong, pisang goreng, karipap and about 150 more.
- Region-aware lookup: `calibrateItems(items, { region })`, `libraryKcal(name, grams, region)` and `canonicalFood(name, region)` in `tkpi.ts`. `MY` searches the Malaysian rows first and then TKPI, so a Malaysian user who logs nasi padang still matches. A whole-plate name that contains another row ("nasi lemak ayam goreng") is one dish, not a combination. Indonesia (and any call without a region) behaves exactly as before. Tests: `tkpi-region.test.ts`, `myfcd-dishes.test.ts`.
- Region reaches the code from `context.region` (a `ms` UI is `MY`; otherwise Cloudflare's `CF-IPCountry` of `MY` or `ID`; else `ID`) into the photo scan, retry, text story, `correctScan`, plate recalculation and the anonymous landing scan. Shadow scans and portion priors still use Indonesia.
- Scan prompts (`region-prompt.ts`): for `MY` the first sentence says "fokus masakan Malaysia: kedai mamak, gerai penjaja, kopitiam", dish names are Malaysian ("nasi lemak bukan nasi uduk, roti canai bukan roti maryam, teh tarik bukan teh susu, kopi O, kopi kosong, teh C"), and defaults cover the bungkus, per keping roti canai, per cucuk satay, per biji kuih, nasi kandar split into rice plus each lauk, and "kurang manis". The prompt never asks for a halal verdict. The Indonesian prompt is byte-identical to before (tested).
- Equivalence: Indonesia and English keep "Setara N bungkus Indomie" (380 kcal). `ms` says "Bersamaan N keping roti canai" (246 kcal, one HPB prata piece; a test keeps the constant equal to the dish row). The loading-screen and Beranda facts for `ms` use 13 Malaysian dishes at HPB weights, none of them pork.
- Attribution: Settings, Tentang (web and native) shows the HPB notice verbatim with the date and the TKPI line. The `/my` page carries it where values appear.

### Left

1. Write to MOH Nutrition Division and IMR (above). If permission arrives, add `db: "myfcd"` rows for what HPB lacks and replace Singapore portions with Malaysian ones.
2. Build a Malaysian eval set. `scripts/eval-scans.ts` has owner and external photo sets and a recorded baseline; there are no Malaysian photos in it. Without real photos nobody knows if the prompt rule helps or hurts. Collect 40 to 60 photos of the named dishes taken by us or by consenting contributors, then run the harness with `region: "MY"`.
3. The `plausibleKcalRange` of the 199 rows needs a human review against what Malaysian hawkers actually serve (bungkus nasi lemak is smaller than HPB's 313 g plate).
4. Region is derived per request, not stored. A Malaysian on a VPN, or an Indonesian traveller, gets the other table. If that matters, add `profile.region` (new D1 column) next to `profile.locale`.
5. Malay-language Malaysian Dietary Guidelines and RNI targets for Hamil/Menyusui and daily macros need MOH permission or direct reading of the PDFs; today the targets follow Indonesian AKG 2019.

## 3. Payments

Sources are numbered at the end. FX used: 1 MYR about Rp4,420, US$1 about RM4.08 (derived).

### Polar for Malaysian buyers

- Currency: Polar products can carry prices in more than one currency, MYR is in the 130+ currency list, and Polar chooses by the customer's geolocation (falls back to the org default, USD). Settlement is always in USD [9][10]. Geolocation uses the IP of the request that creates the checkout; our Worker used to send none, so Polar would see the Worker. Fixed: `createCheckout` now forwards `CF-Connecting-IP` as `customer_ip_address`.
- Methods: cards (Visa, Mastercard and others, recurring too), Apple Pay, Google Pay, Link. No FPX, GrabPay, Touch 'n Go, Boost or DuitNow QR, and Polar states no setting unlocks more [11].
- Tax: Malaysia's service tax on digital services from foreign providers is 6% since 2020-01-01, with a registration threshold of RM500,000 in 12 months [12][13]. The 8% in Google's page is Google's tax on a Malaysian developer's fee, not a consumer rate [14]. Polar says it is the merchant of record and takes international sales-tax liability, but its published registrations are EU OSS, UK VAT and US states; whether it is registered with Royal Malaysian Customs is `[UNVERIFIED]` [15][16]. Prices are tax-inclusive outside US, Canada and India [17]. Ask Polar in writing before saying SST is collected.
- Fees: Early Member plan (org created before 2026-05-27) 4% + 40c + 0.5% on subscriptions, Starter 5% + 50c, plus 1.5% on non-US cards [18]. Which plan JoyoRogo's org is on is not in the repo. At Rp29.000 (about RM6.56) fees take 31 to 38%, so RM12.90 a month is the practical floor on Polar; yearly plans lose 8 to 11%.
- Refunds and chargebacks: dashboard refunds, 60-day discretionary refunds that cancel the subscription, US$15 per dispute [18][19]. The existing `/pengembalian-dana` and webhook handling already cover the paths.

### Alternatives (short)

| Option | Malaysian methods | Fit |
| --- | --- | --- |
| Stripe direct | cards, FPX, GrabPay; FPX and GrabPay are not recurring | Only for accounts based in Malaysia; Indonesia is "Preview" [20][21]. Not usable today |
| Stripe Managed Payments | Stripe checkout | Business must be in the US, EU, UK, CA, AU, HK, JP, SG and a few more, not Indonesia [22] |
| Paddle, Lemon Squeezy | cards, PayPal, Apple Pay, Google Pay | No Malaysian methods; Paddle has no MYR [23][24] |
| Xendit Malaysia | FPX, cards, Touch 'n Go, GrabPay, ShopeePay, DuitNow QR; auto-debit mandates | Not a merchant of record (JoyoRogo carries SST over RM500,000). Whether an Indonesian PT can open an account is `[UNVERIFIED]` [25] |
| Billplz, toyyibPay, 2C2P, iPay88 | FPX, wallets, cards | Fees from a third-party aggregator, foreign-seller eligibility `[UNVERIFIED]` [26] |
| Google Play Billing | cards, carrier billing, Boost, Touch 'n Go, ShopeePay; FPX not for subscriptions | Google remits Malaysian tax; 15% on subscriptions today; no user-choice billing in Malaysia, so no web link-out [14][27][28] |
| Apple IAP | Apple's methods | 15% in the Small Business Program; external purchase links only in BR, JP and the EU, so no link-out in Malaysia [29][30] |

Local rails (FPX, wallets) are one-off or mandate based, which matches the existing no-auto-renew QRIS and DOKU model better than a subscription.

### Recommendation

| Surface | Rail | Why |
| --- | --- | --- |
| Web, launch | Polar with MYR prices added to the two existing products (auto-renew, cards, Apple Pay, Google Pay) | No new vendor, no SSM or local entity, webhooks unchanged. Limit: no FPX or e-wallets |
| Web, phase 2 | A one-off FPX / Touch 'n Go / DuitNow QR gateway (Xendit Malaysia or Billplz) crediting 1 or 12 months, next to DOKU and Pakasir | Reaches buyers without cards. JoyoRogo becomes the SST-liable provider over RM500,000 |
| Android | Google Play Billing only | No link-out in Malaysia |
| iPhone | Apple IAP only | No link-out in Malaysia |
| Do not use | Stripe direct, Stripe Managed Payments, Paddle, Lemon Squeezy | Not available to an Indonesian seller, or nothing for Malaysia |

### RM price points (owner decision)

No Malaysian willingness-to-pay or competitor price was found; Berry Best's Pro price was not read. These follow from fees and the Indonesian ladder, not from demand data.

| Plan | Indonesian price in RM | Proposed Polar (web) | Proposed Apple and Play | Today in stores |
| --- | --- | --- | --- | --- |
| Monthly | Rp29.000 = RM6.56 (ladder step 3 Rp49.000 = RM11.09) | RM12.90 | RM14.90 | Apple RM49.90, Play RM43.99 |
| Yearly | Rp199.000 = RM45.0 (step 3 Rp349.000 = RM79.0) | RM79.90 | RM89.90 | Apple RM299.90, Play RM264.99 |

Today's store prices are about 3.9 times the proposed web prices and about 7.6 times the Rp29.000 conversion (`docs/pricing.md`). Apple's `preserveCurrentPrice` keeps existing subscribers on their old price when lowering. The Founder ladder stays an Indonesian-only mechanism: `FOUNDER_PRICE_LADDER` is in rupiah.

### Built, and what remains

- `/api/config` now carries `myr: { monthlySen, yearlySen, country } | null`, filled only when both `POLAR_PRICE_MONTHLY_MYR_SEN` and `POLAR_PRICE_YEARLY_MYR_SEN` are set (a typo throws at startup of the billing routes, like the USD vars). The `/my` page shows an RM price only when this is not null; otherwise it says the RM price is announced before the Malaysian launch.
- Go-live order: (1) create MYR prices on both Polar products (existing subscribers keep theirs); (2) run a sandbox checkout from a Malaysian IP and confirm the order currency is `MYR`; (3) set the two vars and deploy the server; (4) ask Polar in writing about SST; (5) lower the Apple and Google MYR prices.
- Ledger gap: `polar-billing.ts` records `amount_usd_cents` only for USD orders; a MYR order is booked at the plan's full IDR fallback price, not scaled for discount codes, and `amount_usd_cents` is null. Revenue sums stay usable but not exact for MYR. A proper fix needs a currency column on `payment` (migration).
- Not changed: `usd.preferred` still shows USD first to every non-Indonesian visitor; the web `/harga`, `/pro` and the checkout picker still show USD only; `syarat` and `pengembalian-dana` mention US dollars. All of that moves when the MYR prices go live. Admin shows "Polar (USD)" for every Polar order.

## 4. Landing, og image, routing

- Route: the site has no per-language routing, so Malaysia is `https://joyorogo.com/my` (Bahasa Melayu). `/` stays Indonesian. No automatic redirect: search engines and shared links must land where the URL says. Instead, `/` shows a dismissible notice "Anda di Malaysia? Lihat versi Bahasa Melayu" when the browser language resolves to `ms` or the country from `/api/config` is `MY`.
- SEO: `og:locale` `ms_MY`, `hreflang` pairs between `/` (id) and `/my` (ms-MY) with `x-default` on `/`, the sitemap lists `/my` with `xhtml:link` alternates, `my.html` is prerendered with Malay no-JS content, JSON-LD `inLanguage: "ms"`. `og-my.png` is generated by `bun run og:my` from `apps/web/og/og-my.html`.
- Content rules followed (`marketing-plan.md` 1.1): no user counts, ratings or testimonials; example numbers are from the cited dish table and labelled "Contoh"; the HPB notice is printed; no "halal"; payment wording says cards, Apple Pay and Google Pay only; no rupiah price.
- Left: `/pengembalian-dana` in Malay and English; a Malay blog track (dish pages such as nasi lemak and roti canai calories, built from the same cited rows); store listing translations (section 8); real Malaysian food photos for the page and the og image (none exist in the repo, so the page uses live UI components). Built: the four legal pages and the WhatsApp links (section 6).

## 5. Timezone

Malaysia and Singapore are UTC+8, Indonesia's WIB is UTC+7, none has daylight saving. A Malaysian midnight is 23:00 WIB. A day is `'YYYY-MM-DD'` in the person's zone, and every person has one.

**Built (live once deployed).**

- `profile.timezone` (migration 0059): `Asia/Jakarta` | `Asia/Kuala_Lumpur` | `Asia/Singapore` (`DayZone`). Null = a profile that predates zones, which means Asia/Jakarta: all its stored days were cut in WIB, so Indonesians see no change at all. A person who has not onboarded yet gets the zone of their request region (ID/MY/SG, `zoneForRegion`).
- Where it is set: onboarding (`profile.upsert` takes the device's IANA zone; a zone we serve wins over the region), and `profile.setTimezone` (the apps call it once per launch when the resolved zone differs from the stored one). The device zone wins when it is one we serve (`resolveDayZone` in `packages/i18n/src/day-zone.ts`: device, then stored, then Jakarta for a legacy profile, else the region), so the day follows the person to Kuala Lumpur or Singapore; an unserved zone (Asia/Makassar) never changes anything. Asia/Kuching is Kuala Lumpur.
- Server: every handler takes `const zone = await userZone(context)` (`packages/api/src/lib/user-zone.ts`, one profile read per request) and passes it down: diary day and `input.date ?? today`, the `eatenAt` window and the 04:00 late-night rule, daily scan quota and coach/correct/barcode/dishware windows (`dayBounds(day, zone)`, so the quota resets at the person's midnight), Beranda `today`, streaks, plan and energy budget, sleep (the morning it ended), fasting, Strava and watch day keys, JoyoFit data (`fit-data`, `fit-web`: day keys and `startedAt` carry the zone's offset, `+08:00` for MY/SG), tips rotation, Ramadan check, recap and period weeks, reflection windows, challenge and group days, social quotas. Cron jobs read zones from the profile: reminders and the push digest run per zone group (`ZONE_GROUPS`, `zone-sql.ts`) at each person's local time, quiet hours and "sent today" counts per zone, fasting reminders per subscriber, e-mail dates and `{tanggal}` in the recipient's zone.
- Apps: `setActiveDayZone` (like `setActiveRegion`) is set synchronously from the device at start-up and refined when `profile.myProfile` loads (`DayZoneSync` in web and native, `locale-sync` in JoyoFit); a changed zone invalidates all queries. Every zone-less helper (`jakartaToday()`, `dayIn`, `fmtClock`, `advanceClock`, eaten-at) then follows it. The server never sets an active zone: a Worker serves everyone, so a call that omits the zone there gets Jakarta, never someone else's zone. The legacy `jakarta*`/`wib*` helper names are kept.
- Tests: meal at 23:30 MYT lands on its MYT day and 00:30 MYT is not `wrong_day` (`eaten-at.test.ts`), the quota resets at MYT midnight and not at 23:30 WIB (`quota.test.ts`), a MY streak continues across 23:30/00:20 MYT while the same instants are one WIB day for an ID user (`routers/day-zone.test.ts`), reminders, quiet hours and the digest per zone (`reminders.test.ts`, `notify.test.ts`), onboarding and `setTimezone` (`profile-timezone.test.ts`), the zone helpers (`day-zone.test.ts`).

**Deliberately still WIB.** Admin routes and UI (`apps/server/src/admin*.ts`, `apps/admin`), the daily accuracy digest, dataset export, billing and ledger days, blog and RSS dates, the global shadow-scan budget (`shadow-scan.ts`, one budget for everybody), the push outbox prune, and `strava-retention` (a rolling 7-day cutoff over all users).

**Known limits.**

- Days stored before the switch stay WIB-cut: a Malaysian who joined before it keeps those days as they are, new days are MYT.
- `pastDateSchema` (log dates up to 30 days back) has no request, so its "today" is Kuala Lumpur's: a Jakarta user is allowed to pick a date up to an hour early.
- iOS HealthKit daily totals are bucketed at WIB midnight inside the native module (`AppleHealthModule.swift`); for a UTC+8 person they are an hour off until the module takes the zone, which needs a native build (not OTA-able). Health Connect (Android) is zone-aware.
- JoyoFit watch app (`watch-fit` repo, `jakartaDay` in `rogoMap`) is not changed here: it still cuts days at WIB. The API now returns the person's zone days (`fitWeb.workouts` `items[].date`, recovery `days[].date`, MCP `list_workouts`/`get_workout`/`get_profile` `today`) and ISO times with `+08:00` for MY/SG; the watch client should read `profile.timezone` (or its own device zone) instead of a fixed +07:00.

5. `isRamadanDate` uses the Umm al-Qura calendar; Malaysia starts Ramadan by its own moon sighting announcement (about 8 February 2027 [31]). Keep "tell users to switch Mode Ramadan on by hand" on day 1.

## 6. Compliance

### PDPA 2010 (Act 709) and the 2024 amendment

What the rule says [32][33]:

- The amendment (A1727, Royal Assent 9 October 2024) is in force in three stages: 1 January, 1 April and 1 June 2025. The Act now says "data controller" and "data processor".
- Health data and biometric data are sensitive personal data and need explicit consent (s.40). The notice must be in the national language and English (s.7(3)) and must list the classes of third parties (s.7(1)(e)).
- Breach: notify the Commissioner within 72 hours when harm is significant (sensitive data counts), then data subjects within 7 days. A Data Protection Officer is required above 20,000 data subjects, or 10,000 sensitive-data subjects, or 20,000 under systematic monitoring; wearable fitness data is a named example [34][35].
- Cross-border transfer needs consent, a substantially similar law, or safeguards such as contractual clauses; a Transfer Impact Assessment is valid three years [36].
- A consumer app is not in the registration classes; PDP Circular 1/2026 content was not readable `[UNVERIFIED]`.
- Whether PDPA reaches an Indonesian operator with no Malaysian establishment is not settled by the text (s.2(2): established in Malaysia, or uses equipment in Malaysia). Marketing to Malaysians in Malay is a risk fact, not a safe harbour. Ask counsel [INFERENCE].

What `/privasi` (Indonesian) says: no named legal entity, one e-mail, no Data Protection Officer or breach process, deletion is self-serve but there is no written access, correction or portability route, and it says "Tidak membagikan datamu ke pihak ketiga" while also naming Cloudflare, Polar, DOKU, Pakasir, Apple, Google, Strava, Expo and others. Retention per feature is described well. Server regions are not stated `[UNVERIFIED]`. The Malaysian notices fix these points for Malaysian users (below); the Indonesian page is unchanged.

Actions, built and left:

Built (2026-10-21, `available: code`, JRG-355):

1. `/my/privasi` (Bahasa Melayu) and `/my/privacy` (English), `/my/syarat` and `/my/terms`: prerendered with the whole text in no-JS HTML, in the sitemap, `hreflang` `id`, `ms-MY`, `en-MY` and `x-default` between them and the Indonesian pages, `og:locale` `ms_MY` or `en_MY`, `<html lang>` set. The text lives in `apps/web/src/lib/legal-my.ts` (one data file for the route and the no-JS HTML); `legal-my.test.ts` checks Malay wording, no dashes, no "halal", and the PDPA blocks.
2. The notice states: controller `PT Joyo Digitama Solusi, Malang, Jawa Timur, Indonesia` (the street address line is printed only when `COMPANY_ADDRESS` in `apps/web/src/lib/contact.ts` is non-empty), purposes, required and voluntary data, health and body data as sensitive data with explicit consent and withdrawal, the classes of processors the Indonesian page already names (Cloudflare, Polar, DOKU, Pakasir, Apple, Google, Strava, Open Food Facts, Expo, Revklik, and AI apps the user connects), a transfer statement (processed in Indonesia and by those processors), retention per feature (copied from the Indonesian page), rights (access, correction, withdrawal, deletion, a copy to the user or another controller), request route (e-mail and WhatsApp, reply target 21 days), breach commitment, complaints to JPDP (aduan@pdp.gov.my, 03-7456 3888), 18+, and a language note (both versions are equal). "Tidak dibagikan ke pihak ketiga" is rewritten as "not sold, shared only with the processors listed".
3. Terms: faithful translation of `/syarat`, the controller identity, and no governing-law line (the Indonesian page has none). The USD purchase section stays English in `/my/terms`.
4. In-app links: web (`legal-path.ts`: Profil, Tentang, login) and native (`legal-url.ts`: Tentang, Privasi & data, founder paywall) open `/my/privasi` or `/my/syarat` when the language is `ms`; other languages keep `/privasi` and `/syarat`. The English notice is one tap from the Malay page and linked from `/my`.

Not done, needs the owner: the street address (`COMPANY_ADDRESS`), confirmation of the WhatsApp number, counsel's read of the text and of s.2(2), a Transfer Impact Assessment and processor clauses on file, a breach runbook, and consent capture with timestamp and version at onboarding and for the optional categories (what onboarding stores today was not checked). Watch PDP Public Consultation Paper 1/2026 on AI and personal data (comments closed 23 October 2026) [38]. Keep "tidak dipakai untuk melatih model" true.

### Halal

The Trade Descriptions (Certification and Marking of Halal) Order 2011 (P.U.(A) 431) bars describing food or food services as halal, or as fit for Muslims in any other manner, unless certified by JAKIM or a State Islamic Religious Council [39]. Penang prosecuted three firms in July 2026, two for "Muslim friendly" signs [40]. Rules for us:

- Never write "halal", "Muslim friendly", "syariah", "bebas babi" or "bebas alkohol" anywhere (app, `/my`, listings, ads, creator briefs). Line to use: "JoyoRogo tidak mengesahkan status halal. Semak logo halal JAKIM pada pakej atau premis."
- The scan prompt must not infer halal status (it says so now). No halal attribute in the dish data. Dish names stay as the data has them (bak kut teh and char siu rows exist for non-Muslim users).
- No pork dishes in Ramadan, Raya or "juadah berbuka" content or in the facts pool shown to everyone (the Malaysian facts have none). Keep a separate content track for Chinese and Indian audiences.

### Health claims and advertising

- Medicines (Advertisement and Sale) Act 1956: ads may not lead to using an article or appliance as a remedy for diseases in its Schedule (diabetes, hypertension, heart and kidney disease, among others). The Schedule copy read is an older consolidation `[UNVERIFIED]` [41].
- Medical Device Act 2012: software is a medical device when the manufacturer intends it for diagnosis, monitoring or treatment of disease. Intended purpose is what we say; keep "bukan alat medis" and avoid disease words in Malay copy. Features that read as monitoring (SpO2 and resting heart rate in Keluarga, cycle data, pregnancy modes, injury triage in the coach) are where the Medical Device Authority could ask. MDA guidance text was blocked (403) `[UNVERIFIED]` [42].
- Consumer Protection Act 1999: Part II is the false-advertising part (s.9, s.10 on benefits, approval and endorsement). s.14 (free offers) puts the condition next to "percuma" in print at least half the size, so "percuma, 3 scan AI sehari" must be written together. s.15 (limited claims) needs the maximum stated, so "10 pembeli pertama" is acceptable only with the number and only while true [43].
- Food Regulations 1985 (18B to 18E) govern food labels, not software [44]. ASA Malaysia has a slimming code; the page blocked access, a human reads it before launch `[UNVERIFIED]`.
- Extend "Jangan klaim" for Malaysia: no "kawal diabetes, darah tinggi, kolesterol, jantung, buah pinggang", no "ubat", "terapi", "detoks", "bakar lemak", before and after photos, kg-per-day claims, "doktor syorkan", "disahkan KKM, MOH atau MDA". Never cite KKM or MOH as endorsement; say figures for local dishes are estimates, and do not claim MyFCD (not loaded).
- Consumer Protection (Electronic Trade Transactions) Regulations 2012: the site must show seller name, registration number if any, contact, main characteristics, full price including taxes, payment method and terms [45]. The notices and terms now name PT Joyo Digitama Solusi, Malang, Jawa Timur, Indonesia with e-mail and WhatsApp; the address and any registration number are still missing (`COMPANY_ADDRESS`). Add a "Penjual" block for Malaysian visitors once the owner supplies them.

## 7. Markets, channels, support, competitors

### Platforms (DataReportal Digital 2026, data to October 2025 [46])

| Metric | Value |
| --- | --- |
| Population and internet users | 36.1 M and 35.4 M (98.0%) |
| Social media identities | 30.7 M, median age 31.0 |
| YouTube ad reach | 23.6 M |
| Facebook ad reach | 23.0 M |
| Instagram ad reach | 16.1 M |
| TikTok ad reach (18+) | 30.7 M |

Ad reach is not monthly users. WhatsApp reached 90.7% of internet users aged 16 to 64 monthly in 2024 data (Meltwater, May 2024) [47]; no 2026 figure was obtained. Threads, Telegram and Xiaohongshu Malaysian user figures: no primary source `[UNVERIFIED]`. Population: Muslim 63.5%, Buddhist 18.7%, Christian 9.1%, Hindu 6.1%; Chinese 23.2%, Indian 6.7% (Census 2020) [48].

### Channels and creators

- Lead with TikTok and Instagram for discovery and WhatsApp for support and group invites, as in Indonesia. Threads and X for build-in-public posts. Add Xiaohongshu only after a Mandarin page exists.
- Creator types to look for, no names (none verified): Malay-language gym and running creators, hijabi runner communities, dietitians on TikTok and Instagram, "what I eat in a day" diary creators, hawker and mamak reviewers, Mandarin wellness creators, Tamil fitness creators, office meal-prep creators, postnatal communities. Find them through public rankings (Scrumball, Collabstr) and agencies, then vet each by hand [49]. Briefs: #ad disclosure, the claims list in section 6, "anggaran" labels, no halal wording.
- Calendar: Chinese New Year 6 Feb 2027, Ramadan about 8 Feb 2027, Hari Raya Aidilfitri about 10 Mar 2027, Deepavali 28 Oct 2027 (2026 date `[UNVERIFIED]`) [31][50]. Hawker content all year: per-plate calories of nasi lemak, roti canai, teh tarik, char kuey teow, mee goreng mamak, laksa, nasi kandar, satay, cendol, kuih.
- Support: WhatsApp links are on `/my` (footer, FAQ, pricing help line) and on the four legal pages, with a Malay prefilled message ("Hai JoyoRogo, saya ada soalan tentang ..."). The number is `+62 896-8083-9591` (`apps/web/src/lib/contact.ts`), PT Joyo Digitama Solusi's number from the sibling Voltrus Indonesian landing, the only company WhatsApp number in the repository tree. It is an Indonesian number, not +60: the owner must confirm it is the one to publish, and if a Malaysian or international business number is wanted it is a one-line change. State hours in Malaysian local time (GMT+8, one hour ahead of WIB) once they are fixed. WhatsApp Business is plausible given reach [47].
- Languages: Malay plus English for notices; Manglish and code-switching are fine for creators and are not written into the app. Mandarin and Tamil after Malay and English exist.

### Competitors that exist in Malaysia (pages read 2026-10-21)

| App | Evidence | Malaysian dishes | Note |
| --- | --- | --- | --- |
| Berry Best | berrybest.app, iOS and Android, made in Malaysia [51] | AI photo scan with sample results for nasi lemak, roti canai, char kway teow, satay, banana leaf rice | Has intermittent fasting, gym mode, AI coach. Its site claims 600+ members and 17,000+ meals logged (self-reported). Pro price not read. Closest overlap |
| Food Calories Malaysia | hitungkalori.com/my, Android and iOS [52] | Malaysian food database, AI estimate when no match | Indonesian developer domain. Price not read |
| Macron AI | macronai.app, beta [53] | "knows Malaysian food" (search snippet) | `[UNVERIFIED]` beyond the snippet |
| MyNutriDiari 2 | Ministry of Health Malaysia, App Store [54] | Manual diary with a Malaysian food list | Free; reviews ask for more foods |
| FatSecret | fatsecret.com.sg [55] | Roti canai per piece in search | Freemium |
| MyFitnessPal | App Store [56] | Not checked `[UNVERIFIED]` | Freemium |

Calorie Mama, Lose It, "MyCalorie", "KKM Kalori" and "Kalori Kita" could not be verified to exist as Malaysian products. "Knows Malaysian food" is already claimed by others. The differentiators that remain from `marketing-plan.md` 1.3 are groups (colek, VAR, catatan), Ramadan and fasting modes, a price lock without auto-renew where the rail allows it (not on Polar, Apple or Google, which renew), open source, and cited per-dish sources. I found no group feature in the Malaysian pages I read; this is a comparison of pages, not an audit.

## 8. Stores

- Availability: the closed-testing track is already set to 131 countries and the `pro` subscription has 128 priced regions (`docs/pricing.md`). Nothing Malaysia-specific was found that blocks the app. Whether Malaysia is among the 128 priced regions was not confirmed `[UNVERIFIED]`. JoyoRogo Android is in Play production (178 countries, verified in Play Console 2026-10-30).
- Listing translations: Play Console supports Malay (`ms` and `ms-MY`) and App Store Connect lists Malay [57][58]. Write a `ms-MY` listing (name, 80-character short description, full description) from the claims in section 6; keep the English "Made in Malang, Indonesia" seller line and the Health apps declaration disclaimer ("not a medical device and does not diagnose, treat, cure, or prevent any medical condition") in Malay [59]. Data safety must match the Malay privacy policy. Target audience stays 18+.
- Store prices: set Apple and Play MYR prices by section 3 after the owner picks.
- Apple's medical-device declaration and age-rating answers: text not read `[UNVERIFIED]`.

## 9. Owner decisions and next steps

Blocking, in this order:

1. RM prices (section 3), and the Polar MYR prices that follow. Ask Polar in writing about Malaysian SST and which fee plan the org is on.
2. A postal address for the company (`COMPANY_ADDRESS`, empty today so no address line is printed in the Malaysian notices and terms) and counsel's view on PDPA s.2(2). The legal entity (PT Joyo Digitama Solusi) and the WhatsApp number are now named in the notices; the owner confirms the number.
3. Native-speaker review of the Malay (section 1) and of the Malaysian scan prompt.
4. Written permission request to MOH Nutrition Division and IMR for MyFCD; confirm the HPB reading in writing.
5. Collect the Malaysian eval photos (section 2) and run the harness before any "knows Malaysian dishes" post.
6. Timezone (section 5) is built: deploy the server (migration 0059) and ship the web and native JS together, before Malaysian users log past midnight in volume.

Release entries (all `available: code`): `releases/2026-10-21-bahasa-melayu-malaysia.md` (JRG-351), `releases/2026-10-21-hidangan-malaysia.md` (JRG-352), `releases/2026-10-21-halaman-malaysia.md` (JRG-353), `releases/2026-10-21-notis-privasi-malaysia.md` (JRG-355).

## Sources

[1] https://myfcd.moh.gov.my/ and https://myfcd.moh.gov.my/index.php/about-us/history-of-food-composition-database.html
[2] https://www.fao.org/food-composition/tables-and-databases/detail/(malaysia--2015)-malaysian-food-composition-database/en
[3] Malaysian Dietary Guidelines 2020, https://hq.moh.gov.my/nutrition/wp-content/uploads/2024/03/latest-01.Buku-MDG-2020_12Mac2024.pdf (download timed out, not read)
[4] https://myfcd.moh.gov.my/index.php/disclaimer.html
[5] https://myfcd.moh.gov.my/index.php/directory.html
[6] Terms of Use, SG FoodID: https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf ; database: https://pphtpc.hpb.gov.sg/web/sgfoodid
[7] USDA FoodData Central: https://fdc.nal.usda.gov/
[8] Open Food Facts data: https://world.openfoodfacts.org/data
[9] https://polar.sh/docs/features/products.md
[10] https://polar.sh/docs/features/finance/balance.md
[11] https://polar.sh/docs/features/checkout/payment-methods.md
[12] RMCD Guide on Digital Services by Foreign Service Providers v2.1: https://mystods.customs.gov.my/storage/app/media/pdf/guide/Guide%20on%20Digital%20Service_V2.1_01022021.pdf
[13] https://mysst.customs.gov.my/wp-content/uploads/2025/03/Service-Tax-Rate-Of-Digital-Services-Tax-Order-2019.pdf
[14] https://support.google.com/googleplay/android-developer/answer/138000?hl=en
[15] https://polar.sh/docs/merchant-of-record/introduction.md
[16] https://polar.sh/features/merchant-of-record
[17] https://polar.sh/docs/features/tax-inclusive-pricing.md
[18] https://polar.sh/docs/merchant-of-record/fees.md
[19] https://polar.sh/docs/features/refunds.md
[20] https://docs.stripe.com/payments/fpx and https://docs.stripe.com/payments/grabpay
[21] https://stripe.com/global
[22] https://docs.stripe.com/payments/managed-payments/eligibility
[23] https://www.paddle.com/help/start/intro-to-paddle/which-payment-methods-do-you-support and https://developer.paddle.com/concepts/sell/supported-currencies.md
[24] https://docs.lemonsqueezy.com/help/checkout/payment-methods
[25] https://help.xendit.co/hc/en-us/articles/25149917079961--MY-How-to-create-Xendit-Account-for-business-in-Malaysia
[26] https://malaysiapg.com.my/gateway/xendit/ , /billplz/ , /toyyibpay/ , /2c2p/ (third-party aggregator, fees to be confirmed with each provider)
[27] https://support.google.com/googleplay/answer/2651410?co=GENIE.CountryCode%3DMY&hl=en-GB
[28] https://support.google.com/googleplay/android-developer/answer/13821247?hl=en
[29] https://developer.apple.com/app-store/small-business-program/
[30] https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.storekit.custom-purchase-link.allowed-regions
[31] https://publicholidays.com.my/ms/awal-ramadan/ and https://somin.ai/apac-marketing-calendar/ (secondary)
[32] Act 709 reprint as at 15 September 2026: https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3301061_BI/Act%20709%20%28Reprint%202026%29.pdf
[33] https://www.pdp.gov.my/ppdpv1/en/akta/personal-data-protection-amendment-act-2024/
[34] https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/GP_DPO_ENG.pdf
[35] https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/GP_DBN_ENG.pdf
[36] https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/GP_CBPDT_EN.pdf
[37] https://www.pdp.gov.my/ppdpv1/en/akta/circular-of-personal-data-protection-commissioner-no-2-2025-appointment-of-data-protection-officer/
[38] https://www.rajahtannasia.com/viewpoints/public-consultation-paper-on-artificial-intelligence-and-personal-data-protection-framework/ (summary)
[39] P.U.(A) 431/2011: https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20111230_P.U.%20(A)%20431-perintah%20perihal%20dagangan%20(perakuan%20dan%20penandaan%20halal)%202011.pdf
[40] https://www.thestar.com.my/news/nation/2026/07/24/three-firms-charged-with-misusing-halal-logo
[41] Act 290: https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20290.pdf
[42] Act 737: https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20737%20_ONLINE%20VERSION_1%20MAC%202017.pdf
[43] Act 599: https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1690994_BI/011121_Act%20599_final.pdf
[44] Food Regulations 1985: https://faolex.fao.org/docs/pdf/mal27305.pdf
[45] P.U.(A) 458/2012: https://www.aseanconsumer.org/file/post_image/Consumer%20Protection%20(Electronic%20Trade%20Transactions)%20Regulations%202012.pdf
[46] https://datareportal.com/reports/digital-2026-malaysia
[47] https://www.meltwater.com/en/blog/social-media-statistics-malaysia
[48] https://kawasanku.dosm.gov.my/
[49] https://www.scrumball.com/ranking/top-fitness-influencers-on-instagram-in-malaysia ; https://collabstr.com/top-influencers/tiktok/in/malaysia/klang
[50] SOMIN APAC marketing calendar (secondary), as [31]
[51] https://berrybest.app/en
[52] https://hitungkalori.com/my
[53] https://www.macronai.app/ (search snippet only)
[54] https://apps.apple.com/my/app/mynutridiari-2/id1003686068
[55] https://www.fatsecret.com.sg/calories-nutrition/search?q=Roti%20Canai
[56] https://apps.apple.com/ie/app/myfitnesspal-calorie-counter/id341232718
[57] https://support.google.com/googleplay/android-developer/answer/9844778?hl=en
[58] https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations
[59] https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
