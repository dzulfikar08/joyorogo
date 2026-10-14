import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";

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
  varScan,
  waistLog,
  waterLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { plate, pushSubscription, workoutCustomExercise, workoutRoutine, workoutSession, workoutSet } from "@joyorogo/db/schema/plans";
import { emailLog } from "@joyorogo/db/schema/billing";
import { team, teamMember, teamNudge } from "@joyorogo/db/schema/social";

import { avatarPrefix } from "./avatar";
import { photoPrefix, scanSrcPrefix, stickerKey, varPhotoPrefix } from "./sticker";
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
 * Deletes the user's stickers, every original photo under their prefix, and
 * their avatar(s) (listing catches objects whose rows are already gone).
 * R2 deletes take at most 1000 keys per call.
 */
export async function deleteUserMedia(
  bucket: StickersBucket,
  userId: string,
  stickerKeys: string[],
): Promise<void> {
  const keys = [...stickerKeys];
  for (const prefix of [
    photoPrefix(userId),
    avatarPrefix(userId),
    varPhotoPrefix(userId),
    // Pending-scan originals kept for "Hitung ulang".
    scanSrcPrefix(userId),
  ]) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
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
    db.delete(workoutSet).where(eq(workoutSet.userId, userId)),
    db.delete(workoutSession).where(eq(workoutSession.userId, userId)),
    db.delete(workoutCustomExercise).where(eq(workoutCustomExercise.userId, userId)),
    db.delete(workoutRoutine).where(eq(workoutRoutine.userId, userId)),
    db.delete(plate).where(eq(plate.userId, userId)),
    db.delete(pushSubscription).where(eq(pushSubscription.userId, userId)),
    db.delete(profile).where(eq(profile.userId, userId)),
    db.delete(weightLog).where(eq(weightLog.userId, userId)),
    db.delete(waistLog).where(eq(waistLog.userId, userId)),
    db.delete(varScan).where(eq(varScan.userId, userId)),
    db.delete(foodLog).where(eq(foodLog.userId, userId)),
    db.delete(exerciseLog).where(eq(exerciseLog.userId, userId)),
    db.delete(sleepLog).where(eq(sleepLog.userId, userId)),
    db.delete(stravaAccount).where(eq(stravaAccount.userId, userId)),
    db.delete(waterLog).where(eq(waterLog.userId, userId)),
    db.delete(dailyActivity).where(eq(dailyActivity.userId, userId)),
    db.delete(aiUsage).where(eq(aiUsage.userId, userId)),
    // userId is nullable (anon scans) but scoped wipes only ever match rows.
    db.delete(scanCorrection).where(eq(scanCorrection.userId, userId)),
    db.delete(emailLog).where(eq(emailLog.userId, userId)),
  ]);
}

/**
 * Team cleanup: nudges to/from the user and their memberships go; each team
 * they own follows the leave rule — ownership passes to the earliest-joined
 * remaining member, and a team with no one left is deleted (cascades).
 */
export async function deleteUserSocialData(db: Database, userId: string) {
  const owned = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.ownerId, userId));
  for (const t of owned) {
    const [heir] = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, t.id), ne(teamMember.userId, userId)))
      .orderBy(asc(teamMember.joinedAt))
      .limit(1);
    if (heir) {
      await db.batch([
        db.update(team).set({ ownerId: heir.userId }).where(eq(team.id, t.id)),
        db
          .update(teamMember)
          .set({ role: "owner" })
          .where(and(eq(teamMember.teamId, t.id), eq(teamMember.userId, heir.userId))),
      ]);
    } else {
      await db.delete(team).where(eq(team.id, t.id));
    }
  }
  await db.batch([
    db.delete(teamNudge).where(or(eq(teamNudge.fromUserId, userId), eq(teamNudge.toUserId, userId))),
    db.delete(teamMember).where(eq(teamMember.userId, userId)),
  ]);
}
