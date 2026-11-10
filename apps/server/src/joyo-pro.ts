import type { Context, Hono } from "hono";
import { z } from "zod";

import { JOYOARTO_APPLE_BUNDLE_ID } from "@joyorogo/auth/apple-audience";
import { APPLE_ROOT_CA_G3_SHA256, appleAccountToken, verifyAppleTransactionJws } from "@joyorogo/api/lib/apple";
import { redeemAppleTransaction } from "@joyorogo/api/lib/apple-billing";
import { findJoyoUser, findOrCreateJoyoUser, joyoProStatus } from "@joyorogo/api/lib/joyo-pro";
import type { LedgerHook } from "@joyorogo/api/lib/revklik";
import type { RateLimitBinding } from "@joyorogo/api/lib/group-preview";
import { paywallConfig, paywallEnabled } from "@joyorogo/api/lib/tiers";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { eq } from "drizzle-orm";

import { sameSecret } from "./strava";

export const JOYO_PRO_STATUS_PATH = "/api/internal/joyo-pro/status";
export const JOYO_PRO_APPLE_PATH = "/api/internal/joyo-pro/apple";
export const INTERNAL_KEY_HEADER = "x-joyo-internal-key";

export type JoyoProEnv = PaywallEnv & {
  /** Shared secret of the sibling apps (JoyoArto) that ask for Joyo Pro status. Unset = the route does not exist. */
  JOYO_INTERNAL_KEY?: string;
  /** Budget of authenticated status calls (wrangler `ratelimits`); unset = no limit (self-host, tests). */
  JOYO_INTERNAL_LIMITER?: RateLimitBinding;
  /** Buyers whose Sandbox purchases get the full period (owner, review logins); see apple-billing. */
  APPLE_SANDBOX_EMAILS?: string;
};

type Deps = {
  env: JoyoProEnv;
  getDb: () => Database;
  onLedger?: LedgerHook;
  /** Tests only: the pinned root of the App Store JWS chain (default Apple Root CA - G3). */
  appleRootSha256?: string;
};

const body = z.object({
  googleSub: z.string().max(255).nullish(),
  email: z.string().max(320),
});

const appleBody = body.extend({
  /** Display name for an account created here. */
  name: z.string().max(200).nullish(),
  /** StoreKit 2 `jwsRepresentation`; absent = only the appAccountToken is wanted. */
  signedTransaction: z.string().max(20_000).nullish(),
});

/**
 * Joyo Pro status for JoyoArto (docs/joyo-pro.md). JoyoArto has its own accounts in its own D1 but signs in with the
 * same Google OAuth client, so it sends the Google account id and the email of its user and gets back whether that
 * person's JoyoRogo account has Pro. Server to server only: the shared key never reaches a browser.
 *
 * The answer is the same for "no such account" and "not Pro", so it says nothing about whether an email has a
 * JoyoRogo account beyond what the key holder could already learn. Emails are never logged (the request logger
 * prints method and path only, and this route logs nothing of the body).
 */
export function registerJoyoProRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  /** The shared key and the caller's budget; a Response when the call may not go on. */
  async function refuse(c: Context): Promise<Response | null> {
    const key = env.JOYO_INTERNAL_KEY?.trim();
    if (!key) return c.json({ error: "not_found" }, 404);
    const given = c.req.header(INTERNAL_KEY_HEADER) ?? "";
    if (!given || !(await sameSecret(given, key))) return c.json({ error: "unauthorized" }, 401);
    // One shared bucket for the caller. Not per IP: Workers calling Workers share Cloudflare's egress addresses.
    if (env.JOYO_INTERNAL_LIMITER) {
      const { success } = await env.JOYO_INTERNAL_LIMITER.limit({ key: "joyo-pro-status" });
      if (!success) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }
    return null;
  }

  app.post(JOYO_PRO_STATUS_PATH, async (c) => {
    const refused = await refuse(c);
    if (refused) return refused;
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const db = deps.getDb();
    const row = await findJoyoUser(db, parsed.data);
    const status = await joyoProStatus(db, paywallConfig(env), row);
    c.header("Cache-Control", "no-store");
    return c.json(status);
  });

  /**
   * JoyoArto's App Store purchases (JoyoArto sells Joyo Pro with its own StoreKit products, `com.joyodigitama.joyoarto.pro.*`).
   * Without `signedTransaction`: the appAccountToken JoyoArto passes to StoreKit for this person, so renewals and
   * refunds (App Store Server Notifications, `/api/billing/apple/notifications`) map to the same JoyoRogo account. With
   * it: the transaction is verified (JoyoArto's bundle only), linked and credited exactly like JoyoRogo's own
   * `/api/billing/apple`, and the person's Joyo Pro status comes back. The JoyoRogo account is found by Google id or
   * verified email, or created (findOrCreateJoyoUser): Joyo Pro is one subscription per JoyoRogo account.
   */
  app.post(JOYO_PRO_APPLE_PATH, async (c) => {
    const refused = await refuse(c);
    if (refused) return refused;
    const parsed = appleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    c.header("Cache-Control", "no-store");
    const config = paywallConfig(env);
    if (!paywallEnabled(config)) return c.json({ error: "not_found" }, 404);
    const db = deps.getDb();
    const { signedTransaction, ...who } = parsed.data;

    let transaction = null;
    if (signedTransaction) {
      const verification = await verifyAppleTransactionJws(signedTransaction, {
        rootSha256: deps.appleRootSha256 ?? APPLE_ROOT_CA_G3_SHA256,
        bundleIds: [JOYOARTO_APPLE_BUNDLE_ID],
      });
      if (!verification.ok) {
        console.error(`joyoarto apple purchase rejected: ${verification.reason}`);
        return c.json({ error: "receipt_invalid" }, 400);
      }
      transaction = verification.transaction;
    }

    const row = await findOrCreateJoyoUser(db, who);
    if (!row) return c.json({ error: "no_user" }, 404);
    if (!transaction) return c.json({ appAccountToken: await appleAccountToken(row.id) });

    const result = await redeemAppleTransaction(
      {
        db,
        onLedger: deps.onLedger,
        config: {
          sandboxAllowlist: env.APPLE_SANDBOX_EMAILS,
          fallbackPriceIdr: { monthly: config.founderPriceIdr, yearly: config.founderYearlyPriceIdr },
        },
      },
      { userId: row.id, email: who.email.trim().toLowerCase(), transaction },
    );
    if (!result.ok) {
      const status = result.error === "other-account" ? 403 : result.error === "busy" ? 409 : 400;
      return c.json({ error: result.error }, status);
    }
    const [fresh] = await db.select({ id: user.id, tier: user.tier, founderUntil: user.founderUntil }).from(user).where(eq(user.id, row.id)).limit(1);
    return c.json({
      status: result.status,
      sandbox: transaction.environment === "Sandbox" && result.status === "granted" && result.amountIdr === 0,
      joyo: await joyoProStatus(db, config, fresh),
    });
  });
}
