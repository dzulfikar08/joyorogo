import { z } from "zod";
import { DEFAULT_LOCALE } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { localNameRule, localNameShape } from "./ai-locale";
import { resolveFoodKind } from "./food-kind";
import type { FoodKind } from "./food-kind";
import { calibrateItems, libraryKcal } from "./tkpi";
import type { CalibratedItem } from "./tkpi";
import {
  DEFAULT_VISION_MODEL,
  defaultSchedule,
  extractJson,
  extractUsage,
  normalizeBox,
  responseText,
} from "./vision";
import type { AiRunner, ItemBox, ScheduleTimeout } from "./vision";

/**
 * "Koreksi": the user types or says what the scan got wrong ("itu rolade bukan
 * perkedel", "nasinya setengah aja", "ga ada sambel", "tambah es teh manis").
 * A text-only model call turns it into a handful of operations on the CURRENT
 * list; the server applies them, so items the user did not mention come back
 * byte-identical and only the touched ones go through TKPI calibration.
 */

export const DEFAULT_CORRECT_MODEL = DEFAULT_VISION_MODEL;

/** Corrections one scan session (photo id) may use; the daily cap backs it up. */
export const MAX_CORRECTIONS_PER_SCAN = 10;
/** Corrections per user per WIB day, across all scans. */
export const MAX_CORRECTIONS_PER_DAY = 60;
/** Same cap addScan accepts. */
export const MAX_CORRECTED_ITEMS = 15;

/** Answers are one short line of ops; ~40-80 tokens per op. */
const MAX_COMPLETION_TOKENS = 500;
/** Text-only calls answer in 1-2 s; anything slower is a stuck run. */
const ATTEMPT_DEADLINES_MS: [number, number] = [9_000, 5_000];
/** A failed first attempt only gets the second one when it failed this fast. */
const FAST_FAILURE_BUDGET_MS = 4_000;

export const correctionItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  portion: z.string().max(120).optional(),
  grams: z.number().min(0).max(5000).optional(),
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500).optional(),
  carbs: z.number().min(0).max(500).optional(),
  fat: z.number().min(0).max(500).optional(),
  fiber: z.number().min(0).max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  kind: z.string().max(20).optional(),
  box: z.array(z.number()).length(4).optional(),
});

export type CorrectionItemInput = z.infer<typeof correctionItemSchema>;

/** A list item on the way out: the scan's item shape, `kind` always resolved. */
export type CorrectedItem = CalibratedItem & { kind: FoodKind; box?: ItemBox };

export type CorrectionChange = { index: number; kind: "renamed" | "portion" | "added" };

export type CorrectionPatch = {
  items: CorrectedItem[];
  /** Per new item: its index in the list that was sent, null for an added one. */
  origins: Array<number | null>;
  changes: CorrectionChange[];
  removed: string[];
};

export type CorrectionReason =
  | "unclear"
  | "unknown_reference"
  | "empty_result"
  | "failed"
  | "voice_empty";

export class CorrectionError extends Error {
  reason: CorrectionReason;
  constructor(reason: CorrectionReason, detail?: string) {
    super(`correct:${reason}${detail ? ` ${detail}` : ""}`);
    this.name = "CorrectionError";
    this.reason = reason;
  }
}

/** Number the model may send as "150" or 150; anything else is dropped. */
const num = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v),
  z.number().finite(),
);
const optionalNum = num.optional().catch(undefined);
const index = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v),
  z.number().int(),
);

const newDishShape = {
  name: z.string().trim().min(1).max(120),
  localName: z.string().optional().catch(undefined),
  kind: z.string().optional().catch(undefined),
  portion: z.string().optional().catch(undefined),
  grams: optionalNum,
  kcal: optionalNum,
  protein: optionalNum,
  carbs: optionalNum,
  fat: optionalNum,
  fiber: optionalNum,
};

