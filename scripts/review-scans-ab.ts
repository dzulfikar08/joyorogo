// A/B of the vision prompt on a folder of plate photos, against the REAL
// analyzeFoodPhoto (same parser, same TKPI calibration) over Workers AI REST.
// A variant only rewrites the prompt text on its way to the model (an AiRunner
// wrapper), so production code is untouched. The raw model answer is stored
// next to the parsed items so calibration variants can be replayed offline
// with `replayRaw` (no API calls).
//
// Usage: bun run scripts/review-scans-ab.ts <photo-dir> [variant ...]
//   REPS=3  OUT=<dir>/ab.json  CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_API_TOKEN
//   (or the wrangler OAuth login). Photos: any *.jpg/*.jpeg/*.webp/*.png.
// Variants live in PROMPT_VARIANTS below; "baseline" is the prompt in prod.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { repairKeys } from "../packages/api/src/lib/item-stream";
import { atwaterAdjust, calibrateItems, TKPI_DISHES } from "../packages/api/src/lib/tkpi";
import type { CalibratableItem, CalibratedItem } from "../packages/api/src/lib/tkpi";
import { lookupTkpi2019 } from "../packages/api/src/lib/tkpi2019";
import {
  analyzeFoodPhoto,
  DEFAULT_VISION_MODEL,
  extractJson,
  MAX_ITEMS,
  responseText,
  salvageItems,
  visionItemSchema,
  visionResultSchema,
} from "../packages/api/src/lib/vision";

/** A variant rewrites the prod prompt text and/or request body on its way out. */
export type Variant = {
  prompt?: (prompt: string) => string;
  body?: (body: Record<string, unknown>) => void;
};

const GROUND =
  "Hitung HANYA yang tampak di wadah/piring dan akan dimakan. Abaikan: sachet atau kemasan saus yang masih tertutup, bahan mentah (mis. telur mentah) di luar wadah, alat makan, minuman orang lain. Jangan menebak pelengkap yang tidak jelas terlihat (mis. kerupuk): kalau ragu, jangan masukkan. Irisan pucat di mangkuk buah adalah buah (pir/apel), bukan kerupuk.";
const IDENTITY =
  "Kenali hidangan dari ISInya, bukan dari saus penutupnya: tertutup bumbu kacang bisa siomay/batagor (pangsit kukus, tahu, kentang, kol, telur), gado-gado (sayur rebus, lontong, tempe, kerupuk), ketoprak atau pecel; pilih yang bahan terlihatnya cocok. Untaian kuning = mi, bukan nasi: sebut karbohidrat utamanya dengan benar. Bebek (tulang besar, kulit tebal, kaki panjang) bukan ayam. Tempe = blok kacang berbutir, bukan daging. Labu siam = potongan hijau pucat, bukan timun.";
const PORTION =
  "Hitung potongan satu per satu dan tulis jumlahnya di portion (mis. '4 potong'). Patokan berat matang: satu centong nasi 100 g, gundukan nasi di piring 150-200 g, nasi kotak/bungkus penuh 200-250 g; telur 55 g/butir; satu potong ayam goreng (paha/dada) 100-130 g; nugget 25 g/potong; tahu atau tempe 25-50 g/potong; lauk tumis berbumbu satu sendok sayur 80-100 g. Ikuti ukuran relatif terhadap piring: jangan sengaja memperkecil atau membesarkan berat.";
const SAUCE =
  "Saus, sambal, mayones, dan bumbu kacang yang banyak dihitung kalorinya: mayones 1 sdm (15 g) = 100 kcal, bumbu kacang 50 g = 150 kcal, sambal berminyak (ijo/balado/terasi) 30 g = 60-100 kcal, kacang tanah goreng 10 g = 60 kcal. Lauk bersambal (ayam sambal ijo, ayam penyet, telur balado) = kcal lauknya DITAMBAH sambalnya, bukan hanya kcal sambal.";

// Candidate set after the first round: identity without the two clauses that
// leaked into unrelated photos, piece counting without the rice-weight priors
// (those pushed small nasi boxes up), and no GROUND rule (it did not remove
// the hallucinated kerupuk and made sachet photos return "not food").
const IDENTITY2 =
  "Kenali hidangan dari ISInya, bukan dari saus penutupnya: tertutup bumbu kacang bisa siomay/batagor (pangsit kukus, tahu, kentang, kol, telur), gado-gado (sayur rebus, lontong, tempe, kerupuk), ketoprak atau pecel; pilih yang bahan terlihatnya cocok. Untaian kuning = mi, bukan nasi: sebut karbohidrat utamanya dengan benar. Bebek (tulang besar, kulit tebal, kaki panjang) bukan ayam.";
const PIECES =
  "Hitung potongan satu per satu dan tulis jumlahnya di portion (mis. '4 potong'). Patokan: telur 55 g/butir; nugget 25 g/potong; tahu atau tempe 25-50 g/potong; satu potong ayam goreng (paha/dada) 100-130 g.";

