// DB side of "Porsi kebiasaanmu" (lib/portion-prior.ts): the flag and the user's history.
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";

import { jakartaToday, shiftDate } from "./engine";
import { PRIOR_WINDOW_DAYS, buildPriors, userSetSamples } from "./portion-prior";
import type { PortionPrior } from "./portion-prior";

/** Newest rows read for the history; a diary is a few rows a day, so this covers the whole window. */
const HISTORY_ROWS = 1500;

/**
 * `PORTION_PRIOR_USER_IDS` is a comma-separated user id allowlist (the owner and
 * QA); empty or unset = nobody, and the analyze path stays exactly as it was.
 */
export function portionPriorEnabled(env: { PORTION_PRIOR_USER_IDS?: string }, userId: string): boolean {
  return (env.PORTION_PRIOR_USER_IDS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === userId);
}

/** The user's usual portions per food, from the weights they typed or edited in the last 60 days. */
export async function loadPortionPriors(
  db: Database,
  userId: string,
  today: string = jakartaToday(),
): Promise<Map<string, PortionPrior>> {
  const rows = await db
    .select({
      name: foodLog.name,
      grams: foodLog.grams,
      source: foodLog.source,
      itemsJson: foodLog.itemsJson,
    })
    .from(foodLog)
    .where(
      and(
        eq(foodLog.userId, userId),
        isNotNull(foodLog.grams),
        gte(foodLog.date, shiftDate(today, -PRIOR_WINDOW_DAYS)),
      ),
    )
    .orderBy(desc(foodLog.createdAt))
    .limit(HISTORY_ROWS);
  return buildPriors(userSetSamples(rows));
}