/** A rename carries the new dish per 100 g; the server scales it to the item's weight. */
const per100Shape = {
  kcal100: optionalNum,
  protein100: optionalNum,
  carbs100: optionalNum,
  fat100: optionalNum,
};

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), i: index, ...newDishShape, ...per100Shape }),
  z.object({
    op: z.literal("portion"),
    i: index,
    scale: optionalNum,
    grams: optionalNum,
    portion: z.string().optional().catch(undefined),
  }),
  z.object({ op: z.literal("remove"), i: index }),
  z.object({ op: z.literal("add"), ...newDishShape }),
]);

type Op = z.infer<typeof opSchema>;

/**
 * Indonesian prompt like the scan; non-Indonesian locales also get `localName`
 * on new dishes (see ai-locale.ts) because TKPI matching reads the Indonesian
 * `name`.
 */
export function correctionPrompt(
  items: readonly CorrectionItemInput[],
  text: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const list = items
    .map((item, i) => {
      const parts = [item.name];
      if (item.portion) parts.push(item.portion);
      if (item.grams) parts.push(`${Math.round(item.grams)} g`);
      parts.push(`${Math.round(item.kcal)} kcal`);
      return `${i + 1}. ${parts.join(" | ")}`;
    })
    .join("\n");
  const shape = localNameShape(locale);
  return `Kamu memperbaiki daftar makanan hasil scan foto sesuai koreksi pengguna. Ubah HANYA item yang disebut pengguna; item lain jangan disentuh.
Daftar sekarang (nomor. nama | porsi | berat | kalori):
${list}
Koreksi pengguna: "${text.replace(/"/g, "'")}"
Jawab HANYA JSON valid satu baris (tanpa \`\`\`, tanpa teks lain): {"ops":[...]}. Jenis op:
{"op":"rename","i":nomor,"name":"nama yang benar",${shape}"portion":"maks 3 kata","kcal100":number,"protein100":number,"carbs100":number,"fat100":number} = nama item salah. Isi kcal100/protein100/carbs100/fat100 = kalori dan gizi per 100 gram makanan yang BENAR (bukan angka item lama). Berat tidak usah diisi; tambahkan "grams":number hanya kalau pengguna menyebut beratnya.
{"op":"portion","i":nomor,"scale":number} = porsi berubah relatif (setengah 0.5, dua kali 2, seperempat 0.25, sedikit lebih 1.3); atau {"op":"portion","i":nomor,"grams":number} kalau pengguna menyebut berat atau jumlah pasti.
{"op":"remove","i":nomor} = item tidak ada / tidak dimakan.
{"op":"add","name":"nama","kind":"makanan|camilan|minuman",${shape}"portion":"maks 3 kata","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number} = makanan atau minuman yang ditambahkan.
Satu koreksi boleh memuat beberapa op. Pengguna menyebut sesuatu yang tidak ada di daftar, atau tidak ada yang perlu diubah: {"ops":[]}. Semua angka bulat. name Bahasa Indonesia tanpa terjemahan; kcal dan gizi untuk porsi yang dimakan.${localNameRule(locale)}`;
}

function bound(v: number | undefined, min: number, max: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
}

function scaled(v: number | undefined, factor: number, max: number): number | undefined {
  return v === undefined ? undefined : bound(v * factor, 0, max);
}

/** One working row while ops are applied; `from` is the index in the sent list. */
type Row = {
  item: CorrectionItemInput & { localName?: string };
  from: number | null;
  change?: CorrectionChange["kind"];
  removed?: boolean;
};

