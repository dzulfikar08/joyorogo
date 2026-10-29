import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { payment, polarEvent, polarSubscription } from "@joyorogo/db/schema/billing";

import { polarConfig, polarLedgerId, verifyWebhook } from "./polar";
import { processPolarEvent } from "./polar-billing";
import type { PolarBillingDeps } from "./polar-billing";

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 18, 3, 0, 0));
const MONTHLY = "prod-monthly";
const YEARLY = "prod-yearly";

const { client, db } = await d1TestDb();

let deps: PolarBillingDeps;
let clock = NOW;

beforeEach(async () => {
  clock = NOW;
  await client.executeMultiple(`
    DELETE FROM polar_event; DELETE FROM polar_subscription; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
  deps = {
    db,
    now: () => clock,
    config: { productIds: { monthly: MONTHLY, yearly: YEARLY }, priceUsdCents: { monthly: 999, yearly: 5999 } },
    fallbackPriceIdr: { monthly: 29_000, yearly: 199_000 },
  };
});

const founderUntil = async (id: string) =>
  (await db.select({ v: user.founderUntil }).from(user).where(eq(user.id, id)))[0]?.v ?? null;
const ledger = async (orderId: string) =>
  (await db.select().from(payment).where(eq(payment.orderId, polarLedgerId(orderId))))[0];

type Over = Record<string, unknown>;

const subscription = (over: Over = {}) => ({
  id: "sub1",
  status: "active",
  customer_id: "cus1",
  product_id: MONTHLY,
  created_at: NOW.toISOString(),
  modified_at: NOW.toISOString(),
  current_period_end: new Date(NOW.getTime() + 30 * DAY).toISOString(),
  cancel_at_period_end: false,
  metadata: {},
  customer: { id: "cus1", external_id: "u1" },
  ...over,
});

const order = (over: Over = {}) => ({
  id: "ord1",
  status: "paid",
  billing_reason: "subscription_create",
  currency: "usd",
  net_amount: 999,
  customer_id: "cus1",
  product_id: MONTHLY,
  subscription_id: "sub1",
  metadata: {},
  customer: { id: "cus1", external_id: "u1" },
  subscription: subscription(),
  ...over,
});

const send = (eventId: string, type: string, data: unknown) =>
  processPolarEvent(deps, eventId, { type, timestamp: NOW.toISOString(), data });

describe("Polar webhook signature (Standard Webhooks)", () => {
  const enc = new TextEncoder();
  const body = JSON.stringify({ type: "order.paid", data: { id: "o1" } });
  const nowMs = NOW.getTime();
  const ts = String(Math.floor(nowMs / 1000));

  async function sign(keyBytes: Uint8Array, id: string, timestamp: string, payload: string) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${payload}`));
    return `v1,${Buffer.from(mac).toString("base64")}`;
  }

  const raw = new Uint8Array(32).map((_, i) => i * 7 + 1);
  const standard = `whsec_${Buffer.from(raw).toString("base64")}`;

  test("accepts a Standard Webhooks secret (base64-decoded key)", async () => {
    const signature = await sign(raw, "evt1", ts, body);
    expect(await verifyWebhook(body, { id: "evt1", timestamp: ts, signature }, standard, nowMs)).toBe(true);
  });

  test("accepts an older Polar HMAC secret (whole string as key)", async () => {
    const legacy = "whsec_polar_legacy_secret";
    const signature = await sign(enc.encode(legacy), "evt1", ts, body);
    expect(await verifyWebhook(body, { id: "evt1", timestamp: ts, signature }, legacy, nowMs)).toBe(true);
  });

  test("accepts when one of several space-separated signatures matches", async () => {
    const good = await sign(raw, "evt1", ts, body);
    const signature = `v1,AAAA v2,zzzz ${good}`;
    expect(await verifyWebhook(body, { id: "evt1", timestamp: ts, signature }, standard, nowMs)).toBe(true);
  });

  test("rejects a tampered body, another id, another secret and missing headers", async () => {
    const signature = await sign(raw, "evt1", ts, body);
    const headers = { id: "evt1", timestamp: ts, signature };
    expect(await verifyWebhook(`${body} `, headers, standard, nowMs)).toBe(false);
    expect(await verifyWebhook(body, { ...headers, id: "evt2" }, standard, nowMs)).toBe(false);
    expect(await verifyWebhook(body, headers, "whsec_AAAAAAAA", nowMs)).toBe(false);
    expect(await verifyWebhook(body, { ...headers, signature: "" }, standard, nowMs)).toBe(false);
    expect(await verifyWebhook(body, { ...headers, signature: "v1,not base64!" }, standard, nowMs)).toBe(false);
  });

  test("rejects a stale or future timestamp (replay window)", async () => {
    const old = String(Math.floor(nowMs / 1000) - 6 * 60);
    const future = String(Math.floor(nowMs / 1000) + 6 * 60);
    for (const timestamp of [old, future, "abc"]) {
      const signature = await sign(raw, "evt1", timestamp, body);
      expect(await verifyWebhook(body, { id: "evt1", timestamp, signature }, standard, nowMs)).toBe(false);
    }
  });
});

