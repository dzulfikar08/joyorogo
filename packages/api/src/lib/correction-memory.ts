// "Ingat koreksimu": what the scan learns from the user's own fixes. The ledger already keeps every scan
// session (the AI's answer and what the diary got, lib/scan-outcome.ts), so the history is read from there
// at scan time; nothing new is stored. A pair is "the photo looked like X, the user saved Y".
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dayBoundsIn } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";
import { aiUsage, foodLog } from "@joyorogo/db/schema/fitness";

import { jakartaToday, shiftDate } from "./engine";
import { foodKind } from "./food-kind";
import { currentAnswer, parseSession, scanDiff } from "./scan-outcome";
import type { CompactItem } from "./scan-outcome";

/** Pairs seen at least this often are trusted enough to mention. */
export const MIN_PAIR_COUNT = 2;
/** Ledger window and cap: a few scans a day, so ~3 months is a few hundred rows at most. */
const WINDOW_DAYS = 90;
const SESSION_ROWS = 300;
const FOOD_WINDOW_DAYS = 60;
const TOP_FOODS = 10;
const MAX_PAIRS = 6;
const MAX_CHIPS = 3;
const MAX_OFFERS = 20;
/** About 200 tokens of Indonesian; pairs then foods are dropped to fit. */
const MAX_BLOCK_CHARS = 760;

export type NamePair = { ai: string; saved: string; count: number };

/** `CORRECTION_MEMORY_USER_IDS`: comma-separated allowlist (the owner and QA); empty or unset = nobody. */
export function correctionMemoryEnabled(
  env: { CORRECTION_MEMORY_USER_IDS?: string },
  userId: string,
): boolean {
  return (env.CORRECTION_MEMORY_USER_IDS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === userId);
}