function applyRename(row: Row, op: Extract<Op, { op: "rename" }>): Row | null {
  const old = row.item;
  // The weight stays unless the user stated a new one; the dish is what changed.
  const grams = bound(op.grams, 1, 5000) ?? old.grams;
  const at = (grams ?? 100) / 100;
  // Energy of the NEW dish at that weight: the model's per-100 g figure (or a
  // total it volunteered), and what the curated TKPI library says for that
  // name. When both exist the higher one wins: an unsure estimate should not
  // under-count what the owner eats. Without either, the old kcal stands in
  // and calibration bounds it by the new dish's band.
  const fromModel = op.kcal100 !== undefined ? op.kcal100 * at : op.kcal;
  const fromLibrary = libraryKcal(op.name, grams ?? 100);
  const kcal = bound(Math.max(fromModel ?? 0, fromLibrary ?? 0) || old.kcal, 0, 5000) ?? old.kcal;
  if (kcal <= 0) return null;
  return {
    ...row,
    // A rename that already was an add stays an add.
    change: row.change === "added" ? "added" : "renamed",
    item: {
      name: op.name.slice(0, 120),
      localName: op.localName?.trim().slice(0, 120) || undefined,
      // Portion text and macros described the old dish.
      portion: op.portion?.trim().slice(0, 80) || (grams === old.grams ? old.portion : undefined),
      grams,
      kcal,
      protein: bound(op.protein100 !== undefined ? op.protein100 * at : op.protein, 0, 500),
      carbs: bound(op.carbs100 !== undefined ? op.carbs100 * at : op.carbs, 0, 500),
      fat: bound(op.fat100 !== undefined ? op.fat100 * at : op.fat, 0, 500),
      fiber: bound(op.fiber, 0, 200),
      kind: op.kind?.trim().toLowerCase() || undefined,
      box: old.box,
    },
  };
}

function applyPortion(row: Row, op: Extract<Op, { op: "portion" }>): Row | null {
  const old = row.item;
  let grams: number | undefined;
  let factor: number;
  if (op.grams !== undefined && op.grams > 0) {
    grams = bound(op.grams, 1, 5000);
    factor = old.grams && grams ? grams / old.grams : 1;
    // Absolute grams without an old weight: the kcal of the old portion stays
    // and calibration against the dish does the rest.
  } else if (op.scale !== undefined && op.scale > 0) {
    factor = Math.min(10, Math.max(0.1, op.scale));
    grams = old.grams ? bound(old.grams * factor, 1, 5000) : undefined;
  } else {
    return null;
  }
  if (!Number.isFinite(factor)) return null;
  const portion =
    op.portion?.trim().slice(0, 80) || (grams !== undefined ? `${Math.round(grams)} g` : undefined);
  return {
    ...row,
    change: row.change ?? "portion",
    item: {
      ...old,
      portion,
      grams,
      kcal: bound(old.kcal * factor, 0, 5000) ?? old.kcal,
      protein: scaled(old.protein, factor, 500),
      carbs: scaled(old.carbs, factor, 500),
      fat: scaled(old.fat, factor, 500),
      fiber: scaled(old.fiber, factor, 200),
    },
  };
}

/**
 * Applies the model's ops to the current list. Ops address items by their
 * 1-based number; one that names no item (or the removed one) is ignored.
 * Throws `unknown_reference` when nothing applied, `unclear` when the answer
 * is not ops at all, `empty_result` when every item would go.
 */