const add = (...rules: string[]) => (p: string) => `${p}\n${rules.join("\n")}`;
const temperature = (t: number) => (b: Record<string, unknown>) => {
  b.temperature = t;
};

/** Extra rules appended to the prod prompt, keyed by variant name. */
export const PROMPT_VARIANTS: Record<string, Variant> = {
  baseline: {},
  temp01: { body: temperature(0.1) },
  ground: { prompt: add(GROUND) },
  identity: { prompt: add(IDENTITY) },
  portion: { prompt: add(PORTION) },
  sauce: { prompt: add(SAUCE) },
  all: { prompt: add(GROUND, IDENTITY, PORTION, SAUCE) },
  rec: { prompt: add(IDENTITY2, SAUCE), body: temperature(0.1) },
  ship: { prompt: add(IDENTITY2, PIECES, SAUCE), body: temperature(0.1) },
  "ship-notemp": { prompt: add(IDENTITY2, PIECES, SAUCE) },
  "all-temp01": { prompt: add(GROUND, IDENTITY, PORTION, SAUCE), body: temperature(0.1) },
};

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "b7e6f8457bd39fa37a7eea5249799754";
const REPS = Number(process.env.REPS ?? 3);
const CONCURRENCY = 4;

function apiToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const toml = readFileSync(join(homedir(), ".config/.wrangler/config/default.toml"), "utf8");
  const found = /oauth_token = "([^"]+)"/.exec(toml);
  if (!found) throw new Error("no CLOUDFLARE_API_TOKEN and no wrangler login");
  return found[1]!;
}

function mimeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89) return "image/png";
  return "image/webp";
}

export type Run = {
  photo: string;
  variant: string;
  rep: number;
  raw: string | null;
  items: Array<{ name: string; portion?: string; grams?: number; kcal: number }>;
  kcal: number;
  error?: string;
};

