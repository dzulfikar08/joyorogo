# Barcode lookup sources: evaluation for Indonesian (GS1 899) products

Researched 2026-10-17. Raw test list: [`barcode-899-testlist.json`](barcode-899-testlist.json) (37 codes, every one passes the GTIN check digit, every one carries an `evidence` entry). What was built from it: section 8 and [barcode-community.md](barcode-community.md).

## TL;DR

- Open Food Facts (OFF) is the only free, key-less, redistributable source that returned usable data for Indonesian products. On 29 popular 899-prefix codes it had **25 present (86 %)**, but only **17 with kcal (59 %)**; 4 missing, 8 present-but-no-kcal.
- USDA FoodData Central: **0/10** hits on Indonesian and Indofood UPC-A codes. UPCitemdb free: **5/37 correct names** (+1 wrong), never kcal. Every other nutrition-capable API is paid, US/UK-centric or both. None is worth integrating now.
- The practical way to raise coverage is to write label data back to OFF through the user (section 6), plus OFF name search as "similar products" suggestions.
- The official OFF product-read limit is now **15 req/min/IP**, not 100. In our run 10 of 37 sequential requests at about 1 req/s got HTTP 429.

## 1. Method

1. Test list: 35 popular snacks/drinks plus the 2 prod cache misses. Codes were taken from Indonesian store/POS stock lists (public Scribd uploads such as an Indomaret item list, an Indomarco catalogue and warung stock lists), each checked with the GTIN check digit; all 35 non-prod codes appear in at least 2 sources (separate stock-list uploads, OFF, or barcodelive). These lists are **test evidence only**: they are "All Rights Reserved" uploads and MUST NOT be ingested.
2. 31 of 37 codes have a 899 prefix. Six are Indofood/Kusuka codes printed as UPC-A (`0 89686…`, `653314…`) that normalise to `0…` EAN-13: Chitato, Qtela, Indomie, Lay's, Pop Mie, Kusuka. They are not 899, but users scan them, so they are in the list and reported separately. 29 of the 31 899-codes are popular picks (independent of OFF); 2 are prod misses (selected because they missed, so they bias the 31-code rates downward).
3. OFF classification mirrors `parseOffProduct`/`classifyProduct` in `packages/api/src/lib/barcode.ts`: name = `product_name`, else `product_name_id`, else `generic_name`; kcal = `energy-kcal_100g`, else kJ/4.184; "found + kcal" = name and plausible kcal; "found, no kcal" = name but no kcal; "missing" = 404 / status 0.
4. Requests: OFF with `User-Agent: JoyoRogo/1.0 (dzulfikar@joyorogo.com)`, retried with back-off on 429, then paced at 2 s or more. UPCitemdb at 11 s pacing. USDA with `DEMO_KEY`.
5. Prod cache (`barcode_product`, read-only SELECT): 12 rows, 6 with 899 prefix; 2 of those 6 are `not_found` (`8997219010406`, `8997235180305`). The 4 found: `8997032680381` Taro Net Mix Teriyaki Bbq 62gr, `8997009781110` Hydro Coco ori 500ml, `8997240602533` Wholegrain Oat Cereal Bar, `8992761145026` Sprite. The other 4 `not_found` rows are non-899: ISBN `9787619061660`, `3974444308145`, `8885013131970`, and Indofood UPC-A `0089686737004`.
   - `8997235180305` = "Cleo Purified Drink Water 1l" per the public Go-UPC web page (see Go-UPC note). `8997219010406`: no source returned a name.

## 2. (a) Comparison

"ID coverage" is measured on our 37-code list (hits/N; N differs where a source was only sampled). Limits and prices are quoted from official pages in section 4.

