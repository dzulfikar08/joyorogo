import { z } from "zod";
import { DEFAULT_LOCALE, DEFAULT_REGION, getT } from "@joyorogo/i18n";
import type { Locale, Region } from "@joyorogo/i18n";
import { localNameRule, localNameShape } from "./ai-locale";
import { ChatStreamDecoder } from "./chat-stream";
import { resolveFoodKind } from "./food-kind";
import type { FoodKind } from "./food-kind";
import { ItemScanner, repairKeys, scanItems } from "./item-stream";
import { regionFocus, regionRule } from "./region-prompt";
import type { ItemScanEvent } from "./item-stream";
import type { ScanFailReason } from "./scan-errors";
import { CUP_CONFIDENCE, cupItem, guessCupChoice } from "./drink-options";
import type { CupChoice } from "./drink-options";
import { normalizeAlternates, withMaterialAlternates } from "./name-alternates";
import { reconcileCount } from "./piece-count";
import type { Pieces } from "./piece-chip";
import { calibrateItems } from "./tkpi";
import type { CalibratedItem, CalibrateOptions } from "./tkpi";

export const DEFAULT_VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";

// Latency is completion tokens. Gemma 4 on Workers AI thinks by default:
// ~2-3k reasoning tokens per plate, p50 ~50 s in the prod ledger. With
// thinking off and single-line JSON the same plates answer in 110-350
// tokens / 2-7 s with the same estimates (probe 2026-10-11, 3 dishes).
// Guided JSON (response_format) was dropped: without thinking it degenerates
// into whitespace loops until max_tokens on busy plates.
// A model-side "too many" flag proved unreliable (it dropped the donut next
// to an americano), so the prompt only asks for a cap, not for a verdict.
/**
 * Indonesian prompt; for other locales the model also returns `localName` (see
 * ai-locale.ts) so food names and portions come back in the user's language. A region other than
 * Indonesia adds its dish names and serving defaults (region-prompt.ts); Indonesia's text is unchanged.
 */
export function visionPrompt(locale: Locale = DEFAULT_LOCALE, region: Region = DEFAULT_REGION): string {
  return `Anda adalah ahli gizi. Identifikasi makanan pada foto ini (${regionFocus(region)}). Sebutkan SETIAP makanan atau minuman berbeda yang terlihat, termasuk yang kecil (mis. donat di samping segelas kopi), urut dari yang paling menonjol, maksimal 10 item.
Jawab HANYA JSON valid satu baris (tanpa indentasi, tanpa \`\`\`) tanpa teks lain, dengan bentuk persis:
{"items":[{"name":"nama masakan",${localNameShape(locale)}"kind":"makanan|camilan|minuman","portion":"porsi, maks 3 kata","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"confidence":number,"box":[ymin,xmin,ymax,xmax]${ALT_SHAPE}}]}
Semua angka bulat kecuali confidence. Tidak ada makanan atau minuman di foto: {"items":[],"problem":"bukan_makanan"}. Foto terlalu gelap atau buram sampai makanan tidak bisa dikenali: {"items":[],"problem":"gelap"} atau {"items":[],"problem":"buram"}.
kind: "makanan" = makanan berat (nasi, lauk, sayur, mi, sup), "camilan" = gorengan, kue, keripik, martabak, es krim, jajanan ringan, "minuman" = semua yang diminum.
box = kotak pembatas item itu di foto, skala 0-1000 relatif tinggi dan lebar foto.
Satu hidangan = satu item: kuah, bumbu/saus, sayur, dan lontong/mi/bihun yang sudah bagian dari hidangan itu (mis. gado-gado, bakso, soto) TERMASUK di kcal hidangan, jangan dipisah. Pisahkan hanya yang berdiri sendiri: nasi, lauk terpisah, telur, kerupuk, gorengan, sambal, minuman.
Aturan: ini bukan percakapan — jangan menjawab dengan tabel markdown. name dalam Bahasa Indonesia tanpa terjemahan. grams = perkiraan berat (1-5000); kcal, protein/carbs/fat (gram), fiber (gram) = estimasi realistis porsi umum; confidence 0-1.${localNameRule(locale)}
${PACKAGE_RULE}
${DRINK_RULE}
${SAUCE_RULE}
${COUNT_RULE}
${PRINTED_TEXT_RULE}
${LOOKALIKE_RULE}
${JUICE_RULE}${regionRule(region)}
${ALT_RULE}`;
}

/**
 * "Mungkin juga" chips (lib/name-alternates.ts): up to two other dishes the model finds plausible for an item
 * it is not sure of. Last key of the item, after the box, so a cut-off or garbled tail costs only the chips;
 * the scale readout once broke the item's keys when it was asked for inside the scan (docs/scale-readout.md).
 */
export const ALT_SHAPE = ',"alt":["nama lain","nama lain"]';
export const ALT_RULE =
  'alt = paling banyak 2 nama masakan lain yang juga masuk akal untuk item itu, HANYA bila kamu tidak yakin dengan name (mis. nasi kuning: ["nasi uduk","nasi liwet"]; kue basah mirip lain). Yakin atau hanya satu kemungkinan: "alt":[]. Isi dengan hidangan yang berbeda, bukan variasi tulisan atau bahasa dari name, dalam Bahasa Indonesia seperti name.';

/**
 * Drinks need their own rules: a zero-calorie drink is a valid 0 (not "nothing
 * found"), grams are ml, and a lidded branded cup with unseen contents is
 * still a drink (the scan then offers the usual options, see drink-options.ts).
 */