function runnerFor(token: string, variant: Variant, capture: { raw: string | null }) {
  return {
    async run(model: string, input: unknown) {
      const body = structuredClone(input) as {
        messages: Array<{ content: Array<{ type: string; text?: string }> }>;
      };
      const part = body.messages[0]!.content.find((c) => c.type === "text")!;
      if (variant.prompt) part.text = variant.prompt(part.text!);
      variant.body?.(body as unknown as Record<string, unknown>);
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { result?: unknown };
      if (!res.ok || !json.result) throw new Error(`ai ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      capture.raw = responseText(json.result);
      return json.result;
    },
  };
}

export async function runAll(dir: string, variants: string[], reps = REPS): Promise<Run[]> {
  const token = apiToken();
  const photos = readdirSync(dir).filter((f) => /\.(jpe?g|webp|png)$/i.test(f)).sort();
  const jobs: Array<() => Promise<Run>> = [];
  for (const photo of photos) {
    const bytes = new Uint8Array(readFileSync(join(dir, photo)));
    const imageBase64 = Buffer.from(bytes).toString("base64");
    const mimeType = mimeOf(bytes);
    for (const name of variants) {
      const variant = PROMPT_VARIANTS[name];
      if (!variant) throw new Error(`unknown variant ${name}`);
      for (let rep = 0; rep < reps; rep++) {
        jobs.push(async () => {
          const capture: { raw: string | null } = { raw: null };
          try {
            const result = await analyzeFoodPhoto(runnerFor(token, variant, capture), {
              imageBase64,
              mimeType,
              model: DEFAULT_VISION_MODEL,
            });
            const items = result.items.map((i) => ({
              name: i.name,
              portion: i.portion,
              grams: i.grams,
              kcal: i.kcal,
            }));
            return {
              photo, variant: name, rep, raw: capture.raw, items,
              kcal: Math.round(items.reduce((s, i) => s + i.kcal, 0)),
            };
          } catch (error) {
            return {
              photo, variant: name, rep, raw: capture.raw, items: [], kcal: 0,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });
      }
    }
  }
  const rows: Run[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) rows.push(await jobs[next++]!());
    }),
  );
  return rows.sort((a, b) => a.photo.localeCompare(b.photo, undefined, { numeric: true }) || a.rep - b.rep);
}

type Calibrator = (items: CalibratableItem[]) => CalibratedItem[];

const normalizeName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// Proposed tkpi.ts change #1: a condiment word ("sambal", "kecap", "saus") at
// the tail of a protein/staple dish name is a modifier, not the dish. Prod
// matches the library's "sambal" row (band 5-80 kcal) and clamps a whole
// "ayam penyet sambal ijo" to 80 kcal, or TKPI 2019 "Kecap" (71 kcal/100 g)
// for "telur rebus kuah kecap". Such names skip both lookups and keep the
// model's kcal under the generic band, exactly like any unknown dish.
const CONDIMENT = /\b(sambal|kecap|saus|bumbu|mayones|kuah)\b/;
const FOOD_HEAD =
  /\b(ayam|bebek|daging|sapi|kambing|ikan|lele|udang|cumi|telur|tahu|tempe|nasi|mie|mi|bihun|terong|kangkung|sayur|kentang|jamur|ati|usus|teri|tongkol|kacang)\b/;
const LIBRARY_NAMES = new Set(
  TKPI_DISHES.flatMap((d) => [d.name, ...d.aliases].map(normalizeName)),
);

function bypassesLibrary(name: string): boolean {
  const q = normalizeName(name);
  if (LIBRARY_NAMES.has(q)) return false;
  if (CONDIMENT.test(q) && FOOD_HEAD.test(q)) return true;
  // Proposed change #2: TKPI 2019 reverse containment ("kacang tanah" inside
  // "Oncom kacang tanah pepes", 132 kcal/100 g, gave 40 g of peanuts 53 kcal)
  // may only match a row that starts with the query.
  const row = lookupTkpi2019(name);
  if (row) {
    const key = normalizeName(row.name);
    if (key.length > q.length && !q.includes(key) && !key.startsWith(`${q} `)) return true;
  }
  return false;
}

export const calibrateProd: Calibrator = (items) => calibrateItems(items);

export const calibrateGuarded: Calibrator = (items) =>
  items.map((item) => {
    if (!bypassesLibrary(item.name)) return calibrateItems([item])[0]!;
    const cap = item.grams && item.grams > 0 ? Math.max(400, item.grams * 7) : 4000;
    return atwaterAdjust({
      ...item,
      kcal: Math.min(cap, Math.max(20, item.kcal)),
      matched: false,
    });
  });

// Proposed tkpi.ts change #3: a density band (+-30% around kcal/100 g) for the
// calorie-dense add-ons the model low-balls most ("saus mayones 30 g, 100 kcal"
// is 680 kcal/100 g = ~200). Unmatched dishes only have an upper cap today, so
// nothing stops an underestimate there. Entries are rounded TKPI/label values.
const DENSITY_BANDS: Array<{ re: RegExp; per100: number }> = [
  { re: /\b(mayones|mayonnaise|mayo)\b/, per100: 680 },
  { re: /\b(bumbu|saus) kacang\b/, per100: 250 },
  { re: /\bkacang tanah\b/, per100: 590 },
  { re: /\bnugget\b/, per100: 260 },
];

export const calibrateGuardedDensity: Calibrator = (items) =>
  calibrateGuarded(items).map((item) => {
    const band = DENSITY_BANDS.find((b) => b.re.test(normalizeName(item.name)));
    if (!band || !item.grams) return item;
    const base = (band.per100 * item.grams) / 100;
    return { ...item, kcal: Math.round(Math.min(base * 1.3, Math.max(base * 0.7, item.kcal))) };
  });

// Proposed vision.ts change: the model sometimes quotes every number
// ("grams":"200"), and z.number() then drops the item, so a valid one-item
// answer fails the whole scan (scan:failed). Coerce numeric strings first.
function numericStrings(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  return Object.fromEntries(
    Object.entries(entry).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value,
    ]),
  );
}

/**
 * Re-calibrate stored raw answers with `calibrate`, no API calls. Dedupe and
 * the broth rule are skipped for both arms, so only calibration differs.
 */
export function replayRaw(rows: Run[], calibrate: Calibrator, coerce = false): Run[] {
  return rows.map((r) => {
    if (!r.raw) return r;
    const cleaned = repairKeys(r.raw.replace(/```(?:json)?/g, ""));
    let entries: unknown[];
    try {
      entries = visionResultSchema.parse(extractJson(cleaned)).items;
    } catch {
      entries = salvageItems(cleaned);
    }
    const usable = entries.flatMap((entry) => {
      const item = visionItemSchema.safeParse(coerce ? numericStrings(entry) : entry);
      return item.success && item.data.kcal > 0 && item.data.name ? [item.data] : [];
    });
    const calibrated = calibrate(
      usable.slice(0, MAX_ITEMS).map(({ box: _box, kind: _kind, localName: _local, ...item }) => item),
    );
    const items = calibrated.map((i) => ({ name: i.name, portion: i.portion, grams: i.grams, kcal: i.kcal }));
    return { ...r, items, kcal: Math.round(items.reduce((sum, i) => sum + i.kcal, 0)) };
  });
}

if (import.meta.main) {
  const [dir, ...names] = process.argv.slice(2);
  if (!dir) throw new Error("usage: review-scans-ab.ts <photo-dir> [variant ...]");
  const rows = await runAll(dir, names.length ? names : ["baseline"]);
  writeFileSync(process.env.OUT ?? join(dir, "ab.json"), JSON.stringify(rows, null, 2));
  console.log(`runs=${rows.length} errors=${rows.filter((r) => r.error).length}`);
}
