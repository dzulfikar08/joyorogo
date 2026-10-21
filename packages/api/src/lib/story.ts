import { z } from "zod";
import { DEFAULT_LOCALE, DEFAULT_REGION } from "@joyorogo/i18n";
import type { Locale, Region } from "@joyorogo/i18n";

import { localNameRule, localNameShape, transcriptionLanguage } from "./ai-locale";
import { storyRegionRule } from "./region-prompt";
import { MEALS, jakartaToday, shiftDate, suggestMealNow } from "./engine";
import { foodKind } from "./food-kind";
import type { Meal } from "./engine";
import { scaleRow } from "./meal-reference";
import type { MealRow, Target } from "./meal-reference";
import { serverT } from "./messages";
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

/** User-facing story errors in the caller's language (copy lives in the errors namespace of @joyorogo/i18n). */
export function storyError(kind: "empty" | "failed" | "voiceEmpty", locale: Locale): string {
  return serverT(locale, "errors")(`story.${kind}`);
}

/** The Indonesian copy, for tests and callers without a locale. */
export const STORY_EMPTY_ERROR = storyError("empty", DEFAULT_LOCALE);
export const STORY_FAILED_ERROR = storyError("failed", DEFAULT_LOCALE);
export const VOICE_EMPTY_ERROR = storyError("voiceEmpty", DEFAULT_LOCALE);

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function storyPrompt(ctx: {
  text: string;
  today: string;
  clock: string;
  slots: readonly Meal[];
  defaultMeal?: Meal;
  locale?: Locale;
  /** Dish names and serving defaults of the user's market; Indonesia adds nothing. */
  region?: Region;
  reference?: { rows: readonly MealRow[]; target: Target };
}): string {
  const locale = ctx.locale ?? DEFAULT_LOCALE;
  const weekday = WEEKDAYS[new Date(`${ctx.today}T00:00:00Z`).getUTCDay()];
  const fallback = ctx.defaultMeal
    ? `Jika waktu makan tidak disebut, pakai ${ctx.defaultMeal}.`
    : "Jika waktu makan tidak disebut, tebak dari jam sekarang.";
  return `Anda adalah ahli gizi. Pengguna menceritakan makanan yang SUDAH dimakan (bisa beberapa waktu makan dan beberapa hari). Ubah menjadi daftar item.
Hari ini ${ctx.today} (${weekday}), jam ${ctx.clock} WIB. Waktu makan yang boleh: ${ctx.slots.join(", ")}. ${fallback}
Jawab HANYA JSON valid satu baris (tanpa \`\`\`) dengan bentuk persis:
{"items":[{"name":"nama makanan",${localNameShape(locale)}"portion":"porsi yang disebut","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"meal":"salah satu waktu makan","day":number atau null}]}
Aturan:
- day = 0 hari ini, -1 kemarin, -2 kemarin lusa / dua hari lalu, dst. Nama hari (mis. "senin") = hari itu yang terakhir lewat. day = null jika hari tidak disebut sama sekali.
- pagi/sarapan = sarapan, siang = makan_siang, sore/malam = makan_malam, cemilan/jajan = snack, sahur = sahur, buka puasa = berbuka.
- Jumlah yang disebut (mis. "3 pcs", "2 porsi", "setengah piring") sudah termasuk di grams dan kcal. Tanpa jumlah = 1 porsi umum.
- Merek/menu restoran (mis. Mie Gacoan, McD, Richeese) pakai porsi standar restoran itu; name tetap tulis mereknya.
- Lauk yang disebut ("pakai telur dadar", "lauk rendang") jadi item sendiri. "Nasi padang/warteg/rames lauk X" = item nasi putih (porsi warung, termasuk kuah dan sayur) + item X; jangan hitung lauk dua kali. Hidangan satu kesatuan (nasi goreng, nasi kuning, nasi uduk, bubur, soto, bakso) tetap satu item.
- Minuman dicatat juga (es teh manis, kopi susu). Minuman tanpa kalori (Coke Zero, Diet Coke, air putih, teh tawar, kopi hitam tanpa gula) tetap dicatat dengan kcal 0 atau 1, itu jawaban yang benar. Untuk minuman grams = volume ml (kaleng 330, gelas 250). Merek atau varian yang disebut pengguna dipakai apa adanya (mis. "coke zero" bukan "coca cola").
- Abaikan yang bukan makanan. Kalau tidak ada makanan sama sekali, jawab {"items":[]}.
- name dalam Bahasa Indonesia, huruf awal kapital. kcal, protein/carbs/fat/fiber (gram) = estimasi realistis.${localNameRule(locale)}${storyRegionRule(ctx.region ?? DEFAULT_REGION)}
${referenceBlock(ctx.reference)}Cerita pengguna: """${ctx.text}"""`;
}

