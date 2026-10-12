import { z } from "zod";

import { MEALS, jakartaToday, shiftDate, suggestMealNow } from "./engine";
import type { Meal } from "./engine";
import { calibrateItems } from "./tkpi";
import type { CalibratedItem } from "./tkpi";
import {
  DEFAULT_VISION_MODEL,
  defaultSchedule,
  extractJson,
  extractUsage,
  responseText,
} from "./vision";
import type { AiRunner, ScheduleTimeout } from "./vision";

/**
 * "Ceritakan": the user types or says what they ate ("mie gacoan 1 porsi +
 * udang keju 3 pcs", "kemarin pagi nasi kuning, siang nasi padang") and gets
 * logged items with meal slot and date. Voice goes through Whisper first.
 */

export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** Furthest back a story may log ("seminggu lalu"); older days stay manual. */
export const MAX_DAYS_BACK = 7;
/** A day of meals is ~20 items; anything past that is noise. */
const MAX_ITEMS = 20;
/** 20 items x ~55 tokens each, with headroom. Measured answers: 5-390. */
const MAX_COMPLETION_TOKENS = 1600;
const PARSE_DEADLINE_MS = 25_000;
const TRANSCRIBE_DEADLINE_MS = 25_000;

export const STORY_EMPTY_ERROR =
  "Belum ada makanan yang dikenali dari ceritamu. Sebut nama makanannya, misalnya: nasi goreng 1 piring.";
export const STORY_FAILED_ERROR = "AI belum berhasil membaca ceritamu. Coba lagi sebentar lagi.";
export const VOICE_EMPTY_ERROR = "Suaranya kurang jelas. Coba rekam lagi lebih dekat ke mikrofon.";

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function storyPrompt(ctx: {
  text: string;
  today: string;
  clock: string;
  slots: readonly Meal[];
  defaultMeal?: Meal;
}): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T00:00:00Z`).getUTCDay()];
  const fallback = ctx.defaultMeal
    ? `Jika waktu makan tidak disebut, pakai ${ctx.defaultMeal}.`
    : "Jika waktu makan tidak disebut, tebak dari jam sekarang.";
  return `Anda adalah ahli gizi. Pengguna menceritakan makanan yang SUDAH dimakan (bisa beberapa waktu makan dan beberapa hari). Ubah menjadi daftar item.
Hari ini ${ctx.today} (${weekday}), jam ${ctx.clock} WIB. Waktu makan yang boleh: ${ctx.slots.join(", ")}. ${fallback}
Jawab HANYA JSON valid satu baris (tanpa \`\`\`) dengan bentuk persis:
{"items":[{"name":"nama makanan","portion":"porsi yang disebut","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"meal":"salah satu waktu makan","day":number atau null}]}
Aturan:
- day = 0 hari ini, -1 kemarin, -2 kemarin lusa / dua hari lalu, dst. Nama hari (mis. "senin") = hari itu yang terakhir lewat. day = null jika hari tidak disebut sama sekali.
- pagi/sarapan = sarapan, siang = makan_siang, sore/malam = makan_malam, cemilan/jajan = snack, sahur = sahur, buka puasa = berbuka.
- Jumlah yang disebut (mis. "3 pcs", "2 porsi", "setengah piring") sudah termasuk di grams dan kcal. Tanpa jumlah = 1 porsi umum.
- Merek/menu restoran (mis. Mie Gacoan, McD, Richeese) pakai porsi standar restoran itu; name tetap tulis mereknya.
- Lauk yang disebut ("pakai telur dadar", "lauk rendang") jadi item sendiri. "Nasi padang/warteg/rames lauk X" = item nasi putih (porsi warung, termasuk kuah dan sayur) + item X; jangan hitung lauk dua kali. Hidangan satu kesatuan (nasi goreng, nasi kuning, nasi uduk, bubur, soto, bakso) tetap satu item.
- Minuman dicatat juga (es teh manis, kopi susu).
- Abaikan yang bukan makanan. Kalau tidak ada makanan sama sekali, jawab {"items":[]}.
- name dalam Bahasa Indonesia, huruf awal kapital. kcal, protein/carbs/fat/fiber (gram) = estimasi realistis.
Cerita pengguna: """${ctx.text}"""`;
}

const rawItemSchema = z.object({
  name: z.string(),
  portion: z.string().optional(),
  grams: z.number().optional(),
  kcal: z.number(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  fiber: z.number().optional(),
  meal: z.string().optional(),
  day: z.number().nullable().optional(),
});

const NUMERIC_KEYS = ["grams", "kcal", "protein", "carbs", "fat", "fiber", "day"] as const;

/**
 * Gemma occasionally mangles a key ("protein thick": 15). Keep the first
 * word, and coerce numeric strings ("250") so one glitch never drops an item.
 */
function normalizeItem(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const clean = key.trim().split(/\s+/)[0]?.toLowerCase() ?? key;
    if (!(clean in out)) out[clean] = value;
  }
  for (const key of NUMERIC_KEYS) {
    const v = out[key];
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      out[key] = Number(v);
    }
  }
  return out;
}

function bound(v: number | undefined, min: number, max: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
}

export type StoryItem = CalibratedItem & { meal: Meal; date: string };

export type StoryContext = {
  /** WIB calendar day "today" means; injectable for tests. */
  today: string;
  /** Day a story without any day word lands on (the day the user is viewing). */
  referenceDate: string;
  slots: readonly Meal[];
  defaultMeal?: Meal;
  /** Slot when neither the story nor the caller names one. */
  nowMeal: Meal;
};

