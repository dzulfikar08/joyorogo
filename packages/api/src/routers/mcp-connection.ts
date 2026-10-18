import { z } from "zod";

import { mcpResourceUrl } from "@joyorogo/auth";

import { protectedProcedure } from "../index";
import { listConnections, recentActivity, revokeConnection } from "../lib/mcp-connections";
import { cloudUnlocked } from "../lib/watch-workout-store";

/**
 * Settings > Koneksi AI (web and native): the AI apps connected through the MCP connector and what they read.
 * The connector itself lives at apps/server/src/mcp.ts; connecting happens in the AI app, never here.
 */
export const mcpConnectionRouter = {
  /** The connector address to paste into Claude or ChatGPT, and whether this account may use it (Pro). */
  info: protectedProcedure.handler(async ({ context }) => {
    return {
      url: mcpResourceUrl(context.env.BETTER_AUTH_URL ?? ""),
      unlocked: await cloudUnlocked(context.db, context.env, context.session.user.id),
    };
  }),

  list: protectedProcedure.handler(({ context }) => listConnections(context.db, context.session.user.id)),

  /** Cuts one app off at once. `revoked` is false when the account had no connection with that client. */
  revoke: protectedProcedure
    .input(z.object({ clientId: z.string().min(1).max(200) }))
    .handler(async ({ context, input }) => ({
      revoked: await revokeConnection(context.db, context.session.user.id, input.clientId),
    })),

  /** The latest tool calls on the account (audit log), newest first; optionally of one app. */
  activity: protectedProcedure
    .input(z.object({ clientId: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(100).default(30) }))
    .handler(({ context, input }) => recentActivity(context.db, context.session.user.id, input.limit, input.clientId)),
};