/** Rows the user pointed at ("sama kayak kemarin"), numbered so the model can refer to them without retyping any nutrition. */
function referenceBlock(reference: { rows: readonly MealRow[]; target: Target } | undefined): string {
  if (!reference) return "";
  const rows = reference.rows.map((row, ref) => ({
    ref,
    name: row.name,
    grams: row.grams ?? undefined,
    kcal: Math.round(row.kcal),
  }));
  return `Pengguna menunjuk makanan yang sudah tercatat. Daftarnya (ref = nomor):
${JSON.stringify(rows)}
Aturan tambahan untuk rujukan ini:
- Item tercatat yang tetap dimakan ditulis {"ref":nomor,"scale":faktor porsi} saja (scale 1 = sama persis, 0.5 = setengah, 2 = dua kali). Jangan tulis ulang nama atau gizinya: itu diambil dari catatan.
- Item tercatat yang dihapus atau diganti pengguna jangan ditulis sama sekali.
- Makanan baru yang disebut pengguna (mis. "tambah telur") ditulis lengkap seperti biasa, tanpa ref.
- Semua item masuk ke waktu makan ${reference.target.meal} dan hari tujuan: isi meal="${reference.target.meal}" dan day=null.
`;
}

const rawItemSchema = z.object({
  name: z.string().optional(),
  localName: z.string().optional(),
  portion: z.string().optional(),
  grams: z.number().optional(),
  kcal: z.number().optional(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  fiber: z.number().optional(),
  meal: z.string().optional(),
  day: z.number().nullable().optional(),
  /** Index into the referenced rows: the item is copied from the log, not estimated. */
  ref: z.number().nullable().optional(),
  scale: z.number().optional(),
});

const NUMERIC_KEYS = ["grams", "kcal", "protein", "carbs", "fat", "fiber", "day", "ref", "scale"] as const;

/**
 * Gemma occasionally mangles a key ("protein thick": 15). Keep the first
 * word, and coerce numeric strings ("250") so one glitch never drops an item.
 */
function normalizeItem(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.trim().split(/\s+/)[0]?.toLowerCase() ?? key;
    // The one camelCase key: lower-casing would hide it from the schema.
    const clean = lower === "localname" ? "localName" : lower;
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

/** `copied`: stored nutrition from an earlier log row, scaled, never re-estimated. */
export type StoryItem = CalibratedItem & { meal: Meal; date: string; copied?: boolean };

export type StoryContext = {
  /** WIB calendar day "today" means; injectable for tests. */
  today: string;
  /** Day a story without any day word lands on (the day the user is viewing). */
  referenceDate: string;
  slots: readonly Meal[];
  defaultMeal?: Meal;
  /** Slot when neither the story nor the caller names one. */
  nowMeal: Meal;
  /** Language of the returned item names and portions; default Indonesian. */
  locale?: Locale;
  /** The user's market: nutrient table for calibration (default Indonesia). */
  region?: Region;
  /** Logged rows the story points at; items may reference them by index. Everything lands on `target`. */
  reference?: { rows: readonly MealRow[]; target: Target };
};

/** Parse, bound, calibrate, and place one model answer onto meal slots and dates. */
export function storyItemsFromText(text: string, ctx: StoryContext): StoryItem[] {
  const parsed = z
    .object({ items: z.array(z.unknown()).max(60) })
    .parse(extractJson(text.replace(/```(?:json)?/g, "")));
  const placed: Array<{
    item: Parameters<typeof calibrateItems>[0][number];
    /** Copied from the log: skips calibration, keeps stored nutrition. */
    copy?: CalibratedItem;
    localName?: string;
    meal: Meal;
    date: string;
  }> = [];
  const copiedRefs = new Set<number>();
  for (const candidate of parsed.items.slice(0, MAX_ITEMS)) {
    const result = rawItemSchema.safeParse(normalizeItem(candidate));
    if (!result.success) continue;
    const raw = result.data;
    if (ctx.reference) {
      const ref = raw.ref === null || raw.ref === undefined ? undefined : Math.round(raw.ref);
      const row = ref === undefined ? undefined : ctx.reference.rows[ref];
      if (ref !== undefined && row) {
        if (copiedRefs.has(ref)) continue;
        copiedRefs.add(ref);
        const scale =
          raw.scale !== undefined && Number.isFinite(raw.scale) ? Math.min(5, Math.max(0.1, raw.scale)) : 1;
        placed.push({
          item: { name: row.name, kcal: row.kcal },
          copy: scaleRow(row, scale),
          meal: ctx.reference.target.meal,
          date: ctx.reference.target.date,
        });
        continue;
      }
    }
    const kcal = bound(raw.kcal, 0, 5000);
    const name = raw.name?.trim() ?? "";
    // Zero is a real answer for a drink (Coke Zero, air putih); any other 0 is a miss.
    if (kcal === undefined || name.length === 0) continue;
    if (kcal <= 0 && foodKind(name) !== "minuman") continue;
    // A story about a copied meal lands entirely on the target slot and day.
    const meal = ctx.reference
      ? ctx.reference.target.meal
      : raw.meal && (ctx.slots as readonly string[]).includes(raw.meal)
        ? (raw.meal as Meal)
        : (ctx.defaultMeal ?? ctx.nowMeal);
    const date = ctx.reference
      ? ctx.reference.target.date
      : raw.day === null || raw.day === undefined || !Number.isFinite(raw.day)
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
      localName: raw.localName?.trim().slice(0, 120) || undefined,
      meal,
      date,
    });
  }
  const calibrated = calibrateItems(
    placed.filter((p) => !p.copy).map((p) => p.item),
    ctx.region ? { region: ctx.region } : undefined,
  );
  const local = ctx.locale !== undefined && ctx.locale !== DEFAULT_LOCALE;
  let next = 0;
  return placed.map((p) => {
    if (p.copy) return { ...p.copy, meal: p.meal, date: p.date, copied: true };
    const item = calibrated[next++]!;
    return {
      ...item,
      // Matching used the Indonesian name; the user sees theirs.
      name: (local && p.localName) || item.name,
      meal: p.meal,
      date: p.date,
    };
  });
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
    /** Language of the returned item names and of the error messages. */
    locale?: Locale;
    region?: Region;
    model?: string;
    /** Logged rows the story points at ("sama kayak kemarin tapi ..."): the model copies them by index. */
    reference?: { rows: readonly MealRow[]; target: Target };
    now?: Date;
    schedule?: ScheduleTimeout;
  },
): Promise<StoryAnalysis> {
  const model = opts.model || DEFAULT_VISION_MODEL;
  const locale = opts.locale ?? DEFAULT_LOCALE;
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
    locale,
    region: opts.region,
    reference: opts.reference,
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
              locale,
              region: opts.region,
              reference: opts.reference,
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
    throw new Error(storyError("failed", locale));
  }
  const text = responseText(result);
  let items: StoryItem[];
  try {
    if (text === null) throw new Error("no text in response");
    items = storyItemsFromText(text, ctx);
  } catch (error) {
    console.error("[story] unparseable answer", error, text?.slice(0, 300));
    throw new Error(storyError("failed", locale));
  }
  if (items.length === 0) throw new Error(storyError("empty", locale));
  return { items, model, usage: extractUsage(result) };
}

/** Voice note → transcript in the user's language. Whisper takes webm/opus, mp4/aac, m4a, mp3 and wav as-is. */
export async function transcribeStory(
  ai: AiRunner,
  audioBase64: string,
  locale: Locale = DEFAULT_LOCALE,
  schedule: ScheduleTimeout = defaultSchedule,
): Promise<{ text: string; usage: Record<string, unknown> | null }> {
  let result: unknown;
  try {
    result = await withDeadline(
      ai.run(TRANSCRIBE_MODEL, {
        audio: audioBase64,
        language: transcriptionLanguage(locale),
        vad_filter: true,
        initial_prompt: "Cerita makanan: nasi, lauk, gorengan, minuman, porsi.",
      }),
      TRANSCRIBE_DEADLINE_MS,
      schedule,
      "transcribe",
    );
  } catch (error) {
    console.error("[story] transcription failed", error);
    throw new Error(storyError("voiceEmpty", locale));
  }
  const r = result as { text?: unknown; result?: { text?: unknown } };
  const raw =
    typeof r?.text === "string" ? r.text : typeof r?.result?.text === "string" ? r.result.text : "";
  const text = raw.trim();
  if (text.length < 2) throw new Error(storyError("voiceEmpty", locale));
  return { text: text.slice(0, 1000), usage: extractUsage(result) };
}