describe("polarConfig", () => {
  const base = {
    POLAR_ACCESS_TOKEN: "t",
    POLAR_WEBHOOK_SECRET: "s",
    POLAR_PRODUCT_MONTHLY_ID: "m",
    POLAR_PRODUCT_YEARLY_ID: "y",
  };
  test("off until token, secret and both products are set; defaults are US$9.99 and US$59.99", () => {
    expect(polarConfig({})).toBeNull();
    expect(polarConfig({ ...base, POLAR_PRODUCT_YEARLY_ID: "" })).toBeNull();
    expect(polarConfig(base)?.priceUsdCents).toEqual({ monthly: 999, yearly: 5999 });
    expect(polarConfig(base)?.baseUrl).toBe("https://api.polar.sh");
  });
  test("price and server are configurable; a typo throws", () => {
    const cfg = polarConfig({
      ...base,
      POLAR_SERVER: "sandbox",
      POLAR_PRICE_MONTHLY_USD_CENTS: "1999",
      POLAR_PRICE_YEARLY_USD_CENTS: "9999",
    });
    expect(cfg?.priceUsdCents).toEqual({ monthly: 1999, yearly: 9999 });
    expect(cfg?.baseUrl).toBe("https://sandbox-api.polar.sh");
    expect(() => polarConfig({ ...base, POLAR_PRICE_MONTHLY_USD_CENTS: "9.99" })).toThrow();
  });
});

