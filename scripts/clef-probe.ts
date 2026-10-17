// Clef probe: can @cf/cloudflare/clef(-flash) improve JoyoRogo food recognition?
// Read docs/ai-clef-probe.md for the method and results. Nothing here touches
// production: it calls Workers AI over REST and reuses the vision pipeline
// (analyzeFoodPhoto) unchanged for the Gemma baseline.
//
//   bun run scripts/clef-probe.ts check            # resolve every photo, build contact sheets
//   bun run scripts/clef-probe.ts run <phase|all>  # gemma oracle menu prechecks rerank portion latency parallel
//   (rerank and portion read the gemma results; run latency and parallel alone, they time single requests)
//   bun run scripts/clef-probe.ts report           # markdown tables from the stored results
//
// Env: CLOUDFLARE_API_TOKEN (default: the wrangler OAuth token, refreshed on
// 401), CF_ACCOUNT_ID (default: the account holding the AI binding),
// CLEF_PROBE_OUT (default /tmp/clef-probe), CONC (parallel requests, default 2;
// the latency phase is always sequential).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { analyzeFoodPhoto, VisionError, type AiRunner } from "../packages/api/src/lib/vision";

const ACCOUNT = process.env.CF_ACCOUNT_ID ?? "b7e6f8457bd39fa37a7eea5249799754";
const OUT = process.env.CLEF_PROBE_OUT ?? "/tmp/clef-probe";
const CONC = Number(process.env.CONC ?? 2);
const UA = { "User-Agent": "joyorogo-clef-probe/1.0 (dzulfikar.at@gmail.com)" };
const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const MODELS = ["clef", "clef-flash"] as const;
type ClefModel = (typeof MODELS)[number];

// $ per million input tokens (workers-ai pricing page, 2026-10-15).
const PRICE_IN: Record<string, number> = { clef: 0.24, "clef-flash": 0.038, gemma: 0.1 };
const PRICE_GEMMA_OUT = 0.3;

// ---------------------------------------------------------------------------
// Dish vocabulary. A group is a set of look-alikes: the candidate list a
// reranker would show for any dish in it. Dishes with no photos are decoys.
// `re` matches a normalized name (see norm), first dish in DISHES order wins.
// ---------------------------------------------------------------------------

type Dish = { id: string; group: string; re: RegExp; hint: string };
const D = (id: string, group: string, re: RegExp, hint: string): Dish => ({ id, group, re, hint });

export const DISHES: Dish[] = [
  D("mie bakso", "mie", /\b(mie|bakmie|bakmi)\s+bakso/, "mi kuning dengan bakso dan kuah bening"),
  D("mie ayam", "mie", /\b(mie|bakmie|bakmi)\s+ayam/, "mi kuning dengan topping ayam cincang berbumbu dan sawi, sering dengan pangsit"),
  D("mie goreng", "mie", /\b(mie|bakmie|bakmi)\s+(goreng|tek tek|aceh|jawa)/, "mi digoreng cokelat dengan kecap, sayur dan telur"),
  D("kwetiau goreng", "mie", /kwetiau|kwetiaw|kuetiau/, "kwetiau pipih digoreng dengan kecap, udang atau bakso"),
  D("bihun goreng", "mie", /bihun|bihon/, "bihun tipis digoreng dengan sayur"),
  D("nasi goreng", "nasi", /nasi\s+goreng|magelangan|nasi\s+gila/, "nasi digoreng cokelat dengan kecap dan bumbu, sering dengan telur"),
  D("nasi uduk", "nasi", /nasi\s+(uduk|gurih)/, "nasi gurih santan khas Betawi, putih keruh, dengan bawang goreng"),
  D("nasi kuning", "nasi", /nasi\s+kuning|tumpeng/, "nasi kunyit berwarna kuning cerah"),
  D("nasi liwet", "nasi", /nasi\s+liwet/, "nasi liwet gurih dari daun salam dan serai, dalam daun pisang"),
  D("nasi putih", "nasi", /nasi\s+(putih|polos)|^nasi$|steamed rice|white rice/, "nasi putih polos tanpa bumbu"),
  D("perkedel", "gorengan", /perkedel|bergedel|begedil|frikadel/, "adonan kentang tumbuk pipih bulat digoreng, tanpa isian"),
  D("bakwan", "gorengan", /bakwan(?! malang)|bala bala|ote ote/, "gorengan sayur (kol, wortel, taoge) atau jagung berbalut tepung, bentuk tidak beraturan"),
  D("tahu isi", "gorengan", /tahu\s+(isi|berontak)|isi\s+tahu/, "tahu goreng yang dibelah dan diisi sayur atau soun"),
  D("tahu goreng", "gorengan", /tahu\s+(goreng|crispy|krispi|bulat|walik)|^tahu$/, "potongan tahu digoreng polos atau bertepung"),
  D("tempe goreng", "gorengan", /tempe|tempeh|mendoan/, "irisan tempe tipis digoreng, cokelat keemasan"),
  D("risoles", "gorengan", /risol|rissole/, "kulit dadar tepung berisi ragout, dibalur tepung roti lalu digoreng"),
  D("rolade", "gorengan", /rolade|roulade|rollade/, "gulungan daging cincang berlapis dadar, diiris"),
  D("lumpia", "gorengan", /lumpia|spring roll/, "kulit tipis digulung berisi rebung atau ayam, digoreng"),
  D("pisang goreng", "gorengan", /pisang\s+goreng|goreng\s+pisang|banana fritter|fried banana/, "pisang berbalut tepung digoreng"),
  // geprek/penyet are one dish here: both are smashed fried chicken with sambal.
  D("ayam geprek", "ayam", /geprek|penyet/, "ayam goreng tepung renyah yang digeprek bersama sambal bawang pedas"),
  D("ayam bakar", "ayam", /ayam\s+(bakar|panggang)|grilled chicken/, "ayam dibakar, kulit gelap bergaris arang, bumbu kecap manis"),
  D("ayam goreng", "ayam", /ayam\s+(goreng|kremes|kalasan|pop|crispy|kentucky)|fried chicken/, "potongan ayam digoreng berbumbu, kuning kecokelatan, kadang dengan kremes"),
  D("bebek goreng", "ayam", /bebek|duck/, "bebek goreng berbumbu, kulit renyah"),
  D("soto", "kuah", /\b(soto|sauto|tauto)\b/, "sup kuah kekuningan berisi suwiran ayam atau daging, soun, telur, bawang goreng"),
  D("rawon", "kuah", /rawon/, "sup daging berkuah hitam pekat dari kluwek"),
  D("bakso", "kuah", /\bbakso\b/, "bola daging bulat dalam kuah bening dengan mi dan sayur"),
  D("coto", "kuah", /\b(coto|konro)\b/, "sup daging Makassar kuah cokelat keruh"),
  D("sop buntut", "kuah", /sop\s+buntut|sup\s+buntut|oxtail/, "sup buntut sapi dengan wortel dan kentang"),
  D("sop", "kuah", /\b(sop|sup)\b/, "sup bening sayur dengan wortel, kentang, kol dan daging atau ayam"),
  D("sate ayam", "sate", /sate.*ayam|ayam.*sate|chicken satay|sate taichan/, "tusukan kecil daging ayam dibakar dengan bumbu kacang"),
  D("sate kambing", "sate", /sate\s+(kambing|domba)|goat satay/, "tusukan daging kambing lebih besar, dibakar dengan kecap dan bawang"),
  D("sate padang", "sate", /sate\s+padang/, "sate daging dengan kuah kental cokelat kekuningan"),
  D("sate lilit", "sate", /lilit/, "daging cincang dililit di batang serai, khas Bali"),
  D("es campur", "minuman", /es\s+(campur|buah)/, "es serut dengan aneka isian (alpukat, kolang-kaling, nangka) dan sirup"),
  D("es cendol", "minuman", /cendol|dawet/, "es dengan cendol hijau, santan dan gula merah"),
  D("es teh", "minuman", /es\s+teh|teh\s+(manis|es|dingin)|iced tea/, "teh manis dingin dengan es batu dalam gelas, cokelat kemerahan"),
  D("es jeruk", "minuman", /es\s+jeruk|jeruk\s+(peras|es)|orange juice/, "perasan jeruk dengan es, kuning-oranye keruh"),
  D("kopi", "minuman", /kopi|coffee/, "kopi hitam atau kopi susu dalam gelas atau cangkir"),
  D("gado-gado", "sayur kacang", /gado/, "sayuran rebus dengan lontong dan tahu tempe, disiram bumbu kacang"),
  D("pecel", "sayur kacang", /pecel(?! lele)/, "sayuran rebus dengan sambal kacang pedas, sering dengan peyek"),
  D("karedok", "sayur kacang", /karedok/, "sayuran mentah (kol, kacang panjang, timun) dengan bumbu kacang"),
  D("ketoprak", "sayur kacang", /ketoprak/, "tahu, lontong, bihun dan taoge dengan bumbu kacang"),
  D("rendang", "daging", /rendang|randang/, "daging sapi masak kering bumbu santan dan rempah, cokelat gelap"),
  D("semur", "daging", /semur/, "daging berkuah kecap manis cokelat"),
  D("gulai", "daging", /gulai(?! nangka)|\bkari\b/, "daging berkuah santan kuning atau oranye"),
  D("dendeng balado", "daging", /dendeng/, "dendeng sapi tipis digoreng dengan sambal balado merah"),
  D("pempek", "ikan", /pempek|empek/, "adonan ikan dan sagu (kapal selam, lenjer, kulit) dengan kuah cuko cokelat"),
  D("siomay", "ikan", /siomay|shumai|somay/, "adonan ikan kukus bersama tahu, kentang, kol, bumbu kacang"),
  D("batagor", "ikan", /batagor/, "bakso ikan dan tahu goreng dengan bumbu kacang"),
  D("otak-otak", "ikan", /otak/, "adonan ikan dalam daun pisang dibakar"),
  D("martabak telur", "martabak", /martabak\s+(telur|telor)|murtabak|^martabak$/, "martabak gurih berisi telur dan daging, dipotong persegi"),
  D("martabak manis", "martabak", /martabak\s+manis|terang bulan/, "martabak tebal manis berisi cokelat, keju atau kacang"),
  D("gudeg", "gudeg", /gudeg/, "nangka muda dimasak manis cokelat, dengan telur, krecek, ayam"),
  D("opor ayam", "gudeg", /opor/, "ayam berkuah santan putih kekuningan"),
  D("sayur nangka", "gudeg", /(gulai|sayur)\s+nangka|nangka muda/, "nangka muda berkuah santan"),
];

