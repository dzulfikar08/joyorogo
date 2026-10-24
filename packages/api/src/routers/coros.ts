import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog } from "@joyorogo/db/schema/fitness";
import type { Locale } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import {
  CorosGrantError,
  completeAuthorization,
  corosEnabled,
  deleteImportedWorkouts,
  disconnectCoros,
  grantStatus,
  startAuthorization,
} from "../lib/coros-grant";
import { CorosSyncError, syncCoros } from "../lib/coros-sync";
import type { Context } from "../context";
import { serverT } from "../lib/messages";
import { userZone } from "../lib/user-zone";

// protectedProcedure narrows session to non-null; helpers share that shape.
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

function requireConfig(context: AuthedContext): void {
  if (!corosEnabled(context.env, context.session.user.id)) {
    throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "coros")("server.notConfigured") });
  }
}

/** COROS failures as the user should read them: only a refused grant or an expired link tells them to reconnect. */
function toOrpcError(error: unknown, locale: Locale): ORPCError<string, unknown> {
  const t = serverT(locale, "coros");
  if (error instanceof CorosGrantError) {
    if (error.failure === "bad_state") return new ORPCError("BAD_REQUEST", { message: t("server.badState") });
    if (error.failure === "rejected") return new ORPCError("UNAUTHORIZED", { message: t("server.rejected") });
  }
  if (error instanceof CorosSyncError) {
    if (error.failure === "not_connected") return new ORPCError("NOT_FOUND", { message: t("server.connectFirst") });
    if (error.failure === "expired") return new ORPCError("UNAUTHORIZED", { message: t("server.expired") });
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.retry"), cause: error });
}

export const corosRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const status = await grantStatus(context.db, userId);
    const [imported] = await context.db
      .select({ n: count() })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "coros")));
    return {
      configured: corosEnabled(context.env, userId),
      connected: status.connected,
      connectedAt: status.connectedAt ?? null,
      lastSyncAt: status.lastSyncAt ?? null,
      lastSyncFailed: status.lastError !== undefined,
      importedCount: imported?.n ?? 0,
    };
  }),

  // `returnTo` says which app the server's callback (api host) hands the code to: the web callback page or the app's deep link.
  authorizeUrl: protectedProcedure
    .input(z.object({ returnTo: z.enum(["web", "native"]) }))
    .handler(async ({ context, input }) => {
      requireConfig(context);
      try {
        return await startAuthorization(context.db, context.env, { userId: context.session.user.id, returnTo: input.returnTo });
      } catch (error) {
        throw toOrpcError(error, context.locale);
      }
    }),

  exchangeCode: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(256) }))
    .handler(async ({ context, input }) => {
      requireConfig(context);
      try {
        await completeAuthorization(context.db, context.env, { userId: context.session.user.id, ...input });
        return { connected: true };
      } catch (error) {
        throw toOrpcError(error, context.locale);
      }
    }),

  sync: protectedProcedure.handler(async ({ context }) => {
    requireConfig(context);
    try {
      const { imported, skipped } = await syncCoros({
        db: context.db,
        env: context.env,
        userId: context.session.user.id,
        zone: await userZone(context),
        locale: context.locale,
      });
      return { imported, skipped };
    } catch (error) {
      throw toOrpcError(error, context.locale);
    }
  }),

  // The connection and everything imported from COROS go together.
  disconnect: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await disconnectCoros(context.db, context.env, userId);
    await deleteImportedWorkouts(context.db, userId);
    return { connected: false };
  }),
};