/** Parse, bound, calibrate, and place one model answer onto meal slots and dates. */
export function storyItemsFromText(text: string, ctx: StoryContext): StoryItem[] {
  const parsed = z
    .object({ items: z.array(z.unknown()).max(60) })
    .parse(extractJson(text.replace(/```(?:json)?/g, "")));
  const placed: Array<{
    item: Parameters<typeof calibrateItems>[0][number];
    meal: Meal;
    date: string;
  }> = [];
  for (const candidate of parsed.items.slice(0, MAX_ITEMS)) {
    const result = rawItemSchema.safeParse(normalizeItem(candidate));
    if (!result.success) continue;
    const raw = result.data;
    const kcal = bound(raw.kcal, 0, 5000);
    const name = raw.name.trim();
    if (kcal === undefined || kcal <= 0 || name.length === 0) continue;
    const meal =
      raw.meal && (ctx.slots as readonly string[]).includes(raw.meal)
        ? (raw.meal as Meal)
        : (ctx.defaultMeal ?? ctx.nowMeal);
    const date =
      raw.day === null || raw.day === undefined || !Number.isFinite(raw.day)
        ? ctx.referenceDate
        : shiftDate(ctx.today, Math.max(-MAX_DAYS_BACK, Math.min(0, Math.round(raw.day))));
    placed.push({
      item: {
        name: name.slice(0, 120),
        portion: raw.portion?.trim().slice(0, 80) || undefined,
        kcal,
        grams: bound(raw.grams, 1, 5000),
        protein: bound(raw.protein, 0, 500),
        carbs: bound(raw.carbs, 0, 500),
        fat: bound(raw.fat, 0, 500),
        fiber: bound(raw.fiber, 0, 200),
      },
      meal,
      date,
    });
  }
  const calibrated = calibrateItems(placed.map((p) => p.item));
  return calibrated.map((item, index) => ({
    ...item,
    meal: placed[index]!.meal,
    date: placed[index]!.date,
  }));
}

function withDeadline<T>(
  run: Promise<T>,
  timeoutMs: number,
  schedule: ScheduleTimeout,
  label: string,
): Promise<T> {
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const cancel = schedule(() => reject(new Error(`${label}-timeout`)), timeoutMs);
  return Promise.race([run, deadline]).finally(cancel);
}

export type StoryAnalysis = {
  items: StoryItem[];
  model: string;
  usage: Record<string, unknown> | null;
};

/**
 * Text story → items. Throws a plain Error whose message is user-safe copy.
 * An answer with zero food items throws STORY_EMPTY_ERROR so the caller can
 * skip charging the quota for it.
 */
export async function parseFoodStory(
  ai: AiRunner,
  opts: {
    text: string;
    slots: readonly Meal[];
    defaultMeal?: Meal;
    referenceDate?: string;
    model?: string;
    now?: Date;
    schedule?: ScheduleTimeout;
  },
): Promise<StoryAnalysis> {
  const model = opts.model || DEFAULT_VISION_MODEL;
  const now = opts.now ?? new Date();
  const today = jakartaToday(now);
  const clock = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });
  const slots = opts.slots.length > 0 ? opts.slots : (MEALS as readonly Meal[]);
  const suggested = suggestMealNow(now, slots.includes("sahur"));
  const ctx: StoryContext = {
    today,
    referenceDate: opts.referenceDate && opts.referenceDate <= today ? opts.referenceDate : today,
    slots,
    defaultMeal:
      opts.defaultMeal && slots.includes(opts.defaultMeal) ? opts.defaultMeal : undefined,
    nowMeal: slots.includes(suggested) ? suggested : slots[0]!,
  };
  let result: unknown;
  try {
    result = await withDeadline(
      ai.run(model, {
        messages: [
          {
            role: "user",
            content: storyPrompt({
              text: opts.text,
              today,
              clock,
              slots,
              defaultMeal: ctx.defaultMeal,
            }),
          },
        ],
        max_tokens: MAX_COMPLETION_TOKENS,
        chat_template_kwargs: { enable_thinking: false },
      }),
      PARSE_DEADLINE_MS,
      opts.schedule ?? defaultSchedule,
      "story",
    );
  } catch (error) {
    console.error("[story] inference failed", error);
    throw new Error(STORY_FAILED_ERROR);
  }
  const text = responseText(result);
  let items: StoryItem[];
  try {
    if (text === null) throw new Error("no text in response");
    items = storyItemsFromText(text, ctx);
  } catch (error) {
    console.error("[story] unparseable answer", error, text?.slice(0, 300));
    throw new Error(STORY_FAILED_ERROR);
  }
  if (items.length === 0) throw new Error(STORY_EMPTY_ERROR);
  return { items, model, usage: extractUsage(result) };
}

/** Voice note → Indonesian transcript. Whisper takes webm/opus, mp4/aac, m4a, mp3 and wav as-is. */
export async function transcribeStory(
  ai: AiRunner,
  audioBase64: string,
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<{ text: string; usage: Record<string, unknown> | null }> {
  let result: unknown;
  try {
    result = await withDeadline(
      ai.run(TRANSCRIBE_MODEL, {
        audio: audioBase64,
        language: "id",
        vad_filter: true,
        initial_prompt: "Cerita makanan: nasi, lauk, gorengan, minuman, porsi.",
      }),
      TRANSCRIBE_DEADLINE_MS,
      schedule,
      "transcribe",
    );
  } catch (error) {
    console.error("[story] transcription failed", error);
    throw new Error(VOICE_EMPTY_ERROR);
  }
  const r = result as { text?: unknown; result?: { text?: unknown } };
  const raw =
    typeof r?.text === "string" ? r.text : typeof r?.result?.text === "string" ? r.result.text : "";
  const text = raw.trim();
  if (text.length < 2) throw new Error(VOICE_EMPTY_ERROR);
  return { text: text.slice(0, 1000), usage: extractUsage(result) };
}
