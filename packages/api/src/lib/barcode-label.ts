/**
 * Reading an Indonesian "INFORMASI NILAI GIZI" panel (and optionally the front
 * of the pack) with the vision model: prompts, answer parsing into a draft, and
 * the model call. The router owns quota, storage and the photo's lifetime (the
 * photo lives only in the request).
 *
 * The model copies printed numbers, it never estimates. Everything it says is
 * a draft the user confirms or edits; barcode-nutrition.ts holds the per-100
 * conversion and the plausibility rules every saved value must pass.
 */
import { z } from "zod";

import { EMPTY_NUTRIENTS, KJ_PER_KCAL, checkLabelNutrients } from "./barcode-nutrition";
import type {
  LabelBasis,
  LabelDraft,
  LabelNutrients,
  LabelWarning,
} from "./barcode-nutrition";
import { defaultSchedule, extractJson, extractUsage, responseText } from "./vision";
import type { AiRunner, ScheduleTimeout } from "./vision";

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** Always Indonesian: the panel is, and the model returns numbers only. */
export const LABEL_PROMPT = [
  'Kamu membaca foto tabel "INFORMASI NILAI GIZI" (Nutrition Facts) pada kemasan makanan atau minuman di Indonesia.',
  "Salin angka PERSIS seperti tercetak. Jangan menebak, menghitung, atau membulatkan sendiri. Angka yang tidak terbaca atau tidak tertera: null.",
  "Jawab HANYA satu baris JSON tanpa teks lain:",
  '{"servingSize":30,"unit":"g","servingsPerPack":2,"perServing":{"kcal":150,"kj":null,"protein":2,"carbs":18,"fat":8,"fiber":1,"sugar":3},"per100":null,"problem":null}',
  "Aturan:",
  '- servingSize = "Takaran saji" dalam gram atau ml, angka saja ("1 bungkus (30 g)" jadi 30; "1 botol 350 ml" jadi 350). unit = "g" atau "ml".',
  '- perServing = angka "Jumlah per sajian"/"per sajian". per100 = kolom atau baris "per 100 g"/"per 100 ml" kalau ada. Isi null untuk yang tidak ada di tabel. Jangan menyalin angka satu kolom ke kolom lain.',
  '- kcal = "Energi total" dalam kkal atau kcal. Kalau energi hanya tertulis dalam kJ, isi kj dan kcal null.',
  '- protein = "Protein", carbs = "Karbohidrat total", fat = "Lemak total", fiber = "Serat pangan", sugar = "Gula". Semua dalam gram. Tertulis "0" atau "<1" berarti 0; tidak tertera berarti null.',
  '- "% AKG" dan natrium/garam tidak perlu.',
  '- Kalau foto bukan tabel gizi atau terlalu buram untuk dibaca, isi "problem" dengan "bukan label" atau "buram" dan sisanya null.',
].join("\n");

export const FRONT_PROMPT = [
  "Kamu membaca foto bagian depan kemasan makanan atau minuman di Indonesia.",
  "Jawab HANYA satu baris JSON tanpa teks lain:",
  '{"name":"Chitato Sapi Panggang","brand":"Chitato","quantity":"68 g"}',
  "- name = nama produk beserta variannya seperti tercetak, tanpa merek di depannya kalau mereknya sudah ada di brand dan tanpa slogan.",
  "- brand = merek. quantity = isi bersih ('68 g', '350 ml') kalau tertulis.",
  "Yang tidak terbaca atau tidak tertera: null. Jangan menebak.",
].join("\n");

// ---------------------------------------------------------------------------
// Parsing the model's answers
// ---------------------------------------------------------------------------

/** "1,5", "1.5 g", "<1", "3 gram" -> number; anything else null. */
function printedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(",", ".");
  if (text.startsWith("<")) return 0;
  const match = /^\d+(\.\d+)?/.exec(text);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const numberish = z.preprocess((v) => printedNumber(v), z.number().nullable()).catch(null);
const textish = z
  .preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().nullable())
  .catch(null);

const columnSchema = z
  .object({
    kcal: numberish.optional().default(null),
    kj: numberish.optional().default(null),
    protein: numberish.optional().default(null),
    carbs: numberish.optional().default(null),
    fat: numberish.optional().default(null),
    fiber: numberish.optional().default(null),
    sugar: numberish.optional().default(null),
  })
  .nullable()
  .catch(null);

const labelAnswerSchema = z.object({
  servingSize: numberish.optional().default(null),
  unit: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["g", "ml"])).catch("g"),
  perServing: columnSchema.optional().default(null),
  per100: columnSchema.optional().default(null),
  problem: textish.optional().default(null),
});

const frontAnswerSchema = z.object({
  name: textish.optional().default(null),
  brand: textish.optional().default(null),
  quantity: textish.optional().default(null),
});

type Column = NonNullable<z.infer<typeof columnSchema>>;

function columnToNutrients(column: Column | null): LabelNutrients | null {
  if (!column) return null;
  const kcal = column.kcal ?? (column.kj !== null ? Math.round(column.kj / KJ_PER_KCAL) : null);
  const nutrients: LabelNutrients = {
    kcal,
    protein: column.protein,
    carbs: column.carbs,
    fat: column.fat,
    fiber: column.fiber,
    sugar: column.sugar,
  };
  return Object.values(nutrients).every((v) => v === null) ? null : nutrients;
}

/** Same label read twice: the per-serving and per-100 columns must be proportional. */
function columnsAgree(serving: LabelNutrients, per100: LabelNutrients, servingSize: number): boolean {
  if (serving.kcal === null || per100.kcal === null) return true;
  const expected = (per100.kcal * servingSize) / 100;
  return Math.abs(serving.kcal - expected) <= Math.max(expected * 0.2, 15);
}