const DISH_BY_ID = new Map(DISHES.map((d) => [d.id, d]));

/** Names that are on the plate but outside the vocabulary: valid menu choices, never rerank groups. */
const MENU_EXTRAS = [
  "nasi padang", "nasi campur", "pecel lele", "ikan bakar", "ikan goreng", "telur dadar",
  "telur balado", "telur ceplok", "capcay", "tumis kangkung", "sayur asem", "sayur lodeh",
  "lontong sayur", "ketupat sayur", "bubur ayam", "burger", "pizza", "roti bakar", "donat",
  "kue lapis", "klepon", "onde-onde", "cilok", "cireng", "combro", "kerupuk", "sambal",
  "lalapan", "jus alpukat", "teh tarik", "susu", "air putih", "nugget", "kentang goreng",
  "sandwich", "salad", "spaghetti", "cumi goreng", "udang goreng", "rujak", "kolak",
  "dadar gulung", "lemper", "pastel", "bubur kacang hijau", "mie rebus", "sup ayam",
];
const MENU = [...DISHES.map((d) => d.id), ...MENU_EXTRAS];

export function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bmi\b/g, "mie")
    .replace(/\bbaso\b/g, "bakso")
    .replace(/\bempek empek\b/g, "pempek")
    .trim();
}

/** Canonical dish id for a free-text name, or null when it is outside the vocabulary. */
export function canon(name: string): string | null {
  const n = norm(name);
  return DISHES.find((d) => d.re.test(n))?.id ?? null;
}

const groupOf = (id: string) => DISH_BY_ID.get(id)!.group;
const groupMembers = (group: string) => DISHES.filter((d) => d.group === group).map((d) => d.id);

// ---------------------------------------------------------------------------
// Photo set: curated Wikimedia Commons files (same source as bench-accuracy.ts).
// `file` is the Commons file title; the 960 px thumbnail is fetched at run time.
// ---------------------------------------------------------------------------

type Single = { label: string; file: string; bench?: { min: number; max: number } };
const S = (label: string, files: string[]): Single[] => files.map((file) => ({ label, file }));

export const SINGLES: Single[] = [
  // The eight photos of scripts/bench-accuracy.ts, with its kcal bands.
  { label: "nasi goreng", file: "Nasi goreng indonesia.jpg", bench: { min: 350, max: 700 } },
  { label: "sate ayam", file: "Sate Ayam Al-Huda Jember.jpg", bench: { min: 250, max: 600 } },
  { label: "bakso", file: "Bakso Indonesian Meatball Soup from Solo.jpg", bench: { min: 250, max: 600 } },
  { label: "gado-gado", file: "Gado-gado in Jakarta.JPG", bench: { min: 250, max: 600 } },
  { label: "rendang", file: "Beef Rendang..JPG", bench: { min: 300, max: 700 } },
  { label: "mie ayam", file: "Mi ayam jamur.JPG", bench: { min: 350, max: 700 } },
  { label: "es teh", file: "Glass of iced tea - Evan Swigart.jpg", bench: { min: 10, max: 120 } },
  { label: "pisang goreng", file: "Pisang Goreng.jpg", bench: { min: 200, max: 500 } },
  ...S("perkedel", ["Perkedel.JPG", "Perkedel kentang.JPG", "Perkedel masakan Padang.JPG", "Perkedel kentang tanpa daging.JPG"]),
  ...S("bakwan", ["Bakwan (gorengan).jpg", "Bakwan.jpg", "Bakwan Sayur.jpg", "Makanan Bakwan Goreng Di Kebumen Jateng Indonesia.jpg"]),
  ...S("tahu isi", ["Tahu isi goreng plus cabe rawit.jpg", "Tahu isi goreng di pemandian patemon.jpg"]),
  ...S("tahu goreng", ["Tahu Goreng.jpg", "Tahu digoreng.JPG", "TAHU GORENG.jpg", "Tahu goreng.JPG"]),
  ...S("tempe goreng", ["Tempe Goreng.jpg", "Tempe goreng snack.JPG", "Tempe Goreng Garing.jpg"]),
  ...S("risoles", ["Risol.jpg", "Risoles - CFD Jombang.jpg", "Risoles jumbo.jpg", "Risoles dengan Isi.jpg", "Kue risoles.JPG"]),
  ...S("pisang goreng", ["Pisang goreng fried banana.JPG", "Pisang goreng snack.jpg", "Sepiring Pisang Goreng.jpg"]),
  ...S("ayam goreng", ["Javanese fried chicken.JPG", "Ayam goreng kalasan, sleman.jpg", "Ayam Goreng Kunyit.jpg", "Ayam Goreng 203748.jpg"]),
  ...S("ayam bakar", ["Ayam bakar khas Taliwang.JPG", "Ayam bakar Aie Badarun.JPG", "Ayam Bakar Bali.jpg", "Ayam bakar paha.jpg"]),
  ...S("ayam geprek", ["Ayam geprek.jpg", "Ayam geprek pedas.jpg", "Ayam geprek dan lalapan.jpg", "Ayam Geprek Uyat.jpg", "Ayam penyet.jpg"]),
  ...S("nasi uduk", ["Nasi uduk.jpg", "Nasi Uduk with emping.jpg", "Nasi Uduk Box.jpg"]),
  ...S("nasi kuning", ["Nasi kuning.JPG", "Nasi Kuning.jpg", "Nasi Kuning Ibu Sulastri.jpg", "Nasi Kuning Banjar.jpg"]),
  ...S("nasi goreng", ["Nasi Goreng.jpg", "Nasi Goreng Kampung.jpg", "Nasi Goreng Ayam.jpg", "Nasi Goreng Komplit.jpg"]),
  ...S("soto", ["Soto Kediri.JPG", "Soto Pekalongan.jpg", "Soto Soup.jpg", "Soto daging sapi.jpg", "Tiga mangkuk soto ayam.jpg"]),
  ...S("rawon", ["Nasi Rawon A.JPG", "Nasi Rawon-01.jpg", "Rawon Setan.jpg", "Rawon.jpg"]),
  ...S("bakso", ["Bakso.JPG", "Bakso Daging Sapi.jpg", "Bakso in bowl on blue table.jpg", "Bowl of bakso on white table.jpg", "Bakso kuah.jpg"]),
  ...S("mie ayam", ["Mi ayam biasa.JPG", "Mi ayam kuah.JPG", "Mi ayam pangsit kuah.JPG", "Mie Ayam-01.jpg", "Mie ayam pedas.jpg"]),
  ...S("mie goreng", ["Mi goreng.JPG", "Mi goreng tek-tek.JPG", "Mi goreng, Bandung.JPG", "Mie Goreng in Bali.jpg", "Mie goreng kecap.jpg"]),
  ...S("sate ayam", ["Sate ayam Jalan Sabang.JPG", "Sate ayam-Jakarta.JPG", "Sate ayam.jpg", "Sate Ayam di Rumah.jpg"]),
  ...S("sate kambing", ["Sate kambing.JPG", "Sate kambing dan nasi.jpg", "Goat Sate.jpg", "Sate Kambing di Rumah-2.jpg"]),
  ...S("es campur", ["Es Campur.jpg", "Es Campur in a Glass.JPG", "Es Campur 2.JPG", "Es Campur 1.jpg"]),
  // es cendol: the only good photo was dropped; the dish stays a decoy option.
  ...S("es teh", ["ES TEH MANIS.jpg", "Es teh manis.jpg"]),
  ...S("gado-gado", ["Gado gado.jpg", "Gado-gado 3.jpg"]),
  ...S("rendang", ["Rendang dish closeup.jpg", "Rendang daging sapi asli Padang.JPG"]),
  ...S("pempek", ["Pempek campur.JPG", "Pempek kapal selam Bandar Lampung.JPG", "Pempek Kuah Cuko.jpg", "Pempek telor dengan cuka.jpg"]),
  ...S("martabak telur", ["MartabakTelur.JPG", "Martabak telur.JPG", "Martabak telor.jpg"]),
  ...S("gudeg", ["Nasi gudeg nasi kotak.JPG", "Nasi Gudeg.jpg", "Gudeg full set.jpg"]),
];

