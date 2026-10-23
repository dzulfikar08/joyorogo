import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";

import { registerBillingRoutes } from "./billing";
import type { BillingEnv } from "./billing";

// billing.ts reaches the Workers runtime through ./context; the route needs nothing from it.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { registerBillingRoutes } = await import("./billing");
const { client, db } = await d1TestDb();

const SECRET = `whsec_${Buffer.from("polar-test-secret-0123456789abcdef").toString("base64")}`;
const env = {
  BETTER_AUTH_URL: "https://api.test",
  FREE_DAILY_SCANS: "3",
  FOUNDER_PRICE_IDR: "29000",
  FOUNDER_YEARLY_PRICE_IDR: "199000",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_WEBHOOK_SECRET: SECRET,
  POLAR_PRODUCT_MONTHLY_ID: "prod-monthly",
  POLAR_PRODUCT_YEARLY_ID: "prod-yearly",
} as BillingEnv;

const app = new Hono();
registerBillingRoutes(app, {
  env,
  getDb: () => db,
  createAuth: async () => {
    throw new Error("auth is not used by the webhook");
  },
});
// The same routes with a fixed rate source: MYR 4400, SGD 14000 IDR.
const RATES: Record<string, number> = { MYR: 4400, SGD: 14000 };
const fxApp = new Hono();
registerBillingRoutes(fxApp, {
  env,
  getDb: () => db,
  createAuth: async () => {
    throw new Error("auth is not used by the webhook");
  },
  fxRate: async (currency) => {
    const rate = RATES[currency.toUpperCase()];
    return rate ? { rate, source: "test:2026-10-21" } : null;
  },
});
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

async function deliver(
  id: string,
  body: string,
  signedWith = SECRET,
  timestamp = Math.floor(Date.now() / 1000),
  target: Hono = app,
) {
  const keyBytes = new Uint8Array(Buffer.from(signedWith.slice(6), "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return target.request(
    "/api/billing/polar/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": `v1,${Buffer.from(mac).toString("base64")}`,
      },
      body,
    },
    env,
    ctx,
  );
}