| Source | Commercial use | Rate limit | Cost | Barcode lookup | kcal + macros | ID coverage on our list | Key needed | Verdict |
|---|---|---|---|---|---|---|---|---|
| **OFF v2 product** (`world.` / `id.openfoodfacts.org`, identical data) | Yes. ODbL: attribution + share-alike; DbCL contents; images CC-BY-SA | 15 req/min/IP product reads; 503 on global limit; per user if requests come from users' devices | Free | Yes, per GTIN (UPC-A zero-padded) | kcal/100 g + protein/carbs/fat; fibre often null | present 29/37; kcal 18/37 (899 only: present 25/31, kcal 17/31) | No (custom User-Agent) | **Keep as primary** |
| OFF search-a-licious (`search.openfoodfacts.org`) | Same ODbL data | Not documented [unverified] | Free | Name search + `code:` filter, not a GTIN endpoint | Returns `nutriments` | name hit under another barcode for 2-3 of 6 named misses | No | **Add** as suggestion fallback |
| OFF v1 `cgi/search.pl` / v2 `api/v2/search` | Same | 10 req/min/IP | Free | Name / tag filters | yes | 0 (503 on 4 of 4 attempts) | No | Skip (not usable anonymously now) |
| OFF data dumps (JSONL/Parquet/CSV, nightly) | Same ODbL duties | n/a (download) | Free | Local lookup after import | Full | 4,364 products `code:899*`, 1,353 with kcal (index count) | No | **Next**: local Indonesia mirror |
| USDA FoodData Central, branded | Yes, CC0, citation requested | 1,000 req/h per key (DEMO_KEY documented 30/h, 50/day; header showed 10) | Free | `foods/search?query=<gtin>&dataType=Branded` (GTIN search per FAQ; positive control not completed [unverified]) | Full label nutrients | **0/10** sampled (5 of 899, 5 Indofood UPC-A) | Yes (api.data.gov) | Skip (US-centric) |
| FatSecret Platform | Basic: "testing and evaluation"; Premier: white label | Basic not published; Premier unlimited | Basic free; Premier by quote | **Premier only** (`food.find_id_for_barcode`) | Full | Not measured (no Premier access) | Yes (OAuth2) | Skip until a quote exists |
| Nutritionix | Sales contact | n/a | **No public free tier** | `v2/search/item?upc=` | Full | Not measured; branded region US or UK only | Yes | Skip |
| Edamam Food Database | Yes on paid plans, attribution required | 50 UPC req/min on the $14 plan | From $14/month (30-day trial); no free plan listed | Yes (UPC) | kcal/protein/carbs/fat | Not measured; "790,000 unique UPCs" | Yes | Skip (US-centric; caching limited to FoodId/Label on the $14 plan) |
| UPCitemdb | Licence "solely for Customer's operations"; redistribution not addressed [unverified] | Free: 100 combined requests/day (6/min burst per task brief [unverified]) | Free; DEV $99/month | Yes | **None** (title, brand, category) | 6/37 hits, 5 correct, 1 wrong | No (free tier) | Skip |
| Go-UPC | Terms bar redistributing / publishing Product Data | 5,000 req/month on the base plan | $74.95/month | Yes | None (name, image) | Not measured (paid) | Yes | Skip |
| Barcode Lookup | Paid | 100 req/min max (search snippet) | Pricing page blocked (403) [unverified] | Yes | None | Not measured | Yes | Skip |
| EAN-Search | Paid API | 5,000 queries/month on Pro | EUR 19/month | Yes | None | Not measured | Yes (token) | Skip |
| OFF sister DBs (Beauty/Pet/Products Facts) | Same ODbL | Same family | Free | Yes | n/a | 0/8 on OFF misses | No | Skip |
| Open Product Data / brocade.io | n/a | n/a | n/a | n/a | n/a | Unreachable (TLS / connection error) | n/a | Defunct [unverified] |
| BPOM Cek Produk / Satu Data BPOM | No licence text found [unverified] | n/a | Free to browse | **No**: keyed by registration no. (MD/ML) | **No** nutrition | n/a | n/a | Skip (cannot map barcode to product) |
| Verified by GS1 | **Internal use only**, no redistribution | 30 queries / 24 h | Free | Yes | **No** (company/owner data) | n/a | No (web UI) | Skip |
| Kaggle / TKPI (Kemenkes) | Licence not verified [unverified] | n/a | Free | **No barcode key** | Generic foods | n/a | n/a | Skip for barcodes |

