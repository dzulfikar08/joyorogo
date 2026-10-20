import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import {
  aiUsage,
  dailyActivity,
  exerciseLog,
  foodLog,
  profile,
  scanCorrection,
  scanFeedback,
  sleepLog,
  stravaAccount,
  varScan,
  waistLog,
  waterLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { plate, pushSubscription, workoutCustomExercise, workoutRoutine, workoutSession, workoutSet } from "@joyorogo/db/schema/plans";
import { emailLog } from "@joyorogo/db/schema/billing";
import { pushDevice, pushOutbox, pushPrefs } from "@joyorogo/db/schema/push";
import {
  post,
  postComment,
  postKudos,
  socialBlock,
  socialFollow,
  socialNotification,
  socialReport,
  team,
  teamMember,
  teamNudge,
} from "@joyorogo/db/schema/social";
import { mealPlan, mealPlanSwap, mealPrefs, mealShoppingCheck } from "@joyorogo/db/schema/meal";
import { dishware } from "@joyorogo/db/schema/dishware";
import { savedFood } from "@joyorogo/db/schema/saved-foods";
import { barcodeContribution } from "@joyorogo/db/schema/barcode";
import { teamChallengeMember } from "@joyorogo/db/schema/challenge";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";
import { coachDoc } from "@joyorogo/db/schema/coach";
import { strengthRecord } from "@joyorogo/db/schema/strength";
import { syncRecord } from "@joyorogo/db/schema/sync";
import { sleepInsightCache, sleepInsightPref, sleepNight } from "@joyorogo/db/schema/sleep-insights";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { avatarPrefix } from "./avatar";
import { datasetPrefix } from "./dataset";
import { feedbackPrefix } from "./feedback-keep";
import { deleteUserMcpData } from "./mcp-connections";
import { commentPhotoPrefix, dishwarePrefix, photoPrefix, postPhotoPrefix, scanSrcPrefix, stickerKey, varPhotoPrefix } from "./sticker";
import { parseSavedItems } from "./saved-foods";
import type { StickersBucket } from "./sticker";
import { watchBlobPrefix } from "./watch-workout";

/** Sticker keys of the user's diary; read BEFORE the rows are wiped. */
export async function userStickerKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ scanId: foodLog.scanId })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), isNotNull(foodLog.scanId)));
  const saved = await db
    .select({ itemsJson: savedFood.itemsJson })
    .from(savedFood)
    .where(eq(savedFood.userId, userId));
  const savedIds = saved.flatMap((row) => parseSavedItems(row.itemsJson).flatMap((i) => (i.scanId ? [i.scanId] : [])));
  return [...rows.flatMap((row) => (row.scanId ? [row.scanId] : [])), ...savedIds].map(stickerKey);
}

