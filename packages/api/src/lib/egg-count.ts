// Boiled-egg recount. The scan prompt asks for a count (piece-count.ts) and the model reads it low on halves and
// broken eggs: on 6 photos of 1 to 3 eggs the scan's count was exact in 2 of 18 runs, off by 0.7 egg on average
// (docs/ai-accuracy-log.md 2026-10-28, "Egg counts"). Asked on its own to list every piece with its box, the same
// model was exact in 14 of 18 and off by 0.1 egg. A number asked for in the one-line scan JSON is a guess; a list of
// boxes has to be walked piece by piece.
//
// A second, tiny vision call after the scan, only when the scan named a boiled-egg item (no extra call on any other
// plate). Its list replaces that item's count; the grams and the macros follow by the usual unit weights.
// Never throws: any failure leaves the scan's own count.
import { z } from "zod";
import { clampCount } from "./piece-chip";
import type { Pieces } from "./piece-chip";
import { EGG_GRAMS, isBoiledEgg } from "./piece-count";
import { scalePortion } from "./portion";
import { DEFAULT_VISION_MODEL, defaultSchedule, extractJson, extractUsage, normalizeBox, responseText } from "./vision";
import type { AiRunner, ItemBox, ScheduleTimeout } from "./vision";

/** A scan photo answered in one call; the recount past this leaves the scan's count (the scan has been waiting). */
const EGG_TIMEOUT_MS = 8_000;
/** Entries read from the list: a plate of this many pieces is a different problem. */
const MAX_LISTED = 40;
/** Two entries whose boxes overlap this much are one piece listed twice. */
const SAME_PIECE_IOU = 0.6;

export const EGG_COUNT_PROMPT = `Lihat foto ini. Cari semua telur rebus di foto: telur utuh, belahan telur, atau potongan telur yang menampakkan kuning telur.
Daftar SATU PER SATU, tiap potongan satu entri dengan kotaknya, dari kiri atas ke kanan bawah. Jawab HANYA JSON valid satu baris (tanpa \`\`\`):
{"eggs":[{"kind":"utuh|belahan","box":[ymin,xmin,ymax,xmax]}]}
box skala 0-1000 relatif tinggi dan lebar foto. utuh = telur bulat penuh tanpa irisan; belahan = separuh telur (satu kuning telur tampak, atau cekungan tempat kuning telur). Telur yang pecah atau hancur: satu entri belahan per kuning telur. Kuning telur lepas di samping putihnya bukan entri sendiri. Telur dadar, ceplok, mata sapi, dan putih telur saja bukan telur rebus yang dihitung. Tidak ada telur rebus: {"eggs":[]}`;

export type EggCount = {
  /** Whole eggs and egg halves listed (a listed piece counted once). */
  whole: number;
  halves: number;
};

export type EggCountCall = {
  /** Undefined: no usable list (failure, or no egg listed). */
  count?: EggCount;
  usage: Record<string, unknown> | null;
  ms: number;
  error?: string;
};

function iou(a: ItemBox, b: ItemBox): number {
  const h = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const w = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (h <= 0 || w <= 0) return 0;
  const inter = h * w;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}

/** An entry is read leniently: a missing or odd kind is a half, a bad box only means no overlap check. */
const eggListSchema = z.object({
  eggs: z.array(z.object({ kind: z.unknown().optional(), box: z.unknown().optional() }).catch({})),
});

/**
 * The count in the model's list: whole entries and half entries, an entry whose box covers an earlier one counted
 * once. An entry with no usable box is still a piece. Undefined for no list or an empty one.
 */
export function eggCountOf(answer: unknown): EggCount | undefined {
  const parsed = eggListSchema.safeParse(answer);
  if (!parsed.success) return undefined;
  const seen: ItemBox[] = [];
  let whole = 0;
  let halves = 0;
  for (const entry of parsed.data.eggs.slice(0, MAX_LISTED)) {
    const box = normalizeBox(entry.box);
    if (box) {
      if (seen.some((other) => iou(box, other) >= SAME_PIECE_IOU)) continue;
      seen.push(box);
    }
    if (typeof entry.kind === "string" && /^(utuh|whole)$/i.test(entry.kind.trim())) whole++;
    else halves++;
  }
  return whole + halves > 0 ? { whole, halves } : undefined;
}

