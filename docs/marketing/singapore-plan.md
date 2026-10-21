# JoyoRogo in Singapore: what is built, what is left

Written 2026-10-21. Nothing here is deployed, published to a store or sent by OTA; the user-visible item is `available: code` in `releases/2026-10-21-halaman-singapura.md` (JRG-356). Singapore reuses the Malaysian work (`malaysia-plan.md`): English is the only language, so there is no new locale.

## Built

- Region: `SG` is a third `Region` (`packages/i18n/src/region.ts`). `CF-IPCountry: SG` gives `SG` whatever the UI language is, except a Bahasa Melayu UI, which stays `MY`. `/api/config` now carries `region`, and the web and native clients call `setActiveRegion` with it.
- Nutrient source: the Singapore Health Promotion Board's SG FoodID is the table for `SG` as it is for `MY` (`lib/tkpi.ts` `indexFor`), so Singapore is the one market where it is a local source. The dish table already has chicken rice (steamed, roasted, soya sauce, claypot), char kway teow, laksa, nasi lemak, roti prata, kaya toast, kopi and teh variants, bubble tea, satay. Added Singapore ordering aliases (`kopi peng`, `teh peng`, `teh o peng`, `kopi o peng`). The HPB notice is already in Tentang / About and on `/sg` where values appear.
- Scan prompts: `region-prompt.ts` has a Singapore photo rule and story rule (hawker centre, kopitiam, food court; Singapore spellings; chicken rice per plate, economy rice split per dish, prata per piece, satay per stick, bubble tea per 500 ml cup, `siew dai`, `kosong`, `peng`; never a halal verdict). Not eval'd on real Singapore photos.
- Equivalence: English in Singapore reads "Same as N plates of chicken rice" (509 kcal, one HPB steamed chicken rice plate; a test keeps the constant equal to the dish row). The loading-screen and Beranda facts use a 10-dish Singapore pool (`FOOD_FACTS_SG`) with Singapore names.
- Timezone: `Asia/Singapore` is a `DayZone` (UTC+8, same cut as Kuala Lumpur). Like Malaysia, no caller passes a zone yet (`malaysia-plan.md` section 5).
- Landing: `https://joyorogo.com/sg`, English as written in Singapore, `og-sg.png` (`bun run og:sg`), `hreflang="en-SG"` on `/`, `/my` and `/sg` with `x-default` on `/`, sitemap alternates, prerendered no-JS content, JSON-LD `inLanguage: "en-SG"`. `/` shows a dismissible English notice "In Singapore? See the Singapore version" when `/api/config` reports country SG.
- Prices: S$ on `/sg` from `/api/config` (`sgd`), only when both `POLAR_PRICE_*_SGD_CENTS` are set. Values and how they were chosen: `docs/pricing.md`, "Ringgit and Singapore dollar prices".

## Left

1. Create the SGD prices on the two Polar products (and MYR), see `docs/pricing.md`; confirm in a sandbox checkout from a Singapore IP that the order currency is `SGD`.
2. Ask Polar in writing whether it registers for Singapore GST on overseas digital services (Singapore taxes them; whether Polar as merchant of record does is `[UNVERIFIED]`).
3. A Singapore privacy notice for the Personal Data Protection Act 2012. `/sg` links the English notice written for Malaysia's PDPA (`/my/privacy`) and says so. Counsel decides what Singapore needs.
4. A Singapore eval set (40 to 60 hawker photos) before any "knows Singapore dishes" post; HPB's reuse terms read as in `malaysia-plan.md` section 2, confirm in writing.
5. Native-speaker review of the Singapore English copy and of the hawker prompt (Singlish and Hokkien dish names).
