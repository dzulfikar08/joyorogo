// P/K/L for a food that was logged by name and kcal alone (food.add with no macros: the manual form with the
// macro fields closed, a quick-add chip of an older row that never had them). Without this the row counted as
// 0 g protein/carbs/fat in every day total, ring and recap.
//
// Order: the official TKPI 2019 row the name names (lib/tkpi.ts libraryMacros), then the same text parse the
// "Cerita" story uses. Both are scaled to the kcal the person entered, so the logged energy is never changed.
// Neither answering leaves the row without macros; the diary marks those rows and the editor adds P/K/L.
import { and, between, eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { DayZone, Locale, Region } from "@joyorogo/i18n";

import type { AiBinding } from "../context";
import { MEALS, jakartaToday } from "./engine";
import { parseFoodStory } from "./story";
import type { StoryItem } from "./story";
import { dayBounds } from "./tiers";
import { libraryMacros } from "./tkpi";
import { defaultSchedule } from "./vision";

/** Fiber is a bonus: present only when the table row or every parsed item carries it. */
export type EstimatedMacros = { protein: number; carbs: number; fat: number; fiber?: number; via: "library" | "ai" };

/** Text parses per user per local day that food.add may spend on macros. Own ledger: never the scan quota. */
export const MACRO_AI_PER_DAY = 40;
/** A typed save waits at most this long for the model; slower than that and the row is saved without macros. */
export const MACRO_AI_DEADLINE_MS = 7_000;
/** The parse may differ from the typed kcal by this factor either way before its macros are distrusted. */
const MAX_KCAL_DRIFT = 4;

const UNIT =
  "x|buah|butir|potong|porsi|piring|mangkok|gelas|bungkus|biji|lembar|slice|pcs|piece|pieces|sdm|sdt|cup|cups|bowl|plate|glass";
const LEADING_QUANTITY = new RegExp(`^\\s*\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?(?:\\s*(?:${UNIT})\\b|\\s+)\\s*`, "i");

/** "2 telur rebus" -> "telur rebus", "350 kcal nasi goreng" -> "nasi goreng". Quantity never changes which food it is. */
export function foodNameOnly(name: string): string {
  let out = name.replace(/\b\d+(?:[.,]\d+)?\s*(?:kcal|kkal|cal)\b/gi, " ");
  for (let i = 0; i < 2; i++) out = out.replace(LEADING_QUANTITY, "");
  const cleaned = out.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : name.trim();
}

/** Library step: no network, no cost. */
export function macrosFromName(name: string, kcal: number, region?: Region): EstimatedMacros | null {
  const found = libraryMacros(foodNameOnly(name), kcal, region);
  return found ? { ...found, via: "library" } : null;
}

/** Sum of a parse's items, scaled to the typed kcal; null when any item lacks a macro or the energies disagree wildly. */
export function macrosFromParsed(
  items: ReadonlyArray<Pick<StoryItem, "kcal" | "protein" | "carbs" | "fat" | "fiber">>,
  kcal: number,
): Omit<EstimatedMacros, "via"> | null {
  if (items.length === 0 || !(kcal > 0)) return null;
  let parsedKcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;
  let allFiber = true;
  for (const item of items) {
    if (item.protein === undefined || item.carbs === undefined || item.fat === undefined) return null;
    parsedKcal += item.kcal;
    protein += item.protein;
    carbs += item.carbs;
    fat += item.fat;
    if (item.fiber === undefined) allFiber = false;
    else fiber += item.fiber;
  }
  if (!(parsedKcal > 0)) return null;
  const ratio = kcal / parsedKcal;
  if (ratio < 1 / MAX_KCAL_DRIFT || ratio > MAX_KCAL_DRIFT) return null;
  const scale = (grams: number) => Math.round(Math.min(500, grams * ratio) * 10) / 10;
  return { protein: scale(protein), carbs: scale(carbs), fat: scale(fat), ...(allFiber ? { fiber: scale(fiber) } : {}) };
}

async function macroAiUsedToday(db: Database, userId: string, zone: DayZone): Promise<number> {
  const { startMs, endMs } = dayBounds(jakartaToday(undefined, zone), zone);
  const [row] = await db
    .select({ used: sql<number>`count(*)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.scanType, "macros"),
        between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return row?.used ?? 0;
}

export type MacroEstimateContext = {
  db: Database;
  ai: AiBinding | undefined;
  /** env.AI_VISION_MODEL; unset = the story's default model. */
  model: string | undefined;
  userId: string;
  locale: Locale;
  region: Region | undefined;
  zone: DayZone;
};

/**
 * Macros for `name` at `kcal`, or null. Never throws: a failed estimate must not stop a meal from being logged.
 * A call that reached the model leaves an ai_usage row (scan_type "macros") whatever it answered, so the daily cap
 * holds for stuck or empty answers too.
 */
export async function estimateMacros(
  ctx: MacroEstimateContext,
  name: string,
  kcal: number,
): Promise<EstimatedMacros | null> {
  const fromLibrary = macrosFromName(name, kcal, ctx.region);
  if (fromLibrary) return fromLibrary;
  const { ai } = ctx;
  if (!ai) return null;
  try {
    if ((await macroAiUsedToday(ctx.db, ctx.userId, ctx.zone)) >= MACRO_AI_PER_DAY) return null;
    const startedAt = Date.now();
    let usage: Record<string, unknown> | null = null;
    let macros: Omit<EstimatedMacros, "via"> | null = null;
    try {
      const run = parseFoodStory(ai, {
        text: foodNameOnly(name),
        slots: MEALS,
        model: ctx.model,
        locale: ctx.locale,
        region: ctx.region,
        zone: ctx.zone,
      });
      let cancel = () => {};
      const late = new Promise<null>((resolve) => {
        cancel = defaultSchedule(() => resolve(null), MACRO_AI_DEADLINE_MS);
      });
      const analysis = await Promise.race([run, late]).finally(() => cancel());
      // A run that loses the race still settles later; its rejection is not ours to report.
      run.catch(() => {});
      if (analysis) {
        usage = analysis.usage;
        macros = macrosFromParsed(analysis.items, kcal);
      }
    } catch {
      // empty or failed parse: the row is saved without macros
    }
    await ctx.db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      model: ctx.model || "story",
      scanType: "macros",
      latencyMs: Date.now() - startedAt,
      usageJson: JSON.stringify({ kind: "macros", answered: macros !== null, ...(usage ? { parse: usage } : {}) }),
    });
    return macros ? { ...macros, via: "ai" } : null;
  } catch (error) {
    console.error("[food] macro estimate failed", error);
    return null;
  }
}
