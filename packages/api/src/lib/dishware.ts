// "Piring saya": registered plates and bowls give a photo scan a reference of known size (docs/dishware.md).
//
// Registration: one photo from above, a name, a kind and the diameter. The model reads the photo once and
// writes a short description of how the plate looks (and, when a bank card lies beside it, estimates the
// diameter from the card's known size); the description is stored as text.
// Scan time: the user's plates go into the prompt as text only (name, kind, diameter, description: ~50
// tokens each, no thumbnails). The model answers which one it sees in a leading "plate" field, or null, and
// uses that diameter to read grams off the photo. The server checks the answer against the registered list:
// an unknown label is no match, and no match changes nothing about the scan.
import { z } from "zod";

import { DISHWARE_KINDS } from "@joyorogo/db/schema/dishware";

import { responseText, extractJson } from "./vision";
import type { AiRunner } from "./vision";

export { DISHWARE_KINDS };
export type DishwareKind = (typeof DISHWARE_KINDS)[number];

/** Registered plates per user. Each costs ~50 prompt tokens on every scan, so the list stays short. */
export const MAX_DISHWARE = 6;
/** Registration photos analysed per user per WIB day (the describe/measure call; the scan itself is not counted). */
export const DISHWARE_ANALYSES_PER_DAY = 12;

export const MIN_DIAMETER_CM = 5;
export const MAX_DIAMETER_CM = 60;
export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 200;

/** ISO/IEC 7810 ID-1 card (ATM, debit and credit cards): 85.60 x 53.98 mm. */
export const CARD_LONG_SIDE_CM = 8.56;
/** A plate this many card-lengths across is believable: 1.5 (13 cm saucer) to 7 (60 cm platter). */
const MIN_CARD_RATIO = MIN_DIAMETER_CM / CARD_LONG_SIDE_CM;
const MAX_CARD_RATIO = MAX_DIAMETER_CM / CARD_LONG_SIDE_CM;

/** The prompt's word for each kind (the prompt is Indonesian whatever language the app shows). */
const KIND_PROMPT: Record<DishwareKind, string> = {
  flat: "piring datar",
  bowl: "mangkuk",
  rattan: "piring rotan (alas anyaman, biasanya dengan kertas atau daun)",
  lunchbox: "kotak makan",
};

/** What the scan prompt needs of one registered plate. */
export type PromptDishware = {
  name: string;
  kind: DishwareKind;
  diameterCm: number;
  widthCm?: number | null;
  description: string;
};

/** A name or description that ends up inside a prompt: one line, no quotes, no control characters. */
export function promptText(raw: string, max: number): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/["`\\{}[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * A plate named by hand rather than registered (eval harness only: an external contributor's own plate in
 * the labels, or the owner's in a --plates file). `inPhoto` false = the plate is NOT in this photo: the model
 * should answer none, which measures false matches.
 */
export const plateRefSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  kind: z.enum(DISHWARE_KINDS),
  diameterCm: z.number().min(MIN_DIAMETER_CM).max(MAX_DIAMETER_CM),
  widthCm: z.number().min(3).max(MAX_DIAMETER_CM).optional(),
  description: z.string().max(MAX_DESCRIPTION).default(""),
  inPhoto: z.boolean().default(true),
});
export type PlateRef = z.infer<typeof plateRefSchema>;

const cm = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** "P1" for the first plate: short, so the model cannot mistype an id. */
export const dishwareLabel = (index: number) => `P${index + 1}`;

function sizeText(plate: PromptDishware): string {
  if (plate.kind === "lunchbox") {
    return plate.widthCm ? `${cm(plate.diameterCm)} x ${cm(plate.widthCm)} cm` : `sisi panjang ${cm(plate.diameterCm)} cm`;
  }
  return `diameter ${cm(plate.diameterCm)} cm`;
}

/**
 * The prompt block for a user's registered plates, or null when there are none. Added after the
 * production prompt, so a user without plates (or without the feature) is answered exactly as before.
 * `withCard`: the card block (cardInstruction) comes first and asks for its own leading field, so the
 * plate field follows it and the card is the scale to prefer.
 */