All REST sources above are plain HTTPS and can be called from a Cloudflare Worker (the existing OFF client already does). Workers limits: 50 subrequests per invocation on Free, 10,000 on Paid, 6 concurrent connections ([limits](https://developers.cloudflare.com/workers/platform/limits/)).

## 3. (b) Measured hit rates

### OFF by barcode (world and id gave identical classes for all 37)

| Set | N | found + kcal | found, no kcal | missing | no name |
|---|---|---|---|---|---|
| 899, popular picks | 29 | **17 (59 %)** | 8 (28 %) | 4 (14 %) | 0 |
| 899, incl. 2 prod misses | 31 | 17 (55 %) | 8 (26 %) | 6 (19 %) | 0 |
| Indofood/Kusuka UPC-A (not 899) | 6 | 1 | 3 | 2 | 0 |
| All | 37 | 18 (49 %) | 11 (30 %) | 8 (22 %) | 0 |

Quality notes on the 18 "found + kcal": protein/carbs/fat present 18/18, fibre only 9/18. By my reading two look like per-serving values stored as per-100 g (Good Day Cappuccino 110 kcal; Frisian Flag SKM 130 kcal) [my judgement, not verified]. One present row has `product_name` equal to its barcode (Biskuat `8992716108816`) and one is named just "cassava" (Kusuka). 5 of 29 present products carry a non-Indonesian country tag (Oreo, SilverQueen: France; Good Day: Singapore; Kopiko: Poland; Chitato: Spain), so `countries_tags_en=indonesia` filters would miss them.

Index context from search-a-licious on 2026-10-17 (indexed product counts): `countries_tags:"en:indonesia"` 4,693; `code:899*` 4,364; both 2,633; `code:899*` with `nutriments.energy-kcal_100g` in [0,1000] 1,353.

### OFF name search (search-a-licious) for the 8 code-misses

A "name match under another barcode" is my judgement from the top 5 hits; I cannot tell whether those are wrong barcodes or other pack sizes.

| Missing code | Product | Name hit under a different barcode? |
|---|---|---|
| `8991102300322` | Tango Wafer Coklat 20g | Yes: "Tango Wafer Chocolate" `8991102374309` (+ vanilla, strawberry) |
| `8996006120014` | Fruit Tea Apel 200ml | Yes: "Fruit Tea Apel" `8996006853387` (36 kcal), `8996006858085` |
| `0089686060065` | Pop Mie Ayam Bawang | Likely: "ayam bwng(kecil)" Pop Mie `0089686061024` |
| `8999999191368` | Taro Net Chicken 70g | No (Taro Net exists; seaweed and others, not chicken) |
| `8994075230412` | Momogi Keju Twist | No (only generic "MoMogi" `8994075260013`) |
| `0089686596564` | Lay's Sapi Panggang | No (other Lay's flavours exist) |
| `8997235180305` | Cleo water 1 l (prod miss) | No hit |
| `8997219010406` | unknown (prod miss) | Not searchable |

So 2-3 of 6 named misses have a candidate; every candidate needs human confirmation before any nutrition is used.

### Other sources (same list)

| Source | Tested | Hits | Notes |
|---|---|---|---|
| UPCitemdb trial | 37 | 6 (5 correct) | Correct: Roma Coconut biscuits, Garuda Kacang Atom, Mie Sedaap Goreng (case pack), Oishi Pillows, Indomie (24-pack). `8994075230412` (Momogi) returned "Dagashi C Mix Sweets Gift Box": wrong. No kcal field. `X-RateLimit-Remaining` 62 of 100 after 38 requests. |
| USDA FDC (`DEMO_KEY`) | 10 (Pocari, Oreo ID, Beng-Beng Maxx, Mie Sedaap, Le Minerale; Indomie, Chitato, Qtela, Pop Mie, Lay's UPC-A) | **0** | After these 10 the key returned 429 `OVER_RATE_LIMIT` (header limit 10). A positive control (search a known US UPC) was attempted 6 more times over 2+ hours and always got 429, so GTIN-search behaviour rests on the FDC FAQ, not on a test [unverified]. |
| OFF sister DBs (Beauty/Pet/Products) | 8 OFF misses x 3 | 0 | |
| Open Product Data | 1 | unreachable | TLS handshake error |
| OFF `cgi/search.pl`, `api/v2/search` (world and id) | 4 attempts | 0 | HTTP 503: "the page you requested is not available to anonymous users" |
| Not run (need paid/secret access) | FatSecret, Nutritionix, Edamam, Go-UPC, Barcode Lookup, EAN-Search | n/a | See section 4 |

### Per-code results

OFF column is the same on `world.` and `id.`; kcal is per 100 g/ml as the app would read it.

| Code | Product | OFF by code | kcal | UPCitemdb | Name search |
|---|---|---|---|---|---|
| `8991102300322` | Tango Wafer Coklat 20g | **missing** | – | miss | name: Tango Wafer Chocolate 8991102374309 (pack?) |
| `8992760223022` | Oreo Chocolate Cream biscuit (Indonesia pack) | found + kcal | 483 | miss |  |
| `8997035563544` | Pocari Sweat 350ml | found + kcal | 24 | miss |  |
| `8996001600146` | Teh Pucuk Harum 350ml | found + kcal | 29.2 | miss |  |
| `8996001355756` | Beng-Beng Maxx 32g | found + kcal | 500 | miss |  |
| `8991001121400` | SilverQueen Almond 68g | found + kcal | 550 | miss |  |
| `8991002103764` | Good Day Cappuccino 10x25g | found + kcal | 110 | miss |  |
| `8998009010569` | Ultra Milk Coklat 200ml | found + kcal | 80 | miss |  |
| `8996001301142` | Roma Biskuit Kelapa 300g | found + kcal | 478.3 | hit |  |
| `8999999191368` | Taro Net Chicken 70g | **missing** | – | miss | Taro Net exists, no Chicken flavour |
| `8994075230412` | Momogi Keju Twist | **missing** | – | hit (WRONG name: "Dagashi C Mix Sweets Gift Box") | only generic "MoMogi" 8994075260013 |
| `8996196002954` | Piattos Rumput Laut 85g | found, no kcal | – | miss |  |
| `8993175532464` | Nabati Richeese Wafer Krim Keju 75g | found, no kcal | – | miss |  |
| `8993175537285` | Nabati Richeese Wafer 145g | found + kcal | 466.7 | miss |  |
| `8992775204009` | Garuda Kacang Atom 130g | found + kcal | 520 | hit |  |
| `8998866200301` | Mie Sedaap Goreng 90g | found + kcal | 466.7 | hit |  |
| `8998866201452` | Potabee BBQ 35g | found, no kcal | – | miss |  |
| `8996001600269` | Le Minerale 600ml | found + kcal | 0 | miss |  |
| `8996001600221` | Kopiko 78C Coffee Latte 250ml | found + kcal | 66.7 | miss |  |
| `8992761145026` | Sprite PET 250ml | found, no kcal | – | miss |  |
| `8996006120014` | Fruit Tea Apel 200ml | **missing** | – | miss | name: Fruit Tea Apel 8996006853387 (pack?) |
| `8992907720018` | Sari Roti Sobek Coklat Keju 216g | found + kcal | 327.1 | miss |  |
| `8992716108816` | Biskuat Original 176g | found, no kcal | – | miss |  |
| `8993200661305` | Cimory Yogurt Drink Strawberry | found, no kcal | – | miss |  |
| `8997004301108` | Oishi Snack Pillows Chocolate 130g | found + kcal | 500 | hit |  |
| `8992753101207` | Frisian Flag Susu Kental Manis Putih Kaleng 37 | found + kcal | 130 | miss |  |
| `8996129803504` | Cleo Air Mineral 550ml | found, no kcal | – | miss |  |
| `8992702005945` | Indomilk Coklat Botol 190ml | found, no kcal | – | miss |  |
| `8992775913000` | Chocolatos 3in1 28g | found + kcal | 400 | miss |  |
| `0089686598056` | Chitato Sapi Panggang | found, no kcal | – | miss |  |
| `0089686611519` | Qtela Singkong Original | found, no kcal | – | miss |  |
| `0089686010947` | Indomie Mi Goreng Special 85g | found + kcal | 470.6 | hit |  |
| `0089686596564` | Lay's Rasa Sapi Panggang (BBQ) | **missing** | – | miss | no Lay's sapi panggang; other Lay's flavours exist |
| `0653314504513` | Kusuka Singkong Rumput Laut 60g | found, no kcal | – | miss |  |
| `0089686060065` | Pop Mie Ayam Bawang (cup) | **missing** | – | miss | name: Pop Mie ayam bwng (kecil) 0089686061024 (pack?) |
| `8997219010406` | unknown (no source returned a name) | **missing** | – | miss |  |
| `8997235180305` | Cleo Purified Drink Water 1l | **missing** | – | miss |  |

## 4. (c) Per-source notes (official text relied on)

### Open Food Facts (read)
- API intro: <https://openfoodfacts.github.io/openfoodfacts-server/api/>. "15 req/min/IP address for all read product queries (`GET /api/v*/product` requests or product page). There is no limit on product write queries." and "10 req/min/IP address for all search queries ... don't use it for a search-as-you-type feature". "If your requests come from your users directly (ex: mobile app), the rate limits apply per user." "A HTTP 503 response (Service Not Available) will be returned if these limits are exceeded" (global limits). "We ask you to always use a custom User-Agent ... `AppName/Version (ContactEmail)`". "If you need to fetch more than a few hundred products, we ask you to download the data".
- Measured: 10 of 37 requests at about 1 req/s returned 429, then none at 2 s spacing. Product reads worked while search returned 503 to anonymous traffic.
- API versions: v3 "Current", v2 "Deprecated, still supported", `cgi/search.pl` legacy; "Full-text / plain-text search is not available in the v2 server-side API" (use Search-a-licious).
- Terms: <https://world.openfoodfacts.org/terms-of-use>. "The Open Food Facts database is available under the Open Database License. Individual contents of the database are available under the Database Contents License. Products images are available under the Creative Commons Attribution ShareAlike licence." "The licences are free licences that authorize the use and reproduction of the content for all purposes, including commercial use, under certain conditions, especially the attribution and the sharing under the same condition of derivative works." Re-users "have to mention the licence and to attribute the authorship to Open Food Facts with a link to https://openfoodfacts.org ... or the product page". "Open Food Facts does not guarantee the accuracy of the information and data".
- FAQ: <https://world.openfoodfacts.org/faq> (API & data reuse): "If you combine data from Open Food Facts with other databases, then the ODbL requires that the resulting database must be released as open data as well. It also means that you can combine the data only with sources that would allow such redistribution." Implication: do not blend OFF fields with proprietary-source fields (FatSecret, Edamam, UPCitemdb) in one shared cache table; keep a `source` column and keep sources separate. [legal reading, not legal advice; unverified]
- Data page: <https://world.openfoodfacts.org/data>. "Attribute: You must attribute any public use of the database ... (e.g. "Contains data from Open Food Facts, available under the Open Database License")". "Share-Alike: If you publicly use any adapted version of this database ... you must also offer that adapted database under the ODbL". "Prominent UI attribution: Clearly attribute Open Food Facts in your app or website UI ... with clickable links". Nightly MongoDB / JSONL / CSV / Parquet exports plus 14 days of daily deltas (<https://static.openfoodfacts.org/data/delta/index.txt>).
- Barcode normalisation: <https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization/>: the API "automatically normalizes the barcode passed in the code field"; 9-12 digit codes are padded to 13. Matches `normalizeBarcode`.
- Staging vs production: staging `https://world.openfoodfacts.net` needs basic auth `off` / `off` (HTTP 401 without it, confirmed); "the account you create in the production environment will only work for production requests".
- Cloudflare Worker: callable (plain HTTPS; the current Worker already does it). The per-IP limit then applies to Worker egress addresses [INFERENCE: shared Cloudflare egress, not verified].

### Open Food Facts search-a-licious
- `https://search.openfoodfacts.org/search?q=...&page_size=...&fields=code,product_name,brands,countries_tags,nutriments` returned 200 for 40+ requests at 2-3 s spacing, no key. No official rate limit or terms page found [unverified]. It serves the same ODbL data. Repository: <https://github.com/openfoodfacts/search-a-licious> (AGPL-3.0 code).

### USDA FoodData Central
- API guide: <https://fdc.nal.usda.gov/api-guide/>. "FoodData Central currently limits the number of API requests to a default rate of 1,000 requests per hour per IP address". "USDA FoodData Central data are in the public domain and they are not copyrighted. They are published under CC0 1.0 Universal (CC0 1.0). No permission is needed for their use, but we request that users list FoodData Central as the source of the data."
- Keys: <https://fdc.nal.usda.gov/api-key-signup>. `DEMO_KEY` per <https://github.com/GSA/api.data.gov/blob/main/content/docs/developer-manual/index.md>: "30 requests per IP address per hour", "50 requests per IP address per day"; observed response header `X-Ratelimit-Limit: 10`.
- The FAQ says items can be found by "NDB number, FNDDS Food Code, or GTIN number" (<https://fdc.nal.usda.gov/faq/>).
- Result: 0/10 on Indonesian/Indofood codes. Branded Foods is a US label database; GS1 899 products are not expected. Cloudflare Worker: callable, key as secret.

### FatSecret Platform API
- Barcode method: <https://platform.fatsecret.com/docs/v1/food.find_id_for_barcode>. The method list marks "* Premier Exclusive methods" and includes "Barcode Scanning*"; the OAuth2 scope string is "premier barcode localization" (<https://platform.fatsecret.com/docs/guides/authentication/oauth2>).
- Edition FAQ: <https://platform.fatsecret.com/platform-api>: "We provide testing and evaluation through our Basic fatsecret Platform API which is free." Premier: "White label solution without attribution", "Unlimited API calls with no throttling", "A comprehensive database of UPC codes for barcode scanning"; no price published ("Reach out to the Platform Premier Team"). The claimed "barcode success rate exceeding 90%" is vendor marketing [unverified].
- Localisation: <https://platform.fatsecret.com/docs/guides/localization>: "Localization is a premium feature only made available to select accounts"; region `ID` Indonesia (Indonesian) is in the list. Basic-tier commercial terms and call limits: the terms page returned a server error [unverified].

### Nutritionix
- <https://developer.nutritionix.com/>: "we are no longer able to maintain a public free-access tier"; limited trials only via sales. Docs (Syndigo): `v2/search/item` "Powers UPC Lookup"; `branded_region` "1=US, 2=UK" (<https://docx.syndigo.com/developers/docs/nutritionix-api-guide>). No Indonesia region.

### Edamam Food Database
- <https://developer.edamam.com/food-database-api>: plans $14 / $69 / $299 per month; "30 days Trial period" on the $14 plan only; "UPC requests 50 per minute"; "790,000 unique UPCs/barcodes"; attribution "Required"; "Data caching: FoodId, Food Label" on the $14 plan (kcal/protein/carbs/fat caching only from the next plan up; "Full caching option is available as an add on"). Server-side caching of kcal on the cheap plan is therefore not covered by this table.

### UPCitemdb
- <https://devs.upcitemdb.com/>: Explorer "Free, No Sign up required ... 100 combined requests / day"; DEV $99/month (20,000 lookups/day); responses carry title/brand/category. Terms: <https://devs.upcitemdb.com/termsofservice>: "a limited, non-exclusive, non-transferable and terminable license to access and use the Service solely for Customer's operations". The rate-limit doc page and the "6 requests/minute" figure: pages returned 502 [unverified]. Observed `X-RateLimit-Limit: 100`.

### Go-UPC / Barcode Lookup / EAN-Search (names only)
- Go-UPC: <https://go-upc.com/plans/api> Developer $74.95/month, 5,000 requests/month; terms <https://go-upc.com/terms-and-conditions/>: you may not "Resell, redistribute, or make publicly available the Services or Product Data" and may not use bots "without explicit permission or as part of authorized API usage". I made 2 page fetches of the public web search to name the prod misses; it named `8997235180305` and not `8997219010406`. Not repeated at scale because of that clause.
- Barcode Lookup: <https://www.barcodelookup.com/api-documentation> (search snippet: "A maximum of 100 requests per minute are allowed"); official pages returned 403 to scripted fetch, pricing [unverified].
- EAN-Search: <https://www.ean-search.org/ean-database-api.html>: Pro 5,000 queries/month EUR 19; Trial 100 queries/month; API can "search by product name". Names only; the anonymous web search blocks scripted queries.

### Indonesia-specific
- BPOM Cek Produk (<https://cekbpom.pom.go.id/>): registered products by registration number (MD/ML), brand, packaging, registrant; no barcode, no nutrition panel. Satu Data BPOM lists "APP - Product Master: Product Master API for Cek BPOM Application" (<https://satudata.pom.go.id/datasets/322-app---product-master>); the page is a JS app and showed no licence or terms text [unverified]. Third-party scrapers of cekbpom exist (e.g. <https://datarakyat.id/docs/bpom>); their legality is [unverified]. Not keyed by GTIN, so it cannot answer a scan.
- BPOM label rule: nutrition information on processed-food labels is mandatory (Perka BPOM 26/2021, <https://jdih.pom.go.id/download/rule/1313/26/2021>), so label photos are a legitimate data source for OFF contributions.
- GS1 Indonesia owns prefix 899 (<https://www.gs1.org/barcodes/support/prefix_list>); its product registry (`ui.gs1id.org`) is for members. Verified by GS1 (<https://www.gs1.org/services/verified-by-gs1>) returns mostly company/owner data. ToU (<https://www.gs1.org/docs/verified-by-gs1/verified-by-gs1_tou_2025.pdf>): "You are permitted to enter a maximum of 30 single queries in a twenty-four (24) hour period" and results are "for your internal use only and you may not sell, lease, license, publish, publicise, or otherwise distribute the Query Results". Enterprise API only through the local GS1 office.
- data.go.id: no barcode-keyed nutrition dataset found in my searches. Kaggle: "Indonesian Food and Drink Nutrition Dataset" (<https://www.kaggle.com/datasets/anasfikrihanif/indonesian-food-and-drink-nutrition-dataset>, 1,346 generic foods, no barcode column in the description I saw; licence [unverified]). No Kaggle packaged-food-with-barcode dataset found. Kemenkes TKPI is not barcode-keyed.
- akgizi.com (1,000 FMCG products transcribed from packs): no API, no barcodes visible, terms not reviewed [unverified]; possible partnership target only.

## 5. (d) Recommendation

**Integrate now (free, key-less; caching and showing to users permitted under ODbL with attribution)**
1. Keep OFF v2 product reads as the only barcode source. Add visible attribution (link to the OFF product page plus ODbL wording) on every OFF-sourced result and in About/Privacy; store `source = 'off'` and OFF `last_modified_t` per cache row; do not merge other sources' fields into those rows.
2. After a miss or "no kcal", offer OFF name-search suggestions (search-a-licious) that the user must confirm. Candidates exist for about half of the named misses; never auto-accept.
3. Close the loop with the OFF write API (section 6) so a user's own label entry fills the products we saw missing or without kcal (19 of 37, 51 %).
4. Next iteration: nightly import of the `code:899*` slice of the OFF dump into a separate D1 table. OFF asks heavy users to "build a local cache", and the per-IP limit is the main operational risk for Worker-originated traffic.

**Skip (reason)**
- USDA FDC: 0/10 on Indonesian codes; US label data.
- UPCitemdb: 5/37 correct, 1 wrong name, no nutrition, licence limited to "Customer's operations".
- FatSecret: barcode is Premier-only (quote), no public price. Nutritionix: no free tier, US/UK. Edamam: paid, US-centric, caching limited on the cheap plan. Go-UPC, Barcode Lookup, EAN-Search: paid, names only. Verified by GS1: 30 queries/day, internal use. BPOM: not barcode-keyed, no nutrition. Sister OFF DBs: 0/8.

**Owner actions (accounts only the owner can create)**
1. OFF production app account (required for writes): register at <https://world.openfoodfacts.org/cgi/user.pl>; pick a username (not an email, e.g. `joyorogo-app`); use a mailbox the team owns.
2. OFF staging account (separate database): open <https://world.openfoodfacts.net> (basic auth `off` / `off`), register there, use it for all write tests.
3. Fill the OFF API usage form (the docs ask for it before using the API): <https://docs.google.com/forms/d/e/1FAIpQLSdIE3D8qvjC_zRJw1W8OmuHhsWJ_NSckiiniAHlfaVwUZCziQ/viewform>.
4. Store credentials as Worker secrets in `apps/server`: `wrangler secret put OFF_USER_ID`, `wrangler secret put OFF_PASSWORD` (names are a suggestion).
5. Approve the consent copy and privacy-policy change in section 6 (public, irrevocable licence).
6. Optional: free USDA key at <https://fdc.nal.usda.gov/api-key-signup> (only if US-imported products matter). Optional: ask FatSecret Sales (<https://platform.fatsecret.com/platform-api>, "Contact Sales") for a Premier quote covering barcode plus `ID` localisation.

## 6. (e) OFF write API

**May the app contribute on behalf of users?** Yes, with conditions.
- A shared account is allowed: "You can create a global account to allow your app users to contribute without registering individual accounts on the Open Food Facts website. This way, we know that these contributions came from your application." (<https://openfoodfacts.github.io/openfoodfacts-server/api/>). OFF asks that you send `app_name`, `app_version` and `app_uuid`; `app_uuid` is "a salted random uuid for the user so that Open Food Facts moderators can selectively ban any problematic user without banning your whole app account."
- Contributing back is expected: "if your app allows users to add new products, update nutrition/ingredients, or submit photos, please send those contributions back to Open Food Facts via our API or SDKs." (<https://world.openfoodfacts.org/data>).
- Registration: an account (username, not email) plus the API usage form. The docs I read describe no separate app registration or app token. OAuth2 bearer tokens via Keycloak "will be supported in the future"; the username/password flow "will remain available".
- Auth choices: session cookie from the login API ("the session must always be used from the same IP address", max 10 sessions per user) or `user_id` + `password` in the POST body. Worker egress IPs are not fixed [INFERENCE], so use body credentials, never in a GET.

**Consent and ToU duties** (<https://world.openfoodfacts.org/terms-of-use>)
- "By adding information, data and/or photos, contributors agree to place irrevocably their contributions under the Database Contents Licence 1.0 for information and data, and under the Creative Commons Attribution ShareAlike licence for photos."
- "All contributions are archived and the edit history of the product pages is public ... the public character of contributions cannot be revoked." With a shared account the public identity is the app account; the user's name is not shown.
- "Information and data added by contributors must come directly from the label and packaging of the product." "Photos added by contributors must have been taken by the contributors themselves." "Contributors agree not to add on Open Food Facts information, data and photos from other websites (including other products databases...)". So: never send AI-estimated nutrition or values copied from other APIs; send only what the user typed or OCR'd from their own label photo, and upload that photo ("Photos are source and proof of data").
- Therefore: per-submission explicit opt-in (default off); copy stating "public, permanent, data under DbCL, photo under CC-BY-SA, credited to the JoyoRogo app account"; a Privacy page update (`apps/web/src/routes/privasi.tsx` is already modified in the working tree by another agent, so coordinate); a local record of consent and the `app_uuid` mapping.
- Licence implications: submitted data/photos become irrevocably open; the user's local copy stays ours; re-users must link to the product page; our display of OFF-derived data must credit OFF under the ODbL.

**Endpoint** (documented as the v2 "Edit Product" call; v3 `POST /api/v3/product/{barcode}` also exists but the changelog calls its new nutrition structure "still currently under active development", so I did not verify it [unverified]):

```
POST https://world.openfoodfacts.org/cgi/product_jqm2.pl      (staging: https://world.openfoodfacts.net with Authorization: Basic off:off)
Content-Type: multipart/form-data   (or application/x-www-form-urlencoded)
User-Agent: JoyoRogo/1.0 (dzulfikar@joyorogo.com)

code=8996196002954            # GTIN; API normalises leading zeros
user_id=<app username>        # never the email
password=<app password>
app_name=JoyoRogo
app_version=1.0
app_uuid=<sha1 of (secret salt + our user id)>
comment=Added from the product label via JoyoRogo app
lc=id                         # UI language
lang=id                       # main language of the packaging
product_name_id=Piattos Rumput Laut
brands=Piattos
quantity=85 g
categories=Snacks, Potato chips
countries=Indonesia
serving_size=30 g
nutrition_data_per=100g       # or "serving"; applies to ALL nutriment_* sent together
nutriment_energy-kcal=520     nutriment_energy-kcal_unit=kcal
nutriment_proteins=6          nutriment_proteins_unit=g
nutriment_carbohydrates=58    nutriment_carbohydrates_unit=g
nutriment_fat=29              nutriment_fat_unit=g
nutriment_fiber=3             nutriment_fiber_unit=g
nutriment_sugars=4            nutriment_sugars_unit=g
nutriment_salt=1.2            nutriment_salt_unit=g
# no nutrition panel on the pack:   no_nutrition_data=on
# append to an already filled tag field:   add_categories=..., add_brands=...
```

Example values are illustrative, not a real label. Success body: `{"status_verbose":"fields saved","status":1}`. Without credentials, staging returned `{"status_verbose":"no user credentials","status":0}` (observed by me). Parameter names come from the official request-body schema (`nutriment_<nutrient_id>`, `nutriment_<nutrient_id>_unit`, `nutrition_data_per`, `serving_size`, `app_*`, `comment`): <https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/requestBodies/add_or_edit_a_product.yaml>, <https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/products/post-cgi-product_jqm2.pl/>, cheatsheet <https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/>. The `energy-kcal` plus `_unit=kcal` pair follows the schema's nutrient-id examples ("energy-kj, energy-kcal, fat..."); a full write was **not** executed (no account), so end-to-end acceptance on staging is [unverified].

Photo upload: `POST /cgi/product_image_upload.pl` (multipart; fields `code`, `imagefield` such as `nutrition_id`, `front_id`, `ingredients_id`, and `imgupload_<imagefield>` with the binary; gif/jpeg/jpg/png/heic; same auth) per <https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/requestBodies/add_photo_to_existing_product.yaml>. API v3.3 has a structured `/api/v3.3/product/*/images` alternative.

**Operational rules from the docs**: no rate limit on product writes; "Queue WRITE requests", retry 429/5xx with exponential back-off and jitter, do not retry other 4xx; test on staging first; send a descriptive `User-Agent`.

## 7. Caveats

- Names in the test list come from retailer-entered stock lists, not from packaging; the check digit rules out typos but not mislabelled rows. Results describe 37 codes, not the whole Indonesian market. `[unverified]` marks anything I could not confirm from official text.
- OFF values are live data and change; counts reflect 2026-10-17.
- USDA: no positive control completed (see section 3); the 0/10 is consistent with a US-only label database but the GTIN query form itself is [unverified].

## 8. Decision and what shipped (2026-10-17)

**Sources.** Open Food Facts stays the only external source (`lib/barcode-sources.ts`); nothing else is free, key-less *and* covers Indonesia (USDA 0/10, UPCitemdb 5/37 names only, everything else paid or Premier-only). No new Worker secret is needed. Name-search suggestions (search-a-licious) and the nightly 899 mirror were not built: neither raises the hit rate by itself, and the mirror is only worth it if OFF's 15 req/min/IP limit starts returning 429 to Worker traffic.

**Our own database.** The lever is user-fed: label photo -> vision model -> confirm form -> shared row (`source = 'label_photo'`, `contributors`), second user confirms or overrides. Design, trust rules and migration: [barcode-community.md](barcode-community.md).

**Hit rate on the 899 list, before vs after** (the production lookup code run live on 2026-10-17 over the 29 popular 899 codes, in-memory cache, OFF as the only source):

| | found with kcal | name only (incomplete) | not found |
|---|---|---|---|
| before (OFF only) | 17 / 29 (59 %) | 8 (28 %) | 4 (14 %) |
| after, by source: `off` | 17 / 29 (59 %) | 8 | 4 |
| after, by source: `label_photo` | 0 until users contribute | | |

The lookup itself does not change the lookup-source numbers (no other source qualified), so the gain is the share of misses that now has a way out: 12 of 29 popular codes (41 %) end in "Foto label gizinya" instead of manual typing, and every code a user photographs is complete for everybody after that. Projection, not a measurement: if the label flow completes all of them, coverage on this list goes from 59 % to 100 %; a real figure needs prod contributions.

**Label reader accuracy** (vision model `@cf/google/gemma-4-26b-a4b-it`, our prompt, public OFF nutrition photos of 899 products, 24 photos, one call each, 17 s total for all):

- kcal agrees with the OFF value (either column) on 19 / 24 (79 %); protein 18 / 24, carbs 16 / 24, fat 19 / 24, sugar 18 / 23. OFF is not ground truth: I opened the three kcal disagreements that looked suspicious. Sedaap Ayam Bawang: the model read the panel exactly (320 kcal per 70 g, 14 / 8 / 42 / 5 / 2) and OFF's entry is wrong. Blackthins: kcal right, protein, carbs and fat misaligned between rows; the draft carries an `implausible` warning, so the user must fix it. ABC Mi Goreng: a sideways, multilingual, glare-hit photo (protein 3 vs 10).
- Printed energy absent (sachets, some drinks) -> `no_energy` warning, the form asks the user; very small servings can trip the plausibility check through label rounding (Agar Agar, 1.75 g serving).
- On the two "found, no kcal" products of the list that have an OFF nutrition photo (Chitato Sapi Panggang 20 g -> 110 kcal; Indomilk Coklat 190 ml -> 120 kcal), the flow yields complete, plausible per-100 values (550 and 63.2 kcal). The other incomplete products have no photo on OFF, which is why they are incomplete.
