import { and, desc, eq, gt, gte, inArray, like, lte, sql } from "drizzle-orm";
import type { SendEmail } from "@cloudflare/workers-types";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";

import {
  APPLE_ROOT_CA_G3_SHA256,
  DEFAULT_APPLE_BUNDLE_ID,
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
import { serverT } from "@joyorogo/api/lib/messages";
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
  WEBHOOK_PATH as POLAR_WEBHOOK_PATH,
  createCheckout as createPolarCheckout,
  createPortalSession,
  polarConfig,
  verifyWebhook,
} from "@joyorogo/api/lib/polar";
import type { PolarEnv } from "@joyorogo/api/lib/polar";
import { processPolarEvent } from "@joyorogo/api/lib/polar-billing";
import {
  checkoutAmountIdr,
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
import { payment, polarSubscription } from "@joyorogo/db/schema/billing";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";
import { appVersionConfig } from "./app-version";
import type { AppVersionEnv } from "./app-version";
import { requestLocale, requestRegion } from "./context";
import { runFounderEmails, sendOrderEmails } from "./email";
import { INTERNAL_EMAILS } from "./internal-accounts";

export type BillingEnv = PaywallEnv & GooglePlayEnv & PolarEnv & AppVersionEnv & {
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
  APPLE_SANDBOX_EMAILS?: string;
  /** Review/QA logins (comma separated): never told a purchase was a sandbox test. */
  REVIEW_LOGIN_EMAILS?: string;
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
  /** Called (inside waitUntil) after a zero-revenue Sandbox grant: TestFlight buyers get a notice mail. */
  onSandboxGrant?: (userId: string) => Promise<void>;
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

/** User-facing text of a billing response, in the language the request asks for. */
const t = (c: Context) => serverT(requestLocale(c), "errors");

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
  // Polar (USD, merchant of record): web only, never advertised to the store builds.
  const polar = paywallEnabled(config) ? polarConfig(env) : null;
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

  // Ladder rung = distinct users with a real (non-zero) paid order. Zero-amount
  // rows are sandbox/test grants and never take a seat.
  const ladderBuyers = async (db: Database) => {
    const [row] = await db
      .select({ taken: sql<number>`count(distinct ${payment.userId})` })
      .from(payment)
      .where(and(eq(payment.status, "paid"), gt(payment.amountIdr, 0)));
    return row?.taken ?? 0;
  };

  // Public: lets the web hide pricing and upgrade prompts on self-hosts.
  app.get("/api/config", async (c) => {
    const db = deps.getDb();
    // The answer depends on the visitor's country: never share it between visitors.
    c.header("Cache-Control", "private, no-store");
    const cfCountry = c.req.header("CF-IPCountry")?.toUpperCase() ?? "";
    // "XX" = unknown, "T1" = Tor: neither says the visitor is outside Indonesia.
    const country = /^[A-Z]{2}$/.test(cfCountry) && cfCountry !== "XX" ? cfCountry : null;
    let buyers: number | null = null;
    if (config.founderLadder !== null && provider !== null) buyers = await ladderBuyers(db);
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
      founderYearlyPriceIdr: step ? step.yearlyIdr : config.founderYearlyPriceIdr,
      promo,
      anonScans: config.anonScans,
      // Native update gate: no login needed, so a signed-out user is gated too.
      app: appVersionConfig(env),
      // USD option (Polar): prices in cents; `preferred` = the visitor's Cloudflare country is known and not Indonesia.
      usd: polar
        ? {
            monthlyCents: polar.priceUsdCents.monthly,
            yearlyCents: polar.priceUsdCents.yearly,
            preferred: country !== null && country !== "ID",
            country,
          }
        : null,
      // Ringgit prices of the same Polar plans (sen), only when both are configured; the web shows them to Malaysian visitors.
      myr: polar?.priceMyrSen
        ? { monthlySen: polar.priceMyrSen.monthly, yearlySen: polar.priceMyrSen.yearly, country }
        : null,
      // Singapore dollar prices of the same Polar plans (cents), same rule as `myr`.
      sgd: polar?.priceSgdCents
        ? { monthlyCents: polar.priceSgdCents.monthly, yearlyCents: polar.priceSgdCents.yearly, country }
        : null,
      // The visitor's market (UI language, then country): clients pick local dish names and the equivalence line from it.
      region: requestRegion(c),
    });
  });

  // Body (optional JSON): { plan: "monthly" | "yearly"; method?: "qris" | "transfer" }.
  // Default monthly; no method = the default gateway's full page (older apps).
  app.post("/api/billing/checkout", async (c) => {
    if (!provider) return c.json({ error: t(c)("billing.unavailable") }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signInToSubscribe") }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      plan?: unknown;
      method?: unknown;
    } | null;
    const plan: FounderPlan = body?.plan === "yearly" ? "yearly" : "monthly";
    const method = PAYMENT_METHODS.find((m) => m === body?.method) ?? null;
    const gateway = method ? METHOD_GATEWAY[method] : provider;
    if (!configured[gateway]) {
      return c.json({ error: t(c)("billing.methodUnavailable") }, 400);
    }
    const months = planMonths(plan);
    const db = deps.getDb();

    // Urgency ladder price for this buyer, then grandfathering: anyone who
    // has paid before renews at their lowest monthly-equivalent price when
    // that beats the current rung ("harga terkunci").
    let amountIdr: number;
    if (config.founderLadder) {
      const [taken, paid] = await Promise.all([
        ladderBuyers(db),
        db
          .select({ amountIdr: payment.amountIdr, months: payment.months })
          .from(payment)
          .where(and(eq(payment.userId, me.id), eq(payment.status, "paid"), gt(payment.amountIdr, 0))),
      ]);
      amountIdr = checkoutAmountIdr(
        ladderStep(config.founderLadder, taken),
        plan,
        grandfatheredMonthlyIdr(paid),
      );
    } else {
      amountIdr = plan === "yearly" ? config.founderYearlyPriceIdr : config.founderPriceIdr;
    }

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
      return c.json({ error: t(c)("billing.checkoutFailed") }, 502);
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

  // Polar checkout for the signed-in user. Body: { plan: "monthly" | "yearly" }.
  // external_customer_id = user id, so webhooks and the portal find the account.
  app.post("/api/billing/polar/checkout", async (c) => {
    if (!polar) return c.json({ error: "USD checkout is not available." }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signInToSubscribe") }, 401);
    const body = (await c.req.json().catch(() => null)) as { plan?: unknown } | null;
    const plan: FounderPlan = body?.plan === "yearly" ? "yearly" : "monthly";
    const db = deps.getDb();
    const [live] = await db
      .select({ subscriptionId: polarSubscription.subscriptionId })
      .from(polarSubscription)
      .where(and(eq(polarSubscription.userId, me.id), inArray(polarSubscription.state, ["active", "canceled", "past_due"])))
      .limit(1);
    if (live) {
      return c.json({ error: "You already have a USD subscription. Manage it from Profile." }, 409);
    }
    try {
      const { url } = await createPolarCheckout(polar, {
        plan,
        userId: me.id,
        email: me.email,
        name: me.name,
        successUrl: `${appUrl}/pro?polar=success`,
        returnUrl: `${appUrl}/pro`,
        customerIp: c.req.header("CF-Connecting-IP"),
      });
      return c.json({ url });
    } catch (error) {
      console.error(`polar checkout for ${me.id} failed:`, error);
      return c.json({ error: "Could not open the checkout. Try again in a moment." }, 502);
    }
  });

  // Customer portal (cancel, change plan, card, invoices) for a user who bought through Polar.
  app.post("/api/billing/polar/portal", async (c) => {
    if (!polar) return c.json({ error: "USD checkout is not available." }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signIn") }, 401);
    const [owned] = await deps
      .getDb()
      .select({ subscriptionId: polarSubscription.subscriptionId })
      .from(polarSubscription)
      .where(eq(polarSubscription.userId, me.id))
      .limit(1);
    if (!owned) return c.json({ error: "No USD subscription on this account." }, 404);
    try {
      const { url } = await createPortalSession(polar, { userId: me.id, returnUrl: `${appUrl}/profil` });
      return c.json({ url });
    } catch (error) {
      console.error(`polar portal for ${me.id} failed:`, error);
      return c.json({ error: "Could not open the subscription portal. Try again in a moment." }, 502);
    }
  });

  // The account's most relevant Polar subscription (live ones first), for the profile page.
  app.get("/api/billing/polar/subscription", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signIn") }, 401);
    const rows = await deps
      .getDb()
      .select()
      .from(polarSubscription)
      .where(eq(polarSubscription.userId, me.id))
      .orderBy(desc(polarSubscription.updatedAt))
      .limit(5);
    const row = rows.find((r) => ["active", "canceled", "past_due"].includes(r.state)) ?? rows[0];
    return c.json({
      subscription: row
        ? {
            plan: row.plan,
            state: row.state,
            currentPeriodEnd: row.currentPeriodEnd?.getTime() ?? null,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          }
        : null,
    });
  });

  // Polar webhook (Standard Webhooks signature over the raw body). The org also
  // sells other products: their events are acknowledged and ignored. Only a lost
  // race answers non-2xx (Polar disables an endpoint after 10 failed deliveries).
  app.post(POLAR_WEBHOOK_PATH, async (c) => {
    if (!polar) return c.json({ error: "billing disabled" }, 404);
    const raw = await c.req.text();
    const eventId = c.req.header("webhook-id") ?? "";
    const valid = await verifyWebhook(
      raw,
      {
        id: eventId,
        timestamp: c.req.header("webhook-timestamp") ?? "",
        signature: c.req.header("webhook-signature") ?? "",
      },
      polar.webhookSecret,
    );
    if (!valid) return c.json({ error: "invalid signature" }, 403);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const db = deps.getDb();
    const result = await processPolarEvent(
      {
        db,
        config: polar,
        fallbackPriceIdr: { monthly: config.founderPriceIdr, yearly: config.founderYearlyPriceIdr },
      },
      eventId,
      parsed,
    );
    if (result.outcome === "busy") return c.json({ error: "concurrent update, retry" }, 409);
    if (result.granted && result.granted.amountIdr > 0) {
      const { granted } = result;
      c.executionCtx.waitUntil(
        sendOrderEmails(
          env,
          db,
          { orderId: granted.orderId, userId: granted.userId, gateway: "polar" },
          { founderDailyCap: config.founderDailyCap },
        ).catch((error: unknown) => console.error(`order emails ${granted.orderId}:`, error)),
      );
    }
    return c.json({ received: true, outcome: result.outcome });
  });

  const appleProductConfig = () => ({
    subscriptionIds: {
      monthly: DEFAULT_APPLE_SUB_MONTHLY_PRODUCT_ID,
      yearly: DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID,
    },
  });
  const appleProductIds = () => {
    const { subscriptionIds } = appleProductConfig();
    return [subscriptionIds.monthly, subscriptionIds.yearly];
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
      return c.json({ error: t(c)("billing.unavailable") }, 404);
    }
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signInToSubscribe") }, 401);
    const body = (await c.req.json().catch(() => null)) as { signedTransaction?: string } | null;
    if (typeof body?.signedTransaction !== "string" || !body.signedTransaction) {
      return c.json({ error: t(c)("billing.receiptMissing") }, 400);
    }

    const billing = appleBillingDeps(deps.getDb());
    const verification = await verifyAppleTransactionJws(body.signedTransaction, {
      rootSha256: APPLE_ROOT_CA_G3_SHA256,
      bundleId: env.APPLE_BUNDLE_ID || DEFAULT_APPLE_BUNDLE_ID,
      productIds: appleProductIds(),
    });
    if (!verification.ok) {
      console.error(`apple billing rejected: ${verification.reason}`);
      return c.json({ error: t(c)("billing.receiptInvalid") }, 400);
    }
    const transaction = verification.transaction;

    // TestFlight and App Review purchases are Sandbox with unknown buyer
    // emails (often Apple private relay). Allowlisted buyers (owner, review
    // demo) get the full period; any other Sandbox buyer gets one day at zero
    // revenue (appleSubscriptionGrant), so review works
    // without free months. Subscriptions are credited up to the store's own
    // expiresDate and linked to the account by originalTransactionId.
    const result = await redeemAppleTransaction(billing, {
      userId: me.id,
      email: me.email,
      transaction,
    });
    if (!result.ok) {
      if (result.error === "other-account") {
        return c.json({ error: t(c)("billing.linkedOtherAccount") }, 403);
      }
      if (result.error === "no-user") return c.json({ error: t(c)("billing.userNotFound") }, 404);
      if (result.error === "wrong-product") {
        return c.json({ error: t(c)("billing.receiptInvalid") }, 400);
      }
      return c.json({ error: t(c)("billing.processing") }, 409);
    }
    // A Sandbox transaction credited at Rp0 is Apple's simulation: the app tells
    // the buyer nothing was charged. App Review sees no such wording, so the flag
    // stays off for the review and QA logins.
    const ledgerId = appleLedgerId(transaction.transactionId);
    const reviewAccounts = [...INTERNAL_EMAILS, ...(env.REVIEW_LOGIN_EMAILS ?? "").split(",")].map(
      (email) => email.trim().toLowerCase(),
    );
    let sandbox = false;
    if (transaction.environment === "Sandbox" && !reviewAccounts.includes(me.email.toLowerCase())) {
      if (result.status === "granted") {
        sandbox = result.amountIdr === 0;
      } else {
        const [ledger] = await billing.db
          .select({ amountIdr: payment.amountIdr })
          .from(payment)
          .where(eq(payment.orderId, ledgerId))
          .limit(1);
        sandbox = ledger?.amountIdr === 0;
      }
    }
    if (result.status === "granted") {
      // The one-day sandbox trial is not a sale: no receipt, no admin alert.
      if (result.amountIdr > 0) {
        c.executionCtx.waitUntil(
          sendOrderEmails(
            env,
            billing.db,
            { orderId: ledgerId, userId: me.id, gateway: "apple" },
            { founderDailyCap: config.founderDailyCap },
          ).catch((error: unknown) => console.error(`order emails ${ledgerId}:`, error)),
        );
      } else if (deps.onSandboxGrant) {
        c.executionCtx.waitUntil(deps.onSandboxGrant(me.id));
      }
      return c.json({ activated: true, founderUntil: result.founderUntil, sandbox });
    }
    return c.json({ activated: false, founderUntil: result.founderUntil, sandbox });
  });

  // App Store Server Notifications V2. Set this URL as both the Production and
  // Sandbox Server URL in App Store Connect (App Information). Trust comes from
  // the signed payload's JWS chain, like the purchase route. Verified
  // notifications always answer 200 (unmapped ones are logged); a failed
  // signature is 400; a D1 failure is 500 so Apple redelivers.
  app.post("/api/billing/apple/notifications", async (c) => {
    if (!paywallEnabled(config)) {
      return c.json({ error: t(c)("billing.unavailable") }, 404);
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
      } else if (result.granted && deps.onSandboxGrant) {
        c.executionCtx.waitUntil(deps.onSandboxGrant(result.granted.userId));
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
    if (!me) return c.json({ error: t(c)("billing.signIn") }, 401);
    const order = await ownOrder(c.req.param("orderId"), me.id);
    if (!order) return c.json({ error: t(c)("billing.orderNotFound") }, 404);
    return c.json(order);
  });

  // "Cek pembayaran": the buyer asks us to verify with the gateway now.
  app.post("/api/billing/orders/:orderId/check", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signIn") }, 401);
    const db = deps.getDb();
    const order = await findOrder(db, c.req.param("orderId"));
    if (!order || order.userId !== me.id) return c.json({ error: t(c)("billing.orderNotFound") }, 404);
    await reconcileOrder(db, order, (work) => c.executionCtx.waitUntil(work));
    return c.json(await ownOrder(order.orderId, me.id));
  });

  // Latest pending order of the caller, so profile can offer "Cek pembayaran".
  app.get("/api/billing/orders", async (c) => {
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: t(c)("billing.signIn") }, 401);
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
      return c.json({ error: t(c)("billing.signInForUsage") }, 401);
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