export function dishwareInstruction(plates: readonly PromptDishware[], withCard = false): string | null {
  if (plates.length === 0) return null;
  const lines = plates.map(
    (plate, index) =>
      `${dishwareLabel(index)}: "${plate.name}", ${KIND_PROMPT[plate.kind]}, ${sizeText(plate)}${plate.description ? `. Ciri: ${plate.description}` : ""}`,
  );
  const lead = withCard ? `{"card":{...},"plate":` : `{"plate":`;
  return [
    "Piring dan mangkuk milik pengguna ini (ukurannya sudah diukur sendiri olehnya):",
    ...lines,
    `Jika salah satunya terlihat di foto (cocokkan bentuk, warna, motif, dan ukuran relatif; ragu = tidak cocok), tulis labelnya di field "plate" ${withCard ? 'sesudah "card"' : "PALING AWAL"}: ${lead}"${dishwareLabel(0)}","items":[...]}. Lalu pakai ukurannya sebagai skala nyata: bandingkan luas yang tertutup dan tinggi tumpukan makanan dengan ukuran piring itu untuk memperkirakan grams, bukan porsi umum.`,
    `Jika tidak ada yang cocok (piring lain, makan di luar, tanpa piring), tulis ${lead}null,"items":[...]} dan perkirakan porsi seperti biasa. Jangan menebak.`,
    ...(withCard ? ["Jika kartu juga terlihat, skala dari kartu yang diutamakan; ukuran piring melengkapi."] : []),
  ].join("\n");
}

/** The model must be at least this sure of a card for the scan to say it was used (and tell the user). */
export const CARD_MIN_CONFIDENCE = 0.6;

/**
 * The card reference: any ID-1 card (ATM, debit, credit, KTP, SIM, e-money, any colour) lying next to the
 * food in the scan photo is a ruler of known size, on the same surface as the food.
 */
export const CARD_INSTRUCTION = `Kartu pembanding: kartu berukuran standar (kartu ATM, debit, kredit, KTP, SIM, e-money; warna apa pun) selalu ${String(CARD_LONG_SIDE_CM).replace(".", ",")} x 5,4 cm. Jika kartu seperti itu tergeletak di dekat makanan di foto, itu penggaris yang paling bisa dipercaya karena berada di bidang yang sama dengan makanan. Tulis field "card" PALING AWAL di JSON: {"card":{"seen":true,"confidence":number},"items":[...]} jika kartu terlihat utuh (confidence 0-1 = seberapa yakin itu kartu berukuran standar, tulis angkamu sendiri), atau {"card":{"seen":false,"confidence":0},"items":[...]} jika tidak ada. Ragu, kartu tertutup, atau benda lain yang mirip kartu = seen false; jangan menebak. Jika kartu terlihat, bandingkan panjang dan lebar makanan atau piring dengan sisi panjang kartu (${String(CARD_LONG_SIDE_CM).replace(".", ",")} cm) untuk memperkirakan grams, bukan porsi umum. Jika tidak ada kartu, perkirakan seperti biasa.
Sambal atau irisan bumbu mentah di atas lauk (mis. sambal matah: irisan bawang merah, cabai, serai) yang terlihat adalah item sendiri dengan box sendiri, jangan digabung ke lauk atau nasi.`;

/**
 * Everything a scan of an allowlisted user adds to the prompt: the card reference first, then the user's
 * plates (the scale to fall back on when no card is in the photo). With `card` false and no plates: null.
 */
export function referenceInstruction(plates: readonly PromptDishware[], card: boolean): string | null {
  const platesText = dishwareInstruction(plates, card);
  if (!card) return platesText;
  return platesText === null ? CARD_INSTRUCTION : `${CARD_INSTRUCTION}\n${platesText}`;
}

/**
 * Whether the scan can say a card was the size reference: the model reported one and was sure enough.
 * `seen` is what the ledger keeps to measure the model's own card detection, `used` what the user is told.
 */
