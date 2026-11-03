// The public reply the bot posts (docs/threads-bot.md): Indonesian, at most 500 characters (the Threads limit), the same
// numbers the app's photo scan shows (weight and kcal per dish; kcal, protein, carbs, fat and fiber for the plate),
// "perkiraan AI, bukan saran medis", and the campaign link. Only what the photo shows: it never says anything about a
// body, weight or health.

import { fmtNumber } from "@joyorogo/i18n";

export const REPLY_LINK =
  "https://joyorogo.com/?utm_source=threads&utm_medium=reply&utm_campaign=mention-bot";
export const MAX_REPLY_CHARS = 500;
/** A scan whose items average below this confidence gets the "photo not clear" reply instead of numbers. */
export const LOW_CONFIDENCE = 0.4;

const MAX_NAME_CHARS = 40;

export type ReplyItem = {
  name: string;
  kcal: number;
  grams?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  /** The scan's kind; "minuman" means the weight is ml, as in the app. */
  kind?: string;
  confidence?: number;
};
/** A dish as stored on the mention row and shown in the admin page. */
export type ReplyDish = {
  name: string;
  kcal: number;
  grams?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  /** A drink: its weight is shown in ml. */
  drink?: boolean;
};

export type Macros = { protein: number; carbs: number; fat: number; fiber: number };

export type Estimate = {
  dishes: ReplyDish[];
  totalKcal: number;
  totals: Macros;
  text: string;
};

const whole = (n: number | undefined) => (n === undefined ? undefined : Math.round(n));

/** Indonesian separators, as the app shows them: 1.475 kcal. */
const num = (n: number) => fmtNumber(n, 0, "id");

/** A dish name safe to publish under the brand: one line, no mentions, hashtags or links, at most 40 characters. */
export function cleanDishName(name: string): string {
  const cleaned = name
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[@#]/g, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    (cleaned.length > MAX_NAME_CHARS
      ? `${cleaned.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`
      : cleaned) || "Makanan"
  );
}

/** True when the scan is too unsure to publish numbers: no items, or confidence reported and low on average. */
export function isLowConfidence(items: readonly ReplyItem[]): boolean {
  const shown = items.filter((item) => item.kcal > 0);
  if (shown.length === 0) return true;
  const confidences = shown.flatMap((item) =>
    item.confidence === undefined ? [] : [item.confidence],
  );
  if (confidences.length === 0) return false;
  return confidences.reduce((sum, c) => sum + c, 0) / confidences.length < LOW_CONFIDENCE;
}

const FOOTER = `Perkiraan AI, bukan saran medis. Catat makananmu lebih mudah di JoyoRogo: ${REPLY_LINK}`;

function compose(lines: readonly string[], total: readonly string[], extra: number): string {
  return [
    "Perkiraan gizi dari fotomu:",
    ...lines,
    ...(extra > 0 ? [`+ ${extra} lainnya`] : []),
    "",
    ...total,
    "",
    FOOTER,
  ].join("\n");
}

/**
 * The estimate reply. Dishes are listed biggest first with their weight and kcal; the plate total carries the macros,
 * as the app's scan result does. When the text would pass 500 characters the smallest dishes are folded into
 * "+ N lainnya" (the totals still count them).
 */
export function formatEstimate(items: readonly ReplyItem[]): Estimate {
  const dishes: ReplyDish[] = items
    .filter((item) => item.kcal > 0)
    .map((item) => ({
      name: cleanDishName(item.name),
      kcal: Math.round(item.kcal),
      grams: whole(item.grams),
      protein: whole(item.protein),
      carbs: whole(item.carbs),
      fat: whole(item.fat),
      fiber: whole(item.fiber),
      ...(item.kind === "minuman" ? { drink: true } : {}),
    }))
    .sort((a, b) => b.kcal - a.kcal);
  const sum = (pick: (dish: ReplyDish) => number | undefined) =>
    dishes.reduce((total, dish) => total + (pick(dish) ?? 0), 0);
  const totalKcal = sum((dish) => dish.kcal);
  const totals: Macros = {
    protein: sum((dish) => dish.protein),
    carbs: sum((dish) => dish.carbs),
    fat: sum((dish) => dish.fat),
    fiber: sum((dish) => dish.fiber),
  };
  const totalLines = [
    `Total: ${num(totalKcal)} kcal`,
    `Protein ${num(totals.protein)} g · Karbo ${num(totals.carbs)} g · Lemak ${num(totals.fat)} g · Serat ${num(totals.fiber)} g`,
  ];

  // "• Nasi goreng (350 g): 550 kcal", "• Es teh (350 ml): 100 kcal"; the weight left out when the scan gave none.
  const lines = dishes.map(
    (dish) =>
      `• ${dish.name}${dish.grams ? ` (${num(dish.grams)} ${dish.drink ? "ml" : "g"})` : ""}: ${num(dish.kcal)} kcal`,
  );
  let keep = lines.length;
  let text = compose(lines.slice(0, keep), totalLines, lines.length - keep);
  while (text.length > MAX_REPLY_CHARS && keep > 1) {
    keep -= 1;
    text = compose(lines.slice(0, keep), totalLines, lines.length - keep);
  }
  return { dishes, totalKcal, totals, text };
}

/** The short, polite reply when a photo is food but too unclear to put numbers on. */
export const UNCLEAR_REPLY =
  "Makasih sudah tag kami! Fotonya belum cukup jelas untuk kami perkirakan kalorinya. Coba foto dari atas dengan cahaya terang, lalu tag kami lagi ya 🙏";

/** What an admin may send: 1 to 500 characters. Returns an error message, or null when fine. */
export function replyTextProblem(text: string): string | null {
  if (text.trim().length === 0) return "text: empty";
  if (text.length > MAX_REPLY_CHARS)
    return `text: ${text.length} characters, the Threads limit is ${MAX_REPLY_CHARS}`;
  return null;
}
