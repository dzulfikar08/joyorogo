import { protectedProcedure } from "../index";
import { STRENGTH_LIMITS, strengthPullSchema, strengthPushSchema } from "../lib/strength-record";
import { pushStrengthRecords, readStrengthPage, strengthTotals, wipeStrength } from "../lib/strength-record-store";
import { cloudUnlocked } from "../lib/watch-workout-store";

/**
 * JoyoFit's strength data in the cloud (Pro writes, reads stay open so history is never locked away). Records are
 * JSON documents with last-write-wins on the phone's `updatedAt`; contract and caps: lib/strength-record.ts and
 * watch-fit's docs/strength-cloud.md.
 */
export const strengthRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [unlocked, totals] = await Promise.all([
      cloudUnlocked(context.db, context.env, userId),
      strengthTotals(context.db, userId),
    ]);
    return { unlocked, records: totals.count };
  }),

  /**
   * Records stored after `since` (a `server_at` in ms), oldest first. The phone keeps the returned `cursor` and asks
   * again from `cursor - 1`: the one-millisecond overlap repeats the last row, which last-write-wins absorbs.
   */
  pull: protectedProcedure.input(strengthPullSchema).handler(({ context, input }) =>
    readStrengthPage(context.db, context.session.user.id, input.since, input.limit ?? STRENGTH_LIMITS.pullPage),
  ),

  push: protectedProcedure.input(strengthPushSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    if (!(await cloudUnlocked(context.db, context.env, userId))) return { status: "locked" as const };
    const outcome = await pushStrengthRecords(context.db, userId, input.records);
    return { status: "ok" as const, ...outcome };
  }),

  /** Deletes every strength record of the account ("delete cloud data" in the app). Not Pro gated. */
  wipe: protectedProcedure.handler(async ({ context }) => {
    await wipeStrength(context.db, context.session.user.id);
    return { ok: true as const };
  }),
};
