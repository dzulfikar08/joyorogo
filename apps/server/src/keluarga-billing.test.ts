import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import { WEBHOOK_TARGET, signRequest } from "@joyorogo/api/lib/doku";
import { proUntil } from "@joyorogo/api/lib/household";
import { user } from "@joyorogo/db/schema/auth";
import { eq } from "drizzle-orm";

import type { BillingEnv } from "./billing";

// Joyo Keluarga on web rupiah (docs/pricing/joyo-keluarga.md section 4.1): price = 2x the Pro step, one price lock with
// Pro, months credited to the payer's household, never to their own founder_until.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { registerBillingRoutes } = await import("./billing");
const { founderEmailsDue } = await import("./email");
const { client, db } = await d1TestDb();

const DAY = 24 * 60 * 60 * 1000;
const SECRET = "doku-secret";
const baseEnv = {
  BETTER_AUTH_URL: "https://api.test",
  FREE_DAILY_SCANS: "3",
  FOUNDER_PRICE_LADDER: "10:15000/149000,60:29000/199000,:49000/349000",
  DOKU_CLIENT_ID: "doku-client",
  DOKU_SECRET_KEY: SECRET,
  DOKU_BASE_URL: "https://doku.test",
} as BillingEnv;

let signedIn = "payer";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
function appWith(env: BillingEnv) {
  const app = new Hono();
  registerBillingRoutes(app, {
    env,
    getDb: () => db,
    createAuth: async () =>
      ({
        api: {
          getSession: async () => ({ user: { id: signedIn, email: `${signedIn}@test.id`, name: signedIn } }),
        },
      }) as never,
  });
  return app;
}
const on = appWith({ ...baseEnv, KELUARGA_ENABLED: "1" });
const off = appWith(baseEnv);