export const DRINK_RULE =
  'Minuman (kaleng, botol, gelas, cup) selalu dicatat sebagai item minuman, bukan "bukan_makanan". Untuk minuman grams = volume dalam ml (kaleng 330, botol kecil 500, gelas 250-350). Minuman tanpa kalori (Coke Zero, Diet Coke, teh tawar, kopi hitam tanpa gula, air putih) kcal 0 atau 1 dan protein/carbs/fat 0: itu jawaban yang benar, jangan dinaikkan. Minuman manis ikut gulanya (Coca-Cola 330 ml = 140 kcal, es teh manis 350 ml = 100 kcal).\nGelas atau cup bermerek bertutup (McDonald\'s, KFC, Starbucks, Chatime, Kopi Kenangan) yang isinya TIDAK terlihat: jangan jawab bukan_makanan. Beri satu item minuman, name = tebakan isi yang paling mungkin (cup McDonald\'s biasanya Coca-Cola) dan tambahkan field "cup":"S" atau "M" atau "L" (ukuran gelas; ragu = "M"). Field "cup" hanya untuk kasus ini.';

/**
 * Small packaged items: the model answered 50-60 g for a ~100 g bag of boiled egg white (owner photo,
 * docs/ai-accuracy-log.md). A printed net weight is the truth; without one, a filled bag counts as its contents.
 */
export const PACKAGE_RULE =
  'Makanan dalam kemasan, plastik, atau bungkus: kalau berat bersih tertulis ("Netto 85 g", "100 g") pakai angka itu sebagai grams, jangan ditebak. Tanpa tulisan, grams = isi makanannya (bukan plastiknya) menurut ukuran kemasan yang terlihat; kemasan yang terisi penuh jangan dikecilkan hanya karena kecil di foto. Daging atau ikan bertulang (ayam goreng, ayam bakar, ikan utuh): grams = berat seperti terlihat, termasuk tulang; sistem menghitung bagian yang dimakan.';

/**
 * Reference kcal for the add-ons the model low-balls most (A/B 2026-10-17,
 * docs/ai-accuracy-review-2026-10-17.md: sauce prompt variant).
 */
export const SAUCE_RULE =
  "Saus, sambal, mayones, dan bumbu kacang yang banyak dihitung kalorinya: mayones 1 sdm (15 g) = 100 kkal, bumbu kacang 50 g = 150 kkal, sambal berminyak (ijo/balado/terasi) 30 g = 60-100 kkal, kacang tanah goreng 10 g = 60 kkal. Lauk bersambal (ayam sambal ijo, ayam penyet, telur balado) = kcal lauknya DITAMBAH sambalnya, bukan hanya kcal sambal.";

/**
 * Separate pieces are counted, not guessed as one total (tester photo 2026-10-22: 7 egg halves answered
 * as "telur rebus 60 g"). The count and unit come back as fields; piece-count.ts holds the same unit
 * weights and makes grams agree with them on the server.
 */
export const COUNT_RULE =
  'Makanan yang berupa potongan terpisah (telur utuh atau belahan telur, sate, nugget, pangsit, siomay, dimsum, bakso, roti tawar, pisang goreng) HITUNG dulu satu per satu di foto, jangan menebak satu total: beri item itu field "count" (jumlah potongan yang terlihat, bulat; belahan telur dihitung per belahan; tiap belahan menampakkan satu kuning telur, jadi hitung kuning telurnya, termasuk yang menumpuk atau terpotong; tunjuk satu per satu dari kiri atas ke kanan bawah sampai seluruh piring terhitung, jangan berhenti di bagian tengah) dan "unit" (butir|belahan|tusuk|potong|buah|lembar), tulis jumlahnya di portion (boleh sampai 5 kata, mis. "4 tusuk" untuk sate, "N belahan (N/2 butir)" untuk telur), lalu grams = count x berat satuan: telur ayam 1 butir utuh 50 g, 1 belahan 25 g (2 belahan = 1 butir), sate 1 tusuk 30 g, nugget 20 g, pangsit 15 g, siomay/dimsum/dumpling 25 g, bakso 25 g, roti tawar 1 lembar 30 g, pisang goreng 1 buah 60 g. kcal dan nutrisi untuk grams total itu. Jangan menjawab satu butir bila terlihat banyak potongan.';

/**
 * Text printed in the photo outranks how the food looks (owner scans 2026-10-21:
 * a cup labelled "Americano ICE" read as es kopi susu, a "NASI KEBULI" wrapper
 * as nasi putih, tempe as tahu).
 */
export const PRINTED_TEXT_RULE =
  'Baca dulu semua tulisan yang tercetak di foto (label cup, bungkus, kemasan, menu, struk) dan PERCAYAI tulisan itu di atas penampilan makanan: cup berlabel "Americano ICE" = Americano es hitam tanpa susu (5-15 kkal), bungkus bertulisan "NASI KEBULI" = nasi kebuli, bukan nasi putih. Cup yang cairannya terlihat (cup bening) atau yang labelnya menyebut minumannya BUKAN cup tersembunyi: jangan isi field cup, tulis nama minuman dari label atau warna cairannya. Makanan kemasan memakai porsi dan kkal yang tertulis di label bila terbaca. Nasi konjac/shirataki (beras konjac, 10-120 kkal per 100 g) tampak sama dengan nasi putih di foto: tulis "nasi konjac" HANYA bila kemasan atau teks di foto menyebut konjac/shirataki/porang, atau catatan pengguna menyebutnya; jangan pernah menebak konjac dari tampilan saja, nasi yang tampak biasa = nasi putih. Kopi es yang gelap dan tembus pandang, tanpa warna susu, = Americano/kopi hitam es (5-15 kkal); pilih es kopi susu hanya jika warna susu atau lapisan krim terlihat atau tulisannya menyebut susu/latte. Tempe vs tahu: tempe goreng = lempeng/potongan persegi panjang cokelat tua, padat, permukaan kasar bergaris dengan butir kedelai atau bercak putih keabuan (sering 2-3 potong tipis di tepi piring); tahu goreng = kuning keemasan, kulit halus dan menggembung/berongga tanpa butir. Ragu = tempe jika tampak butir, tahu jika polos halus.';

