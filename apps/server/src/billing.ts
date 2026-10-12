import { and, eq, gte, sql } from "drizzle-orm";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";

import { summarize } from "@joyorogo/api/lib/cost";
import {
  WEBHOOK_TARGET,
  buildOrderId,
  createCheckout,
  isFailed,
  isOrderId,
  isPaid,
  parseNotification,
  verifySignature,
} from "@joyorogo/api/lib/doku";
import type { DokuConfig } from "@joyorogo/api/lib/doku";
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
  DOKU_CLIENT_ID?: string;
  DOKU_SECRET_KEY?: string;
  DOKU_BASE_URL?: string;
};

type Deps = {
  env: BillingEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
};

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

/**
 * Founder plan: prepaid months over DOKU Checkout. Billing is live only when
 * the operator set a paywall (FREE_DAILY_SCANS) AND DOKU credentials; any
 * other self-hosted setup runs without checkout or upgrade prompts.
 */
export function registerBillingRoutes(app: Hono, deps: Deps) {
  const { env } = deps;
  const config = paywallConfig(env);
  const doku = paywallEnabled(config) ? dokuConfig(env) : null;
  const appUrl = (env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "");
  const apiUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

  const sessionUser = async (headers: Headers) =>
    (await (await deps.createAuth()).api.getSession({ headers }))?.user ?? null;

  // Public: lets the web hide pricing and upgrade prompts on self-hosts.
  app.get("/api/config", (c) =>
    c.json({
      paywall: paywallEnabled(config),
      billing: doku !== null,
      freeDailyScans: config.freeDailyScans,
      founderDailyCap: config.founderDailyCap,
      founderPriceIdr: config.founderPriceIdr,
      anonScans: config.anonScans,
    }),
  );

  app.post("/api/billing/checkout", async (c) => {
    if (!doku) return c.json({ error: "Pembayaran tidak tersedia di server ini." }, 404);
    const me = await sessionUser(c.req.raw.headers);
    if (!me) return c.json({ error: "Masuk dulu untuk berlangganan." }, 401);

    const orderId = buildOrderId();
    const db = deps.getDb();
    await db.insert(payment).values({ orderId, userId: me.id, amountIdr: config.founderPriceIdr });
    try {
      const { paymentUrl } = await createCheckout(doku, {
        orderId,
        amountIdr: config.founderPriceIdr,
        itemName: "JoyoRogo Founder 1 bulan",
        customerEmail: me.email,
        customerName: me.name,
        notifyUrl: `${apiUrl}${WEBHOOK_TARGET}`,
        returnUrl: `${appUrl}/pembayaran?order=${encodeURIComponent(orderId)}`,
      });
      await db.update(payment).set({ paymentUrl }).where(eq(payment.orderId, orderId));
      return c.json({ orderId, paymentUrl });
    } catch (error) {
      console.error(`checkout ${orderId} failed:`, error);
      await db.update(payment).set({ status: "failed" }).where(eq(payment.orderId, orderId));
      return c.json({ error: "Halaman pembayaran gagal dibuat. Coba lagi sebentar lagi." }, 502);
    }
  });

  // DOKU payment notification. Public; trust comes from the signature only.
  app.post(WEBHOOK_TARGET, async (c) => {
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
          target: WEBHOOK_TARGET,
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
    const [order] = await db
      .select()
      .from(payment)
      .where(eq(payment.orderId, n.invoiceNumber))
      .limit(1);
    if (!order) return c.json({ error: "order not found" }, 404);

    if (isFailed(n)) {
      await db
        .update(payment)
        .set({ status: "failed" })
        .where(and(eq(payment.orderId, order.orderId), eq(payment.status, "pending")));
      return c.json({ received: true });
    }
    if (!isPaid(n)) return c.json({ received: true });
    if (order.status === "paid") return c.json({ received: true, activated: false });
    if (Math.round(n.amount) !== order.amountIdr) {
      return c.json({ error: "amount mismatch" }, 400);
    }

    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, order.userId))
      .limit(1);
    if (!owner) return c.json({ error: "user not found" }, 404);
    const now = new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    const until = nextFounderUntil(owner.founderUntil, now);

    // One D1 transaction. The flip only lands while the order is pending AND
    // founder_until still holds the value we extended from, so duplicate
    // notifications extend once and two concurrent payments can't both
    // stack on the same base (the loser gets 409 and DOKU retries it).
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
    if (flipped.length === 1) return c.json({ received: true, activated: true });

    const [again] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, order.orderId))
      .limit(1);
    if (again?.status === "paid") return c.json({ received: true, activated: false });
    return c.json({ error: "concurrent update, retry" }, 409);
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