const dokuItems: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://doku.test")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { order?: { line_items?: { name: string }[] } };
    dokuItems.push(body.order?.line_items?.[0]?.name ?? "");
    return new Response(JSON.stringify({ response: { payment: { url: "https://pay.test/x" } } }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function checkout(app: Hono, body: Record<string, unknown>) {
  const res = await app.request(
    "/api/billing/checkout",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    {},
    ctx,
  );
  return { status: res.status, body: (await res.json()) as { orderId?: string; error?: string } };
}

async function payViaDoku(orderId: string) {
  const [row] = (await client.execute({ sql: `SELECT amount_idr FROM payment WHERE order_id = ?`, args: [orderId] })).rows;
  const raw = JSON.stringify({ order: { invoice_number: orderId, amount: Number(row?.amount_idr) }, transaction: { status: "SUCCESS" } });
  const headers = { clientId: "doku-client", requestId: crypto.randomUUID(), timestamp: new Date().toISOString().slice(0, 19) + "Z" };
  const signature = await signRequest({ ...headers, target: WEBHOOK_TARGET, body: raw }, SECRET);
  return on.request(
    WEBHOOK_TARGET,
    {
      method: "POST",
      headers: {
        "Client-Id": headers.clientId,
        "Request-Id": headers.requestId,
        "Request-Timestamp": headers.timestamp,
        Signature: signature,
      },
      body: raw,
    },
    {},
    ctx,
  );
}

async function config(app: Hono) {
  const res = await app.request("/api/config", {}, {}, ctx);
  return (await res.json()) as {
    founderPriceIdr: number;
    founderYearlyPriceIdr: number;
    keluarga: { monthlyIdr: number; yearlyIdr: number; seats: number } | null;
  };
}

/** n distinct earlier buyers, to move the ladder. */
async function buyers(n: number) {
  for (let i = 0; i < n; i++) {
    await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, 'x', ?)`, args: [`b${i}`, `b${i}@test.id`] });
    await client.execute({
      sql: `INSERT INTO payment (order_id, user_id, amount_idr, status, months) VALUES (?, ?, 15000, 'paid', 1)`,
      args: [`old-${i}`, `b${i}`],
    });
  }
}

beforeEach(async () => {
  signedIn = "payer";
  dokuItems.length = 0;
  await client.executeMultiple(`
    DELETE FROM email_log; DELETE FROM household_event; DELETE FROM household_invite; DELETE FROM household_member;
    DELETE FROM household; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('payer', 'Payer', 'payer@test.id'), ('member', 'M', 'member@test.id');
  `);
});

describe("Joyo Keluarga web rupiah", () => {
  test("/api/config: null while off; 2x the current Pro step while on", async () => {
    expect((await config(off)).keluarga).toBeNull();
    await buyers(10); // step 2: Rp29.000 / Rp199.000
    const c = await config(on);
    expect(c.founderPriceIdr).toBe(29_000);
    expect(c.keluarga).toEqual({ monthlyIdr: 58_000, yearlyIdr: 398_000, seats: 5, usd: null });
  });

  test("checkout is 404 while the flag is off", async () => {
    expect((await checkout(off, { plan: "monthly", product: "keluarga" })).status).toBe(404);
  });

  test("checkout charges 2x the Pro step, names the item, tags the row", async () => {
    await buyers(10);
    const { status, body } = await checkout(on, { plan: "yearly", product: "keluarga", method: "transfer" });
    expect(status).toBe(200);
    const [row] = (await client.execute({ sql: `SELECT amount_idr, months, product FROM payment WHERE order_id = ?`, args: [body.orderId!] })).rows;
    expect(row).toMatchObject({ amount_idr: 398_000, months: 12, product: "keluarga" });
    expect(dokuItems).toEqual(["Joyo Keluarga 1 tahun"]);
  });

  test("one price lock: a Pro buyer at Rp15.000 gets Keluarga at Rp30.000, and a Keluarga row locks Pro", async () => {
    await buyers(60); // step 3: Rp49.000
    await client.execute(`INSERT INTO payment (order_id, user_id, amount_idr, status, months) VALUES ('mine', 'payer', 15000, 'paid', 1)`);
    const keluarga = await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" });
    const [k] = (await client.execute({ sql: `SELECT amount_idr FROM payment WHERE order_id = ?`, args: [keluarga.body.orderId!] })).rows;
    expect(k?.amount_idr).toBe(30_000);

    signedIn = "member";
    await client.execute(`INSERT INTO payment (order_id, user_id, amount_idr, status, months, product) VALUES ('fam', 'member', 58000, 'paid', 1, 'keluarga')`);
    const pro = await checkout(on, { plan: "monthly", method: "transfer" });
    const [p] = (await client.execute({ sql: `SELECT amount_idr, product FROM payment WHERE order_id = ?`, args: [pro.body.orderId!] })).rows;
    expect(p).toMatchObject({ amount_idr: 29_000, product: null });
  });

  test("payment credits the household, not the payer's own period; renewals stack", async () => {
    const own = Date.now() + 5 * DAY;
    await client.execute({ sql: `UPDATE "user" SET founder_until = ? WHERE id = 'payer'`, args: [own] });
    const first = await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" });
    expect((await payViaDoku(first.body.orderId!)).status).toBe(200);
    const [h1] = (await client.execute(`SELECT paid_until FROM household`)).rows;
    const [u] = (await client.execute(`SELECT founder_until FROM "user" WHERE id = 'payer'`)).rows;
    expect(Number(u?.founder_until)).toBe(own);
    expect(Number(h1?.paid_until)).toBeGreaterThan(Date.now() + 27 * DAY);
    // Delivered twice: credited once.
    expect((await payViaDoku(first.body.orderId!)).status).toBe(200);
    const second = await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" });
    await payViaDoku(second.body.orderId!);
    const [h2] = (await client.execute(`SELECT paid_until FROM household`)).rows;
    expect(Number(h2?.paid_until)).toBeGreaterThan(Number(h1?.paid_until) + 27 * DAY);
    const [owner] = (await client.execute(`SELECT role FROM household_member WHERE user_id = 'payer'`)).rows;
    expect(owner?.role).toBe("owner");
  });

  test("a member of another household cannot buy Keluarga (409)", async () => {
    signedIn = "member";
    await client.executeMultiple(`
      INSERT INTO household (id, owner_id, paid_until) VALUES ('h', 'payer', ${Date.now() + DAY});
      INSERT INTO household_member (household_id, user_id, role) VALUES ('h', 'payer', 'owner'), ('h', 'member', 'member');
    `);
    expect((await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" })).status).toBe(409);
  });

  test("a Keluarga payer counts once in the ladder; members never", async () => {
    await buyers(9);
    const first = await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" });
    await payViaDoku(first.body.orderId!);
    // 10 buyers now: step 2.
    expect((await config(on)).founderPriceIdr).toBe(29_000);
    const second = await checkout(on, { plan: "monthly", product: "keluarga", method: "transfer" });
    await payViaDoku(second.body.orderId!);
    await client.execute(`INSERT INTO household_member (household_id, user_id, role) SELECT id, 'member', 'member' FROM household`);
    const count = (await client.execute(`SELECT count(distinct user_id) AS n FROM payment WHERE status = 'paid' AND amount_idr > 0`)).rows[0];
    expect(Number(count?.n)).toBe(10);
  });

  test("expiry mails skip a person whose household covers them past their own period", async () => {
    const soon = Date.now() + DAY;
    await client.executeMultiple(`
      UPDATE "user" SET founder_until = ${soon} WHERE id IN ('payer', 'member');
      INSERT INTO household (id, owner_id, paid_until) VALUES ('h', 'payer', ${Date.now() + 30 * DAY});
      INSERT INTO household_member (household_id, user_id, role) VALUES ('h', 'payer', 'owner');
    `);
    const due = await db.select({ id: user.id }).from(user).where(founderEmailsDue(Date.now()));
    expect(due.map((r) => r.id)).toEqual(["member"]);
    const [payer] = await db.select({ until: proUntil }).from(user).where(eq(user.id, "payer"));
    expect(payer?.until?.getTime()).toBeGreaterThan(soon);
  });
});
