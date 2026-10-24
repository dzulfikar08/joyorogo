import { asc, eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { profile, weightLog } from "@joyorogo/db/schema/fitness";

/**
 * Body weight on a day (the latest weigh-in on or before it, else the starting weight, else 70 kg) for the MET calorie
 * estimate of an imported workout. One weight query and one profile query serve a whole batch.
 */
export async function weightLookup(db: Database, userId: string): Promise<(date: string) => number> {
  const [weights, profileRows] = await Promise.all([
    db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(eq(weightLog.userId, userId))
      .orderBy(asc(weightLog.date)),
    db.select({ startWeightKg: profile.startWeightKg }).from(profile).where(eq(profile.userId, userId)),
  ]);
  const fallbackKg = profileRows[0]?.startWeightKg ?? 70;
  return (date) => {
    let latest: number | undefined;
    for (const w of weights) {
      if (w.date > date) break;
      latest = w.weightKg;
    }
    return latest ?? fallbackKg;
  };
}
