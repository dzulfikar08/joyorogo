import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";

import {
  createGoogleKeySource,
  createGooglePlayClient,
  googlePlayConfig,
  parsePushNotification,
  tokenMatches,
  verifyPushJwt,
} from "@joyorogo/api/lib/google-play";
import type { GooglePlayEnv } from "@joyorogo/api/lib/google-play";
import {
  googleLedgerId,
  handleGoogleNotification,
  verifyGooglePurchase,
} from "@joyorogo/api/lib/google-play-billing";
import type { GoogleVerifyResult } from "@joyorogo/api/lib/google-play-billing";
import { serverT } from "@joyorogo/api/lib/messages";
import { paywallConfig, paywallEnabled } from "@joyorogo/api/lib/tiers";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import type { Database } from "@joyorogo/db";
import { requestLocale } from "./context";
import { sendOrderEmails } from "./email";
import type { EmailEnv } from "./email";

export type GoogleBillingEnv = PaywallEnv &
  EmailEnv &
  GooglePlayEnv & {
    BETTER_AUTH_URL: string;
  };

type Deps = {
  env: GoogleBillingEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
};

export const GOOGLE_VERIFY_PATH = "/api/billing/google";
export const GOOGLE_RTDN_PATH = "/api/billing/google/rtdn";

/** Play purchase tokens are URL-safe; the pattern keeps them out of path tricks. */
const PURCHASE_TOKEN = /^[A-Za-z0-9._-]{10,2048}$/;

/** User-facing text of a billing response, in the language the request asks for. */
const t = (c: Context) => serverT(requestLocale(c), "errors");

/**
 * Google Play Billing for the Play build's JoyoRogo Pro subscription (`pro`,
 * base plans `monthly` / `yearly`). Trust comes from the Android Publisher API
 * (service account), never from the client. Everything stays off, answering
 * "tidak tersedia", until the paywall is on AND GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
 * is set, so self-hosts and the iOS/sideload builds are unaffected.
 *
 * - POST /api/billing/google  { purchaseToken }: signed-in user redeems a
 *   purchase (new, restore, or replay). Idempotent per Play order.
 * - POST /api/billing/google/rtdn: Pub/Sub push of Play real-time developer
 *   notifications (renewals, pending-purchase completion, refunds). Authenticated by the
 *   Google-signed push JWT (GOOGLE_PLAY_RTDN_PUSH_EMAIL) or a shared token
 *   (GOOGLE_PLAY_RTDN_TOKEN as `?token=`).
 */
export function registerGooglePlayRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  const paywall = paywallConfig(env);
  const config = paywallEnabled(paywall) ? googlePlayConfig(env) : null;
  const client = config ? createGooglePlayClient(config) : null;
  const signingKey = createGoogleKeySource();
  const apiUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

  const unavailable = (c: Context) => ({ error: t(c)("billing.googleUnavailable") });

  const billingDeps = () =>
    config && client
      ? {
          db: deps.getDb(),
          client,
          config,
          fallbackPriceIdr: {
            monthly: paywall.founderPriceIdr,
            yearly: paywall.founderYearlyPriceIdr,
          },
        }
      : null;

  app.post(GOOGLE_VERIFY_PATH, async (c) => {
    const billing = billingDeps();
    if (!billing) return c.json(unavailable(c), 404);
    const session = await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers });
    const me = session?.user ?? null;
    if (!me) return c.json({ error: t(c)("billing.signInToSubscribe") }, 401);
    const body = (await c.req.json().catch(() => null)) as { purchaseToken?: unknown } | null;
    const purchaseToken = body?.purchaseToken;
    if (typeof purchaseToken !== "string" || !PURCHASE_TOKEN.test(purchaseToken)) {
      return c.json({ error: t(c)("billing.receiptMissing") }, 400);
    }

    let result: GoogleVerifyResult;
    try {
      result = await verifyGooglePurchase(billing, { purchaseToken, userId: me.id });
    } catch (error) {
      console.error("google billing verify failed:", error);
      return c.json({ error: t(c)("billing.googleUnreachable") }, 502);
    }

    if (!result.ok) {
      if (result.error === "other-account") {
        return c.json(
          { error: t(c)("billing.googleLinkedOtherAccount") },
          409,
        );
      }
      if (result.error === "busy") {
        return c.json({ error: t(c)("billing.processing") }, 409);
      }
      if (result.error === "no-user") return c.json({ error: t(c)("billing.userNotFound") }, 404);
      return c.json({ error: t(c)("billing.receiptInvalid") }, 400);
    }
    if (result.status === "pending" || result.status === "inactive") {
      return c.json({ status: result.status });
    }
    if (result.status === "granted" && result.amountIdr > 0) {
      c.executionCtx.waitUntil(
        sendOrderEmails(
          env,
          billing.db,
          { orderId: googleLedgerId(result.orderId), userId: me.id, gateway: "google" },
          { founderDailyCap: paywall.founderDailyCap },
        ).catch((error: unknown) => console.error(`order emails ${result.orderId}:`, error)),
      );
    }
    return c.json({
      status: result.status,
      activated: result.status === "granted",
      founderUntil: result.founderUntil,
    });
  });

  app.post(GOOGLE_RTDN_PATH, async (c) => {
    const billing = billingDeps();
    if (!billing || !config) return c.json(unavailable(c), 404);

    const queryToken = c.req.query("token");
    const bearer = c.req.header("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const authorized =
      (config.pushToken !== null &&
        queryToken !== undefined &&
        tokenMatches(queryToken, config.pushToken)) ||
      (config.pushEmail !== null &&
        bearer !== undefined &&
        (await verifyPushJwt(bearer, {
          audience: `${apiUrl}${GOOGLE_RTDN_PATH}`,
          email: config.pushEmail,
          key: signingKey,
        }).catch(() => false)));
    if (!authorized) return c.json({ error: "unauthorized" }, 401);

    const notification = parsePushNotification(await c.req.json().catch(() => null));
    // Not ours (other app, test ping, malformed): acknowledge so Pub/Sub stops retrying.
    if (!notification || notification.test || notification.packageName !== config.packageName) {
      return c.body(null, 204);
    }
    try {
      const result = await handleGoogleNotification(billing, notification);
      if (result.granted && result.granted.amountIdr > 0) {
        const { granted } = result;
        c.executionCtx.waitUntil(
          sendOrderEmails(
            env,
            billing.db,
            {
              orderId: googleLedgerId(granted.orderId),
              userId: granted.userId,
              gateway: "google",
            },
            { founderDailyCap: paywall.founderDailyCap },
          ).catch((error: unknown) => console.error(`order emails ${granted.orderId}:`, error)),
        );
      }
      return c.body(null, 204);
    } catch (error) {
      // Play or D1 hiccup: a non-2xx makes Pub/Sub redeliver.
      console.error("google rtdn failed:", error);
      return c.json({ error: "retry" }, 500);
    }
  });
}
