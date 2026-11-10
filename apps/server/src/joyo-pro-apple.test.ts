import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { appleAccountToken } from "@joyorogo/api/lib/apple";
import { createTestAppleChain } from "@joyorogo/api/lib/apple-test-chain";
import type { TestAppleChain } from "@joyorogo/api/lib/apple-test-chain";
import { JOYOARTO_APPLE_BUNDLE_ID, JOYOROGO_APPLE_BUNDLE_ID } from "@joyorogo/auth/apple-audience";
import { account, user } from "@joyorogo/db/schema/auth";
import { d1TestDb } from "@joyorogo/db/test-d1";

import { INTERNAL_KEY_HEADER, JOYO_PRO_APPLE_PATH, registerJoyoProRoutes } from "./joyo-pro";

const KEY = "k".repeat(64);
const DAY = 24 * 60 * 60 * 1000;
const MONTHLY = "com.joyodigitama.joyoarto.pro.monthly";

const { client, db } = await d1TestDb();
let chain: TestAppleChain;
let app: Hono;

beforeAll(async () => {
  chain = await createTestAppleChain();
  app = new Hono();
  registerJoyoProRoutes(app, { env: { FREE_DAILY_SCANS: "3", JOYO_INTERNAL_KEY: KEY }, getDb: () => db, appleRootSha256: chain.rootSha256 });
});

beforeEach(async () => {
  await client.executeMultiple(`DELETE FROM apple_subscription; DELETE FROM payment; DELETE FROM account; DELETE FROM "user";`);
});

const ask = (body: unknown, key: string | null = KEY) =>
  app.request(JOYO_PRO_APPLE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { [INTERNAL_KEY_HEADER]: key }) },
    body: JSON.stringify(body),
  });

const tx = (overrides: Record<string, unknown> = {}) => {
  const now = Date.now();
  return chain.sign({
    transactionId: "5000",
    originalTransactionId: "5000",
    bundleId: JOYOARTO_APPLE_BUNDLE_ID,
    productId: MONTHLY,
    environment: "Production",
    signedDate: now,
    purchaseDate: now,
    expiresDate: now + 30 * DAY,
    price: 29_000_000,
    currency: "IDR",
    ...overrides,
  });
};

describe("appAccountToken", () => {
  test("401 without the key", async () => {
    expect((await ask({ email: "a@x.id" }, null)).status).toBe(401);
  });

  test("creates a verified JoyoRogo account with the Google id linked, once", async () => {
    const first = await ask({ googleSub: "g-1", email: "New@X.id", name: "Ani" });
    expect(first.status).toBe(200);
    const [row] = await db.select().from(user).where(eq(user.email, "new@x.id"));
    expect(row?.emailVerified).toBe(true);
    expect(row?.name).toBe("Ani");
    expect((await first.json()).appAccountToken).toBe(await appleAccountToken(row!.id));
    const links = await db.select().from(account).where(eq(account.accountId, "g-1"));
    expect(links).toHaveLength(1);
    expect(links[0]?.userId).toBe(row!.id);

    const again = await (await ask({ googleSub: "g-1", email: "new@x.id" })).json();
    expect(again.appAccountToken).toBe(await appleAccountToken(row!.id));
    expect(await db.select().from(user)).toHaveLength(1);
  });

  test("an existing account with the same Google id is used, whatever the email", async () => {
    await db.insert(user).values({ id: "u1", name: "U1", email: "old@x.id", emailVerified: true });
    await db.insert(account).values({ id: "a1", accountId: "g-2", providerId: "google", userId: "u1", updatedAt: new Date() });
    const body = await (await ask({ googleSub: "g-2", email: "other@x.id" })).json();
    expect(body.appAccountToken).toBe(await appleAccountToken("u1"));
    expect(await db.select().from(user)).toHaveLength(1);
  });

  test("an unverified account with the email is taken over and verified", async () => {
    await db.insert(user).values({ id: "u3", name: "U3", email: "half@x.id", emailVerified: false });
    const body = await (await ask({ email: "half@x.id" })).json();
    expect(body.appAccountToken).toBe(await appleAccountToken("u3"));
    const [row] = await db.select().from(user).where(eq(user.id, "u3"));
    expect(row?.emailVerified).toBe(true);
  });
});

describe("purchase", () => {
  test("a JoyoArto subscription grants Joyo Pro to the account", async () => {
    const res = await ask({ googleSub: "g-9", email: "buyer@x.id", signedTransaction: await tx() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("granted");
    expect(body.sandbox).toBe(false);
    expect(body.joyo.pro).toBe(true);
    expect(body.joyo.source).toBe("apple");

    const replay = await (await ask({ googleSub: "g-9", email: "buyer@x.id", signedTransaction: await tx() })).json();
    expect(replay.status).toBe("already");
  });

  test("a JoyoRogo product or bundle is refused here", async () => {
    const rogo = await tx({ bundleId: JOYOROGO_APPLE_BUNDLE_ID, productId: "com.joyodigitama.joyorogo.founder.monthly" });
    expect((await ask({ email: "buyer@x.id", signedTransaction: rogo })).status).toBe(400);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  test("a subscription linked to another account is refused", async () => {
    expect((await ask({ email: "one@x.id", signedTransaction: await tx() })).status).toBe(200);
    expect((await ask({ email: "two@x.id", signedTransaction: await tx({ transactionId: "5001" }) })).status).toBe(403);
  });

  test("a Sandbox purchase of an unlisted buyer is flagged", async () => {
    const body = await (await ask({ email: "tester@x.id", signedTransaction: await tx({ environment: "Sandbox" }) })).json();
    expect(body.sandbox).toBe(true);
  });
});
