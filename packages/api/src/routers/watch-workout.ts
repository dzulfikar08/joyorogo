import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { serverT } from "../lib/messages";
import type { StickersBucket } from "../lib/sticker";
import { WATCH_WORKOUT_LIMITS, WatchWorkoutDocError, readDoc } from "../lib/watch-workout";
import {
  changedRows,
  cloudUnlocked,
  getBlob,
  getRow,
  listRows,
  removeWorkout,
  toListItem,
  usage,
  wipeWorkouts,
} from "../lib/watch-workout-store";

const unixSeconds = z.number().int().min(0).max(4_102_444_800);

function bucketOf(context: { env: { STICKERS?: StickersBucket }; locale: Parameters<typeof serverT>[0] }): StickersBucket {
  const bucket = context.env.STICKERS;
  if (!bucket) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: serverT(context.locale, "errors")("watchCloud.storageUnavailable") });
  }
  return bucket;
}

/**
 * JoyoFit cloud workouts (Pro uploads, see lib/watch-workout.ts). Everything an account already stored stays
 * readable and deletable without Pro; only uploads (apps/server/src/watch-workout.ts) need it.
 */
export const watchWorkoutRouter = {
  /** Account-level numbers for the app's "Sinkron cloud" row and the web page: Pro state and what is stored. */
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [unlocked, stored] = await Promise.all([cloudUnlocked(context.db, context.env, userId), usage(context.db, userId)]);
    return {
      unlocked,
      count: stored.count,
      bytes: stored.bytes,
      quotaBytes: WATCH_WORKOUT_LIMITS.userBytes,
      lastChangeAt: stored.lastChangeAt,
    };
  }),

  /** Newest workout first. `cursor` is the `start` of the last item of the previous page. */
  list: protectedProcedure
    .input(z.object({ cursor: unixSeconds.optional() }))
    .handler(async ({ context, input }) => {
      const limit = WATCH_WORKOUT_LIMITS.listPage;
      const rows = await listRows(context.db, context.session.user.id, input.cursor ?? null, limit + 1);
      const page = rows.slice(0, limit);
      return {
        items: page.map(toListItem),
        nextCursor: rows.length > limit ? (page[page.length - 1]?.start ?? null) : null,
      };
    }),

  /** One workout with its analysis, for the web page; null analysis when it was uploaded without one. */
  detail: protectedProcedure.input(z.object({ start: unixSeconds })).handler(async ({ context, input }) => {
    const t = serverT(context.locale, "errors");
    const userId = context.session.user.id;
    const row = await getRow(context.db, userId, input.start);
    if (!row || row.deletedAt != null) throw new ORPCError("NOT_FOUND", { message: t("watchCloud.notFound") });
    const bytes = await getBlob(context.db, bucketOf(context), userId, input.start);
    if (!bytes) throw new ORPCError("NOT_FOUND", { message: t("watchCloud.notFound") });
    try {
      const doc = await readDoc(new Uint8Array(bytes));
      return { item: toListItem(row), analysis: doc.analysis };
    } catch (error) {
      if (error instanceof WatchWorkoutDocError) {
        // Stored by an older or newer rules than this server reads: the list row is still right.
        console.error("[watch-workout] stored document unreadable", error.code, error.message);
        return { item: toListItem(row), analysis: null };
      }
      throw error;
    }
  }),

  /**
   * What changed after `since`, oldest change first, deletes included (`deletedAt` set). The app pulls these to
   * restore a new phone and to apply deletes. `cursor` is the `since` of the next call; `hasMore` says to call again.
   */
  changes: protectedProcedure
    .input(z.object({ since: z.object({ updatedAt: z.number().int().min(0), start: unixSeconds }).nullable().default(null) }))
    .handler(async ({ context, input }) => {
      const limit = WATCH_WORKOUT_LIMITS.changesPage;
      const rows = await changedRows(context.db, context.session.user.id, input.since, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toListItem),
        cursor: last ? { updatedAt: last.updatedAt, start: last.start } : input.since,
        hasMore: rows.length > limit,
      };
    }),

  /** Deletes one workout from the cloud. The phones drop their copy on their next pull. */
  remove: protectedProcedure.input(z.object({ start: unixSeconds })).handler(async ({ context, input }) => {
    const removed = await removeWorkout(context.db, bucketOf(context), context.session.user.id, input.start);
    return { removed };
  }),

  /** Deletes every cloud workout of the account, without leaving anything for the phones to pull. */
  wipe: protectedProcedure.handler(async ({ context }) => {
    const deleted = await wipeWorkouts(context.db, bucketOf(context), context.session.user.id);
    return { deleted };
  }),
};
