import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog } from "@joyorogo/db/schema/fitness";
import type { Locale } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import type { Context } from "../context";
import { GarminGrantError, connectGarmin, disconnectGarmin, garminEnabled, garminStatus } from "../lib/garmin-grant";
import { GarminSyncError, syncGarmin } from "../lib/garmin-sync";
import { serverT } from "../lib/messages";
import { userZone } from "../lib/user-zone";

// protectedProcedure narrows session to non-null; helpers share that shape.
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

function requireAllowed(context: AuthedContext): void {
  if (!garminEnabled(context.env, context.session.user.id)) {
    throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "garmin")("server.notConfigured") });
  }
}

/** Garmin failures as the user should read them: only a refused key or an expired one tells them to paste a new key. */
function toOrpcError(error: unknown, locale: Locale): ORPCError<string, unknown> {
  const t = serverT(locale, "garmin");
  if (error instanceof GarminGrantError && error.failure === "rejected") return new ORPCError("UNAUTHORIZED", { message: t("server.badKey") });
  if (error instanceof GarminSyncError) {
    if (error.failure === "not_connected") return new ORPCError("NOT_FOUND", { message: t("server.connectFirst") });
    if (error.failure === "expired") return new ORPCError("UNAUTHORIZED", { message: t("server.expired") });
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.retry"), cause: error });
}

export const garminRouter = {
  // Never carries the key or the token: only whether there is a connection, and how it is doing.
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const status = await garminStatus(context.db, userId);
    const [imported] = await context.db
      .select({ n: count() })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "garmin")));
    return {
      configured: garminEnabled(context.env, userId),
      connected: status.connected,
      connectedAt: status.connected ? status.connectedAt : null,
      lastSyncAt: status.connected ? (status.lastSyncAt ?? null) : null,
      lastSyncFailed: status.connected && status.lastError !== undefined,
      importedCount: imported?.n ?? 0,
    };
  }),

  // Pasting a key proves it by minting a token with it; a wrong key answers UNAUTHORIZED (`server.badKey`) and stores nothing.
  connect: protectedProcedure
    .input(z.object({ apiKey: z.string().trim().min(8).max(512) }))
    .handler(async ({ context, input }) => {
      requireAllowed(context);
      try {
        await connectGarmin(context.db, context.session.user.id, input.apiKey);
        return { connected: true };
      } catch (error) {
        throw toOrpcError(error, context.locale);
      }
    }),

  sync: protectedProcedure.handler(async ({ context }) => {
    requireAllowed(context);
    try {
      const { imported, skipped, weights, days } = await syncGarmin({
        db: context.db,
        userId: context.session.user.id,
        zone: await userZone(context),
        locale: context.locale,
      });
      return { imported, skipped, weights, days };
    } catch (error) {
      throw toOrpcError(error, context.locale);
    }
  }),

  // The connection (key and token) and everything imported from Garmin go together.
  disconnect: protectedProcedure.handler(async ({ context }) => {
    await disconnectGarmin(context.db, context.session.user.id);
    return { connected: false };
  }),
};