export function cardOutcome(answer: { seen: boolean; confidence: number } | undefined): {
  seen: boolean;
  used: boolean;
  confidence: number;
} {
  const seen = answer?.seen ?? false;
  const confidence = answer?.confidence ?? 0;
  return { seen, used: seen && confidence >= CARD_MIN_CONFIDENCE, confidence };
}

export type DishwareMatch<T> = { status: "matched"; plate: T } | { status: "none" };

/**
 * Which registered plate the model said it saw. An absent field, null, or a label that is not in the
 * list (the model made one up) all mean "not recognised": the scan is the ordinary one.
 */
export function matchDishware<T>(answer: string | null | undefined, plates: readonly T[]): DishwareMatch<T> {
  if (answer === null || answer === undefined) return { status: "none" };
  const index = plates.findIndex((_plate, i) => dishwareLabel(i).toLowerCase() === answer.toLowerCase());
  const plate = plates[index];
  return index >= 0 && plate !== undefined ? { status: "matched", plate } : { status: "none" };
}

// ------------------------------------------------------------------ registration photo

const DESCRIBE_PROMPT = `Foto ini menunjukkan piring atau mangkuk KOSONG dari atas. Jawab HANYA JSON valid satu baris tanpa teks lain:
{"description":"ciri piring untuk mengenalinya di foto makanan","card":true atau false,"plateToCardRatio":angka atau null}
description: Bahasa Indonesia, maksimal 25 kata: warna, motif atau pinggiran, bentuk (bulat, persegi, bergelombang), bahan (keramik, melamin, rotan, plastik). Jangan menyebut makanan.
card: true jika ada kartu ATM, debit, atau kredit (kartu plastik persegi panjang) yang terlihat utuh dan tergeletak rata di dekat piring pada permukaan yang sama.
plateToCardRatio: jika card true, lebar piring (bagian terlebar, tepi ke tepi) dibagi sisi PANJANG kartu, satu angka desimal (piring 3 kali panjang kartu = 3.0). Jika card false atau tidak bisa diukur: null.`;

const describeSchema = z.object({
  description: z.string().optional().catch(undefined),
  card: z.boolean().optional().catch(undefined),
  plateToCardRatio: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().nullable().optional().catch(undefined),
  ),
});

export type DishwareAnalysis = {
  /** Few words on how the plate looks; "" when the model wrote none. */
  description: string;
  /** A card lay beside the plate and the ratio was believable: the plate's diameter in cm, to one decimal. */
  cardDiameterCm: number | null;
  /** The model saw a card (whether or not it could be measured). */
  cardSeen: boolean;
};

/** The registration answer, or null when it is not JSON at all. */
export function parseDishwareAnalysis(text: string): DishwareAnalysis | null {
  let parsed: z.infer<typeof describeSchema>;
  try {
    parsed = describeSchema.parse(extractJson(text.replace(/```(?:json)?/g, "")));
  } catch {
    return null;
  }
  const ratio = parsed.plateToCardRatio;
  const usable =
    parsed.card === true && typeof ratio === "number" && Number.isFinite(ratio) && ratio >= MIN_CARD_RATIO && ratio <= MAX_CARD_RATIO;
  return {
    description: promptText(parsed.description ?? "", MAX_DESCRIPTION),
    cardDiameterCm: usable ? Math.round(ratio * CARD_LONG_SIDE_CM * 10) / 10 : null,
    cardSeen: parsed.card === true,
  };
}

/** One model call on the registration photo: the description and, with a card in the photo, the diameter estimate. */
export async function analyzeDishwarePhoto(
  ai: AiRunner,
  opts: { model: string; imageBase64: string; mimeType: string },
): Promise<DishwareAnalysis & { usage: unknown }> {
  const result = await ai.run(opts.model, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: DESCRIBE_PROMPT },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` } },
        ],
      },
    ],
    max_tokens: 300,
    chat_template_kwargs: { enable_thinking: false },
  });
  const text = responseText(result);
  const analysis = text === null ? null : parseDishwareAnalysis(text);
  if (!analysis) throw new Error("dishware: the model did not answer with JSON");
  const usage = (result as { usage?: unknown } | null)?.usage ?? null;
  return { ...analysis, usage };
}
