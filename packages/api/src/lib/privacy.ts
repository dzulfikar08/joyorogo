import { eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import {
  aiUsage,
  dailyActivity,
  exerciseLog,
  foodLog,
  profile,
  scanCorrection,
  sleepLog,
  stravaAccount,
  waterLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";

/**
 * Wipes every fitness row of the user in one atomic batch. The auth account
 * (user/session/account) is kept so the same login keeps working.
 * D1 has no interactive transactions — batch is the atomic unit.
 */
export function deleteAllUserData(db: Database, userId: string) {
  return db.batch([
    db.delete(profile).where(eq(profile.userId, userId)),
    db.delete(weightLog).where(eq(weightLog.userId, userId)),
    db.delete(foodLog).where(eq(foodLog.userId, userId)),
    db.delete(exerciseLog).where(eq(exerciseLog.userId, userId)),
    db.delete(sleepLog).where(eq(sleepLog.userId, userId)),
    db.delete(stravaAccount).where(eq(stravaAccount.userId, userId)),
    db.delete(waterLog).where(eq(waterLog.userId, userId)),
    db.delete(dailyActivity).where(eq(dailyActivity.userId, userId)),
    db.delete(aiUsage).where(eq(aiUsage.userId, userId)),
    // userId is nullable (anon scans) but scoped wipes only ever match rows.
    db.delete(scanCorrection).where(eq(scanCorrection.userId, userId)),
  ]);
}