/** Not food at all. The two empty plates are reported separately: arguably borderline. */
export const NEGATIVES: { kind: "other" | "empty"; file: string }[] = [
  { kind: "other", file: "Cat November 2010-1a.jpg" },
  { kind: "other", file: "Domestic Cat Face Shot.jpg" },
  { kind: "other", file: "Rice terraces, Bali.jpg" },
  { kind: "other", file: "Jakarta skyline 2.jpg" },
  { kind: "other", file: "Desktop with laptop and calculator (Unsplash).jpg" },
  { kind: "other", file: "Borobudur, Java, Indonesia, 20220817 1013 8739.jpg" },
  { kind: "other", file: "Books, pencils, laptop, and iphone on a desk (Unsplash).jpg" },
  { kind: "other", file: "Woman stretches at home office desk while working on laptop.jpg" },
  { kind: "empty", file: "Empty plate with fork.jpg" },
  { kind: "empty", file: "Empty plate and mug at Starmugs Cafe on Lordship Lane Tottenham London England 01.jpg" },
];

/**
 * Plates with several dishes. `items` are the clearly visible dishes the vocabulary can grade;
 * `others` counts visible extras it cannot (sambal, vegetables, crackers), for the item count.
 */
export const MULTI: { file: string; items: string[]; others: number }[] = [
  { file: "Es Teh Tempe Goreng Pisang Goreng Bakwan Goreng Di Kebumen Jateng NKRI.jpg", items: ["es teh", "tempe goreng", "pisang goreng", "bakwan"], others: 0 },
  { file: "Nasi ramas ayam goreng.JPG", items: ["ayam goreng", "nasi putih"], others: 2 },
  { file: "Nasi bakwan udang bakwan teri.JPG", items: ["bakwan"], others: 1 },
  { file: "Nasi uduk telur balado Jkt 11 Juli 18.jpg", items: ["nasi uduk"], others: 3 },
  { file: "Nasi Uduk Jengkol Daging Krecek.JPG", items: ["nasi uduk"], others: 2 },
  { file: "Ayam Goreng Lalapan Komplit.jpg", items: ["ayam goreng", "nasi putih"], others: 1 },
  { file: "Nasi campur mie goreng ayam goreng.jpg", items: ["mie goreng", "nasi putih"], others: 2 },
  { file: "Nasi Padang With beef rendang.jpg", items: ["rendang", "nasi putih"], others: 3 },
  { file: "Tempe and tahu goreng.JPG", items: ["tempe goreng", "tahu goreng"], others: 0 },
  { file: "Set menu Ayam Bakar Tempe Tahu.jpg", items: ["ayam bakar", "nasi putih", "tempe goreng", "tahu goreng"], others: 2 },
  { file: "Sate Ayam dan Sup Bakso.jpg", items: ["sate ayam", "nasi putih"], others: 1 },
  { file: "Nasi goreng dan sate ayam.jpg", items: ["nasi goreng", "sate ayam"], others: 1 },
  { file: "Soto sapi sama sate.jpg", items: ["soto", "nasi putih"], others: 2 },
  { file: "Lalapan ayam.jpg", items: ["ayam goreng", "nasi putih"], others: 1 },
];

// ---------------------------------------------------------------------------
// Plumbing: auth, REST, image cache.
// ---------------------------------------------------------------------------

const wranglerToml = join(homedir(), ".config/.wrangler/config/default.toml");
let tokenCache: string | undefined = process.env.CLOUDFLARE_API_TOKEN;
const usingEnvToken = tokenCache !== undefined;

function readWranglerToken(): string {
  const m = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(wranglerToml, "utf8"));
  if (!m) throw new Error("no CLOUDFLARE_API_TOKEN and no wrangler oauth_token");
  return m[1]!;
}

let refreshing: Promise<void> | undefined;
async function refreshToken(): Promise<void> {
  if (usingEnvToken) throw new Error("CLOUDFLARE_API_TOKEN rejected");
  refreshing ??= (async () => {
    // Any authenticated wrangler call renews the OAuth token on disk.
    execFileSync("bunx", ["wrangler", "whoami"], { cwd: join(import.meta.dir, "../apps/server"), stdio: "ignore" });
    tokenCache = readWranglerToken();
  })().finally(() => {
    refreshing = undefined;
  });
  await refreshing;
}


type CfEnvelope = { success?: boolean; result?: unknown; errors?: unknown };

/** One Workers AI REST call. ms covers the successful attempt only; retries are counted. */
async function cfRun(
  model: string,
  body: unknown,
): Promise<{ result: unknown; ms: number; retries: number }> {
  tokenCache ??= readWranglerToken();
  let retries = 0;
  for (;;) {
    const started = performance.now();
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenCache}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = performance.now() - started;
    if (res.status === 401 && retries < 2) {
      retries++;
      await refreshToken();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && retries < 3) {
      retries++;
      await Bun.sleep(1500 * retries);
      continue;
    }
    const json = (await res.json().catch(() => null)) as CfEnvelope | null;
    if (!res.ok || !json?.success) {
      throw new Error(`${model} HTTP ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}`);
    }
    return { result: json.result, ms, retries };
  }
}

/** The AI binding's `run` shape, backed by REST, so analyzeFoodPhoto runs unmodified. */
const restRunner: AiRunner = { run: async (model, input) => (await cfRun(model, input)).result };

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");
const IMG = join(OUT, "img");
mkdirSync(IMG, { recursive: true });

type Photo = { path: string; mime: string; b64: string; dataUrl: string };
const photos = new Map<string, Photo>();

function register(key: string, path: string): Photo {
  const bytes = readFileSync(path);
  const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
  const b64 = bytes.toString("base64");
  const p = { path, mime, b64, dataUrl: `data:${mime};base64,${b64}` };
  photos.set(key, p);
  return p;
}

function photo(key: string): Photo {
  const p = photos.get(key);
  if (!p) throw new Error(`photo not loaded: ${key}`);
  return p;
}

type CommonsPage = { title: string; imageinfo?: { url: string; thumburl?: string }[] };
type CommonsQuery = {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: Record<string, CommonsPage>;
  };
};