/** One extra vision call on the same photo for the egg list only. Never throws. */
export async function readEggCount(
  ai: AiRunner,
  opts: { imageBase64: string; mimeType: string; model?: string; schedule?: ScheduleTimeout; timeoutMs?: number },
): Promise<EggCountCall> {
  const startedAt = Date.now();
  const request = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EGG_COUNT_PROMPT },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` } },
        ],
      },
    ],
    // 40 entries of kind and box.
    max_tokens: 1200,
    // A list is read, not sampled.
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  deadline.catch(() => {});
  const cancel = (opts.schedule ?? defaultSchedule)(() => reject(new Error("egg-timeout")), opts.timeoutMs ?? EGG_TIMEOUT_MS);
  try {
    const run = ai.run(opts.model || DEFAULT_VISION_MODEL, request);
    run.catch(() => {});
    const result = await Promise.race([run, deadline]);
    const text = responseText(result);
    if (text === null) throw new Error("no text in response");
    return { count: eggCountOf(extractJson(text)), usage: extractUsage(result), ms: Date.now() - startedAt };
  } catch (e) {
    const error = e instanceof Error ? e.message : "failed";
    console.error(`[egg-count] no list: ${error}`);
    return { usage: null, ms: Date.now() - startedAt, error };
  } finally {
    cancel();
  }
}

type EggRow = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  pieces?: Pieces;
};

/** Where the answer's boiled-egg rows are. The call lists every egg piece of the photo, so several rows are one pile. */
const boiledEggRows = (items: readonly { name: string }[]) => items.flatMap((item, i) => (isBoiledEgg(item.name) ? [i] : []));

/**
 * The boiled-egg rows at the counted pieces: halves when any piece is a half (a whole egg is two of them), else whole
 * eggs. The scan sometimes lists one pile twice ("telur rebus 2 belahan" and "telur rebus 2 butir"), so the first row
 * takes the whole count and the other boiled-egg rows go. Grams are count x one piece, kcal and macros follow from the
 * first row's own numbers. Same list when the answer has no egg row, no weight to scale from, or the call has no count.
 */
export function applyEggCount<T extends EggRow>(items: readonly T[], count: EggCount | undefined): T[] {
  const [at, ...duplicates] = boiledEggRows(items);
  if (at === undefined || !count) return [...items];
  const item = items[at]!;
  const half = count.halves > 0;
  const unitGrams = half ? EGG_GRAMS / 2 : EGG_GRAMS;
  const pieces = clampCount(half ? count.whole * 2 + count.halves : count.whole);
  const before = item.grams ?? (item.pieces ? item.pieces.count * item.pieces.unitGrams : undefined);
  if (before === undefined || !(before > 0)) return [...items];
  const unit = half ? "belahan" : "butir";
  const scaled = scalePortion(
    { grams: before, kcal: item.kcal, protein: item.protein ?? null, carbs: item.carbs ?? null, fat: item.fat ?? null, fiber: item.fiber ?? null },
    (pieces * unitGrams) / before,
  );
  const next = {
    ...item,
    portion: `${pieces} ${unit}`,
    grams: Math.round(pieces * unitGrams),
    kcal: scaled.kcal,
    ...(scaled.protein !== null ? { protein: scaled.protein } : {}),
    ...(scaled.carbs !== null ? { carbs: scaled.carbs } : {}),
    ...(scaled.fat !== null ? { fat: scaled.fat } : {}),
    ...(scaled.fiber !== null ? { fiber: scaled.fiber } : {}),
    pieces: { count: pieces, unit, unitGrams },
  };
  return items.flatMap((row, i) => (i === at ? [next] : duplicates.includes(i) ? [] : [row]));
}

/**
 * The scan answer with its boiled-egg rows recounted. No call at all unless the answer has a boiled-egg row.
 * `call` is returned for the cost ledger when one was made.
 */
export async function withEggCount<I extends EggRow, A extends { items: I[] }>(
  ai: AiRunner,
  opts: { imageBase64: string; mimeType: string; model?: string },
  analysis: A,
): Promise<{ analysis: A; call?: EggCountCall }> {
  if (boiledEggRows(analysis.items).length === 0) return { analysis };
  const call = await readEggCount(ai, opts);
  return { analysis: { ...analysis, items: applyEggCount(analysis.items, call.count) }, call };
}

/** What the scan ledger keeps of the call: the pieces it listed, its time and tokens, or why there is no list. */
export function eggLedger(call: EggCountCall) {
  return {
    ms: call.ms,
    ...(call.count ? { whole: call.count.whole, halves: call.count.halves } : {}),
    ...(call.usage ? { usage: call.usage } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}