const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** "putih telur" and "putih telur rebus" are the same food for matching. */
export function sameFood(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

/** "nasi" to "nasi konjac" is a correction; "putih telur" to "putih telur rebus" is the same food worded longer. */
function addsSpecificWord(from: string, to: string): boolean {
  const had = specificWords(from);
  return specificWords(to).some((word) => !had.includes(word));
}

/**
 * Name corrections of one scan: items the diary got instead of what the AI said. Weight-matched renames
 * count (scanDiff); so does the one removed + one added left over (a rename whose weight also changed,
 * the usual "susu 250 g" to "putih telur 100 g"). Several leftovers are ambiguous and give nothing.
 */
export function sessionPairs(ai: readonly CompactItem[], saved: readonly CompactItem[]): Array<{ ai: string; saved: string }> {
  const diff = scanDiff(ai, saved);
  const pairs = diff.renamed.map(({ from, to }) => ({ ai: from.n, saved: to.n }));
  if (diff.removed.length === 1 && diff.added.length === 1) {
    pairs.push({ ai: diff.removed[0]!.n, saved: diff.added[0]!.n });
  }
  return pairs.filter((pair) => !sameFood(pair.ai, pair.saved) || addsSpecificWord(pair.ai, pair.saved));
}

/** Pairs across sessions, most frequent first (ties: the more recent first, as the rows come newest first). */
export function tallyPairs(sessions: ReadonlyArray<{ ai: readonly CompactItem[]; saved: readonly CompactItem[] }>): NamePair[] {
  const tally = new Map<string, NamePair>();
  for (const session of sessions) {
    const seen = new Set<string>();
    for (const pair of sessionPairs(session.ai, session.saved)) {
      const key = `${norm(pair.ai)}\u0000${norm(pair.saved)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = tally.get(key);
      if (row) row.count += 1;
      else tally.set(key, { ai: norm(pair.ai), saved: norm(pair.saved), count: 1 });
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

export type CorrectionMemory = {
  /** Prompt text for the scan, absent when there is nothing worth saying. */
  block?: string;
  /** What the user corrected, for one-tap swaps on the result screen: each offer only fits its own original label (chipsFor). */
  offers: Array<{ ai: string; saved: string }>;
  /** Learned pairs (count >= MIN_PAIR_COUNT) that went into the block. */
  pairs: number;
};

/** Names the user kept as the AI said them (most often first): what a learned pair must not swallow. */
export function keptNames(sessions: ReadonlyArray<{ ai: readonly CompactItem[]; saved: readonly CompactItem[] }>): string[] {
  const counts = new Map<string, number>();
  for (const { ai, saved } of sessions) {
    const savedNames = new Set(saved.map((item) => norm(item.n)));
    for (const name of new Set(ai.map((item) => norm(item.n)))) {
      if (savedNames.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const words = (name: string) => norm(name).split(" ").filter((word) => word.length >= 4);

/**
 * The prompt block and the learned foods. Each learned pair is a rule about the model's own answer ("if you
 * would say X, say Y"), never "the photo shows Y": a history phrased as the latter turns every pale food into
 * the corrected one. A food the user keeps as the model says it, and that shares a word with Y (telur rebus
 * next to putih telur), is named as the exception.
 */
export function buildMemory(pairs: readonly NamePair[], foods: readonly string[], kept: readonly string[] = []): CorrectionMemory {
  const learnedPairs = pairs.filter((pair) => pair.count >= MIN_PAIR_COUNT).slice(0, MAX_PAIRS);
  // A chip is gated by its original label (chipsFor), so one correction is enough to offer it; the prompt block needs two.
  const offers = pairs.slice(0, MAX_OFFERS).map(({ ai, saved }) => ({ ai, saved }));
  if (learnedPairs.length === 0) return { offers, pairs: 0 };
  const rule = (pair: NamePair) => {
    const exception = kept.find((name) => !sameFood(name, pair.saved) && words(name).some((w) => words(pair.saved).includes(w)));
    return (
      `pengguna sudah ${pair.count}x mengoreksi "${pair.ai}" menjadi "${pair.saved}". Jadi hanya kalau kamu hendak menjawab "${pair.ai}" (atau yang mirip), tulis "${pair.saved}".` +
      (exception ? ` Kalau yang terlihat jelas "${exception}", tulis itu (itu juga sering dia catat apa adanya).` : "")
    );
  };
  const tail = " Untuk makanan lain yang kamu kenali, tulis apa yang kamu lihat; catatan ini tidak berlaku.";
  const rules = learnedPairs.map(rule);
  const compose = (extra: string) => `Catatan koreksi pengguna ini: ${rules.join(" ")}${tail}${extra}`;
  let block = compose("");
  while (block.length > MAX_BLOCK_CHARS && rules.length > 1) {
    rules.pop();
    block = compose("");
  }
  // The foods they log most go in only as far as the cap allows.
  const often = foods.slice(0, TOP_FOODS);
  while (often.length > 0) {
    const withFoods = compose(` Makanan yang sering dia catat: ${often.join(", ")}.`);
    if (withFoods.length <= MAX_BLOCK_CHARS) {
      block = withFoods;
      break;
    }
    often.pop();
  }
  return { block, offers, pairs: rules.length };
}

/** Words that say a food's kind, not which food: never enough on their own to tie two names together. */
const GENERIC = new Set([
  "putih", "goreng", "nasi", "ayam", "telur", "rebus", "bakar", "kuah", "sambal", "manis", "pedas",
  "daging", "ikan", "sayur", "mie", "mee", "bihun", "kopi", "teh", "susu", "segar", "campur", "panas", "dingin",
  "fried", "rice", "chicken", "white", "egg", "boiled", "grilled", "noodle", "noodles", "milk", "coffee", "sweet", "spicy",
]);

const specificWords = (name: string) => words(name).filter((word) => !GENERIC.has(word));

/** Same food, or the same distinctive word ("nasi lemak" and "nasi lemak ayam"); "putih", "goreng", "nasi", "ayam" alone do not count. */
function sameLabel(a: string, b: string): boolean {
  if (sameFood(a, b)) return true;
  const theirs = specificWords(b);
  return specificWords(a).some((word) => theirs.includes(word));
}

/**
 * Chips for the result screen. An offer is shown only when the model's top answer is what the user corrected
 * before (the offer's original label, same name or a shared distinctive word), unless the top answer already
 * is the offered food. A drink is only offered drinks and a dish only dishes. Sharing "putih" with "putih telur"
 * is not a match: nasi putih must never get egg white from a lontong correction.
 */
export function chipsFor(offers: ReadonlyArray<{ ai: string; saved: string }>, topName: string | undefined): string[] {
  if (!topName || offers.length === 0) return [];
  const top = norm(topName);
  if (offers.some((offer) => top.includes(norm(offer.saved)))) return [];
  const drink = foodKind(topName) === "minuman";
  const chips = offers
    .filter((offer) => sameLabel(offer.ai, topName) && (foodKind(offer.saved) === "minuman") === drink)
    .map((offer) => offer.saved);
  return [...new Set(chips)].slice(0, MAX_CHIPS);
}

/** The user's memory, read from the ledger and the diary; a failed read is no memory, never a failed scan. */
export async function loadCorrectionMemory(db: Database, userId: string, zone: DayZone): Promise<CorrectionMemory> {
  const today = jakartaToday(undefined, zone);
  const since = dayBoundsIn(shiftDate(today, -WINDOW_DAYS), zone).startMs;
  const [rows, foodRows] = await Promise.all([
    db
      .select({ usageJson: aiUsage.usageJson })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.userId, userId),
          eq(aiUsage.scanType, "user"),
          gte(aiUsage.createdAt, new Date(since)),
          sql`json_extract(${aiUsage.usageJson}, '$.savedItems') is not null`,
        ),
      )
      .orderBy(desc(aiUsage.createdAt))
      .limit(SESSION_ROWS),
    db
      .select({ name: sql<string>`lower(${foodLog.name})`, n: sql<number>`count(*)` })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), isNotNull(foodLog.name), gte(foodLog.date, shiftDate(today, -FOOD_WINDOW_DAYS))))
      .groupBy(sql`lower(${foodLog.name})`)
      .orderBy(desc(sql`count(*)`))
      .limit(TOP_FOODS),
  ]);
  const sessions = rows.flatMap(({ usageJson }) => {
    const session = parseSession(usageJson);
    return session?.savedItems ? [{ ai: currentAnswer(session), saved: session.savedItems }] : [];
  });
  return buildMemory(tallyPairs(sessions), foodRows.map((row) => row.name), keptNames(sessions));
}