/** File title -> 960 px thumbnail URL (the size class the clients upload: <= 1024 px). */
async function resolveThumbs(files: string[]): Promise<Map<string, string>> {
  const byTitle = new Map<string, string>();
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40);
    const titles = chunk.map((f) => `File:${f}`).join("|");
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url&iiurlwidth=960&titles=${encodeURIComponent(titles)}`;
    const json = (await (await fetch(api, { headers: UA })).json()) as CommonsQuery;
    const rename = new Map<string, string>();
    for (const r of [...(json.query?.normalized ?? []), ...(json.query?.redirects ?? [])]) rename.set(r.from, r.to);
    for (const page of Object.values(json.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (info) byTitle.set(page.title, info.thumburl ?? info.url);
    }
    for (const f of chunk) {
      let t = `File:${f}`;
      for (let hops = 0; hops < 3 && rename.has(t); hops++) t = rename.get(t)!;
      const u = byTitle.get(t);
      if (u) byTitle.set(`File:${f}`, u);
    }
  }
  return byTitle;
}

/** Download (cached on disk) and register every file; throws listing the ones Commons cannot resolve. */
export async function loadPhotos(files: string[]): Promise<void> {
  const need = [...new Set(files)].filter((f) => !photos.has(f));
  const missingOnDisk = need.filter((f) => !existsSync(join(IMG, safe(f))));
  if (missingOnDisk.length > 0) {
    const urls = await resolveThumbs(missingOnDisk);
    const unresolved = missingOnDisk.filter((f) => !urls.has(`File:${f}`));
    if (unresolved.length > 0) throw new Error(`unresolved Commons files:\n${unresolved.join("\n")}`);
    for (const f of missingOnDisk) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(urls.get(`File:${f}`)!, { headers: UA });
        if (res.ok) {
          writeFileSync(join(IMG, safe(f)), Buffer.from(await res.arrayBuffer()));
          break;
        }
        if (attempt >= 5) throw new Error(`download ${f}: HTTP ${res.status}`);
        await Bun.sleep(2000 * (attempt + 1));
      }
      await Bun.sleep(150);
    }
  }
  for (const f of need) register(f, join(IMG, safe(f)));
}

/** ImageMagick derivative of a loaded photo (blur, dark, flip, resize, crop); returns the new photo key. */
function derive(file: string, kind: string, args: string[]): string {
  const key = `${kind}:${file}`;
  if (photos.has(key)) return key;
  const out = join(IMG, `${safe(kind)}-${safe(file)}`);
  if (!existsSync(out)) {
    // Atomic: parallel phase processes share the cache directory.
    const tmp = `${out}.${process.pid}.tmp.jpg`;
    execFileSync("convert", [photo(file).path, ...args, "-quality", "88", tmp], { stdio: "ignore" });
    renameSync(tmp, out);
  }
  register(key, out);
  return key;
}

type ItemBox = [number, number, number, number];

/** Crop to a Gemma box ([ymin,xmin,ymax,xmax], 0-1000) padded by 12% each side. */
function cropKey(file: string, box: ItemBox): string {
  const [w, h] = execFileSync("identify", ["-format", "%w %h", photo(file).path], { encoding: "utf8" })
    .split(" ")
    .map(Number) as [number, number];
  const pad = 120;
  const [y0, x0, y1, x1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad].map((v) => Math.min(1000, Math.max(0, v))) as ItemBox;
  const cw = Math.max(64, Math.round(((x1 - x0) / 1000) * w));
  const ch = Math.max(64, Math.round(((y1 - y0) / 1000) * h));
  const cx = Math.round((x0 / 1000) * w);
  const cy = Math.round((y0 / 1000) * h);
  return derive(file, `crop${box.join("-")}`, ["-crop", `${cw}x${ch}+${cx}+${cy}`, "+repage"]);
}

// ---------------------------------------------------------------------------
// Clef.
// ---------------------------------------------------------------------------

type ClefAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };
type ClefResult = { answers: Record<string, ClefAnswer>; usage: { input_tokens: number; output_tokens: number } };
type Question =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };
type Call = { ms: number; tokens: number; retries: number; answers: Record<string, ClefAnswer> };

async function clef(
  model: ClefModel,
  req: { state: string; photoKey?: string; questions: Record<string, Question> },
): Promise<Call> {
  const body = {
    model,
    state: req.state,
    questions: req.questions,
    ...(req.photoKey ? { images: [photo(req.photoKey).dataUrl] } : {}),
  };
  const { result, ms, retries } = await cfRun(`@cf/cloudflare/${model}`, body);
  // The REST envelope was validated by cfRun; the result shape is the documented output schema.
  const r = result as ClefResult;
  return { ms, tokens: r.usage.input_tokens, retries, answers: r.answers };
}

const STATE = "Foto makanan atau minuman, kemungkinan masakan Indonesia.";

function seeded(key: string): () => number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Variant = "terse" | "described";
type Order = "fwd" | "rev";

/** A choice question over dish ids; option order is a seeded shuffle (reversed for `rev`). */
function choiceQ(options: string[], variant: Variant, order: Order, seed: string, instructions = "Hidangan atau minuman apa yang paling menonjol di foto ini?"): Question {
  const rnd = seeded(seed);
  const shuffled = [...options]
    .map((o) => ({ o, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.o);
  if (order === "rev") shuffled.reverse();
  const criteria: Record<string, string | null> = {};
  for (const o of shuffled) criteria[o] = variant === "described" ? (DISH_BY_ID.get(o)?.hint ?? null) : null;
  return { type: "choice", instructions, criteria };
}

const PORTION_LEVELS = [
  "sangat kecil: kurang dari setengah porsi normal",
  "kecil: sekitar tiga perempat porsi normal",
  "normal: satu porsi rumahan orang dewasa",
  "besar: sekitar satu setengah porsi normal",
  "sangat besar: dua porsi normal atau lebih",
];
const COUNT_LEVELS = ["1 jenis", "2 jenis", "3 jenis", "4 jenis", "5 jenis atau lebih"];

const QUESTION_PRECHECKS: Record<string, Question> = {
  is_food: { type: "noul", instructions: "Apakah foto ini menampilkan makanan atau minuman?" },
  blurry: { type: "noul", instructions: "Apakah foto ini buram atau goyang sehingga hidangannya sulit dikenali?" },
  dark: { type: "noul", instructions: "Apakah foto ini terlalu gelap sehingga hidangannya sulit dikenali?" },
};

// ---------------------------------------------------------------------------
// Stats.
// ---------------------------------------------------------------------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  return s[lo]! + (s[Math.ceil(idx)]! - s[lo]!) * (idx - lo);
}
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "-");
const pc = (num: number, den: number) => (den ? `${((100 * num) / den).toFixed(0)}% (${num}/${den})` : "-");

/** P(random positive scores higher than random negative); ties count half. */
function auroc(pos: number[], neg: number[]): number {
  if (pos.length === 0 || neg.length === 0) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Expected calibration error over equal-width bins of predicted probability. */
function ece(rows: { p: number; ok: boolean }[], bins = 5): number {
  let err = 0;
  for (let b = 0; b < bins; b++) {
    const bin = rows.filter((r) => Math.min(bins - 1, Math.floor(r.p * bins)) === b);
    if (bin.length === 0) continue;
    err += (bin.length / rows.length) * Math.abs(mean(bin.map((r) => r.p)) - mean(bin.map((r) => (r.ok ? 1 : 0))));
  }
  return err;
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    for (let k = i; k <= j; k++) out[order[k]!.i] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

function spearman(x: number[], y: number[]): number {
  if (x.length < 3) return NaN;
  const rx = ranks(x);
  const ry = ranks(y);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
      if (++done % 25 === 0) console.error(`  ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
}

const save = (name: string, data: unknown) => writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data));
const load = <T>(name: string): T => JSON.parse(readFileSync(join(OUT, `${name}.json`), "utf8")) as T;

// ---------------------------------------------------------------------------
// Photo keys used by the phases.
// ---------------------------------------------------------------------------

const DEGRADE_KINDS: Record<string, string[]> = {
  blur3: ["-blur", "0x3"],
  blur12: ["-blur", "0x12"],
  dark45: ["-modulate", "45,100,100"],
  dark15: ["-modulate", "15,100,100"],
};
const degradeBase = () => SINGLES.filter((_, i) => i % 5 === 0).map((s) => s.file);
const degradedKeys = () => degradeBase().flatMap((f) => Object.entries(DEGRADE_KINDS).map(([k, args]) => derive(f, k, args)));
const allFiles = () => [...SINGLES.map((s) => s.file), ...NEGATIVES.map((n) => n.file), ...MULTI.map((m) => m.file)];

// ---------------------------------------------------------------------------
// Phases.
// ---------------------------------------------------------------------------

type GemmaItem = { name: string; kcal: number; grams?: number; confidence?: number; box?: ItemBox };
type GemmaRec = {
  key: string;
  ok: boolean;
  ms: number;
  reason?: string;
  items: GemmaItem[];
  promptTokens?: number;
  completionTokens?: number;
};

function tokenCount(usage: Record<string, unknown> | null, key: string): number | undefined {
  const v = usage?.[key];
  return typeof v === "number" ? v : undefined;
}

async function gemmaOne(key: string): Promise<GemmaRec> {
  const p = photo(key);
  const started = performance.now();
  try {
    const out = await analyzeFoodPhoto(restRunner, { imageBase64: p.b64, mimeType: p.mime });
    return {
      key,
      ok: true,
      ms: performance.now() - started,
      items: out.items.map((i) => ({ name: i.name, kcal: i.kcal, grams: i.grams, confidence: i.confidence, box: i.box })),
      promptTokens: tokenCount(out.usage, "prompt_tokens"),
      completionTokens: tokenCount(out.usage, "completion_tokens"),
    };
  } catch (error) {
    const reason = error instanceof VisionError ? error.reason : "error";
    const usage = error instanceof VisionError ? (error.detail.usage ?? null) : null;
    return {
      key,
      ok: false,
      ms: performance.now() - started,
      reason,
      items: [],
      promptTokens: tokenCount(usage, "prompt_tokens"),
      completionTokens: tokenCount(usage, "completion_tokens"),
    };
  }
}

async function phaseGemma() {
  const keys = [...allFiles(), ...degradedKeys()];
  const recs: GemmaRec[] = [];
  await pool(keys, CONC, async (key) => void recs.push(await gemmaOne(key)));
  save("gemma", recs);
}

type ChoiceRec = {
  key: string;
  label?: string;
  model: ClefModel;
  variant: string;
  order?: Order;
  mode?: string;
  itemIdx?: number;
  gemma?: string;
  canonical?: string;
  choice: string;
  probs: Record<string, number>;
  confidence: number;
  ms: number;
  tokens: number;
};

function choiceOf(call: Call, id: string): { choice: string; probs: Record<string, number>; confidence: number } {
  const a = call.answers[id];
  if (a?.type !== "choice") throw new Error(`no choice answer ${id}`);
  return { choice: a.choice, probs: a.probabilities, confidence: a.confidence };
}

/** Clef alone, closed set: the options are the look-alike group of the true label. */
async function phaseOracle() {
  const jobs = SINGLES.flatMap((s) =>
    MODELS.flatMap((model) => [
      { s, model, variant: "terse" as Variant, order: "fwd" as Order },
      { s, model, variant: "described" as Variant, order: "fwd" as Order },
      { s, model, variant: "described" as Variant, order: "rev" as Order },
    ]),
  );
  const recs: ChoiceRec[] = [];
  await pool(jobs, CONC, async ({ s, model, variant, order }) => {
    const options = groupMembers(groupOf(s.label));
    const call = await clef(model, { state: STATE, photoKey: s.file, questions: { q: choiceQ(options, variant, order, s.file) } });
    recs.push({ key: s.file, label: s.label, model, variant, order, ms: call.ms, tokens: call.tokens, ...choiceOf(call, "q") });
  });
  save("oracle", recs);
}

