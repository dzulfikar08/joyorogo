import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import { googlePurchase, payment } from "@joyorogo/db/schema/billing";

// google-billing.ts reaches the Workers runtime through ./context; the routes need nothing from it.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { registerGooglePlayRoutes } = await import("./google-billing");
const { client, db } = await d1TestDb();

const ROGO = "com.joyodigitama.joyorogo";
const FIT = "com.joyodigitama.joyofit";
const FIT_MONTHLY = `${FIT}.pro.monthly`;
const FIT_YEARLY = `${FIT}.pro.yearly`;
const TOKEN = "purchase-token-aaaaaaaa";

async function serviceAccountJson() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n");
  return JSON.stringify({
    client_email: "svc@p.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
  });
}

const baseEnv = {
  BETTER_AUTH_URL: "https://api.test",
  FREE_DAILY_SCANS: "3",
  FOUNDER_PRICE_IDR: "29000",
  FOUNDER_YEARLY_PRICE_IDR: "199000",
  GOOGLE_PLAY_RTDN_TOKEN: "rtdn-secret",
};

type Env = Parameters<typeof registerGooglePlayRoutes>[1]["env"];

/** Play answers per package: package -> token -> SubscriptionPurchaseV2 JSON. */
const play = new Map<string, Map<string, unknown>>();
const publisherCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return Response.json({ access_token: "at", expires_in: 3600 });
    }
    publisherCalls.push(`${init?.method ?? "GET"} ${decodeURIComponent(url.split("/applications/")[1] ?? url)}`);
    const [, pkg = "", rest = ""] = /applications\/([^/]+)\/(.*)$/.exec(url) ?? [];
    if (rest.includes(":acknowledge")) return Response.json({});
    const token = decodeURIComponent(rest.split("/tokens/")[1] ?? "");
    const found = play.get(decodeURIComponent(pkg))?.get(token);
    return found ? Response.json(found) : new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function subscription(productId: string, basePlanId: string, order = "GPA.1111-2222-3333-44444") {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    latestOrderId: order,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    startTime: "2026-10-16T03:00:00Z",
    lineItems: [
      {
        productId,
        expiryTime: "2099-01-01T00:00:00Z",
        offerDetails: { basePlanId },
        autoRenewingPlan: { recurringPrice: { currencyCode: "IDR", units: "29000" } },
      },
    ],
  };
}

async function build(extra: Record<string, string> = {}) {
  const app = new Hono();
  registerGooglePlayRoutes(app, {
    env: { ...baseEnv, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: await serviceAccountJson(), ...extra } as Env,
    getDb: () => db,
    createAuth: async () =>
      ({
        api: {
          getSession: async ({ headers }: { headers: Headers }) =>
            headers.get("x-test-user") ? { user: { id: headers.get("x-test-user") } } : null,
        },
      }) as never,
  });
  return app;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

function verify(app: Hono, body: unknown, user: string | null = "u1") {
  return app.request(
    "/api/billing/google",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: JSON.stringify(body),
    },
    undefined,
    ctx,
  );
}

function rtdn(app: Hono, message: unknown) {
  const data = Buffer.from(JSON.stringify(message)).toString("base64url");
  return app.request(
    "/api/billing/google/rtdn?token=rtdn-secret",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { data } }) },
    undefined,
    ctx,
  );
}

let app: Hono;
beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM google_purchase; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
  play.clear();
  publisherCalls.length = 0;
  app = await build();
});

