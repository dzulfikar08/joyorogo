import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";

import {
  DEFAULT_GOOGLE_PLAY_PACKAGE,
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
import type { LedgerKind } from "@joyorogo/api/lib/revklik";
import { paywallConfig, paywallEnabled } from "@joyorogo/api/lib/tiers";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import type { Database } from "@joyorogo/db";
import { requestLocale } from "./context";
import { sendOrderEmails } from "./email";
import type { EmailEnv } from "./email";
import type { Revklik } from "./revklik";

export type GoogleBillingEnv = PaywallEnv &
  EmailEnv &
  GooglePlayEnv & {
    BETTER_AUTH_URL: string;
  };

type Deps = {
  env: GoogleBillingEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  /** RevKlik revenue forwarding; queues an event after every paid flip and refund. */
  revklik?: Revklik;
};

export const GOOGLE_VERIFY_PATH = "/api/billing/google";
export const GOOGLE_RTDN_PATH = "/api/billing/google/rtdn";

/** Play purchase tokens are URL-safe; the pattern keeps them out of path tricks. */
const PURCHASE_TOKEN = /^[A-Za-z0-9._-]{10,2048}$/;

/** User-facing text of a billing response, in the language the request asks for. */
const t = (c: Context) => serverT(requestLocale(c), "errors");

/** Stable machine-readable `code` of every error response, next to the localized `error` text. */
type ErrorCode =
  | "signIn"
  | "invalidReceipt"
  | "otherAccount"
  | "processing"
  | "unreachable"
  | "unavailable"
  | "userNotFound";

/**
 * Google Play Billing for JoyoRogo Pro sold in the JoyoRogo Play app (`pro`,
 * base plans `monthly` / `yearly`) and the JoyoFit Play app (`pro.monthly` /
 * `pro.yearly`); the product table is GOOGLE_PLAY_PRODUCTS and the enabled
 * apps are GOOGLE_PLAY_PACKAGE_NAMES. Trust comes from the Android Publisher API
 * (service account), never from the client. Everything stays off, answering
 * "tidak tersedia", until the paywall is on AND GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
 * is set, so self-hosts and the iOS/sideload builds are unaffected.
 *
 * - POST /api/billing/google  { purchaseToken, packageName? }: signed-in user redeems a
 *   purchase (new, restore, or replay) of the given enabled package (default JoyoRogo's).
 *   Idempotent per Play order.
 * - POST /api/billing/google/rtdn: Pub/Sub push of Play real-time developer
 *   notifications (renewals, pending-purchase completion, refunds). Authenticated by the
 *   Google-signed push JWT (GOOGLE_PLAY_RTDN_PUSH_EMAIL) or a shared token
 *   (GOOGLE_PLAY_RTDN_TOKEN as `?token=`).
 */
export function registerGooglePlayRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  const paywall = paywallConfig(env);
  const config = paywallEnabled(paywall) ? googlePlayConfig(env) : null;
  const clients = new Map(
    (config?.packageNames ?? []).map((packageName) => [
      packageName,
      createGooglePlayClient({ ...config!, packageName }),
    ]),
  );
  const signingKey = createGoogleKeySource();
  const apiUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

  const fail = (c: Context, message: string, code: ErrorCode, status: 400 | 401 | 404 | 409 | 502) =>
    c.json({ error: message, code }, status);
  const unavailable = (c: Context) =>
    fail(c, t(c)("billing.googleUnavailable"), "unavailable", 404);

  const billingDeps = () =>
    config
      ? {
          db: deps.getDb(),
          clientFor: (packageName: string) => clients.get(packageName) ?? null,
          config,
          onLedger: deps.revklik ? (orderId: string, kind: LedgerKind) => (deps.revklik as Revklik).onLedger(orderId, kind) : undefined,
          fallbackPriceIdr: {
            monthly: paywall.founderPriceIdr,
            yearly: paywall.founderYearlyPriceIdr,
          },
        }
      : null;

  app.post(GOOGLE_VERIFY_PATH, async (c) => {
    const billing = billingDeps();
    if (!billing) return unavailable(c);
    const session = await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers });
    const me = session?.user ?? null;
    if (!me) return fail(c, t(c)("billing.signInToSubscribe"), "signIn", 401);
    const body = (await c.req.json().catch(() => null)) as {
      purchaseToken?: unknown;
      packageName?: unknown;
    } | null;
    const purchaseToken = body?.purchaseToken;
    if (typeof purchaseToken !== "string" || !PURCHASE_TOKEN.test(purchaseToken)) {
      return fail(c, t(c)("billing.receiptMissing"), "invalidReceipt", 400);
    }
    // Omitted = JoyoRogo's app: the deployed apps send no package name.
    const packageName = body?.packageName ?? DEFAULT_GOOGLE_PLAY_PACKAGE;
    if (typeof packageName !== "string" || !clients.has(packageName)) {
      return fail(c, t(c)("billing.receiptInvalid"), "invalidReceipt", 400);
    }

    let result: GoogleVerifyResult;
    try {
      result = await verifyGooglePurchase(billing, { purchaseToken, userId: me.id, packageName });
    } catch (error) {
      console.error("google billing verify failed:", error);
      return fail(c, t(c)("billing.googleUnreachable"), "unreachable", 502);
    }

    if (!result.ok) {
      if (result.error === "other-account") {
        return fail(c, t(c)("billing.googleLinkedOtherAccount"), "otherAccount", 409);
      }
      if (result.error === "busy") {
        return fail(c, t(c)("billing.processing"), "processing", 409);
      }
      if (result.error === "no-user") {
        return fail(c, t(c)("billing.userNotFound"), "userNotFound", 404);
      }
      return fail(c, t(c)("billing.receiptInvalid"), "invalidReceipt", 400);
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
    if (!billing || !config) return unavailable(c);

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
    // Not ours (app that is not enabled, test ping, malformed): acknowledge so Pub/Sub stops retrying.
    if (!notification || notification.test || !clients.has(notification.packageName)) {
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
