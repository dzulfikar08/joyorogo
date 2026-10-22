// DB side of "Seperti biasanya" (lib/usual-density.ts): the user's own logged rows. Every photo scan and every story
// reads it; there is no allowlist.
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { foodLog } from "@joyorogo/db/schema/fitness";

import { jakartaToday, shiftDate } from "./engine";
import { USUAL_WINDOW_DAYS, buildUsualMap } from "./usual-density";
import type { UsualMap } from "./usual-density";

/** Newest rows read; a diary is a few rows a day, so this covers the whole window. */
const HISTORY_ROWS = 1500;

/** The user's usual kcal per gram per food, from rows logged in the last 120 days. */
export async function loadUsualDensities(db: Database, userId: string, zone: DayZone): Promise<UsualMap> {
  const today = jakartaToday(undefined, zone);
  const rows = await db
    .select({
      name: foodLog.name,
      grams: foodLog.grams,
      kcal: foodLog.kcal,
      protein: foodLog.protein,
      carbs: foodLog.carbs,
      fat: foodLog.fat,
      fiber: foodLog.fiber,
    })
    .from(foodLog)
    .where(
      and(
        eq(foodLog.userId, userId),
        // Rows imported from a watch or Health Connect are not the user's own food numbers.
        ne(foodLog.source, "huawei"),
        gte(foodLog.date, shiftDate(today, -USUAL_WINDOW_DAYS)),
      ),
    )
    // rowid breaks a tie between rows written in the same millisecond: the later insert is the newer one.
    .orderBy(desc(foodLog.createdAt), desc(sql`${foodLog}.rowid`))
    .limit(HISTORY_ROWS);
  return buildUsualMap(rows);
}
