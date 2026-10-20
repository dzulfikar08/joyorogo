// Kitchen-scale readout: when the photo shows a scale's display, the model reads
// the digits and those grams replace its own guess (the weak point of a photo
// scan: docs/ai-accuracy-log.md 2026-10-20). The model only transcribes; units,
// the sanity gates and how the weight lands on items happen here.
//
// A separate, tiny vision call beside the scan (not a rule inside the scan
// prompt: that made the model drop the keys of its item list on some scale
// photos, see docs/scale-readout.md), so the scan's own answer is the one it
// always was. Flag: SCALE_READOUT_USER_IDS (scaleReadoutEnabled); off = no call.
import { itemAtGrams } from "./item-grams";
import { numbersOf } from "./portion-chip";
import type { ScaleReadChip, ScaleUnit } from "./scale-chip";
import { NAME_MATCH_MIN, nameScore } from "./scan-match";
import type { CalibratedItem } from "./tkpi";
import { DEFAULT_VISION_MODEL, defaultSchedule, extractJson, extractUsage, responseText } from "./vision";
import type { AiRunner, ScheduleTimeout } from "./vision";

/** Below this the model's own confidence in the digits is not enough: the reading is ignored. */
export const SCALE_MIN_CONFIDENCE = 0.75;
/** The scale beats the photo estimate, but a total this far from it is a misread digit or decimal point. */
export const SCALE_MAX_RATIO = 10;
const MAX_SCALE_GRAMS = 5000;
/** The call runs beside the scan, so it only matters when it outlasts it; past this the scan answers without a reading. */
const SCALE_TIMEOUT_MS = 12_000;

/** Asks only for the display: `{"scale":null}` for almost every photo, a few dozen tokens otherwise. */
export const SCALE_PROMPT = `Lihat foto ini. Apakah ada layar timbangan digital (angka LCD atau LED) yang menampilkan berat?
Jawab HANYA JSON valid satu baris (tanpa \`\`\`), tanpa teks lain.
Tidak ada layar timbangan, atau layarnya 0 atau 0.0 (kosong, tare): {"scale":null}
Ada layar timbangan: {"scale":{"reading":"angka persis seperti di layar, mis. 100 atau 3.5","unit":"g|kg|oz|lb|ml","confidence":number,"appliesTo":"plate atau nama makanan yang ditimbang"}}
Baca angka digit demi digit; angka yang tertutup, terpotong, atau buram tidak ditebak (confidence di bawah 0.5). unit sesuai tulisan di layar atau badan timbangan (g bila tidak terlihat). appliesTo "plate" bila yang ditimbang seluruh piring atau mangkuk, atau nama makanan dalam Bahasa Indonesia bila hanya itu yang ditimbang (beberapa nama dipisah "|"). Angka pada kemasan, struk, jam, atau layar ponsel bukan layar timbangan.`;

/** What the scale call returned: the raw `scale` object (unvalidated; applyScaleReading decides what it is worth). */
export type ScaleCall = {
  reading: unknown;
  usage: Record<string, unknown> | null;
  ms: number;
  /** Why there is no answer (timeout, unparseable): the scan goes on without a reading. */
  error?: string;
};

/**
 * One extra vision call on the same photo, for the scale display only. Never
 * throws: any failure is a scan with no reading. A malformed answer gets one
 * more try (it costs a few dozen tokens); a timeout does not.
 */