/**
 * Lookalikes testers reported as wrong (scan feedback 2026-10-17/21): bakwan sayur read as tempe goreng tepung,
 * a Pizza Hut slice as plain cheese pizza, siomay with its peanut sauce as one blob.
 */
export const LOOKALIKE_RULE =
  'Gorengan bertepung yang mirip: bakwan sayur = adonan tepung penuh serutan sayur (kol, wortel, tauge, jagung) dengan permukaan bergelombang, isinya sayur; tempe goreng tepung = irisan tempe tipis dan padat berbintik kedelai di dalam lapisan tepung. Lihat isinya yang tampak di bagian yang patah atau tepi, jangan menukar keduanya. Pizza: bila ada kotak, kertas, atau tulisan merek (Pizza Hut, Domino\'s, Papa John\'s, Sbarro) pakai merek itu di name (mis. "pizza Pizza Hut keju") dan hitung per potong ukuran restoran (satu potong sedang 100-130 g, pinggiran isi keju atau topping tebal lebih berat), bukan satu loyang. Siomay atau batagor yang disiram bumbu kacang: siomay (pangsit, tahu, kentang, kol, telur) satu item dan bumbu kacang item terpisah (aturan bumbu kacang di atas) bila saus terlihat banyak; jangan menggabungkan saus ke kcal siomay.';

/**
 * Juice sugar cannot be seen in the glass (tester: "jus mangga" logged with sugar though made without), so the
 * name carries the assumption and the library has one row per choice (tkpi.ts "jus buah dengan/tanpa gula").
 */
export const JUICE_RULE =
  'Jus buah: gula tidak terlihat dari gelas. Tulis name "jus X dengan gula" (jus warung, kafe, atau dagang: ini dugaan bawaan) atau "jus X tanpa gula" HANYA bila label, menu, atau catatan pengguna menyebut tanpa gula/no sugar/unsweetened; jangan menebak dari warna atau kekentalan. Americano atau kopi hitam di gelas sekitar 5 kkal, es kopi susu sekitar 175 kkal per gelas 250 ml.';

/**
 * Shadow variant (see lib/shadow-scan.ts): the production prompt plus the
 * trimmed dish-identity rule, answered at temperature 0.1. It runs beside live
 * scans only, to be compared with what users saved; it never reaches a user.
 */
export const SHADOW_IDENTITY_RULE =
  "Kenali hidangan dari ISInya, bukan dari saus penutupnya: tertutup bumbu kacang bisa siomay/batagor (pangsit kukus, tahu, kentang, kol, telur), gado-gado (sayur rebus, lontong, tempe, kerupuk), ketoprak atau pecel; pilih yang bahan terlihatnya cocok. Untaian kuning = mi, bukan nasi: sebut karbohidrat utamanya dengan benar. Bebek (tulang besar, kulit tebal, kaki panjang) bukan ayam.";
export const SHADOW_VARIANT = {
  id: "identity-t01",
  temperature: 0.1,
  promptTransform: (base: string) => `${base}\n${SHADOW_IDENTITY_RULE}`,
} as const;

export const VISION_PROMPT = visionPrompt();

/**
 * Room for ~12 single-line items incl. boxes: ~60-80 tokens each (measured
 * 110-660 for up to 8). Billing is per generated token, so the ceiling costs
 * nothing on plates that stop early; it only keeps a busy photo from being
 * cut mid-JSON.
 */
const MAX_COMPLETION_TOKENS = 1600;
/** Items kept per photo; the prompt asks for the same number. */
export const MAX_ITEMS = 10;

/**
 * The model sometimes quotes every number (`"grams":"200"`). A numeric string
 * is that number; anything else (null, "", "abc") stays itself and fails
 * z.number() as before. Part of the schema, so the stream preview, the final
 * parse and the eval harness all read quoted numbers alike.
 */
const quotedNumber = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : value;
const modelNumber = z.preprocess(quotedNumber, z.number());

export const visionItemSchema = z.object({
  name: z.string(),
  // Name in the user's language when it is not Indonesian (see ai-locale.ts).
  localName: z.string().optional(),
  // Model's own call; resolveFoodKind falls back to the name when it is missing or odd.
  kind: z.string().optional(),
  portion: z.string().optional(),
  grams: modelNumber.optional(),
  // Separate pieces the model counted and what one is called (COUNT_RULE); grams are reconciled to them.
  count: modelNumber.optional().catch(undefined),
  unit: z.string().optional().catch(undefined),
  kcal: modelNumber,
  protein: modelNumber.optional(),
  carbs: modelNumber.optional(),
  fat: modelNumber.optional(),
  fiber: modelNumber.optional(),
  confidence: z.preprocess(quotedNumber, z.number().min(0).max(1)).optional(),
  // Only on a cup whose contents are not visible: its size letter (S/M/L).
  cup: z.string().optional().catch(undefined),
  // Bounding box [ymin, xmin, ymax, xmax] on a 0-1000 grid; validated by normalizeBox.
  box: z.unknown().optional(),
  // Other dishes the model finds plausible (ALT_RULE); validated by normalizeAlternates, never rejects the item.
  alt: z.unknown().optional(),
});

export type ItemBox = [number, number, number, number];