describe("POST /api/billing/google", () => {
  test("no packageName is JoyoRogo's app (deployed clients)", async () => {
    play.set(ROGO, new Map([[TOKEN, subscription("pro", "monthly")]]));
    const res = await verify(app, { purchaseToken: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "granted", activated: true });
    expect((await db.select().from(googlePurchase))[0]).toMatchObject({ packageName: ROGO });
    expect(publisherCalls[0]).toContain(`${ROGO}/purchases/subscriptionsv2`);
  });

  test("JoyoFit monthly and yearly credit 1 and 12 months under JoyoFit's package", async () => {
    play.set(FIT, new Map([[TOKEN, subscription(FIT_MONTHLY, "monthly")]]));
    const monthly = await verify(app, { purchaseToken: TOKEN, packageName: FIT });
    expect(await monthly.json()).toMatchObject({ status: "granted", activated: true });

    play.set(FIT, new Map([["yearly-token-aaaaaa", subscription(FIT_YEARLY, "yearly", "GPA.9999-8888-7777-66666")]]));
    const yearly = await verify(app, { purchaseToken: "yearly-token-aaaaaa", packageName: FIT }, "u2");
    expect(await yearly.json()).toMatchObject({ status: "granted" });

    expect((await db.select().from(payment)).map((row) => row.months).sort()).toEqual([1, 12]);
    expect((await db.select().from(googlePurchase)).map((row) => row.packageName)).toEqual([FIT, FIT]);
    expect(publisherCalls.some((call) => call.startsWith(`GET ${ROGO}`))).toBe(false);
    expect(publisherCalls.some((call) => call.startsWith(`POST ${FIT}/purchases/subscriptions/${FIT_MONTHLY}/`))).toBe(true);
  });

  test("a product of the other package is invalid both ways", async () => {
    play.set(FIT, new Map([[TOKEN, subscription("pro", "monthly")]]));
    play.set(ROGO, new Map([["rogo-token-aaaaaaa", subscription(FIT_MONTHLY, "monthly")]]));
    for (const body of [
      { purchaseToken: TOKEN, packageName: FIT },
      { purchaseToken: "rogo-token-aaaaaaa" },
    ]) {
      const res = await verify(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalidReceipt" });
    }
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("an unknown or disabled package is 400 without asking Play", async () => {
    for (const packageName of ["com.example.other", 7, ""]) {
      const res = await verify(app, { purchaseToken: TOKEN, packageName });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalidReceipt" });
    }
    const only = await build({ GOOGLE_PLAY_PACKAGE_NAMES: ROGO });
    const res = await verify(only, { purchaseToken: TOKEN, packageName: FIT });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalidReceipt" });
    expect(publisherCalls).toHaveLength(0);
  });

  test("every error response carries a stable code next to the error text", async () => {
    const signIn = await verify(app, { purchaseToken: TOKEN }, null);
    expect(signIn.status).toBe(401);
    expect(await signIn.json()).toMatchObject({ code: "signIn", error: expect.any(String) });

    const malformed = await verify(app, { purchaseToken: "x" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "invalidReceipt" });

    const unknown = await verify(app, { purchaseToken: "never-seen-token-a" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "invalidReceipt" });

    play.set(ROGO, new Map([[TOKEN, subscription("pro", "monthly")]]));
    expect((await verify(app, { purchaseToken: TOKEN })).status).toBe(200);
    const other = await verify(app, { purchaseToken: TOKEN }, "u2");
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ code: "otherAccount" });

    const off = await build({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "" });
    const unavailable = await verify(off, { purchaseToken: TOKEN });
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toMatchObject({ code: "unavailable" });
  });

  test("an unreachable Play is 502 with its code", async () => {
    const failing = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("oauth2")
        ? Response.json({ access_token: "at", expires_in: 3600 })
        : new Response("{}", { status: 500 })) as typeof fetch;
    try {
      const res = await verify(await build(), { purchaseToken: TOKEN });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "unreachable" });
    } finally {
      globalThis.fetch = failing;
    }
  });
});

describe("POST /api/billing/google/rtdn", () => {
  test("a JoyoFit notification is re-read under JoyoFit's package and credits the renewal", async () => {
    play.set(FIT, new Map([[TOKEN, subscription(FIT_MONTHLY, "monthly")]]));
    expect((await verify(app, { purchaseToken: TOKEN, packageName: FIT })).status).toBe(200);
    publisherCalls.length = 0;
    play.set(FIT, new Map([[TOKEN, subscription(FIT_MONTHLY, "monthly", "GPA.1111-2222-3333-44444..0")]]));

    const res = await rtdn(app, {
      packageName: FIT,
      subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN, subscriptionId: FIT_MONTHLY },
    });
    expect(res.status).toBe(204);
    expect(publisherCalls[0]).toContain(`${FIT}/purchases/subscriptionsv2`);
    expect((await db.select().from(payment)).map((row) => row.orderId).sort()).toEqual([
      "google:GPA.1111-2222-3333-44444",
      "google:GPA.1111-2222-3333-44444..0",
    ]);
  });

  test("a notification for a package that is not enabled is acknowledged and ignored", async () => {
    play.set(FIT, new Map([[TOKEN, subscription(FIT_MONTHLY, "monthly")]]));
    const only = await build({ GOOGLE_PLAY_PACKAGE_NAMES: ROGO });
    for (const packageName of [FIT, "com.example.other"]) {
      const res = await rtdn(only, {
        packageName,
        subscriptionNotification: { notificationType: 4, purchaseToken: TOKEN, subscriptionId: FIT_MONTHLY },
      });
      expect(res.status).toBe(204);
    }
    expect(publisherCalls).toHaveLength(0);
  });
});
