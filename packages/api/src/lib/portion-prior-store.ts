// DB side of "Porsi kebiasaanmu" (lib/portion-prior.ts): the user's history. Every user's
// photo scan reads it; there is no allowlist.
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";

import { jakartaToday, shiftDate } from "./engine";
import { PRIOR_WINDOW_DAYS, buildPriors, userSetSamples } from "./portion-prior";
import type { PortionPrior } from "./portion-prior";

/** Newest rows read for the history; a diary is a few rows a day, so this covers the whole window. */
const HISTORY_ROWS = 1500;

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
        // Only these two can hold a weight the user set (barcode and copied rows never count).
        inArray(foodLog.source, ["manual", "ai"]),
        isNotNull(foodLog.grams),
        gte(foodLog.date, shiftDate(today, -PRIOR_WINDOW_DAYS)),
      ),
    )
    .orderBy(desc(foodLog.createdAt))
    .limit(HISTORY_ROWS);
  return buildPriors(userSetSamples(rows));
}