/**
 * A usable box or undefined. A malformed box never drops the item: it only
 * means that item gets no per-item crop.
 */
export function normalizeBox(raw: unknown): ItemBox | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const v = raw.map((n) =>
    typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(1000, Math.max(0, n))) : NaN,
  );
  if (v.some(Number.isNaN)) return undefined;
  const [y0, x0, y1, x1] = v as ItemBox;
  // Under 2% of the photo on either side is a dot, not a dish.
  if (y1 - y0 < 20 || x1 - x0 < 20) return undefined;
  return [y0, x0, y1, x1];
}

export const visionResultSchema = z.object({
  // Items are validated one by one in parseAnswer: a bad item must not sink the plate.
  items: z.array(z.unknown()),
  tooMany: z.boolean().optional().catch(undefined),
  problem: z.string().optional().catch(undefined),
});

export type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

/** Models answer with prose, fences, or wrapper keys — cut the JSON out. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object in response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/** Token accounting from the AI binding when the model surfaces it; null otherwise. */
export function extractUsage(result: unknown): Record<string, unknown> | null {
  const r = result as { usage?: unknown; result?: { usage?: unknown } };
  if (r?.usage && typeof r.usage === "object") {
    return r.usage as Record<string, unknown>;
  }
  if (r?.result?.usage && typeof r.result.usage === "object") {
    return r.result.usage as Record<string, unknown>;
  }
  return null;
}

export type VisionAnalysis = {
  items: Array<CalibratedItem & { box?: ItemBox; kind: FoodKind; cup?: CupChoice; alt?: string[] }>;
  /** Model actually used — callers pass `model` through unresolved. */
  model: string;
  usage: Record<string, unknown> | null;
  /** More food in the photo than fit: the answer was cut off or reached the item cap. */
  tooMany: boolean;
  /** The model set its own tooMany flag (logged for tuning; does not drive the UI). */
  modelTooMany?: boolean;
  /** The model's JSON needed key repair or item salvage before it parsed (logged for tuning). */
  repaired?: boolean;
  /** The "plate" the model answered (lib/dishware.ts): a label, null = none of the user's plates; absent = not asked. */
  plate?: string | null;
  /** The "card" the model answered (lib/dishware.ts): a standard bank-size card beside the food; absent = not asked. */
  card?: CardAnswer;
  /** Where the model call's time went (ms): the whole attempt, and for a stream the wait for the first token. */
  timing: { modelMs: number; ttftMs?: number; attempts: number };
};

/** Handles every Workers AI response shape: text, {response}, {result}, chat. */
export function responseText(result: unknown): string | null {
  if (typeof result === "string") return result;
  const r = result as {
    response?: unknown;
    result?: { response?: unknown };
    choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>;
  };
  if (r?.response !== undefined && typeof r.response === "object" && r.response !== null) {
    return JSON.stringify(r.response);
  }
  if (typeof r?.response === "string") return r.response;
  if (typeof r?.result?.response === "string") return r.result.response;
  const message = r?.choices?.[0]?.message;
  if (typeof message?.content === "string" && message.content.length > 0) {
    return message.content;
  }
  // AI_VISION_MODEL may point at a reasoning model that answers inside reasoning.
  if (typeof message?.reasoning === "string" && message.reasoning.includes("{")) {
    return message.reasoning;
  }
  return null;
}

/**
 * A failed scan: `reason` is the stable code clients and the router localize
 * from (message is for logs only), `detail` is for the failure ledger.
 */
export class VisionError extends Error {
  reason: ScanFailReason;
  detail: {
    itemCount: number;
    finish: string | null;
    attempts: number;
    usage: Record<string, unknown> | null;
  };

