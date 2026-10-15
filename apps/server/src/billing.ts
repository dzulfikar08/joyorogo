import { and, desc, eq, gt, gte, like, lte, sql } from "drizzle-orm";
import type { SendEmail } from "@cloudflare/workers-types";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";

import {
  APPLE_ROOT_CA_G3_SHA256,
  DEFAULT_APPLE_BUNDLE_ID,
  DEFAULT_APPLE_FOUNDER_PRODUCT_ID,
  DEFAULT_APPLE_FOUNDER_YEARLY_PRODUCT_ID,
  DEFAULT_APPLE_SUB_MONTHLY_PRODUCT_ID,
  DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID,
  verifyAppleNotificationJws,
  verifyAppleTransactionJws,
} from "@joyorogo/api/lib/apple";
import {
  appleLedgerId,
  handleAppleNotification,
  redeemAppleTransaction,
} from "@joyorogo/api/lib/apple-billing";
import type { AppleBillingDeps } from "@joyorogo/api/lib/apple-billing";
import { summarize } from "@joyorogo/api/lib/cost";
import { googlePlayConfig } from "@joyorogo/api/lib/google-play";
import type { GooglePlayEnv } from "@joyorogo/api/lib/google-play";
import {
  WEBHOOK_TARGET as DOKU_WEBHOOK_PATH,
  buildOrderId,
  checkStatus as checkDokuStatus,
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
import {
  grandfatheredMonthlyIdr,
  ladderStep,
  nextFounderUntil,
  paywallConfig,
  paywallEnabled,
  planMonths,
  promoFor,
} from "@joyorogo/api/lib/tiers";
import type { FounderPlan, PaywallEnv } from "@joyorogo/api/lib/tiers";
import { user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";
import { runFounderEmails, sendOrderEmails } from "./email";

export type BillingEnv = PaywallEnv & GooglePlayEnv & {
  BETTER_AUTH_URL: string;
  /** Public web app origin; defaults to BETTER_AUTH_URL (single-worker deploys). */
  APP_URL?: string;
  /**
   * Default gateway for checkouts that name no payment method (older app
   * builds): "doku" or "pakasir". Empty or unconfigured = first configured, DOKU first.
   */
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
  APPLE_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
  APPLE_FOUNDER_PRODUCT_ID?: string;
  APPLE_FOUNDER_YEARLY_PRODUCT_ID?: string;
  APPLE_SANDBOX_EMAILS?: string;
  /** Transactional email (Cloudflare Email Service binding). Unset = off. */
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
  ADMIN_EMAILS?: string;
};

type Deps = {
  env: BillingEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
};

type Provider = "doku" | "pakasir";

/** Buyer-facing choice in the checkout picker; each maps to one gateway. */
type PaymentMethod = "qris" | "transfer";
const METHOD_GATEWAY: Record<PaymentMethod, Provider> = { qris: "pakasir", transfer: "doku" };
const PAYMENT_METHODS: readonly PaymentMethod[] = ["qris", "transfer"];

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

/** Gateway for checkouts without a payment method; null = checkout off. */
function defaultProvider(
  choice: string | undefined,
  configured: Record<Provider, boolean>,
): Provider | null {
  if ((choice === "doku" || choice === "pakasir") && configured[choice]) return choice;
  if (configured.doku) return "doku";
  if (configured.pakasir) return "pakasir";
  return null;
}

/**
 * Founder plan: prepaid months over DOKU Checkout or a Pakasir payment link.
 * The buyer picks QRIS (Pakasir, QR only) or bank transfer (DOKU); each
 * option exists only when its gateway is configured. Billing is live only
 * when the operator set a paywall (FREE_DAILY_SCANS) AND at least one
 * gateway's credentials; any other self-hosted setup runs without checkout
 * or upgrade prompts. Both webhooks stay mounted whenever their gateway is
 * configured, so open orders settle whichever gateway they went to.
 */
export function registerBillingRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  const config = paywallConfig(env);
  const doku = paywallEnabled(config) ? dokuConfig(env) : null;
  const pakasir = paywallEnabled(config) ? pakasirConfig(env) : null;
  const configured: Record<Provider, boolean> = { doku: doku !== null, pakasir: pakasir !== null };
  const provider = defaultProvider(env.BILLING_PROVIDER, configured);
  const paymentMethods = PAYMENT_METHODS.filter((method) => configured[METHOD_GATEWAY[method]]);
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
   * On the winning flip, receipt + admin emails are claimed and sent; the
   * caller decides how the work is scheduled (waitUntil on requests, awaited
   * in the cron).
   */
  const activateOrder = async (
    db: Database,
    order: { orderId: string; userId: string; months: number; gateway: string },
    notify: (work: Promise<void>) => void = (work) => {
      work.catch((error) => console.error(`order emails ${order.orderId}:`, error));
    },
  ): Promise<"activated" | "already" | "conflict" | "no-user"> => {
    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, order.userId))
      .limit(1);
    if (!owner) return "no-user";
    const now = new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    const until = nextFounderUntil(owner.founderUntil, now, order.months);

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
    if (flipped.length === 1) {
      notify(
        sendOrderEmails(env, db, order, { founderDailyCap: config.founderDailyCap }),
      );
      return "activated";
    }

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

  const settle = async (
    c: Context,
    db: Database,
    order: { orderId: string; userId: string; months: number },
    gateway: Provider,
  ) => {
    const result = await activateOrder(db, { ...order, gateway }, (work) =>
      c.executionCtx.waitUntil(work),
    );
    if (result === "activated") return c.json({ received: true, activated: true });
    if (result === "already") return c.json({ received: true, activated: false });
    if (result === "no-user") return c.json({ error: "user not found" }, 404);
    return c.json({ error: "concurrent update, retry" }, 409);
  };

  // Public: lets the web hide pricing and upgrade prompts on self-hosts.
  app.get("/api/config", async (c) => {
    // Urgency ladder: current rung comes from how many users have ever paid.
    const db = deps.getDb();
    const yearlyOverride = env.FOUNDER_YEARLY_PRICE_IDR?.trim()
      ? config.founderYearlyPriceIdr
      : null;
    let buyers: number | null = null;
    if (config.founderLadder !== null && provider !== null) {
      const [row] = await db
        .select({ taken: sql<number>`count(distinct ${payment.userId})` })
        .from(payment)
        .where(eq(payment.status, "paid"));
      buyers = row?.taken ?? 0;
    }
    const step = config.founderLadder && buyers !== null ? ladderStep(config.founderLadder, buyers) : null;
    const promo = config.founderLadder && buyers !== null ? promoFor(config.founderLadder, buyers) : null;
    return c.json({
      paywall: paywallEnabled(config),
      billing: provider !== null,
      // Options for the checkout picker, in display order.
      paymentMethods,
      appleBilling: paywallEnabled(config),
      // Google Play Billing for the Play build: needs the paywall and the Play service account.
      googlePlayBilling: paywallEnabled(config) && googlePlayConfig(env) !== null,
      freeDailyScans: config.freeDailyScans,
      founderDailyCap: config.founderDailyCap,
      founderPriceIdr: step ? step.monthlyIdr : config.founderPriceIdr,
      founderYearlyPriceIdr: step
        ? (yearlyOverride ?? step.monthlyIdr * 10)
        : config.founderYearlyPriceIdr,
      promo,
      anonScans: config.anonScans,
    });
  });

  // Body (optional JSON): { plan: "monthly" | "yearly"; method?: "qris" | "transfer" }.
  // Default monthly; no method = the default gateway's full page (older apps).
  app.post("/api/billing/checkout", async (c) => {
    if (!provider) return c.json({ error: "Pembayaran tidak tersedia di server ini." }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu untuk berlangganan." }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      plan?: unknown;
      method?: unknown;
    } | null;
    const plan: FounderPlan = body?.plan === "yearly" ? "yearly" : "monthly";
    const method = PAYMENT_METHODS.find((m) => m === body?.method) ?? null;
    const gateway = method ? METHOD_GATEWAY[method] : provider;
    if (!configured[gateway]) {
      return c.json({ error: "Metode pembayaran ini tidak tersedia." }, 400);
    }
    const months = planMonths(plan);
    const db = deps.getDb();

    // Urgency ladder price for this buyer, then grandfathering: anyone who
    // has paid before renews at their lowest monthly-equivalent price when
    // that beats the current rung ("harga terkunci").
    let basePriceIdr: number;
    if (config.founderLadder) {
      const [[row], paid] = await Promise.all([
        db
          .select({ taken: sql<number>`count(distinct ${payment.userId})` })
          .from(payment)
          .where(and(eq(payment.status, "paid"), gt(payment.amountIdr, 0))),
        db
          .select({ amountIdr: payment.amountIdr, months: payment.months })
          .from(payment)
          .where(and(eq(payment.userId, me.id), eq(payment.status, "paid"), gt(payment.amountIdr, 0))),
      ]);
      const step = ladderStep(config.founderLadder, row?.taken ?? 0);
      const locked = grandfatheredMonthlyIdr(paid);
      basePriceIdr =
        locked !== null && locked < step.monthlyIdr ? Math.round(locked) : step.monthlyIdr;
    } else {
      basePriceIdr = config.founderPriceIdr;
    }
    const amountIdr = plan === "yearly" ? basePriceIdr * 10 : basePriceIdr;

    const orderId = buildOrderId();
    const returnUrl = `${appUrl}/pembayaran?order=${encodeURIComponent(orderId)}`;
    await db.insert(payment).values({ orderId, userId: me.id, amountIdr, months });
    try {
      const { paymentUrl } =
        gateway === "pakasir"
          ? await createPaymentLink(pakasir as PakasirConfig, {
              orderId,
              amountIdr,
              redirectUrl: returnUrl,
              qrisOnly: method === "qris",
            })
          : await createCheckout(doku as DokuConfig, {
              orderId,
              amountIdr,
              itemName: plan === "yearly" ? "JoyoRogo Pro 1 tahun" : "JoyoRogo Pro 1 bulan",
              customerEmail: me.email,
              customerName: me.name,
              notifyUrl: `${apiUrl}${DOKU_WEBHOOK_PATH}`,
              returnUrl,
            });
      await db.update(payment).set({ paymentUrl }).where(eq(payment.orderId, orderId));
      return c.json({ orderId, paymentUrl });
    } catch (error) {
      console.error(`${gateway} checkout ${orderId} failed:`, error);
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
    return settle(c, db, order, "doku");
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
    return settle(c, db, order, "pakasir");
  });

  const appleProductConfig = () => ({
    subscriptionIds: {
      monthly: DEFAULT_APPLE_SUB_MONTHLY_PRODUCT_ID,
      yearly: DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID,
    },
    legacyIds: {
      monthly: env.APPLE_FOUNDER_PRODUCT_ID || DEFAULT_APPLE_FOUNDER_PRODUCT_ID,
      yearly: env.APPLE_FOUNDER_YEARLY_PRODUCT_ID || DEFAULT_APPLE_FOUNDER_YEARLY_PRODUCT_ID,
    },
  });
  const appleProductIds = () => {
    const { subscriptionIds, legacyIds } = appleProductConfig();
    return [
      subscriptionIds.monthly,
      subscriptionIds.yearly,
      legacyIds.monthly,
      legacyIds.yearly,
    ];
  };
  const appleBillingDeps = (db: Database): AppleBillingDeps => ({
    db,
    config: {
      ...appleProductConfig(),
      sandboxAllowlist: env.APPLE_SANDBOX_EMAILS,
      fallbackPriceIdr: {
        monthly: config.founderPriceIdr,
        yearly: config.founderYearlyPriceIdr,
      },
    },
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

    const billing = appleBillingDeps(deps.getDb());
    const verification = await verifyAppleTransactionJws(body.signedTransaction, {
      rootSha256: APPLE_ROOT_CA_G3_SHA256,
      bundleId: env.APPLE_BUNDLE_ID || DEFAULT_APPLE_BUNDLE_ID,
      productIds: appleProductIds(),
    });
    if (!verification.ok) {
      console.error(`apple billing rejected: ${verification.reason}`);
      return c.json({ error: "Bukti pembelian tidak valid." }, 400);
    }
    const transaction = verification.transaction;

    // TestFlight and App Review purchases are Sandbox with unknown buyer
    // emails (often Apple private relay). Allowlisted buyers (owner, review
    // demo) get the full period; any other Sandbox buyer gets one day at zero
    // revenue (appleFounderGrant / appleSubscriptionGrant), so review works
    // without free months. Subscriptions are credited up to the store's own
    // expiresDate and linked to the account by originalTransactionId.
    const result = await redeemAppleTransaction(billing, {
      userId: me.id,
      email: me.email,
      transaction,
    });
    if (!result.ok) {
      if (result.error === "other-account") {
        return c.json({ error: "Langganan ini sudah terhubung ke akun JoyoRogo lain." }, 403);
      }
      if (result.error === "no-user") return c.json({ error: "Pengguna tidak ditemukan." }, 404);
      if (result.error === "wrong-product") {
        return c.json({ error: "Bukti pembelian tidak valid." }, 400);
      }
      return c.json({ error: "Pembayaran masih diproses. Coba lagi sebentar." }, 409);
    }
    if (result.status === "granted") {
      // The one-day sandbox trial is not a sale: no receipt, no admin alert.
      if (result.amountIdr > 0) {
        const orderId = appleLedgerId(transaction.transactionId);
        c.executionCtx.waitUntil(
          sendOrderEmails(
            env,
            billing.db,
            { orderId, userId: me.id, gateway: "apple" },
            { founderDailyCap: config.founderDailyCap },
          ).catch((error: unknown) => console.error(`order emails ${orderId}:`, error)),
        );
      }
      return c.json({ activated: true, founderUntil: result.founderUntil });
    }
    return c.json({ activated: false, founderUntil: result.founderUntil });
  });

  // App Store Server Notifications V2. Set this URL as both the Production and
  // Sandbox Server URL in App Store Connect (App Information). Trust comes from
  // the signed payload's JWS chain, like the purchase route. Verified
  // notifications always answer 200 (unmapped ones are logged); a failed
  // signature is 400; a D1 failure is 500 so Apple redelivers.
  app.post("/api/billing/apple/notifications", async (c) => {
    if (!paywallEnabled(config)) {
      return c.json({ error: "Pembayaran tidak tersedia di server ini." }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as { signedPayload?: string } | null;
    if (typeof body?.signedPayload !== "string" || !body.signedPayload) {
      return c.json({ error: "signedPayload tidak ada." }, 400);
    }
    const verification = await verifyAppleNotificationJws(body.signedPayload, {
      rootSha256: APPLE_ROOT_CA_G3_SHA256,
      bundleId: env.APPLE_BUNDLE_ID || DEFAULT_APPLE_BUNDLE_ID,
      productIds: appleProductIds(),
    });
    if (!verification.ok) {
      console.error(`apple notification rejected: ${verification.reason}`);
      return c.json({ error: "signedPayload tidak valid." }, 400);
    }
    const billing = appleBillingDeps(deps.getDb());
    try {
      const result = await handleAppleNotification(billing, verification.notification);
      if (result.granted && result.granted.amountIdr > 0) {
        const { granted } = result;
        c.executionCtx.waitUntil(
          sendOrderEmails(
            env,
            billing.db,
            { orderId: granted.orderId, userId: granted.userId, gateway: "apple" },
            { founderDailyCap: config.founderDailyCap },
          ).catch((error: unknown) => console.error(`order emails ${granted.orderId}:`, error)),
        );
      }
      return c.json({ received: true });
    } catch (error) {
      console.error("apple notification failed:", error);
      return c.json({ error: "retry" }, 500);
    }
  });

  /**
   * Ask the gateway directly whether a pending order was paid and settle it
   * if so. Covers a webhook that is missing or misconfigured. Pakasir orders
   * are recognised by their payment link (which carries the txn id).
   * Returns a short outcome for the admin page and logs.
   */
  const reconcileOrder = async (
    db: Database,
    order: {
      orderId: string;
      userId: string;
      amountIdr: number;
      status: string;
      paymentUrl: string | null;
      months: number;
    },
    notify?: (work: Promise<void>) => void,
  ): Promise<string> => {
    if (order.status !== "pending") return `already ${order.status}`;
    const pakasirTxn = order.paymentUrl?.match(/app\.pakasir\.com\/pay-v2\/([^/?#]+)/)?.[1];
    const gateway: Provider = pakasirTxn ? "pakasir" : "doku";
    let paidAmount: number;
    try {
      if (pakasirTxn) {
        if (!pakasir) return "pakasir not configured";
        const txn = await fetchTransaction(pakasir, pakasirTxn);
        if (txn.orderId !== order.orderId) return "pakasir order mismatch";
        if (pakasirFailed(txn)) {
          await markFailed(db, order.orderId);
          return "pakasir canceled -> failed";
        }
        if (txn.isSandbox && !pakasir.allowSandbox) return "pakasir sandbox ignored";
        if (!pakasirPaid(txn)) return `pakasir ${txn.status}`;
        paidAmount = txn.amount;
      } else {
        if (!doku) return "doku not configured";
        const n = await checkDokuStatus(doku, order.orderId);
        // EXPIRED is final; FAILED is not (the buyer may retry on the same order).
        if (n.status === "EXPIRED") {
          await markFailed(db, order.orderId);
          return "doku EXPIRED -> failed";
        }
        if (!dokuPaid(n)) return `doku ${n.status}`;
        paidAmount = n.amount;
      }
    } catch (error) {
      // DOKU answers Not Found until the buyer picks a payment channel.
      console.error(`reconcile ${order.orderId}:`, error);
      return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (Math.round(paidAmount) !== order.amountIdr) {
      console.error(`reconcile ${order.orderId}: amount mismatch ${paidAmount}`);
      return `amount mismatch (${paidAmount})`;
    }
    return `paid: ${await activateOrder(db, { ...order, gateway }, notify)}`;
  };

  const ownOrder = (orderId: string, userId: string) =>
    deps
      .getDb()
      .select({
        orderId: payment.orderId,
        status: payment.status,
        amountIdr: payment.amountIdr,
        founderUntil: payment.founderUntil,
      })
      .from(payment)
      .where(and(eq(payment.orderId, orderId), eq(payment.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]);

  // Return page polls this until the webhook lands.
  app.get("/api/billing/orders/:orderId", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu." }, 401);
    const order = await ownOrder(c.req.param("orderId"), me.id);
    if (!order) return c.json({ error: "Pesanan tidak ditemukan." }, 404);
    return c.json(order);
  });

  // "Cek pembayaran": the buyer asks us to verify with the gateway now.
  app.post("/api/billing/orders/:orderId/check", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu." }, 401);
    const db = deps.getDb();
    const order = await findOrder(db, c.req.param("orderId"));
    if (!order || order.userId !== me.id) return c.json({ error: "Pesanan tidak ditemukan." }, 404);
    await reconcileOrder(db, order, (work) => c.executionCtx.waitUntil(work));
    return c.json(await ownOrder(order.orderId, me.id));
  });

  // Latest pending order of the caller, so profile can offer "Cek pembayaran".
  app.get("/api/billing/orders", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu." }, 401);
    const [latest] = await deps
      .getDb()
      .select({ orderId: payment.orderId, status: payment.status, createdAt: payment.createdAt })
      .from(payment)
      .where(and(eq(payment.userId, me.id), eq(payment.status, "pending")))
      .orderBy(desc(payment.createdAt))
      .limit(1);
    return c.json({ pending: latest ?? null });
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

  /** Cron: settle pending orders from the last 2 days whose webhook never came. */
  const reconcilePending = async (): Promise<void> => {
    const db = deps.getDb();
    const now = Date.now();
    const rows = await db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.status, "pending"),
          gte(payment.createdAt, new Date(now - 2 * 24 * 60 * 60 * 1000)),
          // DOKU asks for check-status calls at least 60 s after payment.
          lte(payment.createdAt, new Date(now - 60 * 1000)),
          like(payment.orderId, "JRG-%"),
        ),
      )
      .orderBy(desc(payment.createdAt))
      .limit(25);
    // Cron has no request context: collect activation emails and await them
    // sequentially so the scheduled handler doesn't drop them.
    const emails: Promise<void>[] = [];
    for (const order of rows) {
      console.log(
        `reconcile ${order.orderId}: ${await reconcileOrder(db, order, (work) => {
          emails.push(work);
        })}`,
      );
    }
    for (const work of emails) await work;
  };

  /** Cron: founder expiry + expired reminder emails (bounded, deduped). */
  const runEmails = (): Promise<void> => runFounderEmails(env, deps.getDb());

  /** Admin: verify one order with its gateway now. */
  const reconcileById = async (orderId: string): Promise<string> => {
    const db = deps.getDb();
    const order = await findOrder(db, orderId);
    return order ? reconcileOrder(db, order) : "order not found";
  };
  return { reconcilePending, reconcileById, runEmails };
}