export type LabelReadResult =
  | { ok: true; draft: LabelDraft }
  | { ok: false; reason: "unclear" | "not_label" };

/**
 * Model text for the label photo (and optionally the front photo) -> draft.
 * A draft with some blanks is fine (the user fills them); no numbers at all is not.
 */
export function buildDraft(labelText: string, frontText: string | null): LabelReadResult {
  let answer: z.infer<typeof labelAnswerSchema>;
  try {
    answer = labelAnswerSchema.parse(extractJson(labelText));
  } catch {
    return { ok: false, reason: "unclear" };
  }
  const serving = columnToNutrients(answer.perServing);
  const per100 = columnToNutrients(answer.per100);
  if (!serving && !per100) {
    const notLabel = answer.problem !== null && /bukan|not/i.test(answer.problem);
    return { ok: false, reason: notLabel ? "not_label" : "unclear" };
  }
  const servingSize = answer.servingSize !== null && answer.servingSize > 0 ? answer.servingSize : null;
  const warnings: LabelWarning[] = [];
  // Prefer the panel's per-serving column (what the user sees in bold on the
  // pack) when the serving size makes it convertible; otherwise per 100.
  const useServing = serving !== null && (servingSize !== null || per100 === null);
  const basis: LabelBasis = useServing ? "serving" : "per100";
  const nutrients = (useServing ? serving : per100) ?? serving ?? per100 ?? EMPTY_NUTRIENTS;
  if (useServing && servingSize === null) warnings.push("no_serving_size");
  if (nutrients.kcal === null) warnings.push("no_energy");
  if (serving && per100 && servingSize !== null && !columnsAgree(serving, per100, servingSize)) {
    warnings.push("columns_disagree");
  }
  let front: z.infer<typeof frontAnswerSchema> | null = null;
  if (frontText !== null) {
    try {
      front = frontAnswerSchema.parse(extractJson(frontText));
    } catch {
      front = null;
    }
  }
  const draft: LabelDraft = {
    name: front?.name?.slice(0, 120) ?? null,
    brand: front?.brand?.slice(0, 80) ?? null,
    quantity: front?.quantity?.slice(0, 60) ?? null,
    servingSize,
    unit: answer.unit,
    basis,
    nutrients,
    warnings,
  };
  const rejection = checkLabelNutrients(draft.basis, draft.servingSize, draft.nutrients);
  if (rejection) warnings.push(rejection);
  return { ok: true, draft };
}

// ---------------------------------------------------------------------------
// The model calls
// ---------------------------------------------------------------------------

const LABEL_MAX_TOKENS = 500;
const FRONT_MAX_TOKENS = 200;
/** One attempt per photo; the user can simply retake. Panels answer in a few seconds. */
export const LABEL_TIMEOUT_MS = 40_000;

export class LabelReadError extends Error {
  reason: "unclear" | "not_label" | "timeout" | "failed";
  constructor(reason: LabelReadError["reason"]) {
    super(`label:${reason}`);
    this.name = "LabelReadError";
    this.reason = reason;
  }
}

type PhotoInput = { imageBase64: string; mimeType: string };

async function askModel(
  ai: AiRunner,
  model: string,
  prompt: string,
  photo: PhotoInput,
  maxTokens: number,
  timeoutMs: number,
  schedule: ScheduleTimeout,
): Promise<{ text: string; usage: Record<string, unknown> | null }> {
  const run = ai.run(model, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${photo.mimeType};base64,${photo.imageBase64}` } },
        ],
      },
    ],
    max_tokens: maxTokens,
    // Copying numbers off a panel: deterministic, and no thinking latency.
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  });
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  deadline.catch(() => {});
  const cancel = schedule(() => reject(new LabelReadError("timeout")), timeoutMs);
  try {
    const result = await Promise.race([run, deadline]);
    const text = responseText(result);
    if (text === null) throw new LabelReadError("failed");
    return { text, usage: extractUsage(result) };
  } finally {
    cancel();
  }
}

export type LabelRun = {
  draft: LabelDraft;
  model: string;
  usage: Record<string, unknown> | null;
};

/**
 * Reads the nutrition panel (required) and the front of the pack (optional),
 * concurrently. The front photo failing never fails the read: the user types the
 * name. The photos are only ever passed through; nothing here stores them.
 */
export async function readLabelPhotos(
  ai: AiRunner,
  opts: {
    model: string;
    label: PhotoInput;
    front?: PhotoInput | null;
    timeoutMs?: number;
    schedule?: ScheduleTimeout;
  },
): Promise<LabelRun> {
  const timeoutMs = opts.timeoutMs ?? LABEL_TIMEOUT_MS;
  const schedule = opts.schedule ?? defaultSchedule;
  const labelCall = askModel(ai, opts.model, LABEL_PROMPT, opts.label, LABEL_MAX_TOKENS, timeoutMs, schedule);
  const frontCall = opts.front
    ? askModel(ai, opts.model, FRONT_PROMPT, opts.front, FRONT_MAX_TOKENS, timeoutMs, schedule).catch(
        () => null,
      )
    : Promise.resolve(null);
  let label: Awaited<typeof labelCall>;
  try {
    label = await labelCall;
  } catch (error) {
    await frontCall;
    throw error instanceof LabelReadError ? error : new LabelReadError("failed");
  }
  const front = await frontCall;
  const read = buildDraft(label.text, front?.text ?? null);
  if (!read.ok) throw new LabelReadError(read.reason);
  return { draft: read.draft, model: opts.model, usage: label.usage };
}