  constructor(reason: ScanFailReason, detail: VisionError["detail"]) {
    super(`scan:${reason}`);
    this.name = "VisionError";
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * A failed attempt may only trigger the retry if it failed fast; anything
 * slower means the user has already waited most of their patience.
 */
export const FAST_FAILURE_BUDGET_MS = 12_000;

/**
 * Healthy single plates answer in 2-14 s (prod ledger: 28-50 tokens/s). A
 * busy photo of ~12 items is ~800-1000 tokens, i.e. 16-35 s, so the first
 * attempt waits up to 40 s; the retry only follows a fast failure and gets a
 * shorter leash.
 */
const ATTEMPT_DEADLINES_MS: [number, number] = [40_000, 25_000];

export function finishReasonOf(result: unknown): string | null {
  const r = result as { choices?: Array<{ finish_reason?: unknown }> };
  return typeof r?.choices?.[0]?.finish_reason === "string" ? r.choices[0].finish_reason : null;
}

export type ScheduleTimeout = (fn: () => void, ms: number) => () => void;

export const defaultSchedule: ScheduleTimeout = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * Prompt preamble for "Hitung ulang": the user judged the first answer on this photo wrong. The optional
 * hint is the user's own words and outranks the photo: names, counts and weights they wrote are used as
 * written (prod: 13 of 16 retry passes carried a hint, mostly "Nasi 75 g", "telurnya 3", "2pcs").
 */
export function retryInstruction(hint?: string): string {
  const base =
    "Koreksi: jawabanmu sebelumnya untuk foto ini dinilai tidak akurat oleh pengguna. Periksa ulang nama, porsi, jumlah potongan, dan angka kalorinya, lalu jawab dengan bentuk JSON yang sama.";
  return hint
    ? `${base} Catatan pengguna: "${hint}". Nama, jumlah, berat, dan isi yang disebut pengguna dipakai apa adanya dan menang atas foto (mis. gelas yang kata pengguna Coke Zero adalah Coke Zero, tanpa field "cup").`
    : base;
}

type VisionRunOptions = {
  imageBase64: string;
  mimeType: string;
  instruction?: string;
  locale?: Locale;
  region?: Region;
  /** Eval-only: rewrites the base prompt (see analyzeFoodPhoto). Unset in production. */
  promptTransform?: (base: string) => string;
  /** Sampling temperature; unset = the model default (every production scan today). */
  temperature?: number;
};

function visionRequest(opts: VisionRunOptions) {
  return {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              opts.promptTransform
                ? opts.promptTransform(visionPrompt(opts.locale, opts.region))
                : visionPrompt(opts.locale, opts.region),
              ...(opts.instruction ? [opts.instruction] : []),
            ].join("\n\n"),
          },
          {
            type: "image_url",
            image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: MAX_COMPLETION_TOKENS,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    // Thinking quintuples latency for no measurable accuracy gain on plates.
    chat_template_kwargs: { enable_thinking: false },
  };
}

/**
 * One inference call with a hard wall-clock deadline. Workers AI cannot be
 * cancelled, so timing out only stops OUR wait — the underlying run keeps
 * burning tokens until it finishes. That is still the right trade: the user
 * gets an error at the deadline instead of an open-ended spinner.
 */
export function runVisionOnce(
  ai: AiRunner,
  model: string,
  opts: VisionRunOptions,
  timeoutMs: number,
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<unknown> {
  const run = ai.run(model, visionRequest(opts));
  // The losing run must never surface as an unhandled rejection after the
  // race has settled on the timeout.
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const cancel = schedule(() => reject(new Error("vision-timeout")), timeoutMs);
  return Promise.race([run, deadline]).finally(cancel);
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array | string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof value.getReader === "function"
  );
}

/** What a streaming scan shows before the final answer is parsed. */
export type VisionEvent =
  /** A new attempt starts (the previous one failed): drop what was shown. */
  | { type: "reset" }
  /** An item's name is known; its numbers are still being written. */
  | { type: "name"; index: number; name: string }
  /** An item is complete: numbers, box and calibration. */
  | { type: "item"; index: number; item: StreamedItem };

/** Wall-clock marks of one streaming attempt, ms since the run started. */
export type StreamTiming = { ttftMs?: number };

/**
 * Like runVisionOnce, but asks Workers AI for `stream: true` and reports the
 * items as the single-line JSON grows. Resolves to a chat-completion-shaped
 * object (content, finish_reason, usage) so the caller's parsing is the same
 * as for a plain run. The deadline covers the whole stream: a model that
 * stalls mid-answer times out like one that never started. A runner that
 * ignores `stream` and answers with a plain object passes straight through,
 * with no events.
 */
export async function runVisionStream(
  ai: AiRunner,
  model: string,
  opts: VisionRunOptions,
  timeoutMs: number,
  onEvent: (event: VisionEvent) => void,
  timing: StreamTiming = {},
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<unknown> {
  const startedAt = Date.now();
  const run = ai.run(model, { ...visionRequest(opts), stream: true });
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  deadline.catch(() => {});
  const cancel = schedule(() => reject(new Error("vision-timeout")), timeoutMs);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  try {
    const stream = await Promise.race([run, deadline]);
    const reader = isReadableStream(stream) ? stream.getReader() : null;
    if (!reader) return stream;
    const bytes = new TextDecoder();
    const sse = new ChatStreamDecoder();
    const scanner = new ItemScanner(locale !== DEFAULT_LOCALE);
    const emit = (events: ItemScanEvent[]) => {
      for (const event of events) {
        if (event.index >= MAX_ITEMS) continue;
        if (event.kind === "name") {
          const name = (locale === DEFAULT_LOCALE ? event.name : event.localName)?.trim();
          if (name) onEvent({ type: "name", index: event.index, name: name.slice(0, 120) });
        } else {
          const item = previewItem(event.raw, locale, opts.region);
          if (item) onEvent({ type: "item", index: event.index, item });
        }
      }
    };
    const report = (added: string) => {
      if (!added) return;
      timing.ttftMs ??= Date.now() - startedAt;
      emit(scanner.push(added));
    };
    try {
      while (!sse.done) {
        const { done, value } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        report(sse.push(typeof value === "string" ? value : bytes.decode(value, { stream: true })));
      }
      report(sse.flush());
      // A last item the token limit cut off still counts (see ItemScanner.end).
      emit(scanner.end());
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    }
    return {
      choices: [
        {
          message: { content: sse.text, reasoning: sse.reasoning },
          finish_reason: sse.finish,
        },
      ],
      usage: sse.usage,
    };
  } finally {
    cancel();
  }
}

/** Bound model numbers and round to one decimal. */
function clamp(v: number | undefined, min: number, max: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
}

/** One entry per dish — keep the most complete when the model repeats a name. */
function dedupeItems<T extends { name: string }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const fields = (i: T) => Object.values(i).filter((v) => v !== undefined).length;
    if (fields(item) > fields(existing)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

// Dishes whose kcal already includes their broth (see VISION_PROMPT).
const SOUP_DISH = /\b(bakso|baso|soto|sop|sup|rawon|coto|konro|tekwan|mie? (ayam|kuah|bakso))\b/i;
// A line that is only broth: "kuah", "kaldu", "kuah kaldu", "kuah bakso".
const BROTH_ONLY = /^(kuah|kaldu)\b/i;

/**
 * The model sometimes lists a soup's broth as its own item despite the
 * prompt, double counting it (bakso 380 + "kuah kaldu" 50). Drop broth
 * lines only when a soup dish on the same plate already carries them.
 */
export function dropDuplicateBroth<T extends { name: string }>(items: T[]): T[] {
  const hasSoup = items.some((item) => !BROTH_ONLY.test(item.name) && SOUP_DISH.test(item.name));
  return hasSoup ? items.filter((item) => !BROTH_ONLY.test(item.name.trim())) : items;
}

type ParsedAnswer = {
  items: VisionAnalysis["items"];
  /** Show the "too many" guidance: truncated answer or the item cap was reached. */
  tooMany: boolean;
  /** The raw flag the model set itself (logged for tuning, not trusted). */
  modelTooMany: boolean;
  /** The model's own verdict when it found no food (dark, blurry, not food). */
  problem: ScanFailReason | null;
  /** The answer was a valid, empty list. */
  empty: boolean;
  /** Valid items in the answer before the cap. */
  found: number;
  /** Key repair or item salvage was needed before the answer parsed. */
  repaired: boolean;
  /** The "plate" field (see extractPlateAnswer); undefined = the answer has none. */
  plate: string | null | undefined;
  /** The "card" field (see extractCardAnswer); undefined = the answer has none. */
  card: CardAnswer | undefined;
};

/** The model's report on a reference card in the photo: whether one is there and how sure it is (0-1). */
export type CardAnswer = { seen: boolean; confidence: number };

/**
 * The model's leading "card" field (docs/dishware.md): `{"seen":true,"confidence":0.9}`. Read from the raw
 * text like the plate. undefined = no such field (not asked, or skipped); a field without a usable `seen`
 * is undefined too. A missing confidence on a seen card counts as 0: a card nobody is sure about is not a ruler.
 */
export function extractCardAnswer(text: string): CardAnswer | undefined {
  const field = /"card"\s*:\s*\{([^{}]{0,80})\}/.exec(text);
  if (!field) return undefined;
  const seen = /"seen"\s*:\s*(true|false)/.exec(field[1]!);
  if (!seen) return undefined;
  const confidence = /"confidence"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/.exec(field[1]!);
  const value = confidence ? Math.min(1, Math.max(0, Number(confidence[1]))) : 0;
  return seen[1] === "true" ? { seen: true, confidence: value } : { seen: false, confidence: 0 };
}

/**
 * The model's leading "plate" field (docs/dishware.md), read from the raw text so a cut-off or
 * repaired answer keeps it: undefined = no such field (the model was not asked, or skipped it),
 * null = it answered none, else the label it chose (checked against the user's plates by the caller).
 */
export function extractPlateAnswer(text: string): string | null | undefined {
  const match = /"plate"\s*:\s*(?:"([^"]{0,16})"|(null)|([A-Za-z0-9]{1,8}))/.exec(text);
  if (!match) return undefined;
  if (match[2] !== undefined) return null;
  const label = (match[1] ?? match[3] ?? "").trim();
  return label === "" || /^(null|none|tidak|-)$/i.test(label) ? null : label;
}

/** The model reports why it found nothing as a short Indonesian/English tag. */
function problemReason(problem: string | undefined): ScanFailReason | null {
  if (!problem) return null;
  const p = problem.toLowerCase();
  if (/gelap|buram|blur|dark|kabur/.test(p)) return "unclear";
  if (/bukan|not.?food|no.?food|tidak ada/.test(p)) return "not_food";
  return null;
}

/**
 * Every complete item object of an `"items":[...]` array, even when the answer
 * is cut off mid-item (max_tokens) so the whole text is not valid JSON.
 * Braces inside strings do not count; the unfinished last object is dropped.
 */
export function salvageItems(text: string): unknown[] {
  return scanItems(text);
}

/** The model's tooMany flag is believed only with at least this many items. */
const MODEL_FLAG_MIN_ITEMS = 8;

type ParsedItem = z.infer<typeof visionItemSchema>;

/** A model item with bounded numbers and a validated box; `kcal` is gone when it was not a number. */
type BoundItem = Omit<ParsedItem, "box" | "kind" | "kcal" | "cup" | "alt"> & {
  box: ItemBox | undefined;
  /** Other dishes the model finds plausible, cleaned (lib/name-alternates.ts). */
  alt: string[] | undefined;
  kind: string | undefined;
  kcal: number | undefined;
  /** Cup size the model read off a cup whose contents it could not see; set = contents hidden. */
  cup: string | undefined;
  /** Counted pieces of an item in the weight table or with a count the model gave (lib/piece-count.ts). */
  pieces?: Pieces;
};
type UsableItem = BoundItem & { kcal: number };

function boundItem({ box, kind, cup, alt, ...parsed }: ParsedItem): BoundItem {
  const item = reconcileCount({ ...parsed, grams: clamp(parsed.grams, 1, 5000), kcal: clamp(parsed.kcal, 0, 5000) });
  return {
    ...item,
    box: normalizeBox(box),
    alt: normalizeAlternates(alt, parsed.name),
    kind,
    cup: cup?.trim() || undefined,
    // A hidden cup needs no number from the model: its numbers come from the cup table.
    kcal: clamp(item.kcal, 0, 5000) ?? (cup?.trim() ? 0 : undefined),
    grams: clamp(item.grams, 1, 5000),
    protein: clamp(item.protein, 0, 500),
    carbs: clamp(item.carbs, 0, 500),
    fat: clamp(item.fat, 0, 500),
    fiber: clamp(item.fiber, 0, 200),
    confidence: clamp(item.confidence, 0, 1),
  };
}

/**
 * Zero kcal is a real answer for a drink (Coke Zero, water, black coffee), so
 * a drink may be 0; any other item at 0 is the model giving up on it.
 */
function isUsable(item: BoundItem): item is UsableItem {
  if (item.name.length === 0 || item.kcal === undefined) return false;
  return (
    item.kcal > 0 || item.cup !== undefined || resolveFoodKind(item.name, item.kind) === "minuman"
  );
}

/** Detected item as it leaves calibration; `cup` marks a drink whose contents the photo hides. */
type CalibratedRaw = CalibratedItem & {
  box: ItemBox | undefined;
  alt?: string[];
  kind: FoodKind;
  localName: string | undefined;
  cup?: CupChoice;
};

/** The portion text of a bone-in item says the grams include the bone ("2 potong, dengan tulang"). */
function boneInPortion(item: CalibratedItem, locale: Locale): string {
  const label = getT(locale, "scan")("result.withBone");
  const base = item.portion?.trim() || `${Math.round(item.grams ?? 0)} g`;
  return /tulang|bone/i.test(base) ? base : `${base}, ${label}`;
}

/**
 * Calibrates against TKPI item by item; boxes, kinds and local names re-attach by index.
 * A hidden cup skips calibration: its numbers are the cup table's, for the pick it stands for.
 */
function calibrateRaw(
  raw: UsableItem[],
  locale: Locale,
  options?: CalibrateOptions,
): CalibratedRaw[] {
  const visible = raw.filter((item) => item.cup === undefined);
  const calibrated = calibrateItems(
    visible.map(({ box: _box, alt: _alt, kind, cup: _cup, ...item }) => ({
      ...item,
      drink: resolveFoodKind(item.name, kind) === "minuman",
      asSeen: true,
    })),
    options,
  );
  let next = 0;
  return raw.map((entry) => {
    if (entry.cup !== undefined) {
      const cup = guessCupChoice(entry.name, entry.cup);
      return {
        ...cupItem(cup, locale),
        confidence: CUP_CONFIDENCE,
        matched: true,
        box: entry.box,
        kind: "minuman",
        cup,
      };
    }
    const item = calibrated[next++]!;
    const alt = normalizeAlternates(entry.alt, item.name, entry.name);
    return {
      ...item,
      ...(item.edibleGrams !== undefined ? { portion: boneInPortion(item, locale) } : {}),
      box: entry.box,
      // The library may have renamed the item to the very dish an alternate names.
      ...(alt ? { alt } : {}),
      kind: resolveFoodKind(item.name, entry.kind),
      // An English name the library renamed to its Indonesian row stays what an English reader sees.
      localName: entry.localName ?? (item.name !== entry.name ? entry.name : undefined),
    };
  });
}

/** Matching, broth and kind detection use the Indonesian name; the user sees theirs. */
function localizeName<T extends { name: string; localName?: string }>(
  { localName, ...item }: T,
  locale: Locale,
): Omit<T, "localName"> {
  return {
    ...item,
    name: locale === DEFAULT_LOCALE ? item.name : localName?.trim().slice(0, 120) || item.name,
  };
}

/** An item as it appears on screen: calibrated, before dedupe and the broth rule. */
export type StreamedItem = VisionAnalysis["items"][number];

/**
 * One finished item of a streaming answer, calibrated exactly like the final
 * result (calibration is per item) but without the whole-plate dedupe and
 * broth rules, which need every item. Null for a malformed or empty item.
 */
export function previewItem(
  entry: unknown,
  locale: Locale = DEFAULT_LOCALE,
  region?: Region,
): StreamedItem | null {
  const parsed = visionItemSchema.safeParse(entry);
  if (!parsed.success) return null;
  const bounded = boundItem(parsed.data);
  if (!isUsable(bounded)) return null;
  return localizeName(calibrateRaw([bounded], locale, region ? { region } : undefined)[0]!, locale);
}

/**
 * Parse, bound, calibrate against TKPI, and dedupe one model answer. A
 * cut-off answer (finish "length", or text that is not valid JSON but holds
 * complete items) keeps those items and counts as `tooMany`: running out of
 * tokens means the photo had more dishes than fit. So does a list that
 * reached MAX_ITEMS.
 */
export function parseAnswer(
  text: string,
  finish: string | null,
  locale: Locale = DEFAULT_LOCALE,
  calibration?: CalibrateOptions,
): ParsedAnswer {
  const unfenced = text.replace(/```(?:json)?/g, "");
  const cleaned = repairKeys(unfenced);
  let rawItems: unknown[];
  let modelTooMany = false;
  let problem: ScanFailReason | null = null;
  let truncated = finish === "length";
  let repaired = cleaned !== unfenced;
  try {
    const answer = visionResultSchema.parse(extractJson(cleaned));
    rawItems = answer.items;
    modelTooMany = answer.tooMany === true;
    problem = problemReason(answer.problem);
  } catch (error) {
    rawItems = salvageItems(cleaned);
    if (rawItems.length === 0) throw error;
    truncated = true;
    if (finish !== "length") repaired = true;
  }
  // One malformed item must not sink the plate.
  const valid = rawItems.flatMap((entry) => {
    const parsed = visionItemSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const raw = valid.slice(0, MAX_ITEMS).map(boundItem).filter(isUsable);
  const items = withMaterialAlternates(
    dropDuplicateBroth(dedupeItems(calibrateRaw(raw, locale, calibration))).map((item) => localizeName(item, locale)),
  );
  return {
    items,
    // Real evidence only: the answer was cut off, or it filled the cap. The
    // model's own flag is unreliable on small plates (prod: 1-2 item photos
    // flagged), so it only counts when it came with a near-full list.
    tooMany:
      truncated ||
      valid.length >= MAX_ITEMS ||
      (modelTooMany && valid.length >= MODEL_FLAG_MIN_ITEMS),
    modelTooMany,
    problem,
    empty: rawItems.length === 0,
    found: valid.length,
    repaired,
    plate: extractPlateAnswer(cleaned),
    card: extractCardAnswer(cleaned),
  };
}

/**
 * Runs the vision model and returns validated items plus the model and the
 * binding's token usage (for the cost ledger). `tooMany` is true when the
 * photo held more than fit: the items are the ones that were listed or
 * salvaged from a cut-off answer. Throws a VisionError (`reason` = which failure) when nothing usable came back; callers wrap
 * it into their transport's error shape. Two attempts; the second only after
 * a fast, non-deterministic failure (unparseable answer, transport blip).
 */
export async function analyzeFoodPhoto(
  ai: AiRunner,
  opts: {
    imageBase64: string;
    mimeType: string;
    model?: string;
    /** Present when this run re-checks a photo the user judged inaccurate. */
    retry?: { hint?: string };
    /** Language of the item names and portions in the result; default Indonesian. */
    locale?: Locale;
    /** The user's market: dish names, serving defaults and the nutrient table (default Indonesia). */
    region?: Region;
    /** One line about the person (maternalPromptNote: Hamil/Menyusui), appended to the prompt. */
    userContext?: string;
    /** The user's registered plates as prompt text (dishwareInstruction); the answer then carries `plate`. */
    dishware?: string;
    /** The user's past corrections as a hint (lib/correction-memory.ts); never an override of what the photo shows. */
    memory?: string;
    /**
     * Stream the answer and report items as they complete. The returned
     * analysis is parsed from the whole text, identical to a plain run.
     */
    onEvent?: (event: VisionEvent) => void;
    /** Injectable for tests. */
    timeouts?: [number, number];
    /**
     * Eval harness only (scripts/eval-scans.ts): rewrites the production prompt
     * for this run, so a variant is a diff on the prompt instead of a copy.
     * Production callers never set it; unset = the prompt exactly as shipped.
     */
    promptTransform?: (base: string) => string;
    /** Sampling temperature (the shadow variant only); unset = the model default. */
    temperature?: number;
    /** Eval harness only (scripts/eval-scans.ts): calibration variant; production never sets it. */
    calibration?: CalibrateOptions;
    /** Injectable for tests — deterministic deadlines without real timers. */
    schedule?: ScheduleTimeout;
  },
): Promise<VisionAnalysis> {
  const model = opts.model || DEFAULT_VISION_MODEL;
  const deadlines = opts.timeouts ?? ATTEMPT_DEADLINES_MS;
  let reason: ScanFailReason = "failed";
  let found = 0;
  let finish: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let attempts = 0;

  for (const [attempt, timeoutMs] of deadlines.entries()) {
    const attemptStartedAt = Date.now();
    attempts = attempt + 1;
    const streamTiming: StreamTiming = {};
    try {
      if (opts.onEvent && attempt > 0) opts.onEvent({ type: "reset" });
      const runOptions = {
        imageBase64: opts.imageBase64,
        mimeType: opts.mimeType,
        instruction:
          [opts.retry ? retryInstruction(opts.retry.hint) : undefined, opts.userContext, opts.dishware, opts.memory]
            .filter(Boolean)
            .join("\n\n") || undefined,
        locale: opts.locale,
        region: opts.region,
        promptTransform: opts.promptTransform,
        temperature: opts.temperature,
      };
      const result = opts.onEvent
        ? await runVisionStream(
            ai,
            model,
            runOptions,
            timeoutMs,
            opts.onEvent,
            streamTiming,
            opts.schedule,
          )
        : await runVisionOnce(ai, model, runOptions, timeoutMs, opts.schedule);
      const modelMs = Date.now() - attemptStartedAt;
      finish = finishReasonOf(result);
      usage = extractUsage(result);
      const text = responseText(result);
      if (text === null) throw new Error("no text in response");
      const answer = parseAnswer(
        text,
        finish,
        opts.locale,
        opts.region ? { ...opts.calibration, region: opts.region } : opts.calibration,
      );
      found = answer.found;
      if (answer.items.length > 0) {
        if (answer.tooMany || answer.modelTooMany) {
          console.error(
            `[vision] too many: shown=${answer.tooMany} modelFlag=${answer.modelTooMany} kept ${answer.items.length} of ${answer.found} finish=${finish}`,
          );
        }
        return {
          items: answer.items,
          model,
          usage,
          tooMany: answer.tooMany,
          ...(answer.modelTooMany ? { modelTooMany: true } : {}),
          ...(answer.repaired ? { repaired: true } : {}),
          ...(answer.card !== undefined ? { card: answer.card } : {}),
          ...(answer.plate !== undefined ? { plate: answer.plate } : {}),
          timing: { modelMs, ...streamTiming, attempts },
        };
      }
      // The model's own verdict, or a valid empty list: the same photo gives
      // the same answer again, so a second attempt would only burn quota.
      reason = answer.problem ?? (answer.tooMany ? "too_many" : answer.empty ? "not_food" : "failed");
      if (reason !== "failed") break;
      throw new Error(`no usable items: ${text.slice(0, 200)}`);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "vision-timeout";
      const elapsed = Date.now() - attemptStartedAt;
      reason = isTimeout ? "timeout" : "failed";
      console.error(
        `[vision] attempt ${attempt + 1} failed after ${elapsed}ms finish=${finish}`,
        error,
      );
      // A slow failure already spent the user's patience; don't chain a retry.
      if (isTimeout || elapsed > FAST_FAILURE_BUDGET_MS) break;
    }
  }

  console.error(`[vision] giving up: reason=${reason} items=${found} finish=${finish}`);
  throw new VisionError(reason, { itemCount: found, finish, attempts, usage });
}