/** Clef alone, open menu of every dish in the vocabulary plus common extras (~100 options). */
async function phaseMenu() {
  const jobs = SINGLES.flatMap((s) => MODELS.map((model) => ({ s, model })));
  const recs: ChoiceRec[] = [];
  await pool(jobs, CONC, async ({ s, model }) => {
    const call = await clef(model, { state: STATE, photoKey: s.file, questions: { q: choiceQ(MENU, "terse", "fwd", s.file) } });
    recs.push({ key: s.file, label: s.label, model, variant: "menu", ms: call.ms, tokens: call.tokens, ...choiceOf(call, "q") });
  });
  save("menu", recs);
}

type PreRec = { key: string; model: ClefModel; is_food: number; blurry: number; dark: number; ms: number; tokens: number };

async function phasePrechecks() {
  const keys = [...SINGLES.map((s) => s.file), ...NEGATIVES.map((n) => n.file), ...degradedKeys()];
  const jobs = keys.flatMap((key) => MODELS.map((model) => ({ key, model })));
  const recs: PreRec[] = [];
  await pool(jobs, CONC, async ({ key, model }) => {
    const call = await clef(model, { state: STATE, photoKey: key, questions: QUESTION_PRECHECKS });
    const noul = (id: string) => {
      const a = call.answers[id];
      if (a?.type !== "noul") throw new Error(`no noul answer ${id}`);
      return a.noul;
    };
    recs.push({ key, model, is_food: noul("is_food"), blurry: noul("blurry"), dark: noul("dark"), ms: call.ms, tokens: call.tokens });
  });
  save("prechecks", recs);
}

/** Clef as a reranker of what Gemma named: candidates = look-alike group of Gemma's label. */
async function phaseRerank() {
  const gemma = load<GemmaRec[]>("gemma");
  type Job = { key: string; gemmaKey: string; itemIdx: number; gemmaName: string; canonical: string; mode: "whole" | "crop"; label?: string };
  const jobs: Job[] = [];
  for (const s of SINGLES) {
    const item = gemma.find((g) => g.key === s.file)?.items[0];
    const canonical = item ? canon(item.name) : null;
    if (item && canonical) jobs.push({ key: s.file, gemmaKey: s.file, itemIdx: 0, gemmaName: item.name, canonical, mode: "whole", label: s.label });
  }
  for (const m of MULTI) {
    const g = gemma.find((x) => x.key === m.file);
    for (const [idx, item] of (g?.items ?? []).entries()) {
      const canonical = canon(item.name);
      if (!canonical) continue;
      jobs.push({ key: m.file, gemmaKey: m.file, itemIdx: idx, gemmaName: item.name, canonical, mode: "whole" });
      if (item.box) jobs.push({ key: cropKey(m.file, item.box), gemmaKey: m.file, itemIdx: idx, gemmaName: item.name, canonical, mode: "crop" });
    }
  }
  const recs: ChoiceRec[] = [];
  const all = jobs.flatMap((j) => MODELS.map((model) => ({ j, model })));
  await pool(all, CONC, async ({ j, model }) => {
    const options = groupMembers(groupOf(j.canonical));
    const instructions =
      j.mode === "crop"
        ? "Foto ini dipotong di sekitar satu hidangan atau minuman. Apa itu?"
        : `Foto ini punya beberapa item. Item ke-${j.itemIdx + 1} yang disebut "${j.gemmaName}" sebenarnya yang mana?`;
    const q = j.mode === "whole" && j.label ? choiceQ(options, "described", "fwd", j.key) : choiceQ(options, "described", "fwd", j.key, instructions);
    const call = await clef(model, { state: STATE, photoKey: j.key, questions: { q } });
    recs.push({ key: j.gemmaKey, label: j.label, model, variant: "described", mode: j.mode, itemIdx: j.itemIdx, gemma: j.gemmaName, canonical: j.canonical, ms: call.ms, tokens: call.tokens, ...choiceOf(call, "q") });
  });
  save("rerank", recs);
}

type PortionRec = { key: string; variant: string; model: ClefModel; item: string; score: number; levelProbs: Record<string, number>; count: number; ms: number; tokens: number };

async function phasePortion() {
  const gemma = load<GemmaRec[]>("gemma");
  const files = [...SINGLES.filter((_, i) => i % 3 === 0).map((s) => s.file), ...MULTI.map((m) => m.file)];
  const jobs: { file: string; key: string; variant: string; item: string; model: ClefModel }[] = [];
  for (const file of files) {
    const item = gemma.find((g) => g.key === file)?.items[0];
    if (!item) continue;
    const variants: [string, string][] = [
      ["orig", file],
      ["flip", derive(file, "flop", ["-flop"])],
      ["small", derive(file, "small512", ["-resize", "512x512>"])],
    ];
    for (const [variant, key] of variants) for (const model of MODELS) jobs.push({ file, key, variant, item: item.name, model });
  }
  const recs: PortionRec[] = [];
  await pool(jobs, CONC, async (j) => {
    const call = await clef(j.model, {
      state: STATE,
      photoKey: j.key,
      questions: {
        portion: { type: "score", instructions: `Seberapa besar porsi "${j.item}" di foto ini dibanding satu porsi normal rumahan?`, criteria: PORTION_LEVELS },
        count: { type: "score", instructions: "Berapa jenis makanan atau minuman yang berbeda di foto ini?", criteria: COUNT_LEVELS },
      },
    });
    const portion = call.answers.portion;
    const count = call.answers.count;
    if (portion?.type !== "score" || count?.type !== "score") throw new Error("score answers missing");
    recs.push({ key: j.file, variant: j.variant, model: j.model, item: j.item, score: portion.score, levelProbs: portion.probabilities, count: count.score + 1, ms: call.ms, tokens: call.tokens });
  });
  save("portion", recs);
}

type LatRec = { shape: string; model: string; ms: number; tokens: number };

/** Strictly sequential: one request in flight, so numbers are not inflated by our own load. */
async function phaseLatency() {
  const keys = SINGLES.filter((_, i) => i % 5 === 1).map((s) => s.file);
  const recs: LatRec[] = [];
  const bundle: Record<string, Question> = {
    ...QUESTION_PRECHECKS,
    count: { type: "score", instructions: "Berapa jenis makanan atau minuman yang berbeda di foto ini?", criteria: COUNT_LEVELS },
    portion: { type: "score", instructions: "Seberapa besar porsi hidangan utama dibanding satu porsi normal rumahan?", criteria: PORTION_LEVELS },
    dish: choiceQ(groupMembers("gorengan"), "described", "fwd", "bundle"),
    drink: choiceQ(groupMembers("minuman"), "described", "fwd", "bundle2"),
  };
  for (const [n, file] of keys.entries()) {
    const label = SINGLES.find((s) => s.file === file)!.label;
    for (const model of MODELS) {
      const shapes: [string, Parameters<typeof clef>[1]][] = [
        ["text-only, 1 choice", { state: `Hidangan: ${label}`, questions: { q: choiceQ(groupMembers(groupOf(label)), "terse", "fwd", file) } }],
        ["image + 1 choice (group)", { state: STATE, photoKey: file, questions: { q: choiceQ(groupMembers(groupOf(label)), "described", "fwd", file) } }],
        ["image + 7 questions", { state: STATE, photoKey: file, questions: bundle }],
        ["image + menu (~100 options)", { state: STATE, photoKey: file, questions: { q: choiceQ(MENU, "terse", "fwd", file) } }],
      ];
      for (const [shape, req] of shapes) {
        const call = await clef(model, req);
        recs.push({ shape, model, ms: call.ms, tokens: call.tokens });
      }
    }
    if (n < 15) {
      const g = await gemmaOne(file);
      recs.push({ shape: "gemma (scan pipeline)", model: "gemma", ms: g.ms, tokens: (g.promptTokens ?? 0) + (g.completionTokens ?? 0) });
      gemmaSeq.push(g);
    }
    if ((n + 1) % 5 === 0) console.error(`  latency ${n + 1}/${keys.length}`);
  }
  save("latency", { recs, gemma: gemmaSeq });
}
const gemmaSeq: GemmaRec[] = [];

type ParRec = {
  key: string;
  model: ClefModel;
  /** Gemma alone, run right before (the same photo, nothing else in flight). */
  gemmaAloneMs: number;
  /** Gemma while the Clef call runs beside it. */
  gemmaParMs: number;
  clefParMs: number;
  /** Wall clock until both have finished. */
  wallMs: number;
  /** Reranker after Gemma, blocking: Gemma's label names the candidate group. */
  rerankMs?: number;
};

/**
 * Where Clef can sit relative to Gemma. Parallel: the prechecks bundle starts
 * with the Gemma call (no dependence on Gemma's answer). Blocking rerank: one
 * call after Gemma, needed for the candidate group. Sequential per photo.
 */
