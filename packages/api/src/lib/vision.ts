import { z } from "zod";
import { calibrateItems } from "./tkpi";

export const DEFAULT_VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";

// Latency is completion tokens. Gemma 4 on Workers AI thinks by default:
// ~2-3k reasoning tokens per plate, p50 ~50 s in the prod ledger. With
// thinking off and single-line JSON the same plates answer in 110-350
// tokens / 2-7 s with the same estimates (probe 2026-10-11, 3 dishes).
// Guided JSON (response_format) was dropped: without thinking it degenerates
// into whitespace loops until max_tokens on busy plates.
export const VISION_PROMPT = `Anda adalah ahli gizi. Identifikasi makanan pada foto ini (fokus masakan Indonesia), maksimal 8 item terbesar/terpenting.
Jawab HANYA JSON valid satu baris (tanpa indentasi, tanpa \`\`\`) tanpa teks lain, dengan bentuk persis:
{"items":[{"name":"nama masakan","portion":"perkiraan porsi","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"confidence":number}]}
Satu hidangan = satu item: kuah, bumbu/saus, sayur, dan lontong/mi/bihun yang sudah bagian dari hidangan itu (mis. gado-gado, bakso, soto) TERMASUK di kcal hidangan, jangan dipisah. Pisahkan hanya yang berdiri sendiri: nasi, lauk terpisah, telur, kerupuk, gorengan, minuman.
Aturan: ini bukan percakapan — jangan menjawab dengan tabel markdown. name dalam Bahasa Indonesia tanpa terjemahan. grams = perkiraan berat (1-5000); kcal, protein/carbs/fat (gram), fiber (gram) = estimasi realistis porsi umum; confidence 0-1.`;

/** Fits 8 single-line items with room to spare; measured answers are 110-660. */
const MAX_COMPLETION_TOKENS = 1200;
const MAX_ITEMS = 8;

export const visionItemSchema = z.object({
  name: z.string(),
  portion: z.string().optional(),
  grams: z.number().optional(),
  kcal: z.number(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  fiber: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const visionResultSchema = z.object({
  // Loose upper bound for parsing — the 8-item cap is enforced by slicing.
  items: z.array(visionItemSchema).max(15),
});

export type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

/** Models answer with prose, fences, or wrapper keys — cut the JSON out. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object in response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/** Token accounting from the AI binding when the model surfaces it; null otherwise. */
function extractUsage(result: unknown): Record<string, unknown> | null {
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
  items: Array<z.infer<typeof visionItemSchema> & { kcal: number }>;
  /** Model actually used — callers pass `model` through unresolved. */
  model: string;
  usage: Record<string, unknown> | null;
};

/** Handles every Workers AI response shape: text, {response}, {result}, chat. */
function responseText(result: unknown): string | null {
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

export const FRIENDLY_ERROR =
  "AI tidak berhasil mengenali foto ini. Coba foto lain dengan pencahayaan lebih baik.";

/**
 * A failed attempt may only trigger the retry if it failed fast; anything
 * slower means the user has already waited most of their patience.
 */
export const FAST_FAILURE_BUDGET_MS = 12_000;

/** Healthy answers land in 2-14 s; the retry gets a shorter leash. */
const ATTEMPT_DEADLINES_MS: [number, number] = [25_000, 20_000];

function finishReasonOf(result: unknown): string | null {
  const r = result as { choices?: Array<{ finish_reason?: unknown }> };
  return typeof r?.choices?.[0]?.finish_reason === "string" ? r.choices[0].finish_reason : null;
}

export type ScheduleTimeout = (fn: () => void, ms: number) => () => void;

const defaultSchedule: ScheduleTimeout = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * One inference call with a hard wall-clock deadline. Workers AI cannot be
 * cancelled, so timing out only stops OUR wait — the underlying run keeps
 * burning tokens until it finishes. That is still the right trade: the user
 * gets an error at the deadline instead of an open-ended spinner.
 */
export function runVisionOnce(
  ai: AiRunner,
  model: string,
  opts: { imageBase64: string; mimeType: string },
  timeoutMs: number,
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<unknown> {
  const run = ai.run(model, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: MAX_COMPLETION_TOKENS,
    // Thinking quintuples latency for no measurable accuracy gain on plates.
    chat_template_kwargs: { enable_thinking: false },
  });
  // The losing run must never surface as an unhandled rejection after the
  // race has settled on the timeout.
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const cancel = schedule(() => reject(new Error("vision-timeout")), timeoutMs);
  return Promise.race([run, deadline]).finally(cancel);
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

/** Parse, bound, calibrate against TKPI, and dedupe one model answer. */
function itemsFromText(text: string): VisionAnalysis["items"] {
  const raw = visionResultSchema
    .parse(extractJson(text.replace(/```(?:json)?/g, "")))
    .items.slice(0, MAX_ITEMS);
  return dedupeItems(
    calibrateItems(
      raw
        .map((item) => ({
          ...item,
          kcal: clamp(item.kcal, 0, 5000),
          grams: clamp(item.grams, 1, 5000),
          protein: clamp(item.protein, 0, 500),
          carbs: clamp(item.carbs, 0, 500),
          fat: clamp(item.fat, 0, 500),
          fiber: clamp(item.fiber, 0, 200),
          confidence: clamp(item.confidence, 0, 1),
        }))
        .filter(
          (item): item is typeof item & { kcal: number } =>
            item.kcal !== undefined && item.kcal > 0 && item.name.length > 0,
        ),
    ),
  );
}

/**
 * Runs the vision model and returns validated items plus the model and the
 * binding's token usage (for the cost ledger). Throws a plain Error
 * (message = user-safe copy) on any failure; callers wrap into their
 * transport's error shape. Two attempts; the second only after a fast
 * failure (unparseable/truncated answer, transport blip).
 */
export async function analyzeFoodPhoto(
  ai: AiRunner,
  opts: {
    imageBase64: string;
    mimeType: string;
    model?: string;
    /** Injectable for tests. */
    timeouts?: [number, number];
    /** Injectable for tests — deterministic deadlines without real timers. */
    schedule?: ScheduleTimeout;
  },
): Promise<VisionAnalysis> {
  const model = opts.model || DEFAULT_VISION_MODEL;
  const deadlines = opts.timeouts ?? ATTEMPT_DEADLINES_MS;

  for (const [attempt, timeoutMs] of deadlines.entries()) {
    const attemptStartedAt = Date.now();
    let finish: string | null = null;
    try {
      const result = await runVisionOnce(ai, model, opts, timeoutMs, opts.schedule);
      finish = finishReasonOf(result);
      const text = responseText(result);
      if (text === null) throw new Error("no text in response");
      const items = itemsFromText(text);
      if (items.length === 0) throw new Error(`no usable items: ${text.slice(0, 200)}`);
      return { items, model, usage: extractUsage(result) };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "vision-timeout";
      const elapsed = Date.now() - attemptStartedAt;
      console.error(
        `[vision] attempt ${attempt + 1} failed after ${elapsed}ms finish=${finish}`,
        error,
      );
      // A slow failure already spent the user's patience; don't chain a retry.
      if (isTimeout || elapsed > FAST_FAILURE_BUDGET_MS) break;
    }
  }

  throw new Error(FRIENDLY_ERROR);
}