describe("order.paid", () => {
  test("grants one month, priced at the IDR equivalent, linked to the subscription", async () => {
    const result = await send("e1", "order.paid", order());
    expect(result.outcome).toBe("granted");
    expect(result.granted).toEqual({ orderId: "polar:ord1", userId: "u1", amountIdr: 29_000 });
    expect((await founderUntil("u1"))?.toISOString()).toBe(new Date(Date.UTC(2026, 10, 18, 3, 0, 0)).toISOString());
    const row = await ledger("ord1");
    expect(row).toMatchObject({ status: "paid", months: 1, amountIdr: 29_000, amountUsdCents: 999, userId: "u1" });
    const [sub] = await db.select().from(polarSubscription);
    expect(sub).toMatchObject({ subscriptionId: "sub1", userId: "u1", plan: "monthly", state: "active" });
  });

  test("yearly grants 12 months at the yearly IDR equivalent", async () => {
    await send("e1", "order.paid", order({ product_id: YEARLY, net_amount: 5999 }));
    expect((await founderUntil("u1"))?.toISOString()).toBe(new Date(Date.UTC(2027, 9, 18, 3, 0, 0)).toISOString());
    expect(await ledger("ord1")).toMatchObject({ months: 12, amountIdr: 199_000, amountUsdCents: 5999 });
  });

  test("a discounted order is scaled down; a free one is Rp0 (no ladder seat)", async () => {
    await send("e1", "order.paid", order({ net_amount: 500 }));
    expect((await ledger("ord1"))?.amountIdr).toBe(Math.round(29_000 * (500 / 999)));
    await send("e2", "order.paid", order({ id: "ord2", customer: { id: "cus2", external_id: "u2" }, net_amount: 0 }));
    expect(await ledger("ord2")).toMatchObject({ amountIdr: 0, status: "paid" });
    expect(await founderUntil("u2")).not.toBeNull();
  });

  test("redelivery by event id does nothing; a new event id for the same order does not extend twice", async () => {
    await send("e1", "order.paid", order());
    const first = await founderUntil("u1");
    expect((await send("e1", "order.paid", order())).outcome).toBe("duplicate");
    expect((await send("e2", "order.paid", order())).outcome).toBe("already");
    expect(await founderUntil("u1")).toEqual(first);
    expect(await db.select().from(payment)).toHaveLength(1);
    expect(await db.select().from(polarEvent)).toHaveLength(2);
  });

  test("a renewal extends from the end of the current period", async () => {
    await send("e1", "order.paid", order());
    const afterFirst = await founderUntil("u1");
    clock = new Date(NOW.getTime() + 29 * DAY);
    await send("e2", "order.paid", order({ id: "ord2", billing_reason: "subscription_cycle" }));
    expect((await founderUntil("u1"))?.getTime()).toBe(
      new Date(Date.UTC(2026, 11, 18, 3, 0, 0)).getTime(),
    );
    expect((await founderUntil("u1"))!.getTime()).toBeGreaterThan(afterFirst!.getTime());
    expect(await db.select().from(payment)).toHaveLength(2);
  });

  test("stacks on Pro time bought through another gateway", async () => {
    await client.execute({
      sql: `UPDATE "user" SET founder_until = ? WHERE id = 'u1'`,
      args: [NOW.getTime() + 10 * DAY],
    });
    await send("e1", "order.paid", order());
    expect((await founderUntil("u1"))?.toISOString()).toBe(
      new Date(Date.UTC(2026, 10, 28, 3, 0, 0)).toISOString(),
    );
  });

  test("a plan-change proration charge is recorded without granting time", async () => {
    await send("e1", "order.paid", order());
    const before = await founderUntil("u1");
    await send("e2", "order.paid", order({ id: "ord2", billing_reason: "subscription_update", net_amount: 300 }));
    expect(await founderUntil("u1")).toEqual(before);
    expect(await ledger("ord2")).toMatchObject({ months: 0, amountIdr: 0, status: "paid" });
  });

  test("finds the account through metadata.user_id when the customer has no external id", async () => {
    const result = await send(
      "e1",
      "order.paid",
      order({ customer: { id: "cus9", external_id: null }, metadata: { user_id: "u2" }, subscription: null }),
    );
    expect(result.granted?.userId).toBe("u2");
  });

  test("an unknown account is acknowledged without a grant", async () => {
    const result = await send("e1", "order.paid", order({ customer: { id: "c", external_id: "ghost" } }));
    expect(result.outcome).toBe("no-user");
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("other products in the same Polar org are ignored", async () => {
    const result = await send("e1", "order.paid", order({ product_id: "paparan-ai", subscription: subscription({ product_id: "paparan-ai" }) }));
    expect(result.outcome).toBe("ignored");
    expect(await db.select().from(payment)).toHaveLength(0);
    expect(await db.select().from(polarSubscription)).toHaveLength(0);
    expect((await send("e2", "subscription.active", subscription({ product_id: "paparan-ai" }))).outcome).toBe("ignored");
  });

  test("unpaid status and unrelated event types are ignored", async () => {
    expect((await send("e1", "order.paid", order({ status: "pending" }))).outcome).toBe("ignored");
    expect((await send("e2", "checkout.updated", { id: "c" })).outcome).toBe("ignored");
    expect((await processPolarEvent(deps, "e3", { nope: true })).outcome).toBe("invalid");
    expect((await send("e4", "order.paid", { id: 5 })).outcome).toBe("invalid");
  });

  test("concurrent deliveries of two different orders both extend, none twice", async () => {
    const results = await Promise.all([
      send("e1", "order.paid", order({ id: "ordA" })),
      send("e2", "order.paid", order({ id: "ordB", billing_reason: "subscription_cycle" })),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(["granted", "granted"]);
    expect((await founderUntil("u1"))?.toISOString()).toBe(new Date(Date.UTC(2026, 11, 18, 3, 0, 0)).toISOString());
  });
});

describe("order.refunded", () => {
  test("takes back the months the order granted, once", async () => {
    await send("e1", "order.paid", order({ product_id: YEARLY, net_amount: 5999 }));
    await send("e2", "order.refunded", order({ product_id: YEARLY, status: "refunded" }));
    // Refund backs the whole 12 months out; nothing left beyond now.
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime());
    expect((await ledger("ord1"))?.status).toBe("failed");
    const after = await founderUntil("u1");
    expect((await send("e3", "order.refunded", order({ product_id: YEARLY, status: "refunded" }))).outcome).toBe("already");
    expect(await founderUntil("u1")).toEqual(after);
  });

  test("keeps time that came from other purchases", async () => {
    await client.execute({
      sql: `UPDATE "user" SET founder_until = ? WHERE id = 'u1'`,
      args: [NOW.getTime() + 60 * DAY],
    });
    await send("e1", "order.paid", order());
    await send("e2", "order.refunded", order({ status: "refunded" }));
    expect((await founderUntil("u1"))?.toISOString()).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
  });

  test("a partial refund changes nothing", async () => {
    await send("e1", "order.paid", order());
    const before = await founderUntil("u1");
    expect((await send("e2", "order.refunded", order({ status: "partially_refunded" }))).outcome).toBe("ignored");
    expect(await founderUntil("u1")).toEqual(before);
    expect((await ledger("ord1"))?.status).toBe("paid");
  });

  test("a refund that arrives before the payment blocks the later grant", async () => {
    await send("e1", "order.refunded", order({ status: "refunded" }));
    expect((await send("e2", "order.paid", order())).outcome).toBe("refunded");
    expect(await founderUntil("u1")).toBeNull();
  });
});

describe("RevKlik attribution ids", () => {
  const vid = "3f2a9c1e-7b64-4d0a-9e55-0c1d2e3f4a5b";
  const sid = "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const ids = async (orderId: string) => {
    const row = await ledger(orderId);
    return { visitor: row?.revklikVisitorId, session: row?.revklikSessionId };
  };

  test("the first order stores the checkout's ids from its metadata", async () => {
    await send("e1", "order.paid", order({ metadata: { revklik_vid: vid, revklik_sid: sid } }));
    expect(await ids("ord1")).toEqual({ visitor: vid, session: sid });
  });

  test("renewals and malformed ids store none", async () => {
    await send("e1", "order.paid", order({ id: "renew", billing_reason: "subscription_cycle", metadata: { revklik_vid: vid } }));
    await send("e2", "order.paid", order({ id: "bad", metadata: { revklik_vid: "no spaces allowed", revklik_sid: 7 } }));
    expect(await ids("renew")).toEqual({ visitor: null, session: null });
    expect(await ids("bad")).toEqual({ visitor: null, session: null });
  });
});

describe("RevKlik hook", () => {
  test("fires once per paid flip and once per refund, not for duplicates", async () => {
    const seen: string[] = [];
    deps.onLedger = async (orderId, kind) => {
      seen.push(`${kind}:${orderId}`);
    };
    await send("e1", "order.paid", order());
    await send("e1b", "order.paid", order());
    await send("e2", "order.refunded", order({ status: "refunded" }));
    await send("e3", "order.refunded", order({ status: "refunded" }));
    expect(seen).toEqual(["paid:polar:ord1", "refund:polar:ord1"]);
  });

  test("a hook that throws never fails the credit", async () => {
    deps.onLedger = async () => {
      throw new Error("outbox down");
    };
    expect((await send("e1", "order.paid", order())).outcome).toBe("granted");
    expect((await ledger("ord1"))?.status).toBe("paid");
  });
});

describe("subscription events", () => {
  test("canceled (auto-renew off) keeps Pro until the period end and shows the state", async () => {
    await send("e1", "order.paid", order());
    const before = await founderUntil("u1");
    await send("e2", "subscription.canceled", subscription({ cancel_at_period_end: true }));
    expect(await founderUntil("u1")).toEqual(before);
    const [sub] = await db.select().from(polarSubscription);
    expect(sub).toMatchObject({ state: "canceled", cancelAtPeriodEnd: true });
    await send("e3", "subscription.uncanceled", subscription({ modified_at: new Date(NOW.getTime() + 1000).toISOString() }));
    const [again] = await db.select().from(polarSubscription);
    expect(again).toMatchObject({ state: "active", cancelAtPeriodEnd: false });
  });

  test("an older event never overwrites a newer state", async () => {
    const later = new Date(NOW.getTime() + 60_000).toISOString();
    await send("e1", "subscription.canceled", subscription({ cancel_at_period_end: true, modified_at: later }));
    await send("e2", "subscription.active", subscription({ modified_at: NOW.toISOString() }));
    const [sub] = await db.select().from(polarSubscription);
    expect(sub?.state).toBe("canceled");
  });

  test("revoked after the period ran out changes nothing", async () => {
    await send("e1", "order.paid", order());
    clock = new Date(NOW.getTime() + 40 * DAY);
    const before = await founderUntil("u1");
    const result = await send("e2", "subscription.revoked", subscription({ status: "canceled", cancel_at_period_end: true }));
    expect(result.outcome).toBe("synced");
    expect(await founderUntil("u1")).toEqual(before);
    expect((await db.select().from(polarSubscription))[0]?.state).toBe("revoked");
  });

  test("an immediate revoke cuts the remaining Polar time to now", async () => {
    await send("e1", "order.paid", order());
    clock = new Date(NOW.getTime() + 5 * DAY);
    const result = await send("e2", "subscription.revoked", subscription({ status: "canceled" }));
    expect(result.outcome).toBe("revoked");
    expect((await founderUntil("u1"))?.getTime()).toBe(clock.getTime());
  });

  test("a revoke leaves time bought elsewhere and other live subscriptions alone", async () => {
    await send("e1", "order.paid", order());
    await client.execute({
      sql: `UPDATE "user" SET founder_until = ? WHERE id = 'u1'`,
      args: [NOW.getTime() + 200 * DAY],
    });
    expect((await send("e2", "subscription.revoked", subscription({ status: "canceled" }))).outcome).toBe("synced");
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 200 * DAY);

    await client.execute(`UPDATE "user" SET founder_until = ${NOW.getTime() + 20 * DAY} WHERE id = 'u1'`);
    await send("e3", "subscription.active", subscription({ id: "sub2", customer: { id: "cus1", external_id: "u1" } }));
    expect((await send("e4", "subscription.revoked", subscription({ status: "canceled", modified_at: new Date(NOW.getTime() + 5000).toISOString() }))).outcome).toBe("synced");
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 20 * DAY);
  });

  test("past_due is shown but does not take time away", async () => {
    await send("e1", "order.paid", order());
    const before = await founderUntil("u1");
    await send("e2", "subscription.past_due", subscription({ status: "past_due", modified_at: new Date(NOW.getTime() + 1000).toISOString() }));
    expect((await db.select().from(polarSubscription))[0]?.state).toBe("past_due");
    expect(await founderUntil("u1")).toEqual(before);
  });
});

