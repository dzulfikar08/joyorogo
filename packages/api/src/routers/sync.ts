import { protectedProcedure } from "../index";
import {
  SYNC_LIMITS,
  SYNC_PRO_NAMESPACES,
  syncPullSchema,
  syncPushSchema,
  syncWipeSchema,
} from "../lib/sync-record";
import { pushSyncRecords, readSyncPage, syncCount, wipeSync } from "../lib/sync-record-store";
import { cloudUnlocked } from "../lib/watch-workout-store";

/**
 * Preferences and small user-made documents that follow the account to every phone (docs/multi-device.md). `rogo`
 * writes are free, `fit` writes need Pro; reads stay open so history is never locked away. Contract and caps:
 * lib/sync-record.ts.
 */
export const syncRouter = {
  /** `unlocked` says whether this account's writes to `ns` are accepted. */
  status: protectedProcedure.input(syncPullSchema.pick({ ns: true })).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const [unlocked, records] = await Promise.all([
      SYNC_PRO_NAMESPACES.includes(input.ns) ? cloudUnlocked(context.db, context.env, userId) : true,
      syncCount(context.db, userId, input.ns),
    ]);
    return { unlocked, records };
  }),

  /**
   * Records of `ns` stored after `since` (a `server_at` in ms), oldest first. The phone keeps the returned `cursor` and
   * asks again from `cursor - 1`: the one-millisecond overlap repeats the last row, which the merge absorbs.
   */
  pull: protectedProcedure.input(syncPullSchema).handler(async ({ context, input }) => ({
    ...(await readSyncPage(
      context.db,
      context.session.user.id,
      input.ns,
      input.since,
      input.limit ?? SYNC_LIMITS.pullPage,
    )),
    // The server clock: the phone derives its clock skew from it (lib/sync-engine.ts).
    now: Date.now(),
  })),

  push: protectedProcedure.input(syncPushSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    if (SYNC_PRO_NAMESPACES.includes(input.ns) && !(await cloudUnlocked(context.db, context.env, userId))) {
      return { status: "locked" as const };
    }
    const now = Date.now();
    const outcome = await pushSyncRecords(context.db, userId, input.ns, input.clientNow, input.records, now);
    return { status: "ok" as const, ...outcome, now };
  }),

  /** Hard-deletes the account's records of `ns` ("delete cloud data", or the cycle switch turned off). Not Pro gated. */
  wipe: protectedProcedure.input(syncWipeSchema).handler(async ({ context, input }) => {
    await wipeSync(context.db, context.session.user.id, input.ns, input.kinds);
    return { ok: true as const };
  }),
};
