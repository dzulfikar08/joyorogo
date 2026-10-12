import { and, eq, isNotNull } from "drizzle-orm";

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

import { photoPrefix, stickerKey } from "./sticker";
import type { StickersBucket } from "./sticker";

/** Sticker keys of the user's diary; read BEFORE the rows are wiped. */
export async function userStickerKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ scanId: foodLog.scanId })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), isNotNull(foodLog.scanId)));
  return rows.flatMap((row) => (row.scanId ? [stickerKey(row.scanId)] : []));
}

/**
 * Deletes the user's stickers and every original photo under their prefix
 * (listing catches photos whose rows are already gone). R2 deletes take at
 * most 1000 keys per call.
 */
export async function deleteUserMedia(
  bucket: StickersBucket,
  userId: string,
  stickerKeys: string[],
): Promise<void> {
  const keys = [...stickerKeys];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: photoPrefix(userId), cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

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