/**
 * Deletes the user's stickers, every original photo under their prefix, their
 * dataset record (if any), and their avatar(s) (listing catches objects whose rows are already gone).
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
    // Feed post photos (cerita + shared meals).
    postPhotoPrefix(userId),
    // Photos attached to comments (a user's own, shown on other people's posts too).
    commentPhotoPrefix(userId),
    // Pending-scan originals kept for "Hitung ulang".
    scanSrcPrefix(userId),
    // Internal accuracy dataset (allowlisted accounts only): "delete on request".
    datasetPrefix(userId),
    // Photos the user opted in to keep with negative feedback.
    feedbackPrefix(userId),
    // "Piring saya": photos of their registered plates and bowls.
    dishwarePrefix(userId),
    // JoyoFit cloud workouts (Pro): one document per workout.
    watchBlobPrefix(userId),
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
    // Feed: posts go with their kudos/comments/notifications (FK cascade);
    // the user's own reactions, follows, blocks and reports on others go too.
    db.delete(socialReport).where(eq(socialReport.reporterId, userId)),
    db
      .delete(socialNotification)
      .where(or(eq(socialNotification.userId, userId), eq(socialNotification.actorId, userId))),
    db.delete(postKudos).where(eq(postKudos.userId, userId)),
    db.delete(postComment).where(eq(postComment.userId, userId)),
    db.delete(post).where(eq(post.userId, userId)),
    db
      .delete(socialFollow)
      .where(or(eq(socialFollow.followerId, userId), eq(socialFollow.followingId, userId))),
    db
      .delete(socialBlock)
      .where(or(eq(socialBlock.blockerId, userId), eq(socialBlock.blockedId, userId))),
    db.delete(plate).where(eq(plate.userId, userId)),
    db.delete(savedFood).where(eq(savedFood.userId, userId)),
    db.delete(dishware).where(eq(dishware.userId, userId)),
    // Rencana makan: saved plans, swaps, shopping ticks and food preferences.
    db.delete(mealPlan).where(eq(mealPlan.userId, userId)),
    db.delete(mealPlanSwap).where(eq(mealPlanSwap.userId, userId)),
    db.delete(mealShoppingCheck).where(eq(mealShoppingCheck.userId, userId)),
    db.delete(mealPrefs).where(eq(mealPrefs.userId, userId)),
    db.delete(pushSubscription).where(eq(pushSubscription.userId, userId)),
    db.delete(pushDevice).where(eq(pushDevice.userId, userId)),
    db.delete(pushPrefs).where(eq(pushPrefs.userId, userId)),
    db.delete(pushOutbox).where(eq(pushOutbox.userId, userId)),
    db.delete(profile).where(eq(profile.userId, userId)),
    db.delete(weightLog).where(eq(weightLog.userId, userId)),
    db.delete(waistLog).where(eq(waistLog.userId, userId)),
    db.delete(varScan).where(eq(varScan.userId, userId)),
    db.delete(foodLog).where(eq(foodLog.userId, userId)),
    db.delete(exerciseLog).where(eq(exerciseLog.userId, userId)),
    db.delete(sleepLog).where(eq(sleepLog.userId, userId)),
    db.delete(fitnessScore).where(eq(fitnessScore.userId, userId)),
    db.delete(watchWorkout).where(eq(watchWorkout.userId, userId)),
    // Sleep insights: the nights JoyoFit pushed, the cached findings and the consent switch itself.
    db.delete(sleepNight).where(eq(sleepNight.userId, userId)),
    db.delete(sleepInsightCache).where(eq(sleepInsightCache.userId, userId)),
    db.delete(sleepInsightPref).where(eq(sleepInsightPref.userId, userId)),
    db.delete(coachDoc).where(eq(coachDoc.userId, userId)),
    db.delete(strengthRecord).where(eq(strengthRecord.userId, userId)),
    db.delete(syncRecord).where(eq(syncRecord.userId, userId)),
    // AI apps connected through the MCP connector: consent, tokens and the audit log (they would read an empty account).
    ...deleteUserMcpData(db, userId),
    db.delete(stravaAccount).where(eq(stravaAccount.userId, userId)),
    db.delete(waterLog).where(eq(waterLog.userId, userId)),
    db.delete(dailyActivity).where(eq(dailyActivity.userId, userId)),
    db.delete(aiUsage).where(eq(aiUsage.userId, userId)),
    // userId is nullable (anon scans) but scoped wipes only ever match rows.
    db.delete(scanCorrection).where(eq(scanCorrection.userId, userId)),
    // Ratings and notes the user wrote on scan results.
    db.delete(scanFeedback).where(eq(scanFeedback.userId, userId)),
    db.delete(emailLog).where(eq(emailLog.userId, userId)),
    // Nutrition values the user read off a label belong to the shared product
    // database: they stay, but stop being linked to the person.
    db.update(barcodeContribution).set({ userId: null }).where(eq(barcodeContribution.userId, userId)),
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
    db.delete(teamChallengeMember).where(eq(teamChallengeMember.userId, userId)),
    db.delete(teamMember).where(eq(teamMember.userId, userId)),
  ]);
}