async function phaseParallel() {
  const keys = SINGLES.filter((_, i) => i % 5 === 2).map((s) => s.file);
  const recs: ParRec[] = [];
  const bundle: Record<string, Question> = {
    ...QUESTION_PRECHECKS,
    menu: choiceQ(MENU, "terse", "fwd", "par"),
  };
  for (const [n, file] of keys.entries()) {
    for (const model of MODELS) {
      const alone = await gemmaOne(file);
      const started = performance.now();
      const [g, c] = await Promise.all([gemmaOne(file), clef(model, { state: STATE, photoKey: file, questions: bundle })]);
      const wallMs = performance.now() - started;
      const canonical = alone.items[0] ? canon(alone.items[0].name) : null;
      let rerankMs: number | undefined;
      if (canonical) {
        const r = await clef(model, { state: STATE, photoKey: file, questions: { q: choiceQ(groupMembers(groupOf(canonical)), "described", "fwd", file) } });
        rerankMs = r.ms;
      }
      recs.push({ key: file, model, gemmaAloneMs: alone.ms, gemmaParMs: g.ms, clefParMs: c.ms, wallMs, rerankMs });
    }
    if ((n + 1) % 5 === 0) console.error(`  parallel ${n + 1}/${keys.length}`);
  }
  save("parallel", recs);
}

// ---------------------------------------------------------------------------
// check: resolve every photo and render contact sheets for eyeballing labels.
// ---------------------------------------------------------------------------

async function check() {
  await loadPhotos(allFiles());
  const entries = [
    ...SINGLES.map((s) => ({ cap: s.label, file: s.file })),
    ...NEGATIVES.map((n) => ({ cap: `NEG ${n.kind}`, file: n.file })),
    ...MULTI.map((m) => ({ cap: `MULTI ${m.items.join("+")}`, file: m.file })),
  ];
  const dir = join(OUT, "sheets");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < entries.length; i += 20) {
    const args = entries.slice(i, i + 20).flatMap((e, j) => ["-label", `${i + j} ${e.cap}`.slice(0, 40), photo(e.file).path]);
    const out = join(dir, `sheet-${String(i / 20).padStart(2, "0")}.jpg`);
    execFileSync("montage", [...args, "-tile", "5x4", "-geometry", "256x192+3+3", "-pointsize", "13", out]);
  }
  console.log(`${SINGLES.length} singles, ${NEGATIVES.length} negatives, ${MULTI.length} multi-item; sheets in ${dir}`);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const row = (...cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) =>
  [row(...head), row(...head.map(() => "---")), ...rows.map((r) => row(...r))].join("\n");
const costClef = (model: string, tokens: number) => (tokens * PRICE_IN[model]!) / 1e6;
const usd = (x: number) => `$${x.toFixed(5)}`;