export async function readScaleDisplay(
  ai: AiRunner,
  opts: {
    imageBase64: string;
    mimeType: string;
    model?: string;
    /** Injectable for tests. */
    schedule?: ScheduleTimeout;
    timeoutMs?: number;
  },
): Promise<ScaleCall> {
  const startedAt = Date.now();
  const request = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SCALE_PROMPT },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` } },
        ],
      },
    ],
    max_tokens: 160,
    // Digits are transcribed, not sampled.
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  deadline.catch(() => {});
  const cancel = (opts.schedule ?? defaultSchedule)(() => reject(new Error("scale-timeout")), opts.timeoutMs ?? SCALE_TIMEOUT_MS);
  let usage: Record<string, unknown> | null = null;
  let error = "failed";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = ai.run(opts.model || DEFAULT_VISION_MODEL, request);
      run.catch(() => {});
      try {
        const result = await Promise.race([run, deadline]);
        const text = responseText(result);
        const sum = extractUsage(result);
        if (sum) usage = { ...(usage ?? {}), ...sum };
        if (text === null) throw new Error("no text in response");
        const answer = extractJson(text) as { scale?: unknown } | null;
        return { reading: answer?.scale ?? undefined, usage, ms: Date.now() - startedAt };
      } catch (e) {
        error = e instanceof Error ? e.message : "failed";
        if (error === "scale-timeout") break;
      }
    }
  } finally {
    cancel();
  }
  console.error(`[scale] no reading: ${error}`);
  return { reading: undefined, usage, ms: Date.now() - startedAt, error };
}

/** The reading as the model wrote it, validated; grams are not computed yet. */
export type RawScaleReading = {
  text: string;
  unit: ScaleUnit;
  confidence: number;
  /** "plate" or the item names it applies to. */
  appliesTo: "plate" | string[];
};

const UNIT_ALIASES: Record<string, ScaleUnit> = {
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  ml: "ml",
  cc: "ml",
  "fl oz": "fl oz",
  floz: "fl oz",
};

/** Grams (or ml, read 1:1 as the drink rule does) per displayed unit. */
const GRAMS_PER_UNIT: Record<ScaleUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
  ml: 1,
  "fl oz": 29.5735,
};

const unitOf = (raw: unknown): ScaleUnit | null =>
  typeof raw === "string" ? (UNIT_ALIASES[raw.trim().toLowerCase().replace(/\./g, "")] ?? null) : null;

/**
 * The model's `scaleReading` object, or null when it is absent or malformed.
 * The digits stay the model's text ("3.5", "1,25"): a number read that way is
 * checked by the same `parseScaleDigits` the grams come from.
 */
export function parseScaleReading(raw: unknown): RawScaleReading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const reading = typeof o.reading === "number" ? String(o.reading) : o.reading;
  if (typeof reading !== "string") return null;
  // "100g" in the reading and no unit field: the unit is in the text.
  const inline = /^\s*([\d.,]+)\s*([a-z. ]+)?\s*$/i.exec(reading);
  if (!inline) return null;
  const unit = unitOf(o.unit) ?? unitOf(inline[2]);
  if (!unit) return null;
  const confidence = typeof o.confidence === "string" ? Number(o.confidence) : o.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  const targets = Array.isArray(o.appliesTo)
    ? o.appliesTo
    : typeof o.appliesTo === "string"
      ? o.appliesTo.split("|")
      : [];
  const names = targets.flatMap((t) => (typeof t === "string" && t.trim() ? [t.trim()] : []));
  const plate = names.length === 0 || names.some((n) => /^(plate|piring|mangkuk|bowl|semua|all)$/i.test(n));
  return {
    text: inline[1]!,
    unit,
    confidence: Math.min(1, Math.max(0, confidence)),
    appliesTo: plate ? "plate" : names,
  };
}

/**
 * The displayed number: "100", "3.5", "1,25" (either decimal mark). Null for
 * anything else, and for a grams display with three decimals ("1.250": a
 * thousands separator or a decimal, there is no telling which).
 */
export function parseScaleDigits(text: string, unit: ScaleUnit): number | null {
  const m = /^(\d{1,5})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  if (m[2] !== undefined && m[2].length === 3 && (unit === "g" || unit === "ml")) return null;
  const value = Number(`${m[1]}${m[2] !== undefined ? `.${m[2]}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

/** Grams a displayed reading stands for (ml read 1:1), or null when its digits do not parse. */
export function scaleReadingGrams(text: string, unit: ScaleUnit): number | null {
  const value = parseScaleDigits(text, unit);
  return value === null ? null : value * GRAMS_PER_UNIT[unit];
}

export type ScaleSkip =
  | "low_confidence"
  | "unreadable"
  | "zero"
  | "out_of_range"
  | "no_target"
  | "implausible";

/** What happened to a reading; logged on the ledger row so the rule can be tuned from real scans. */
export type ScaleOutcome = {
  text: string;
  unit: ScaleUnit;
  confidence: number;
  /** Grams the display stands for (0 when the digits did not parse). */
  grams: number;
  appliesTo: "plate" | string[];
  /** The items that now carry the weight; empty when the reading was set aside. */
  applied: number[];
  skipped?: ScaleSkip;
  /** The model's own grams for the items it changed, by index into `applied`. */
  before?: number[];
};

type ScaleItem = CalibratedItem & { kind?: string; cup?: unknown };

/**
 * Puts the scale's grams on the items it covers. One covered item gets the
 * reading; several (a plate, or a list of names) share it in the proportions the
 * model gave them. Kcal and macros follow through calibration (item-grams.ts).
 * A reading that is low-confidence, zero, unparseable, matches no item, or sits
 * more than SCALE_MAX_RATIO away from the model's total is set aside and the
 * items come back untouched. Never trusts a low-confidence read.
 */
export function applyScaleReading<T extends ScaleItem>(
  items: readonly T[],
  raw: unknown,
): { items: Array<T & { scaleRead?: ScaleReadChip }>; outcome: ScaleOutcome | null } {
  const reading = parseScaleReading(raw);
  if (!reading) {
    return { items: [...items], outcome: raw === undefined || raw === null ? null : unreadableOutcome(raw) };
  }
  const value = parseScaleDigits(reading.text, reading.unit);
  const grams = value === null ? 0 : value * GRAMS_PER_UNIT[reading.unit];
  const outcome: ScaleOutcome = {
    text: reading.text,
    unit: reading.unit,
    confidence: reading.confidence,
    grams: Math.round(grams * 10) / 10,
    appliesTo: reading.appliesTo,
    applied: [],
  };
  const skip = (reason: ScaleSkip) => ({ items: [...items], outcome: { ...outcome, skipped: reason } });

  if (value === null) return skip("unreadable");
  if (value === 0) return skip("zero");
  if (reading.confidence < SCALE_MIN_CONFIDENCE) return skip("low_confidence");
  const total = Math.round(grams);
  if (total < 1 || total > MAX_SCALE_GRAMS) return skip("out_of_range");

  const targets = targetIndexes(items, reading.appliesTo);
  const weights = targets.map((i) => items[i]!.grams ?? 0);
  const modelTotal = weights.reduce((sum, g) => sum + g, 0);
  if (targets.length === 0 || modelTotal <= 0) return skip("no_target");
  if (total > modelTotal * SCALE_MAX_RATIO || total * SCALE_MAX_RATIO < modelTotal) return skip("implausible");

  const shares = split(total, weights);
  const next: Array<T & { scaleRead?: ScaleReadChip }> = [...items];
  const applied: number[] = [];
  const before: number[] = [];
  targets.forEach((index, n) => {
    const item = items[index]!;
    const shown = itemAtGrams(item, shares[n]!);
    if (!shown) return;
    applied.push(index);
    before.push(item.grams!);
    next[index] = {
      ...shown,
      scaleRead: {
        active: "scale",
        other: numbersOf({ ...item, grams: item.grams! }),
        text: reading.text,
        unit: reading.unit,
        grams: total,
        count: targets.length,
      },
    };
  });
  if (applied.length === 0) return skip("no_target");
  return { items: next, outcome: { ...outcome, applied, before } };
}

function unreadableOutcome(raw: unknown): ScaleOutcome {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    text: typeof o.reading === "string" || typeof o.reading === "number" ? String(o.reading).slice(0, 12) : "",
    unit: unitOf(o.unit) ?? "g",
    confidence: typeof o.confidence === "number" ? o.confidence : 0,
    grams: 0,
    appliesTo: "plate",
    applied: [],
    skipped: "unreadable",
  };
}

/**
 * Items a reading covers: for a plate every food with a weight (drinks only when
 * nothing else is there), for names the items they match. Names that match
 * nothing cover the only item of the photo, never one of several. Hidden cups
 * (their numbers come from the cup table) are never covered.
 */
function targetIndexes(items: readonly ScaleItem[], appliesTo: "plate" | string[]): number[] {
  const open = items.flatMap((item, index) =>
    item.cup === undefined && item.grams !== undefined && item.grams > 0 ? [index] : [],
  );
  if (appliesTo === "plate") {
    const food = open.filter((i) => items[i]!.kind !== "minuman");
    return food.length > 0 ? food : open;
  }
  const named = open.filter((i) => appliesTo.some((n) => nameScore(items[i]!.name, n) >= NAME_MATCH_MIN));
  if (named.length > 0) return named;
  return open.length === 1 && items.length === 1 ? open : [];
}

/** `total` in whole grams split in the proportions of `weights`; the parts always add up to it. */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.max(1, Math.round((total * w) / sum)));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  const biggest = parts.indexOf(Math.max(...parts));
  parts[biggest] = Math.max(1, parts[biggest]! + drift);
  return parts;
}

/**
 * `SCALE_READOUT_USER_IDS` is a comma-separated user id allowlist (the owner and
 * QA); empty or unset = nobody, and the analyze path stays exactly as it was.
 */
export function scaleReadoutEnabled(env: { SCALE_READOUT_USER_IDS?: string }, userId: string): boolean {
  return (env.SCALE_READOUT_USER_IDS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === userId);
}

/** The ledger row's account of a scale call: what was read, what became of it, and what the call cost. */
export function scaleLedger(call: ScaleCall, outcome: ScaleOutcome | null) {
  return {
    ...(outcome ?? {}),
    ms: call.ms,
    ...(call.usage ? { usage: call.usage } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}