describe("polarConfig MYR prices", () => {
  const base = {
    POLAR_ACCESS_TOKEN: "t",
    POLAR_WEBHOOK_SECRET: "s",
    POLAR_PRODUCT_MONTHLY_ID: "m",
    POLAR_PRODUCT_YEARLY_ID: "y",
  };
  test("none shown until both ringgit prices are set", () => {
    expect(polarConfig(base)?.priceMyrSen).toBeNull();
    expect(polarConfig({ ...base, POLAR_PRICE_MONTHLY_MYR_SEN: "1290" })?.priceMyrSen).toBeNull();
    expect(
      polarConfig({ ...base, POLAR_PRICE_MONTHLY_MYR_SEN: "1290", POLAR_PRICE_YEARLY_MYR_SEN: "7990" })?.priceMyrSen,
    ).toEqual({ monthly: 1290, yearly: 7990 });
  });
  test("a typo throws instead of advertising a wrong price", () => {
    expect(() => polarConfig({ ...base, POLAR_PRICE_MONTHLY_MYR_SEN: "12.90", POLAR_PRICE_YEARLY_MYR_SEN: "7990" })).toThrow();
  });
});

describe("polarConfig SGD prices", () => {
  const base = {
    POLAR_ACCESS_TOKEN: "t",
    POLAR_WEBHOOK_SECRET: "s",
    POLAR_PRODUCT_MONTHLY_ID: "m",
    POLAR_PRODUCT_YEARLY_ID: "y",
  };
  test("none shown until both Singapore dollar prices are set", () => {
    expect(polarConfig(base)?.priceSgdCents).toBeNull();
    expect(polarConfig({ ...base, POLAR_PRICE_MONTHLY_SGD_CENTS: "1398" })?.priceSgdCents).toBeNull();
    expect(
      polarConfig({ ...base, POLAR_PRICE_MONTHLY_SGD_CENTS: "1398", POLAR_PRICE_YEARLY_SGD_CENTS: "8398" })?.priceSgdCents,
    ).toEqual({ monthly: 1398, yearly: 8398 });
  });
  test("MYR and SGD are independent", () => {
    const cfg = polarConfig({ ...base, POLAR_PRICE_MONTHLY_SGD_CENTS: "1398", POLAR_PRICE_YEARLY_SGD_CENTS: "8398" });
    expect(cfg?.priceMyrSen).toBeNull();
  });
  test("a typo throws instead of advertising a wrong price", () => {
    expect(() => polarConfig({ ...base, POLAR_PRICE_MONTHLY_SGD_CENTS: "13.98", POLAR_PRICE_YEARLY_SGD_CENTS: "8398" })).toThrow();
  });
});
