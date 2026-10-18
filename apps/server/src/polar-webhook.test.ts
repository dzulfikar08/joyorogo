import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @libsql/client is a transitive dep of @joyorogo/db; resolved directly because the server doesn't declare it.
import { createClient } from "../../../packages/db/node_modules/@libsql/client";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import { user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import { registerBillingRoutes } from "./billing";
import type { BillingEnv } from "./billing";

// billing.ts reaches the Workers runtime through ./context; the route needs nothing from it.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { registerBillingRoutes } = await import("./billing");
const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../packages/db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
const db = drizzle(client) as unknown as Database;

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
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

async function deliver(id: string, body: string, signedWith = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const keyBytes = new Uint8Array(Buffer.from(signedWith.slice(6), "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return app.request(
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
});
