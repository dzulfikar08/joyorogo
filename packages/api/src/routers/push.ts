import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { pushSubscription } from "@joyorogo/db/schema/plans";
import { pushDevice, pushPrefs } from "@joyorogo/db/schema/push";

import { protectedProcedure } from "../index";
import { isExpoToken } from "../lib/expo-push";
import { notify, prefsFromRow } from "../lib/notify";
import { removeDevice, removeWebSubscription, saveDevice, saveWebSubscription } from "../lib/push-subs";
import { serverT } from "../lib/messages";
import { vapidConfigured } from "../lib/webpush";

// Push settings and registration for the whole account (JoyoRogo web, JoyoRogo native, JoyoFit). Contract: docs/push.md.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

async function readPrefs(context: { db: Database; session: { user: { id: string } } }) {
  const userId = context.session.user.id;
  const [row] = await context.db.select().from(pushPrefs).where(eq(pushPrefs.userId, userId)).limit(1);
  const [web, rogo, fit] = await context.db.batch([
    context.db.select({ total: count() }).from(pushSubscription).where(eq(pushSubscription.userId, userId)),
    context.db
      .select({ total: count() })
      .from(pushDevice)
      .where(and(eq(pushDevice.userId, userId), eq(pushDevice.app, "joyorogo"))),
    context.db
      .select({ total: count() })
      .from(pushDevice)
      .where(and(eq(pushDevice.userId, userId), eq(pushDevice.app, "joyofit"))),
  ]);
  return {
    ...prefsFromRow(row),
    devices: { web: web[0]?.total ?? 0, joyorogo: rogo[0]?.total ?? 0, joyofit: fit[0]?.total ?? 0 },
  };
}

export const pushRouter = {
  /** Switches, quiet hours and how many browsers / phones of each app are registered. Defaults while nothing is saved. */
  prefs: protectedProcedure.handler(({ context }) => readPrefs(context)),

  setPrefs: protectedProcedure
    .input(
      z.object({
        social: z.boolean().optional(),
        group: z.boolean().optional(),
        meal: z.boolean().optional(),
        weigh: z.boolean().optional(),
        recap: z.boolean().optional(),
        quiet: z
          .object({ enabled: z.boolean().optional(), start: hhmm.optional(), end: hhmm.optional() })
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const set = {
        ...(input.social !== undefined ? { social: input.social } : {}),
        ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.meal !== undefined ? { meal: input.meal } : {}),
        ...(input.weigh !== undefined ? { weigh: input.weigh } : {}),
        ...(input.recap !== undefined ? { recap: input.recap } : {}),
        ...(input.quiet?.enabled !== undefined ? { quietEnabled: input.quiet.enabled } : {}),
        ...(input.quiet?.start !== undefined ? { quietStart: input.quiet.start } : {}),
        ...(input.quiet?.end !== undefined ? { quietEnd: input.quiet.end } : {}),
      };
      await context.db
        .insert(pushPrefs)
        .values({ userId, ...set })
        .onConflictDoUpdate({ target: pushPrefs.userId, set: { ...set, updatedAt: new Date() } });
      return readPrefs(context);
    }),

  /** Native apps (JoyoRogo or JoyoFit) hand over their Expo push token. Call again on every start: tokens rotate. */
  registerDevice: protectedProcedure
    .input(
      z.object({
        app: z.enum(["joyorogo", "joyofit"]),
        platform: z.enum(["android", "ios"]),
        expoToken: z.string().max(200),
        locale: z.string().max(10).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!isExpoToken(input.expoToken)) {
        throw new ORPCError("BAD_REQUEST", { message: serverT(context.locale, "errors")("push.badToken") });
      }
      await saveDevice(context.db, context.session.user.id, input);
      return { ok: true };
    }),

  unregisterDevice: protectedProcedure
    .input(z.object({ expoToken: z.string().max(200) }))
    .handler(async ({ context, input }) => {
      await removeDevice(context.db, context.session.user.id, input.expoToken);
      return { ok: true };
    }),

  /** `PushManager.applicationServerKey`; null = this server cannot send Web Push. */
  vapidPublicKey: protectedProcedure.handler(({ context }) => ({
    key: vapidConfigured(context.env) ? (context.env.VAPID_PUBLIC_KEY ?? null) : null,
  })),

  subscribeWeb: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
    )
    .handler(async ({ context, input }) => {
      await saveWebSubscription(context.db, context.session.user.id, input);
      return { ok: true };
    }),

  unsubscribeWeb: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .handler(async ({ context, input }) => {
      await removeWebSubscription(context.db, context.session.user.id, input.endpoint);
      return { ok: true };
    }),

  /** Sends one notification to every browser and phone of the caller now, ignoring switches, quiet hours and caps. */
  sendTest: protectedProcedure.handler(async ({ context }) => {
    const result = await notify({ db: context.db, env: context.env }, context.session.user.id, {
      category: "social",
      kind: "test",
      title: { key: "notify.test.title" },
      body: { key: "notify.test.body" },
      link: { t: "settings" },
      bypass: true,
    });
    return { status: result.status, reached: result.status === "sent" };
  }),
};
