// DB side of "sama kayak tadi siang": reads the logged rows a reference points
// at and shapes the answer the review screen shows. Nothing is written here;
// the client saves the reviewed items through food.add like any other story.
import { and, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { foodLog } from "@joyorogo/db/schema/fitness";

import { MEALS, jakartaToday, shiftDate } from "./engine";
import type { Meal } from "./engine";
import { REFERENCE_WINDOW_DAYS, applyModifiers, groupRows, resolveReference, scaleRow } from "./meal-reference";
import type { MealGroup, MealReference, MealRow, Target } from "./meal-reference";
import type { StoryItem } from "./story";
import type { CalibratedItem } from "./tkpi";

export type MealSlotRef = { date: string; meal: Meal };

/** What the review screen needs to explain a copy (or why there was nothing to copy). */
export type ReferenceInfo = {
  /** copied: items ready to review; empty: nothing logged there; emptied: the changes removed every item. */
  status: "copied" | "empty" | "emptied";
  /** rule: deterministic; ai: the parser applied the changes; chip: a one-tap repeat. */
  via: "rule" | "ai" | "chip";
  from: MealSlotRef | null;
  wanted: { date: string | null; meal: Meal | null };
  suggestion: (MealSlotRef & { count: number; kcal: number }) | null;
};

export type CopyResult = { items: StoryItem[]; reference: ReferenceInfo };

const isMeal = (value: string): value is Meal => (MEALS as readonly string[]).includes(value);

/** The user's rows from `from` to `to` (day keys, inclusive), oldest log first. */
export async function loadMealRows(
  db: Database,
  userId: string,
  from: string,
  to: string,
): Promise<MealRow[]> {
  const rows = await db
    .select({
      date: foodLog.date,
      meal: foodLog.meal,
      name: foodLog.name,
      kcal: foodLog.kcal,
      grams: foodLog.grams,
      protein: foodLog.protein,
      carbs: foodLog.carbs,
      fat: foodLog.fat,
      fiber: foodLog.fiber,
      createdAt: foodLog.createdAt,
    })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), gte(foodLog.date, from), lte(foodLog.date, to)))
    .orderBy(desc(foodLog.createdAt));
  return rows.flatMap((row) =>
    isMeal(row.meal) ? [{ ...row, meal: row.meal, createdAt: row.createdAt.getTime() }] : [],
  );
}

/** Rows inside the window a reference may reach. */
export function loadReferenceRows(db: Database, userId: string, now: Date, zone: DayZone): Promise<MealRow[]> {
  const today = jakartaToday(now, zone);
  return loadMealRows(db, userId, shiftDate(today, -REFERENCE_WINDOW_DAYS), today);
}

function slotInfo(group: MealGroup): MealSlotRef & { count: number; kcal: number } {
  return { date: group.date, meal: group.meal, count: group.rows.length, kcal: Math.round(group.kcal) };
}

function toStoryItems(items: CalibratedItem[], target: Target): StoryItem[] {
  return items.map((item) => ({ ...item, meal: target.meal, date: target.date, copied: true }));
}

export type ReferenceAnswer =
  | ({ kind: "answer" } & CopyResult)
  /** Changes the rules cannot pin down: the AI parser gets the rows as context. */
  | { kind: "ai"; rows: MealRow[]; from: MealSlotRef };

/** Resolve a detected reference against the log and apply what the rules can. */
export async function answerReference(
  db: Database,
  userId: string,
  ref: MealReference,
  target: Target,
  now: Date,
  zone: DayZone,
): Promise<ReferenceAnswer> {
  const rows = await loadReferenceRows(db, userId, now, zone);
  const resolution = resolveReference(ref, rows, target, now, zone);
  if (resolution.status === "empty") {
    return {
      kind: "answer",
      items: [],
      reference: {
        status: "empty",
        via: "rule",
        from: null,
        wanted: resolution.wanted,
        suggestion: resolution.suggestion ? slotInfo(resolution.suggestion) : null,
      },
    };
  }
  const { group } = resolution;
  const from = { date: group.date, meal: group.meal };
  const applied = applyModifiers(group.rows, ref);
  if (!applied.ok) return { kind: "ai", rows: group.rows, from };
  return {
    kind: "answer",
    items: toStoryItems(applied.items, target),
    reference: {
      status: applied.items.length > 0 ? "copied" : "emptied",
      via: "rule",
      from,
      wanted: { date: from.date, meal: from.meal },
      suggestion: null,
    },
  };
}

/** One-tap repeat of a logged meal (the "Ulangi makanan" chips and the empty-slot suggestion). */
export async function copyLoggedMeal(
  db: Database,
  userId: string,
  from: MealSlotRef,
  target: Target,
): Promise<CopyResult> {
  const rows = (await loadMealRows(db, userId, from.date, from.date)).filter((r) => r.meal === from.meal);
  const group = groupRows(rows)[0];
  const reference: ReferenceInfo = {
    status: group ? "copied" : "empty",
    via: "chip",
    from: group ? from : null,
    wanted: from,
    suggestion: null,
  };
  return {
    items: group ? toStoryItems(group.rows.map((row) => scaleRow(row, 1)), target) : [],
    reference,
  };
}

/** Meals logged in the last week, newest first: the "Ulangi makanan" chips. */
export async function recentMealGroups(
  db: Database,
  userId: string,
  now: Date,
  exclude: Target,
  limit: number,
  zone: DayZone,
): Promise<Array<MealSlotRef & { count: number; kcal: number; names: string[] }>> {
  const today = jakartaToday(now, zone);
  const rows = await loadMealRows(db, userId, shiftDate(today, -7), today);
  return groupRows(rows)
    .filter((g) => !(g.date === exclude.date && g.meal === exclude.meal))
    .sort((a, b) => b.latest - a.latest)
    .slice(0, limit)
    .map((g) => ({ ...slotInfo(g), names: g.rows.slice(0, 3).map((r) => r.name) }));
}
