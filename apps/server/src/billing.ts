import { and, eq, gte, sql } from "drizzle-orm";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";

import {
  APPLE_ROOT_CA_G3_SHA256,
  DEFAULT_APPLE_BUNDLE_ID,
  DEFAULT_APPLE_FOUNDER_PRODUCT_ID,
  verifyAppleTransactionJws,
} from "@joyorogo/api/lib/apple";
import { summarize } from "@joyorogo/api/lib/cost";
import {
  WEBHOOK_TARGET as DOKU_WEBHOOK_PATH,
  buildOrderId,
  createCheckout,
  isFailed as dokuFailed,
  isOrderId,
  isPaid as dokuPaid,
  parseNotification,
  verifySignature,
} from "@joyorogo/api/lib/doku";
import type { DokuConfig } from "@joyorogo/api/lib/doku";
import {
  WEBHOOK_PATH as PAKASIR_WEBHOOK_PATH,
  createPaymentLink,
  fetchTransaction,
  isFailed as pakasirFailed,
  isPaid as pakasirPaid,
  parseTransaction,
  secretMatches,
} from "@joyorogo/api/lib/pakasir";
import type { PakasirConfig } from "@joyorogo/api/lib/pakasir";
import { nextFounderUntil, paywallConfig, paywallEnabled } from "@joyorogo/api/lib/tiers";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import { user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";

export type BillingEnv = PaywallEnv & {
  BETTER_AUTH_URL: string;
  /** Public web app origin; defaults to BETTER_AUTH_URL (single-worker deploys). */
  APP_URL?: string;
  /** Gateway for new checkouts: "doku" or "pakasir". Empty = first configured, DOKU first. */
  BILLING_PROVIDER?: string;
  DOKU_CLIENT_ID?: string;
  DOKU_SECRET_KEY?: string;
  DOKU_BASE_URL?: string;
  PAKASIR_SLUG?: string;
  PAKASIR_API_KEY?: string;
  PAKASIR_WEBHOOK_SECRET?: string;
  /** "1" lets Pakasir sandbox-mode payments credit Founder (testing only). */
  PAKASIR_SANDBOX?: string;
  APPLE_BUNDLE_ID?: string;
  APPLE_FOUNDER_PRODUCT_ID?: string;
  APPLE_SANDBOX_EMAILS?: string;
};

type Deps = {
  env: BillingEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
};

type Provider = "doku" | "pakasir";

const SUMMARY_WINDOW_DAYS = 30;
const DOKU_PRODUCTION = "https://api.doku.com";

function dokuConfig(env: BillingEnv): DokuConfig | null {
  if (!env.DOKU_CLIENT_ID || !env.DOKU_SECRET_KEY) return null;
  return {
    clientId: env.DOKU_CLIENT_ID,
    secretKey: env.DOKU_SECRET_KEY,
    baseUrl: env.DOKU_BASE_URL || DOKU_PRODUCTION,
  };
}

function pakasirConfig(env: BillingEnv): PakasirConfig | null {
  if (!env.PAKASIR_SLUG || !env.PAKASIR_API_KEY || !env.PAKASIR_WEBHOOK_SECRET) return null;
  return {
    slug: env.PAKASIR_SLUG,
    apiKey: env.PAKASIR_API_KEY,
    webhookSecret: env.PAKASIR_WEBHOOK_SECRET,
    allowSandbox: env.PAKASIR_SANDBOX === "1",
  };
}

/** Gateway new checkouts go to; null = checkout off. */
function checkoutProvider(
  choice: string | undefined,
  configured: Record<Provider, boolean>,
): Provider | null {
  if (choice === "doku" || choice === "pakasir") return configured[choice] ? choice : null;
  if (configured.doku) return "doku";
  if (configured.pakasir) return "pakasir";
  return null;
}

/**
 * Founder plan: prepaid months over DOKU Checkout or a Pakasir payment link.
 * Billing is live only when the operator set a paywall (FREE_DAILY_SCANS) AND
 * the chosen gateway's credentials; any other self-hosted setup runs without
 * checkout or upgrade prompts. Both webhooks stay mounted whenever their
 * gateway is configured, so orders opened before a BILLING_PROVIDER switch
 * still settle.
 */
export function registerBillingRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  const config = paywallConfig(env);
  const doku = paywallEnabled(config) ? dokuConfig(env) : null;
  const pakasir = paywallEnabled(config) ? pakasirConfig(env) : null;
  const provider = checkoutProvider(env.BILLING_PROVIDER, {
    doku: doku !== null,
    pakasir: pakasir !== null,
  });
  const appUrl = (env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "");
  const apiUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

  const sessionUser = async (headers: Headers) =>
    (await (await deps.createAuth()).api.getSession({ headers }))?.user ?? null;

  /**
   * Flip a pending order to paid and extend the owner's Founder period, in
   * one D1 batch. The flip only lands while the order is pending AND
   * founder_until still holds the value we extended from, so duplicate
   * notifications extend once and two concurrent payments can't both stack
   * on the same base (the loser gets "conflict" and the gateway retries).
   */
  const activateOrder = async (
    db: Database,
    order: { orderId: string; userId: string },
  ): Promise<"activated" | "already" | "conflict" | "no-user"> => {
    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, order.userId))
      .limit(1);
    if (!owner) return "no-user";
    const now = new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    const until = nextFounderUntil(owner.founderUntil, now);

    const [flipped] = await db.batch([
      db
        .update(payment)
        .set({ status: "paid", paidAt: now, founderUntil: until })
        .where(
          and(
            eq(payment.orderId, order.orderId),
            eq(payment.status, "pending"),
            sql`(select ${user.founderUntil} from ${user} where ${user.id} = ${order.userId}) is ${previousMs}`,
          ),
        )
        .returning({ orderId: payment.orderId }),
      db
        .update(user)
        .set({ founderUntil: until })
        .where(
          and(
            eq(user.id, order.userId),
            sql`exists (select 1 from ${payment} where ${payment.orderId} = ${order.orderId} and ${payment.status} = 'paid' and ${payment.paidAt} = ${now.getTime()})`,
          ),
        ),
    ]);
    if (flipped.length === 1) return "activated";

    const [again] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, order.orderId))
      .limit(1);
    return again?.status === "paid" ? "already" : "conflict";
  };

  const markFailed = (db: Database, orderId: string) =>
    db
      .update(payment)
      .set({ status: "failed" })
      .where(and(eq(payment.orderId, orderId), eq(payment.status, "pending")));

  const findOrder = async (db: Database, orderId: string) =>
    (await db.select().from(payment).where(eq(payment.orderId, orderId)).limit(1))[0];

  const settle = async (c: Context, db: Database, order: { orderId: string; userId: string }) => {
    const result = await activateOrder(db, order);
    if (result === "activated") return c.json({ received: true, activated: true });
    if (result === "already") return c.json({ received: true, activated: false });
    if (result === "no-user") return c.json({ error: "user not found" }, 404);
    return c.json({ error: "concurrent update, retry" }, 409);
  };

  // Public: lets the web hide pricing and upgrade prompts on self-hosts.
  app.get("/api/config", (c) =>
    c.json({
      paywall: paywallEnabled(config),
      billing: provider !== null,
      // iOS pays through Apple in-app purchase; gateway credentials irrelevant.
      appleBilling: paywallEnabled(config),
      freeDailyScans: config.freeDailyScans,
      founderDailyCap: config.founderDailyCap,
      founderPriceIdr: config.founderPriceIdr,
      anonScans: config.anonScans,
    }),
  );

  app.post("/api/billing/checkout", async (c) => {
    if (!provider) return c.json({ error: "Pembayaran tidak tersedia di server ini." }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu untuk berlangganan." }, 401);

    const orderId = buildOrderId();
    const returnUrl = `${appUrl}/pembayaran?order=${encodeURIComponent(orderId)}`;
    const db = deps.getDb();
    await db.insert(payment).values({ orderId, userId: me.id, amountIdr: config.founderPriceIdr });
    try {
      const { paymentUrl } =
        provider === "pakasir" && pakasir
          ? await createPaymentLink(pakasir, {
              orderId,
              amountIdr: config.founderPriceIdr,
              redirectUrl: returnUrl,
            })
          : await createCheckout(doku as DokuConfig, {
              orderId,
              amountIdr: config.founderPriceIdr,
              itemName: "JoyoRogo Founder 1 bulan",
              customerEmail: me.email,
              customerName: me.name,
              notifyUrl: `${apiUrl}${DOKU_WEBHOOK_PATH}`,
              returnUrl,
            });
      await db.update(payment).set({ paymentUrl }).where(eq(payment.orderId, orderId));
      return c.json({ orderId, paymentUrl });
    } catch (error) {
      console.error(`${provider} checkout ${orderId} failed:`, error);
      await db.update(payment).set({ status: "failed" }).where(eq(payment.orderId, orderId));
      return c.json({ error: "Halaman pembayaran gagal dibuat. Coba lagi sebentar lagi." }, 502);
    }
  });

  // DOKU payment notification. Public; trust comes from the signature only.
  app.post(DOKU_WEBHOOK_PATH, async (c) => {
    if (!doku) return c.json({ error: "billing disabled" }, 404);
    const raw = await c.req.text();
    const clientId = c.req.header("Client-Id") ?? "";
    const valid =
      clientId === doku.clientId &&
      (await verifySignature(
        {
          clientId,
          requestId: c.req.header("Request-Id") ?? "",
          timestamp: c.req.header("Request-Timestamp") ?? "",
          target: DOKU_WEBHOOK_PATH,
          body: raw,
        },
        c.req.header("Signature") ?? "",
        doku.secretKey,
      ));
    if (!valid) return c.json({ error: "invalid signature" }, 401);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const n = parseNotification(parsed);
    if (!n || !isOrderId(n.invoiceNumber)) return c.json({ error: "invalid notification" }, 400);

    const db = deps.getDb();
    const order = await findOrder(db, n.invoiceNumber);
    if (!order) return c.json({ error: "order not found" }, 404);

    if (dokuFailed(n)) {
      await markFailed(db, order.orderId);
      return c.json({ received: true });
    }
    if (!dokuPaid(n)) return c.json({ received: true });
    if (order.status === "paid") return c.json({ received: true, activated: false });
    if (Math.round(n.amount) !== order.amountIdr) {
      return c.json({ error: "amount mismatch" }, 400);
    }
    return settle(c, db, order);
  });

  // Pakasir success webhook. Public; the X-Secret header gates it, and the
  // status API (keyed by our API key) is the source of truth for what was paid.
  app.post(PAKASIR_WEBHOOK_PATH, async (c) => {
    if (!pakasir) return c.json({ error: "billing disabled" }, 404);
    if (!secretMatches(c.req.header("X-Secret") ?? "", pakasir.webhookSecret)) {
      return c.json({ error: "invalid secret" }, 401);
    }
    const hook = parseTransaction(await c.req.json().catch(() => null));
    if (!hook || !isOrderId(hook.orderId)) return c.json({ error: "invalid notification" }, 400);

    let txn;
    try {
      txn = await fetchTransaction(pakasir, hook.txnId);
    } catch (error) {
      console.error(`pakasir status ${hook.txnId} failed:`, error);
      return c.json({ error: "status check failed" }, 502);
    }
    if (txn.orderId !== hook.orderId) return c.json({ error: "order mismatch" }, 400);

    const db = deps.getDb();
    const order = await findOrder(db, txn.orderId);
    if (!order) return c.json({ error: "order not found" }, 404);

    if (pakasirFailed(txn)) {
      await markFailed(db, order.orderId);
      return c.json({ received: true });
    }
    if (!pakasirPaid(txn)) return c.json({ received: true });
    if (txn.isSandbox && !pakasir.allowSandbox) {
      console.error(`pakasir ${txn.orderId}: sandbox payment ignored (PAKASIR_SANDBOX off)`);
      return c.json({ received: true, activated: false });
    }
    if (order.status === "paid") return c.json({ received: true, activated: false });
    if (Math.round(txn.amount) !== order.amountIdr) {
      return c.json({ error: "amount mismatch" }, 400);
    }
    return settle(c, db, order);
  });

  // StoreKit 2 purchase from the iOS app. Trust comes from the JWS chain
  // (pinned Apple Root CA - G3); no DOKU credentials involved, so the gate is
  // the paywall alone and an iOS-only self-host works.
  app.post("/api/billing/apple", async (c) => {
    if (!paywallEnabled(config)) {
      return c.json({ error: "Pembayaran tidak tersedia di server ini." }, 404);
    }
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu untuk berlangganan." }, 401);
    const body = (await c.req.json().catch(() => null)) as { signedTransaction?: string } | null;
    if (typeof body?.signedTransaction !== "string" || !body.signedTransaction) {
      return c.json({ error: "Bukti pembelian tidak ada." }, 400);
    }

    const verification = await verifyAppleTransactionJws(body.signedTransaction, {
      rootSha256: APPLE_ROOT_CA_G3_SHA256,
      bundleId: env.APPLE_BUNDLE_ID || DEFAULT_APPLE_BUNDLE_ID,
      productId: env.APPLE_FOUNDER_PRODUCT_ID || DEFAULT_APPLE_FOUNDER_PRODUCT_ID,
    });
    if (!verification.ok) {
      console.error(`apple billing rejected: ${verification.reason}`);
      return c.json({ error: "Bukti pembelian tidak valid." }, 400);
    }
    const transaction = verification.transaction;

    // TestFlight and App Review purchases are Sandbox; only allowlisted
    // accounts (owner, review demo) may credit them, or a production server
    // would hand out free Founder months.
    const sandboxEmails = (env.APPLE_SANDBOX_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (transaction.environment === "Sandbox" && !sandboxEmails.includes(me.email.toLowerCase())) {
      console.error("apple billing rejected: sandbox buyer not allowlisted");
      return c.json({ error: "Akun ini tidak bisa memakai pembelian sandbox." }, 400);
    }

    const orderId = `apple:${transaction.transactionId}`;
    const amountIdr = transaction.priceIdr ?? config.founderPriceIdr;

    const db = deps.getDb();
    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, me.id))
      .limit(1);
    if (!owner) return c.json({ error: "Pengguna tidak ditemukan." }, 404);
    const [existing] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .limit(1);
    if (existing?.status === "paid") {
      return c.json({ activated: false, founderUntil: owner.founderUntil });
    }

    const now = new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    const until = nextFounderUntil(owner.founderUntil, now);

    // One D1 batch. The pending row records the order; the paid flip only
    // lands while founder_until still holds the value we extended from, so a
    // replayed JWS or two concurrent purchases extend exactly once. The user
    // update rides on the flip (a paid row stamped with this batch's time).
    await db.insert(payment).values({ orderId, userId: me.id, amountIdr }).onConflictDoNothing();
    const [flipped] = await db.batch([
      db
        .update(payment)
        .set({ status: "paid", paidAt: now, founderUntil: until })
        .where(
          and(
            eq(payment.orderId, orderId),
            eq(payment.status, "pending"),
            sql`(select ${user.founderUntil} from ${user} where ${user.id} = ${me.id}) is ${previousMs}`,
          ),
        )
        .returning({ orderId: payment.orderId }),
      db
        .update(user)
        .set({ founderUntil: until })
        .where(
          and(
            eq(user.id, me.id),
            sql`exists (select 1 from ${payment} where ${payment.orderId} = ${orderId} and ${payment.status} = 'paid' and ${payment.paidAt} = ${now.getTime()})`,
          ),
        ),
    ]);
    if (flipped.length === 1) return c.json({ activated: true, founderUntil: until });

    // Lost a race: either this transaction already paid (replay) or another
    // purchase flipped founder_until first; the client retries the replay.
    const [again] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .limit(1);
    if (again?.status === "paid") {
      const [current] = await db
        .select({ founderUntil: user.founderUntil })
        .from(user)
        .where(eq(user.id, me.id))
        .limit(1);
      return c.json({ activated: false, founderUntil: current?.founderUntil ?? null });
    }
    return c.json({ error: "Pembayaran masih diproses. Coba lagi sebentar." }, 409);
  });

  // Return page polls this until the webhook lands.
  app.get("/api/billing/orders/:orderId", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu." }, 401);
    const [order] = await deps
      .getDb()
      .select({
        orderId: payment.orderId,
        status: payment.status,
        amountIdr: payment.amountIdr,
        founderUntil: payment.founderUntil,
      })
      .from(payment)
      .where(and(eq(payment.orderId, c.req.param("orderId")), eq(payment.userId, me.id)))
      .limit(1);
    if (!order) return c.json({ error: "Pesanan tidak ditemukan." }, 404);
    return c.json(order);
  });

  // Caller's own AI cost summary; no admin surface on purpose.
  app.get("/api/ai/my-usage", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) {
      return c.json({ error: "Masuk dulu untuk melihat pemakaian AI-mu." }, 401);
    }
    const since = new Date(Date.now() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await deps
      .getDb()
      .select({ model: aiUsage.model, latencyMs: aiUsage.latencyMs })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, me.id), gte(aiUsage.createdAt, since)));
    return c.json(summarize(rows));
  });
}
