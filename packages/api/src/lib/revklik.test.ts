import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { revklikOutbox } from "@joyorogo/db/schema/billing";

import { backfillLedger, enqueueLedger, flushOutbox, parseRevklikIds, revklikConfig, sweepRecentLedger } from "./revklik";
import type { RevklikEventBody } from "./revklik";

const { client, db } = await d1TestDb();
const PAID = Date.UTC(2026, 9, 18, 3, 0, 0);
const DAY = 86_400_000;

const insertPayment = (row: {
  id: string;
  user?: string;
  status?: string;
  idr?: number;
  months?: number;
  isTest?: number | null;
  paidAt?: number | null;
  currency?: string;
  minor?: number;
  tax?: number;
  url?: string;
  vid?: string;
  sid?: string;
}) =>
  client.execute({
    sql: `INSERT INTO payment (order_id, user_id, amount_idr, status, months, is_test, paid_at, charged_currency, charged_amount_minor, charged_tax_minor, payment_url, revklik_visitor_id, revklik_session_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.user ?? "u1",
      row.idr ?? 29_000,
      row.status ?? "paid",
      row.months ?? 1,
      row.isTest === undefined ? 0 : row.isTest,
      row.paidAt === undefined ? PAID : row.paidAt,
      row.currency ?? null,
      row.minor ?? null,
      row.tax ?? null,
      row.url ?? null,
      row.vid ?? null,
      row.sid ?? null,
    ],
  });

const outbox = async () =>
  (await db.select().from(revklikOutbox)).map((row) => ({ ...row, event: JSON.parse(row.body) as RevklikEventBody }));

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM revklik_outbox; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
});

describe("enqueueLedger", () => {
  test("skips test purchases, zero charges and unpaid rows", async () => {
    await insertPayment({ id: "apple:sandbox", isTest: 1 });
    await insertPayment({ id: "apple:trial", idr: 0 });
    await insertPayment({ id: "JRG-260101000000-aaaaaaaa", status: "pending", paidAt: null });
    expect(await enqueueLedger(db, "apple:sandbox", "paid")).toBe(false);
    expect(await enqueueLedger(db, "apple:trial", "paid")).toBe(false);
    expect(await enqueueLedger(db, "JRG-260101000000-aaaaaaaa", "paid")).toBe(false);
    expect(await enqueueLedger(db, "missing", "paid")).toBe(false);
    expect(await outbox()).toEqual([]);
  });

  test("queues an Apple sale in IDR with rail, product and no PII", async () => {
    await insertPayment({ id: "apple:1", months: 12, idr: 199_000 });
    expect(await enqueueLedger(db, "apple:1", "paid")).toBe(true);
    const [row] = await outbox();
    expect(row?.externalId).toBe("apple:1");
    expect(row?.event).toEqual({
      name: "purchase",
      revenue: 199_000,
      currency: "IDR",
      external_id: "apple:1",
      source: "apple",
      rail: "apple",
      product: "joyorogo",
      props: { plan: "yearly", months: 12, environment: "production" },
      occurred_at: new Date(PAID).toISOString(),
    });
    expect(row?.body).not.toContain("test.id");
  });

  test("is idempotent per external_id", async () => {
    await insertPayment({ id: "google:GPA.1" });
    expect(await enqueueLedger(db, "google:GPA.1", "paid")).toBe(true);
    expect(await enqueueLedger(db, "google:GPA.1", "paid")).toBe(false);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event.rail).toBe("google_play");
  });

  test("a refund is the negative sale under <order_id>:refund and needs a failed row", async () => {
    await insertPayment({ id: "google:GPA.2", status: "paid" });
    expect(await enqueueLedger(db, "google:GPA.2", "refund")).toBe(false);
    await client.execute("UPDATE payment SET status = 'failed' WHERE order_id = 'google:GPA.2'");
    const now = new Date(PAID + 2 * DAY);
    expect(await enqueueLedger(db, "google:GPA.2", "refund", { now })).toBe(true);
    const [row] = await outbox();
    expect(row?.externalId).toBe("google:GPA.2:refund");
    expect(row?.event).toMatchObject({
      name: "refund",
      revenue: -29_000,
      currency: "IDR",
      external_id: "google:GPA.2:refund",
      occurred_at: now.toISOString(),
    });
  });

  test("Polar uses the charged currency and the amount before tax; tax goes to props", async () => {
    await insertPayment({ id: "polar:o1", idr: 44_000, currency: "MYR", minor: 4399, tax: 264 });
    await enqueueLedger(db, "polar:o1", "paid");
    const [row] = await outbox();
    expect(row?.event).toMatchObject({ rail: "polar", currency: "MYR", revenue: 43.99 });
    expect(row?.event.props.tax_minor).toBe(264);
  });

  test("Polar USD order and zero-decimal currency", async () => {
    await insertPayment({ id: "polar:usd", idr: 160_000, currency: "USD", minor: 999, tax: 0 });
    await insertPayment({ id: "polar:jpy", user: "u2", idr: 100_000, currency: "JPY", minor: 1500, tax: 0 });
    await enqueueLedger(db, "polar:usd", "paid");
    await enqueueLedger(db, "polar:jpy", "paid");
    const byId = Object.fromEntries((await outbox()).map((row) => [row.externalId, row.event]));
    expect(byId["polar:usd"]).toMatchObject({ currency: "USD", revenue: 9.99 });
    expect(byId["polar:jpy"]).toMatchObject({ currency: "JPY", revenue: 1500 });
  });

  test("DOKU vs Pakasir by hint or payment link; the buyer's second sale is a renewal", async () => {
    await insertPayment({ id: "JRG-260101000000-aaaaaaaa", paidAt: PAID - 40 * DAY, url: "https://app.pakasir.com/pay/x" });
    await insertPayment({ id: "JRG-260201000000-bbbbbbbb", paidAt: PAID });
    await enqueueLedger(db, "JRG-260101000000-aaaaaaaa", "paid");
    await enqueueLedger(db, "JRG-260201000000-bbbbbbbb", "paid", { rail: "doku" });
    const byId = Object.fromEntries((await outbox()).map((row) => [row.externalId, row.event]));
    expect(byId["JRG-260101000000-aaaaaaaa"]).toMatchObject({ rail: "pakasir", name: "purchase" });
    expect(byId["JRG-260201000000-bbbbbbbb"]).toMatchObject({ rail: "doku", name: "renewal" });
  });
});

describe("attribution ids", () => {
  const vid = "3f2a9c1e-7b64-4d0a-9e55-0c1d2e3f4a5b";
  const sid = "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  test("a web sale carries visitor_id and session_id; its refund does not", async () => {
    await insertPayment({ id: "JRG-260101000000-cccccccc", vid, sid, status: "failed" });
    await enqueueLedger(db, "JRG-260101000000-cccccccc", "paid", { rail: "doku" });
    await enqueueLedger(db, "JRG-260101000000-cccccccc", "refund", { rail: "doku" });
    const byId = Object.fromEntries((await outbox()).map((row) => [row.externalId, row.event]));
    expect(byId["JRG-260101000000-cccccccc"]).toMatchObject({ visitor_id: vid, session_id: sid });
    expect(byId["JRG-260101000000-cccccccc:refund"]?.visitor_id).toBeUndefined();
    expect(byId["JRG-260101000000-cccccccc:refund"]?.session_id).toBeUndefined();
  });

  test("native orders carry no ids", async () => {
    await insertPayment({ id: "apple:9" });
    await enqueueLedger(db, "apple:9", "paid");
    const [row] = await outbox();
    expect("visitor_id" in (row?.event ?? {})).toBe(false);
  });

  test("parseRevklikIds keeps UUID-like ids and drops everything else", () => {
    expect(parseRevklikIds({ visitorId: vid, sessionId: sid })).toEqual({ revklikVisitorId: vid, revklikSessionId: sid });
    expect(parseRevklikIds({ visitorId: "short", sessionId: "x".repeat(65) })).toEqual({ revklikVisitorId: null, revklikSessionId: null });
    expect(parseRevklikIds({ visitorId: "has space in it!!", sessionId: 42 })).toEqual({ revklikVisitorId: null, revklikSessionId: null });
    expect(parseRevklikIds(null)).toEqual({ revklikVisitorId: null, revklikSessionId: null });
  });
});

describe("backfillLedger", () => {
  test("queues real sales and refunds once, skipping tests, and is safe to repeat", async () => {
    await insertPayment({ id: "apple:a", paidAt: PAID - 3 * DAY });
    await insertPayment({ id: "apple:b", paidAt: PAID - 2 * DAY });
    await insertPayment({ id: "apple:refunded", user: "u2", status: "failed", paidAt: PAID - DAY });
    await insertPayment({ id: "apple:sandbox", isTest: 1 });
    await insertPayment({ id: "polar:never-paid", user: "u2", status: "failed", paidAt: null, idr: 0 });

    const first = await backfillLedger(db);
    expect(first).toMatchObject({ queued: 4, skipped: 0 });
    const ids = (await outbox()).map((row) => row.externalId).sort();
    expect(ids).toEqual(["apple:a", "apple:b", "apple:refunded", "apple:refunded:refund"]);
    const byId = Object.fromEntries((await outbox()).map((row) => [row.externalId, row.event]));
    expect(byId["apple:a"]?.name).toBe("purchase");
    expect(byId["apple:b"]?.name).toBe("renewal");
    expect(byId["apple:refunded:refund"]?.revenue).toBe(-29_000);

    expect(await backfillLedger(db)).toMatchObject({ queued: 0, skipped: 4 });
    expect(await outbox()).toHaveLength(4);
  });

  test("sweepRecentLedger queues only recent rows the outbox misses", async () => {
    await insertPayment({ id: "apple:old", paidAt: PAID - 30 * DAY });
    await insertPayment({ id: "apple:new" });
    await insertPayment({ id: "apple:queued", user: "u2" });
    await enqueueLedger(db, "apple:queued", "paid");
    expect(await sweepRecentLedger(db, new Date(PAID + DAY))).toBe(1);
    expect((await outbox()).map((row) => row.externalId).sort()).toEqual(["apple:new", "apple:queued"]);
  });
});

describe("flushOutbox", () => {
  const config = { apiUrl: "https://rk.test", token: "rvt_x", siteId: "site-1" };
  const respond = (status: number) => {
    const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        body: JSON.parse(init.body as string),
      });
      return new Response("nope", { status });
    }) as unknown as typeof fetch;
    return { calls, fetcher };
  };

  test("no-op without a token or site id", async () => {
    await insertPayment({ id: "apple:1" });
    await enqueueLedger(db, "apple:1", "paid");
    expect(revklikConfig({ REVKLIK_SITE_ID: "s" })).toBeNull();
    expect(revklikConfig({ REVKLIK_TOKEN: "t" })).toBeNull();
    expect(await flushOutbox(db, null)).toEqual({ sent: 0, failed: 0, parked: 0 });
    expect((await outbox())[0]?.forwardedAt).toBeNull();
  });

  test("2xx delivers with site_id and bearer token, then never resends", async () => {
    await insertPayment({ id: "apple:1" });
    await enqueueLedger(db, "apple:1", "paid");
    const ok = respond(200);
    expect(await flushOutbox(db, config, { fetcher: ok.fetcher })).toEqual({ sent: 1, failed: 0, parked: 0 });
    expect(ok.calls[0]).toMatchObject({
      url: "https://rk.test/api/v1/events/server",
      auth: "Bearer rvt_x",
      body: { site_id: "site-1", external_id: "apple:1", name: "purchase", rail: "apple" },
    });
    expect(await flushOutbox(db, config, { fetcher: ok.fetcher })).toEqual({ sent: 0, failed: 0, parked: 0 });
    expect(ok.calls).toHaveLength(1);
  });

  test("4xx parks at once; 5xx retries with backoff and parks after 6 attempts", async () => {
    await insertPayment({ id: "apple:4xx" });
    await insertPayment({ id: "apple:5xx", user: "u2" });
    await enqueueLedger(db, "apple:4xx", "paid");
    await enqueueLedger(db, "apple:5xx", "paid");
    const bad = respond(400);
    const down = respond(503);
    const only = (id: string) => (r: typeof bad) => r.calls.filter((c) => c.body.external_id === id).length;

    let now = Date.now();
    const mixed = (async (url: string, init: RequestInit) =>
      (JSON.parse(init.body as string).external_id === "apple:4xx" ? bad : down).fetcher(url, init)) as unknown as typeof fetch;
    expect(await flushOutbox(db, config, { fetcher: mixed, now: () => now })).toEqual({ sent: 0, failed: 1, parked: 1 });
    expect(only("apple:4xx")(bad)).toBe(1);

    // Too early for attempt 2 of the 5xx row: nothing is sent.
    expect(await flushOutbox(db, config, { fetcher: mixed, now: () => now + 60_000 })).toEqual({ sent: 0, failed: 0, parked: 0 });

    let last = { sent: 0, failed: 0, parked: 0 };
    for (let i = 0; i < 5; i++) {
      now += 7 * 3600_000;
      last = await flushOutbox(db, config, { fetcher: mixed, now: () => now });
    }
    expect(last.parked).toBe(1);
    const rows = Object.fromEntries((await outbox()).map((row) => [row.externalId, row]));
    expect(rows["apple:5xx"]).toMatchObject({ attempts: 6, forwardedAt: null });
    expect(rows["apple:5xx"]?.lastError).toContain("503");
    expect(rows["apple:4xx"]).toMatchObject({ attempts: 6 });
    expect(await db.select().from(revklikOutbox).where(eq(revklikOutbox.externalId, "apple:4xx"))).toHaveLength(1);
  });
});