const paid = JSON.stringify({
  type: "order.paid",
  data: {
    id: "ord1",
    status: "paid",
    billing_reason: "subscription_create",
    currency: "usd",
    net_amount: 5999,
    customer_id: "cus1",
    product_id: "prod-yearly",
    subscription_id: null,
    metadata: {},
    customer: { id: "cus1", external_id: "u1" },
    subscription: null,
  },
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM polar_event; DELETE FROM polar_subscription; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id');
  `);
});

// Polar prices are tax-inclusive: net = price - tax (MY SST 8%, SG GST 9%).
const orderIn = (currency: string, productId: string, net: number, tax: number, id = "ord1") =>
  JSON.stringify({
    type: "order.paid",
    data: {
      ...JSON.parse(paid).data,
      id,
      currency,
      product_id: productId,
      net_amount: net,
      tax_amount: tax,
      total_amount: net + tax,
    },
  });

describe("non-USD Polar orders (ledger in the charged currency)", () => {
  const cases = [
    { name: "MYR monthly", currency: "myr", product: "prod-monthly", net: 4073, tax: 326, months: 1, idr: 179_212, rate: 4400 },
    { name: "MYR yearly", currency: "myr", product: "prod-yearly", net: 24536, tax: 1963, months: 12, idr: 1_079_584, rate: 4400 },
    { name: "SGD monthly", currency: "sgd", product: "prod-monthly", net: 1283, tax: 115, months: 1, idr: 179_620, rate: 14000 },
    { name: "SGD yearly", currency: "sgd", product: "prod-yearly", net: 7705, tax: 693, months: 12, idr: 1_078_700, rate: 14000 },
  ];
  for (const c of cases) {
    test(`${c.name}: books the charged amount and tax, and the IDR at the recorded rate`, async () => {
      const res = await deliver("evt_fx", orderIn(c.currency, c.product, c.net, c.tax), SECRET, undefined, fxApp);
      expect(await res.json()).toEqual({ received: true, outcome: "granted" });
      const [row] = await db.select().from(payment);
      expect(row).toMatchObject({
        orderId: "polar:ord1",
        months: c.months,
        status: "paid",
        amountUsdCents: null,
        chargedCurrency: c.currency.toUpperCase(),
        chargedAmountMinor: c.net,
        chargedTaxMinor: c.tax,
        fxRateIdr: c.rate,
        fxSource: "test:2026-10-21",
        amountIdr: c.idr,
      });
      expect(row?.amountIdr).not.toBe(c.months === 12 ? 199_000 : 29_000);
    });
  }

  test("a USD order keeps the plan-priced IDR, with its currency and tax recorded and no rate", async () => {
    await deliver("evt_usd", orderIn("usd", "prod-yearly", 5999, 0), SECRET, undefined, fxApp);
    const [row] = await db.select().from(payment);
    expect(row).toMatchObject({
      amountIdr: 199_000,
      amountUsdCents: 5999,
      chargedCurrency: "USD",
      chargedAmountMinor: 5999,
      chargedTaxMinor: 0,
      fxRateIdr: null,
      fxSource: null,
    });
  });

  test("a free MYR order is Rp0 with no rate", async () => {
    await deliver("evt_free", orderIn("myr", "prod-monthly", 0, 0), SECRET, undefined, fxApp);
    const [row] = await db.select().from(payment);
    expect(row).toMatchObject({ amountIdr: 0, chargedCurrency: "MYR", chargedAmountMinor: 0, fxRateIdr: null });
  });

  test("the live source is the ECB rate of the order's day; when it fails the fallback table is booked", async () => {
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    try {
      globalThis.fetch = (async (url: string) => {
        urls.push(String(url));
        return Response.json({ amount: 1, base: "MYR", date: "2026-10-20", rates: { IDR: 4405.3 } });
      }) as unknown as typeof fetch;
      await deliver("evt_live", orderIn("myr", "prod-monthly", 4073, 326));
      expect(urls[0]).toMatch(/^https:\/\/api\.frankfurter\.dev\/v1\/\d{4}-\d{2}-\d{2}\?base=MYR&symbols=IDR$/);
      let [row] = await db.select().from(payment);
      expect(row).toMatchObject({ fxRateIdr: 4405.3, fxSource: "frankfurter:2026-10-20", amountIdr: 179_428 });

      await client.executeMultiple(`DELETE FROM polar_event; DELETE FROM payment;`);
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      await deliver("evt_down", orderIn("sgd", "prod-monthly", 1283, 115));
      [row] = await db.select().from(payment);
      expect(row).toMatchObject({ fxRateIdr: 14000, fxSource: "static:2026-10-20", amountIdr: 179_620 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a full refund takes the months back and keeps what was charged on the failed row", async () => {
    await deliver("evt_a", orderIn("myr", "prod-yearly", 24536, 1963), SECRET, undefined, fxApp);
    const refund = JSON.stringify({
      type: "order.refunded",
      data: { ...JSON.parse(orderIn("myr", "prod-yearly", 24536, 1963)).data, status: "refunded" },
    });
    const res = await deliver("evt_b", refund, SECRET, undefined, fxApp);
    expect(await res.json()).toEqual({ received: true, outcome: "refunded" });
    const [row] = await db.select().from(payment);
    expect(row).toMatchObject({ status: "failed", chargedCurrency: "MYR", chargedAmountMinor: 24536, amountIdr: 1_079_584 });
    const [owner] = await db.select({ until: user.founderUntil }).from(user).where(eq(user.id, "u1"));
    expect(owner?.until && owner.until.getTime() <= Date.now() + 1000).toBe(true);
  });
});

describe("POST /api/billing/polar/webhook", () => {
  test("a signed order.paid grants Pro once, even when Polar redelivers", async () => {
    const first = await deliver("evt_1", paid);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcome: "granted" });
    const [row] = await db.select({ until: user.founderUntil }).from(user).where(eq(user.id, "u1"));
    expect(row?.until && row.until.getTime() > Date.now() + 360 * 86_400_000).toBe(true);

    const again = await deliver("evt_1", paid);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, outcome: "duplicate" });
    const rows = await db.select().from(payment);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId: "polar:ord1", amountUsdCents: 5999, amountIdr: 199_000 });
  });

  test("a wrong signature or a stale timestamp is 403 and changes nothing", async () => {
    const other = `whsec_${Buffer.from("another-secret-another-secret-00").toString("base64")}`;
    expect((await deliver("evt_2", paid, other)).status).toBe(403);
    expect((await deliver("evt_3", paid, SECRET, Math.floor(Date.now() / 1000) - 3600)).status).toBe(403);
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("an event of another product in the org is acknowledged with 200 and ignored", async () => {
    const other = JSON.stringify({ type: "order.paid", data: { ...JSON.parse(paid).data, product_id: "paparan-ai" } });
    const res = await deliver("evt_4", other);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "ignored" });
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("an unreadable payload is acknowledged so Polar does not disable the endpoint", async () => {
    const res = await deliver("evt_5", JSON.stringify({ type: "order.paid", data: { id: 1 } }));
    expect(res.status).toBe(200);
  });

  test("/api/config shows USD with the visitor's country only when Polar is configured", async () => {
    const outside = await app.request("/api/config", { headers: { "CF-IPCountry": "DE" } }, env, ctx);
    expect((await outside.json()).usd).toEqual({ monthlyCents: 999, yearlyCents: 5999, preferred: true, country: "DE" });
    const inside = await app.request("/api/config", { headers: { "CF-IPCountry": "ID" } }, env, ctx);
    expect((await inside.json()).usd).toMatchObject({ preferred: false, country: "ID" });
    const unknown = await app.request("/api/config", { headers: { "CF-IPCountry": "XX" } }, env, ctx);
    expect((await unknown.json()).usd).toMatchObject({ preferred: false, country: null });
    expect(outside.headers.get("cache-control")).toBe("private, no-store");
  });

  test("/api/config names the visitor's region and shows the MYR and SGD prices only when both are set", async () => {
    const config = async (country: string, vars: Record<string, string> = {}, locale?: string) => {
      const headers: Record<string, string> = { "CF-IPCountry": country };
      if (locale) headers["x-locale"] = locale;
      // The Polar config is read when the routes are registered, so each case registers its own app.
      const local = new Hono();
      const localEnv = { ...env, ...vars } as BillingEnv;
      registerBillingRoutes(local, {
        env: localEnv,
        getDb: () => db,
        createAuth: async () => {
          throw new Error("auth is not used by /api/config");
        },
      });
      const res = await local.request("/api/config", { headers }, localEnv, ctx);
      return (await res.json()) as { region: string; myr: unknown; sgd: unknown };
    };
    const none = await config("SG");
    expect(none).toMatchObject({ region: "SG", myr: null, sgd: null });
    const priced = await config(
      "SG",
      {
        POLAR_PRICE_MONTHLY_MYR_SEN: "4399",
        POLAR_PRICE_YEARLY_MYR_SEN: "26499",
        POLAR_PRICE_MONTHLY_SGD_CENTS: "1398",
        POLAR_PRICE_YEARLY_SGD_CENTS: "8398",
      },
    );
    expect(priced.sgd).toEqual({ monthlyCents: 1398, yearlyCents: 8398, country: "SG" });
    expect(priced.myr).toEqual({ monthlySen: 4399, yearlySen: 26499, country: "SG" });
    const half = await config("SG", { POLAR_PRICE_MONTHLY_SGD_CENTS: "1398" });
    expect(half.sgd).toBeNull();
    expect((await config("MY")).region).toBe("MY");
    expect((await config("ID")).region).toBe("ID");
    expect((await config("DE")).region).toBe("ID");
    expect((await config("SG", {}, "ms")).region).toBe("MY");
  });

  test("/api/config carries the native update gate, off by default", async () => {
    const res = await app.request("/api/config", {}, env, ctx);
    const body = await res.json();
    expect(body.app.android.minBuild).toBe(0);
    expect(body.app.ios.minBuild).toBe(0);
  });
});