export function applyCorrection(
  current: readonly CorrectionItemInput[],
  answer: string,
  locale: Locale = DEFAULT_LOCALE,
): CorrectionPatch {
  let rawOps: unknown[];
  try {
    const parsed = z
      .object({ ops: z.array(z.unknown()) })
      .parse(extractJson(answer.replace(/```(?:json)?/g, "")));
    rawOps = parsed.ops.slice(0, 12);
  } catch {
    throw new CorrectionError("unclear", answer.slice(0, 200));
  }
  const rows: Row[] = current.map((item, from) => ({ item, from }));
  let applied = 0;
  for (const raw of rawOps) {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) continue;
    const op = parsed.data;
    if (op.op === "add") {
      const kcal = bound(op.kcal, 0, 5000);
      if (kcal === undefined || kcal <= 0) continue;
      if (rows.filter((r) => !r.removed).length >= MAX_CORRECTED_ITEMS) continue;
      rows.push({
        from: null,
        change: "added",
        item: {
          name: op.name.slice(0, 120),
          localName: op.localName?.trim().slice(0, 120) || undefined,
          portion: op.portion?.trim().slice(0, 80) || undefined,
          grams: bound(op.grams, 1, 5000),
          kcal,
          protein: bound(op.protein, 0, 500),
          carbs: bound(op.carbs, 0, 500),
          fat: bound(op.fat, 0, 500),
          fiber: bound(op.fiber, 0, 200),
          kind: op.kind?.trim().toLowerCase() || undefined,
        },
      });
      applied += 1;
      continue;
    }
    const at = op.i - 1;
    const row = rows[at];
    if (!row || row.removed || at >= current.length) continue;
    if (op.op === "remove") {
      row.removed = true;
      applied += 1;
      continue;
    }
    const next = op.op === "rename" ? applyRename(row, op) : applyPortion(row, op);
    if (!next) continue;
    rows[at] = next;
    applied += 1;
  }
  if (applied === 0) throw new CorrectionError("unknown_reference");
  const kept = rows.filter((row) => !row.removed);
  if (kept.length === 0) throw new CorrectionError("empty_result");

  // Only touched rows go through calibration; the rest stay exactly as sent.
  const touched = kept.filter((row) => row.change !== undefined);
  const fixed = calibrateItems(
    touched.map(({ item: { localName: _l, kind: _k, box: _b, ...item } }) => item),
    { scaleBand: true },
  );
  const calibrated = new Map(touched.map((row, i) => [row, fixed[i]!]));
  const local = locale !== DEFAULT_LOCALE;
  const items: CorrectedItem[] = kept.map((row) => {
    const result = calibrated.get(row);
    if (!result) {
      const { localName: _localName, box, ...item } = row.item;
      return { ...item, box: normalizeBox(box), kind: resolveFoodKind(item.name, item.kind) };
    }
    return {
      ...result,
      kind: resolveFoodKind(result.name, row.item.kind),
      box: normalizeBox(row.item.box),
      // Matching used the Indonesian name; the user sees theirs.
      name: local ? row.item.localName || result.name : result.name,
    };
  });
  return {
    items,
    origins: kept.map((row) => row.from),
    changes: kept.flatMap((row, i) => (row.change ? [{ index: i, kind: row.change }] : [])),
    removed: rows.filter((row) => row.removed).map((row) => row.item.name),
  };
}

export type CorrectionRun = {
  patch: CorrectionPatch;
  model: string;
  usage: Record<string, unknown> | null;
};

function withDeadline<T>(run: Promise<T>, ms: number, schedule: ScheduleTimeout): Promise<T> {
  run.catch(() => {});
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const cancel = schedule(() => reject(new Error("correct-timeout")), ms);
  return Promise.race([run, deadline]).finally(cancel);
}

/**
 * One text-only model call plus the patch. Two attempts, the second only after
 * a fast failure (garbled answer, transport blip). An answer that parses but
 * names nothing is final: the same text gives the same answer again.
 */
export async function correctScanItems(
  ai: AiRunner,
  opts: {
    items: readonly CorrectionItemInput[];
    text: string;
    model?: string;
    locale?: Locale;
    timeouts?: [number, number];
    schedule?: ScheduleTimeout;
  },
): Promise<CorrectionRun> {
  const model = opts.model || DEFAULT_CORRECT_MODEL;
  const prompt = correctionPrompt(opts.items, opts.text, opts.locale);
  let lastError: unknown = new CorrectionError("failed");
  for (const timeoutMs of opts.timeouts ?? ATTEMPT_DEADLINES_MS) {
    const startedAt = Date.now();
    try {
      const result = await withDeadline(
        ai.run(model, {
          messages: [{ role: "user", content: prompt }],
          max_tokens: MAX_COMPLETION_TOKENS,
          // Thinking multiplies latency; the ops are a lookup, not a puzzle.
          chat_template_kwargs: { enable_thinking: false },
        }),
        timeoutMs,
        opts.schedule ?? defaultSchedule,
      );
      const text = responseText(result);
      if (text === null) throw new Error("no text in response");
      const patch = applyCorrection(opts.items, text, opts.locale);
      return { patch, model, usage: extractUsage(result) };
    } catch (error) {
      if (error instanceof CorrectionError && error.reason !== "unclear") throw error;
      lastError = error;
      console.error(`[correct] attempt failed after ${Date.now() - startedAt}ms`, error);
      const timedOut = error instanceof Error && error.message === "correct-timeout";
      if (timedOut || Date.now() - startedAt > FAST_FAILURE_BUDGET_MS) break;
    }
  }
  if (lastError instanceof CorrectionError) throw lastError;
  throw new CorrectionError("failed");
}
