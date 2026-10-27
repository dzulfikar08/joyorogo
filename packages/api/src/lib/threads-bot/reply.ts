// The public reply the bot posts (docs/threads-bot.md): Indonesian, at most 500 characters (the Threads limit), a kcal
// range per dish and for the plate, "perkiraan AI, bukan saran medis", and the campaign link. Only what the photo shows:
// it never says anything about a body, weight or health.

export const REPLY_LINK =
  "https://joyorogo.com/?utm_source=threads&utm_medium=reply&utm_campaign=mention-bot";
export const MAX_REPLY_CHARS = 500;
/** A scan whose items average below this confidence gets the "photo not clear" reply instead of numbers. */
export const LOW_CONFIDENCE = 0.4;

const MAX_NAME_CHARS = 40;

export type ReplyItem = { name: string; kcal: number; confidence?: number };
/** A dish as stored on the mention row and shown in the admin page. */
export type ReplyDish = { name: string; kcal: number; low: number; high: number };

export type Estimate = {
  dishes: ReplyDish[];
  totalKcal: number;
  low: number;
  high: number;
  text: string;
};

/** Round to the nearest 10 kcal: a range with unit digits would claim a precision the photo does not have. */
const round10 = (kcal: number) => Math.round(kcal / 10) * 10;

/** The kcal range for a point estimate: ± `band` (a fraction), 10-kcal steps, never below 0. */
export function kcalRange(kcal: number, band: number): { low: number; high: number } {
  return { low: Math.max(0, round10(kcal * (1 - band))), high: round10(kcal * (1 + band)) };
}

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

function compose(lines: readonly string[], total: string, extra: number): string {
  return [
    "Perkiraan kalori dari fotomu:",
    ...lines,
    ...(extra > 0 ? [`+ ${extra} lainnya`] : []),
    "",
    total,
    "",
    FOOTER,
  ].join("\n");
}

/**
 * The estimate reply. Dishes are listed biggest first; when the text would pass 500 characters the smallest are folded
 * into "+ N lainnya" (the total still counts them). `band` is the ± fraction around each kcal (config: 0.2 by default).
 */
export function formatEstimate(items: readonly ReplyItem[], band: number): Estimate {
  const shown = items
    .filter((item) => item.kcal > 0)
    .map((item) => ({ name: cleanDishName(item.name), kcal: Math.round(item.kcal) }))
    .sort((a, b) => b.kcal - a.kcal);
  const dishes: ReplyDish[] = shown.map((item) => ({ ...item, ...kcalRange(item.kcal, band) }));
  const totalKcal = dishes.reduce((sum, dish) => sum + dish.kcal, 0);
  const total = kcalRange(totalKcal, band);
  const pct = Math.round(band * 100);
  const totalLine = `Total: ${total.low}–${total.high} kcal (±${pct}%)`;

  const lines = dishes.map((dish) => `• ${dish.name}: ${dish.low}–${dish.high} kcal`);
  let keep = lines.length;
  let text = compose(lines.slice(0, keep), totalLine, lines.length - keep);
  while (text.length > MAX_REPLY_CHARS && keep > 1) {
    keep -= 1;
    text = compose(lines.slice(0, keep), totalLine, lines.length - keep);
  }
  return { dishes, totalKcal, low: total.low, high: total.high, text };
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