function report() {
  const out: string[] = [];
  const gemma = load<GemmaRec[]>("gemma");
  const gOf = new Map(gemma.map((g) => [g.key, g]));
  const labelOf = new Map(SINGLES.map((s) => [s.file, s.label]));

  // ---- Gemma baseline
  const singles = SINGLES.map((s) => ({ s, g: gOf.get(s.file)! }));
  const okSingles = singles.filter((x) => x.g.ok);
  const top1 = okSingles.filter((x) => x.g.items[0] && canon(x.g.items[0].name) === x.s.label);
  const any = okSingles.filter((x) => x.g.items.some((i) => canon(i.name) === x.s.label));
  const uncovered = okSingles.filter((x) => x.g.items[0] && canon(x.g.items[0].name) === null);
  const benchRows = singles.filter((x) => x.s.bench);
  const benchHit = benchRows.filter((x) => x.g.ok && x.s.bench && sum(x.g.items.map((i) => i.kcal)) >= x.s.bench.min && sum(x.g.items.map((i) => i.kcal)) <= x.s.bench.max);
  const gemmaMs = singles.map((x) => x.g.ms);
  const gemmaCost = (g: GemmaRec) => ((g.promptTokens ?? 0) * PRICE_IN.gemma! + (g.completionTokens ?? 0) * PRICE_GEMMA_OUT) / 1e6;
  out.push("## Gemma baseline (scan pipeline, thinking off, same prompt)\n");
  out.push(
    table(
      ["metric", "value"],
      [
        ["photos / scan errors", `${singles.length} / ${singles.length - okSingles.length}`],
        ["first item is the true dish", pc(top1.length, okSingles.length)],
        ["true dish anywhere in the items", pc(any.length, okSingles.length)],
        ["first item outside the vocabulary (no judgement possible)", pc(uncovered.length, okSingles.length)],
        ["bench kcal hit rate (the 8 bench photos)", pc(benchHit.length, benchRows.length)],
        ["latency p50 / p95 (REST, concurrency " + CONC + ")", `${f1(pct(gemmaMs, 0.5))} / ${f1(pct(gemmaMs, 0.95))} ms`],
        ["mean tokens in / out", `${f1(mean(okSingles.map((x) => x.g.promptTokens ?? NaN).filter(Number.isFinite)))} / ${f1(mean(okSingles.map((x) => x.g.completionTokens ?? NaN).filter(Number.isFinite)))}`],
        ["mean cost per scan", usd(mean(okSingles.map((x) => gemmaCost(x.g))))],
      ],
    ),
  );
  const wrong = okSingles.filter((x) => x.g.items[0] && canon(x.g.items[0].name) !== x.s.label);
  out.push(`\nFirst-item misses (${wrong.length}): ` + wrong.map((x) => `${x.s.label} -> "${x.g.items[0]!.name}"`).join("; "));
  const conf = okSingles.filter((x) => x.g.items[0]?.confidence !== undefined && canon(x.g.items[0].name) !== null);
  const confOk = conf.filter((x) => canon(x.g.items[0]!.name) === x.s.label).map((x) => x.g.items[0]!.confidence!);
  const confBad = conf.filter((x) => canon(x.g.items[0]!.name) !== x.s.label).map((x) => x.g.items[0]!.confidence!);
  out.push(`\nGemma's own \`confidence\` as a predictor of a correct first item: AUROC ${f2(auroc(confOk, confBad))} (n=${confOk.length}+${confBad.length}); mean ${f2(mean(confOk))} when right, ${f2(mean(confBad))} when wrong.`);

  // The owner accepts over-estimated kcal, not under-estimated: report which side errors fall on.
  const bands = benchRows.flatMap((x) => {
    if (!x.g.ok || !x.s.bench) return [];
    const k = sum(x.g.items.map((i) => i.kcal));
    return [{ label: x.s.label, k, side: k < x.s.bench.min ? "UNDER" : k > x.s.bench.max ? "over" : "in band" }];
  });
  out.push(`\nBench kcal vs band: ${bands.map((b) => `${b.label} ${b.k} (${b.side})`).join("; ")}`);
  const refKcal = new Map<string, number[]>();
  for (const x of okSingles) {
    const first = x.g.items[0];
    if (first && canon(first.name) === x.s.label) refKcal.set(x.s.label, [...(refKcal.get(x.s.label) ?? []), first.kcal]);
  }
  const missKcal = wrong.flatMap((x) => {
    const ref = refKcal.get(x.s.label);
    return ref && ref.length >= 2 ? [{ label: x.s.label, name: x.g.items[0]!.name, ratio: x.g.items[0]!.kcal / pct(ref, 0.5) }] : [];
  });
  out.push(`Kcal of each wrongly named first item relative to the median kcal Gemma gives the true dish when it names it right: ${missKcal.map((m) => `${m.label} -> "${m.name}" x${f2(m.ratio)}`).join("; ")}. Under-estimating misses (ratio < 0.85): ${missKcal.filter((m) => m.ratio < 0.85).length} of ${missKcal.length}.`);

  // ---- Oracle
  const oracle = load<ChoiceRec[]>("oracle");
  out.push("\n## Clef closed-set choice (candidates = look-alike group of the true dish)\n");
  const oracleRows: (string | number)[][] = [];
  for (const model of MODELS) {
    for (const [variant, order] of [["terse", "fwd"], ["described", "fwd"], ["described", "rev"]] as const) {
      const rs = oracle.filter((r) => r.model === model && r.variant === variant && r.order === order);
      const ok = rs.filter((r) => r.choice === r.label);
      const pTrue = rs.map((r) => r.probs[r.label!] ?? 0);
      const wrongP = rs.flatMap((r) => Object.entries(r.probs).filter(([k]) => k !== r.label).map(([, v]) => v));
      const cal = ece(rs.map((r) => ({ p: Math.max(...Object.values(r.probs)), ok: r.choice === r.label })));
      oracleRows.push([model, variant, order, pc(ok.length, rs.length), f2(mean(pTrue)), f3(auroc(pTrue, wrongP)), f3(cal), `${f1(pct(rs.map((r) => r.ms), 0.5))} / ${f1(pct(rs.map((r) => r.ms), 0.95))}`, f1(mean(rs.map((r) => r.tokens)))]);
    }
  }
  out.push(table(["model", "options", "order", "top-1 accuracy", "mean P(true)", "AUROC P(true) vs P(wrong option)", "ECE of top prob", "ms p50 / p95", "tokens"], oracleRows));
  for (const model of MODELS) {
    const fwd = oracle.filter((r) => r.model === model && r.variant === "described" && r.order === "fwd");
    const rev = new Map(oracle.filter((r) => r.model === model && r.variant === "described" && r.order === "rev").map((r) => [r.key, r]));
    const same = fwd.filter((r) => rev.get(r.key)?.choice === r.choice);
    const groups = [...new Set(SINGLES.map((s) => groupOf(s.label)))];
    out.push(`\n${model}: option-order swap keeps the same choice on ${pc(same.length, fwd.length)}. Per group (described, fwd): ` + groups.map((g) => { const rs = fwd.filter((r) => groupOf(r.label!) === g); return `${g} ${pc(rs.filter((r) => r.choice === r.label).length, rs.length)}`; }).join("; "));
    const bad = fwd.filter((r) => r.choice !== r.label);
    out.push(`${model} misses: ` + bad.map((r) => `${r.label} -> ${r.choice} (${f2(r.probs[r.choice] ?? 0)})`).join("; "));
  }

  // ---- Menu
  const menu = load<ChoiceRec[]>("menu");
  out.push("\n## Clef open menu (~" + MENU.length + " options), run in parallel with Gemma\n");
  const menuRows: (string | number)[][] = [];
  const menuNotes: string[] = [];
  for (const model of MODELS) {
    const rs = menu.filter((r) => r.model === model);
    const ranked = (r: ChoiceRec) => Object.entries(r.probs).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const t1 = rs.filter((r) => r.choice === r.label).length;
    const t3 = rs.filter((r) => ranked(r).slice(0, 3).includes(r.label!)).length;
    const t5 = rs.filter((r) => ranked(r).slice(0, 5).includes(r.label!)).length;
    // Agreement with Gemma's first item: does it say anything about correctness?
    const joint = rs.flatMap((r) => { const g = gOf.get(r.key); const gc = g?.items[0] ? canon(g.items[0].name) : null; return gc ? [{ r, gc }] : []; });
    const agree = joint.filter((x) => x.gc === x.r.choice);
    const disagree = joint.filter((x) => x.gc !== x.r.choice);
    const gOk = (x: { gc: string; r: ChoiceRec }) => x.gc === x.r.label;
    menuRows.push([model, pc(t1, rs.length), pc(t3, rs.length), pc(t5, rs.length), f1(mean(rs.map((r) => r.tokens))), `${f1(pct(rs.map((r) => r.ms), 0.5))} / ${f1(pct(rs.map((r) => r.ms), 0.95))}`, pc(agree.length, joint.length), pc(agree.filter(gOk).length, agree.length), pc(disagree.filter(gOk).length, disagree.length), pc(disagree.filter((x) => x.r.choice === x.r.label).length, disagree.length)]);
    const allWrong = joint.filter((x) => !gOk(x));
    const caught = disagree.filter((x) => !gOk(x));
    const alts = (x: { gc: string; r: ChoiceRec }) => ranked(x.r).filter((k) => k !== x.gc).slice(0, 3);
    menuNotes.push(`${model}: flagging on disagreement flags ${pc(disagree.length, joint.length)} of scans, catches ${pc(caught.length, allWrong.length)} of Gemma's first-item errors (flagged that were really wrong: ${pc(caught.length, disagree.length)}); the 3 best other menu options contain the true dish for ${pc(caught.filter((x) => alts(x).includes(x.r.label!)).length, caught.length)} of the caught errors.`);
  }
  out.push(table(["model", "top-1", "top-3", "top-5", "tokens", "ms p50 / p95", "agrees with Gemma", "Gemma right when they agree", "Gemma right when they disagree", "Clef right when they disagree"], menuRows));
  const menuErr = menu.filter((r) => r.model === "clef" && r.choice !== r.label).map((r) => `${r.label} -> ${r.choice}`);
  out.push(`\nclef menu misses (${menuErr.length}): ${menuErr.join("; ")}`);
  out.push(`\n${menuNotes.join("\n\n")}`);

  // ---- Rerank
  const rerank = load<ChoiceRec[]>("rerank");
  out.push("\n## Clef as reranker after Gemma (single-dish photos, first item; candidates = group of Gemma's label)\n");
  const rrRows: (string | number)[][] = [];
  const thr = [0.5, 0.7, 0.8, 0.9, 0.95];
  const thrRows: (string | number)[][] = [];
  for (const model of MODELS) {
    const rs = rerank.filter((r) => r.model === model && r.mode === "whole" && r.label);
    const gemmaOk = (r: ChoiceRec) => r.canonical === r.label;
    const inSet = rs.filter((r) => groupOf(r.canonical!) === groupOf(r.label!));
    const clefOk = (r: ChoiceRec) => r.choice === r.label;
    const pG = (r: ChoiceRec) => r.probs[r.canonical!] ?? 0;
    rrRows.push([model, rs.length, pc(rs.filter(gemmaOk).length, rs.length), pc(inSet.length, rs.length), pc(rs.filter(clefOk).length, rs.length), pc(rs.filter((r) => clefOk(r) && !gemmaOk(r)).length, rs.length - rs.filter(gemmaOk).length), pc(rs.filter((r) => !clefOk(r) && gemmaOk(r)).length, rs.filter(gemmaOk).length), f3(auroc(rs.filter(gemmaOk).map(pG), rs.filter((r) => !gemmaOk(r)).map(pG))), f3(ece(rs.map((r) => ({ p: pG(r), ok: gemmaOk(r) }))))]);
    for (const t of thr) {
      const flagged = rs.filter((r) => pG(r) < t);
      const wrongAll = rs.filter((r) => !gemmaOk(r));
      const wrongFlagged = flagged.filter((r) => !gemmaOk(r));
      const unflagged = rs.filter((r) => pG(r) >= t);
      const alt2 = (r: ChoiceRec) => Object.entries(r.probs).filter(([k]) => k !== r.canonical).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
      thrRows.push([model, t, pc(flagged.length, rs.length), pc(wrongFlagged.length, wrongAll.length), pc(wrongFlagged.length, flagged.length), pc(unflagged.filter(gemmaOk).length, unflagged.length), pc(wrongFlagged.filter((r) => alt2(r).includes(r.label!)).length, wrongFlagged.length)]);
    }
  }
  out.push(table(["model", "photos with a covered first item", "Gemma first item right", "true dish inside candidate set", "Clef argmax right", "wrong -> fixed by Clef", "right -> broken by Clef", "AUROC P(Gemma label) vs Gemma right", "ECE of P(Gemma label)"], rrRows));
  out.push("\nFlagging when P(Gemma label) < threshold and showing the top-2 other options as one-tap alternatives:\n");
  out.push(table(["model", "threshold", "flagged", "Gemma errors caught", "flagged that were really wrong", "precision among unflagged", "errors whose true dish is in the 2 alternatives"], thrRows));
  const wrongRows = rerank.filter((r) => r.model === "clef" && r.mode === "whole" && r.label && r.canonical !== r.label);
  out.push(`\nGemma first-item errors in the rerank set: ` + wrongRows.map((r) => `${r.label}: Gemma "${r.gemma}" (${r.canonical}) -> Clef ${r.choice} P(Gemma)=${f2(r.probs[r.canonical!] ?? 0)}`).join("; "));

  // Multi-item plates: whole image vs crop.
  if (MULTI.length > 0) {
    out.push("\n### Multi-item plates, per Gemma item\n");
    const rows: (string | number)[][] = [];
    for (const model of MODELS) {
      for (const mode of ["whole", "crop"]) {
        const rs = rerank.filter((r) => r.model === model && r.mode === mode && !r.label);
        const truth = (r: ChoiceRec) => MULTI.find((m) => m.file === r.key)!.items.includes(r.canonical!);
        const pG = (r: ChoiceRec) => r.probs[r.canonical!] ?? 0;
        const agree = rs.filter((r) => r.choice === r.canonical);
        rows.push([model, mode, rs.length, pc(rs.filter(truth).length, rs.length), pc(agree.length, rs.length), f2(mean(rs.filter(truth).map(pG))), f2(mean(rs.filter((r) => !truth(r)).map(pG))), f3(auroc(rs.filter(truth).map(pG), rs.filter((r) => !truth(r)).map(pG))), `${f1(pct(rs.map((r) => r.ms), 0.5))}`]);
      }
    }
    out.push(table(["model", "image", "judged Gemma items", "Gemma item is on the plate", "Clef argmax = Gemma label", "mean P(label) true items", "mean P(label) false items", "AUROC", "ms p50"], rows));
  }

  // ---- Prechecks
  const pre = load<PreRec[]>("prechecks");
  out.push("\n## Prechecks (noul questions, one call with 3 questions)\n");
  const kindOf = (key: string): string => {
    const colon = key.indexOf(":");
    if (colon > 0 && key.slice(0, colon) in DEGRADE_KINDS) return key.slice(0, colon);
    const neg = NEGATIVES.find((n) => n.file === key);
    return neg ? `neg-${neg.kind}` : "clean";
  };
  const conds = ["clean", "blur3", "blur12", "dark45", "dark15", "neg-other", "neg-empty"];
  const gemmaProblem = (kind: string) => gemma.filter((g) => kindOf(g.key) === kind);
  const preRows: (string | number)[][] = [];
  for (const model of MODELS) {
    for (const c of conds) {
      const rs = pre.filter((r) => r.model === model && kindOf(r.key) === c);
      const g = gemmaProblem(c);
      const gTag = (tag: string[]) => g.filter((x) => !x.ok && x.reason && tag.includes(x.reason)).length;
      preRows.push([model, c, rs.length, f2(mean(rs.map((r) => r.is_food))), pc(rs.filter((r) => r.is_food >= 0.5).length, rs.length), f2(mean(rs.map((r) => r.blurry))), pc(rs.filter((r) => r.blurry >= 0.5).length, rs.length), f2(mean(rs.map((r) => r.dark))), pc(rs.filter((r) => r.dark >= 0.5).length, rs.length), c.startsWith("neg") ? `not_food ${pc(gTag(["not_food"]), g.length)}` : c === "clean" ? `any problem ${pc(g.filter((x) => !x.ok).length, g.length)}` : `unclear or not_food ${pc(gTag(["unclear", "not_food"]), g.length)}; failed ${pc(g.filter((x) => !x.ok).length, g.length)}`]);
    }
  }
  out.push(table(["model", "photo set", "n", "mean P(food)", "P(food) >= 0.5", "mean P(blurry)", "blurry >= 0.5", "mean P(dark)", "dark >= 0.5", "Gemma on the same photos"], preRows));
  for (const model of MODELS) {
    const clean = pre.filter((r) => r.model === model && kindOf(r.key) === "clean");
    const neg = pre.filter((r) => r.model === model && kindOf(r.key) === "neg-other");
    const bl = pre.filter((r) => r.model === model && ["blur12"].includes(kindOf(r.key)));
    const dk = pre.filter((r) => r.model === model && ["dark15"].includes(kindOf(r.key)));
    out.push(`\n${model} AUROC: food vs non-food ${f3(auroc(clean.map((r) => r.is_food), neg.map((r) => r.is_food)))}; heavy blur vs clean (P(blurry)) ${f3(auroc(bl.map((r) => r.blurry), clean.map((r) => r.blurry)))}; very dark vs clean (P(dark)) ${f3(auroc(dk.map((r) => r.dark), clean.map((r) => r.dark)))}.`);
  }

  // Does a degraded photo cost Gemma accuracy, and how fast does it say no?
  const degRows = ["clean", ...Object.keys(DEGRADE_KINDS)].map((kind) => {
    const recs = degradeBase().flatMap((f) => {
      const g = gOf.get(kind === "clean" ? f : `${kind}:${f}`);
      return g ? [{ f, g }] : [];
    });
    const ok = recs.filter((x) => x.g.ok);
    const right = ok.filter((x) => x.g.items[0] && canon(x.g.items[0].name) === labelOf.get(x.f));
    return [kind, recs.length, pc(ok.length, recs.length), pc(right.length, ok.length), f1(pct(recs.filter((x) => !x.g.ok).map((x) => x.g.ms), 0.5)), f1(pct(ok.map((x) => x.g.ms), 0.5))];
  });
  out.push("\nGemma on the degraded copies of the same 22 photos:\n");
  out.push(table(["photos", "n", "scan succeeds", "first item right (of successes)", "ms until a failure verdict (p50)", "ms for a success (p50)"], degRows));

  // ---- Portion and count
  const por = load<PortionRec[]>("portion");
  out.push("\n## Portion score and item count (no ground truth: consistency checks only)\n");
  const dishGrams = new Map<string, number[]>();
  for (const s of SINGLES) {
    const g = gOf.get(s.file)?.items[0];
    if (g?.grams) dishGrams.set(s.label, [...(dishGrams.get(s.label) ?? []), g.grams]);
  }
  const portionRows: (string | number)[][] = [];
  for (const model of MODELS) {
    const orig = por.filter((r) => r.model === model && r.variant === "orig" && labelOf.has(r.key));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of orig) {
      const label = labelOf.get(r.key)!;
      const grams = gOf.get(r.key)?.items[0]?.grams;
      const peers = dishGrams.get(label) ?? [];
      if (grams && peers.length >= 3) {
        xs.push(r.score);
        ys.push(grams / pct(peers, 0.5));
      }
    }
    const delta = (variant: string) => {
      const o = new Map(por.filter((r) => r.model === model && r.variant === "orig").map((r) => [r.key, r]));
      return por.filter((r) => r.model === model && r.variant === variant).flatMap((r) => (o.has(r.key) ? [Math.abs(r.score - o.get(r.key)!.score)] : []));
    };
    const scores = orig.map((r) => r.score);
    portionRows.push([model, orig.length, f2(mean(scores)), f2(Math.sqrt(mean(scores.map((s) => (s - mean(scores)) ** 2)))), `${f2(Math.min(...scores))}..${f2(Math.max(...scores))}`, f2(spearman(xs, ys)) + ` (n=${xs.length})`, f2(mean(delta("flip"))), f2(mean(delta("small")))]);
  }
  out.push(table(["model", "photos", "mean score (0-4)", "stdev", "range", "Spearman vs Gemma grams (same-dish ratio)", "mean |change| mirrored", "mean |change| 512 px"], portionRows));
  const countRows: (string | number)[][] = [];
  for (const model of MODELS) {
    const rs = por.filter((r) => r.model === model && r.variant === "orig" && MULTI.some((m) => m.file === r.key));
    const truth = (r: PortionRec) => {
      const m = MULTI.find((x) => x.file === r.key)!;
      return m.items.length + m.others;
    };
    const gem = (r: PortionRec) => gOf.get(r.key)?.items.length ?? 0;
    countRows.push([model, rs.length, f2(mean(rs.map((r) => Math.abs(r.count - truth(r))))), f2(mean(rs.map((r) => Math.abs(gem(r) - truth(r))))), pc(rs.filter((r) => Math.round(r.count) === truth(r)).length, rs.length), pc(rs.filter((r) => gem(r) === truth(r)).length, rs.length)]);
  }
  if (MULTI.length > 0) {
    out.push("\nItem count on the multi-item plates (true = labelled visible items):\n");
    out.push(table(["model", "plates", "Clef MAE", "Gemma MAE", "Clef exact", "Gemma exact"], countRows));
  }

  // ---- Latency and cost
  const lat = load<{ recs: LatRec[]; gemma: GemmaRec[] }>("latency");
  out.push("\n## Latency and cost per call (strictly sequential, REST from this machine)\n");
  const latRows: (string | number)[][] = [];
  for (const shape of [...new Set(lat.recs.map((r) => r.shape))]) {
    for (const model of [...MODELS, "gemma"] as const) {
      const rs = lat.recs.filter((r) => r.shape === shape && r.model === model);
      if (rs.length === 0) continue;
      const tok = mean(rs.map((r) => r.tokens));
      latRows.push([shape, model, rs.length, f1(pct(rs.map((r) => r.ms), 0.5)), f1(pct(rs.map((r) => r.ms), 0.95)), f1(tok), model === "gemma" ? usd(mean(lat.gemma.map(gemmaCost))) : usd(costClef(model, tok))]);
    }
  }
  out.push(table(["request", "model", "n", "p50 ms", "p95 ms", "mean tokens", "cost per call"], latRows));

  const par = load<ParRec[]>("parallel");
  out.push("\n## Where Clef sits relative to Gemma (per photo, sequential pairs, REST)\n");
  const parRows: (string | number)[][] = [];
  const p50p95 = (xs: number[]) => `${f1(pct(xs, 0.5))} / ${f1(pct(xs, 0.95))}`;
  for (const model of MODELS) {
    const rs = par.filter((r) => r.model === model);
    const rr = rs.flatMap((r) => (r.rerankMs === undefined ? [] : [r]));
    parRows.push([
      model,
      rs.length,
      p50p95(rs.map((r) => r.gemmaAloneMs)),
      p50p95(rs.map((r) => r.gemmaParMs)),
      p50p95(rs.map((r) => r.clefParMs)),
      pc(rs.filter((r) => r.clefParMs <= r.gemmaParMs).length, rs.length),
      p50p95(rs.map((r) => r.wallMs - r.gemmaParMs)),
      p50p95(rr.map((r) => r.rerankMs!)),
      p50p95(rr.map((r) => r.gemmaAloneMs + r.rerankMs!)),
    ]);
  }
  out.push(table(["model", "n", "Gemma alone ms p50 / p95", "Gemma with Clef beside it", "Clef (3 noul + ~100-option menu) in parallel", "Clef done before Gemma", "extra wait after Gemma, parallel (p50 / p95)", "blocking rerank call, added (p50 / p95)", "Gemma + blocking rerank total"], parRows));
  console.log(out.join("\n"));
}

// ---------------------------------------------------------------------------

const PHASES: Record<string, () => Promise<void>> = {
  gemma: phaseGemma,
  oracle: phaseOracle,
  menu: phaseMenu,
  prechecks: phasePrechecks,
  rerank: phaseRerank,
  portion: phasePortion,
  latency: phaseLatency,
  parallel: phaseParallel,
};

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  mkdirSync(OUT, { recursive: true });
  if (cmd === "check") return check();
  if (cmd === "report") return report();
  if (cmd === "run" && arg) {
    await loadPhotos(allFiles());
    const names = arg === "all" ? Object.keys(PHASES) : [arg];
    for (const name of names) {
      const phase = PHASES[name];
      if (!phase) throw new Error(`unknown phase ${name}; one of ${Object.keys(PHASES).join(", ")}`);
      console.error(`phase ${name}`);
      await phase();
    }
    return;
  }
  console.error("usage: clef-probe.ts check | run <gemma|oracle|menu|prechecks|rerank|portion|latency|parallel|all> | report");
  process.exit(1);
}

if (import.meta.main) await main();
