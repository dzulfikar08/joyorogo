import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @libsql/client is a transitive dep of @joyorogo/db (its D1-shaped driver
// supports batch); resolved directly because packages/api doesn't declare it.
import { createClient } from "../../../db/node_modules/@libsql/client";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import { user } from "@joyorogo/db/schema/auth";
import { googlePurchase, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import type { GooglePlayClient, GoogleSubscription } from "./google-play";
import {
  handleGoogleNotification,
  revokeGoogleOrder,
  verifyGooglePurchase,
} from "./google-play-billing";
import type { GoogleBillingDeps } from "./google-play-billing";

const NOW = new Date(Date.UTC(2026, 9, 16, 3, 0, 0));
const TOKEN = "purchase-token-aaaaaaaa";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
const db = drizzle(client) as unknown as Database;

function sub(overrides: Partial<GoogleSubscription> = {}): GoogleSubscription {
  return {
    state: "active",
    acknowledged: false,
    test: false,
    accountId: null,
    productId: "pro",
    basePlanId: "monthly",
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    orderId: "GPA.1111-2222-3333-44444",
    priceIdr: 15000,
    ...overrides,
  };
}

type FakePlay = {
  play: GooglePlayClient;
  subs: Map<string, GoogleSubscription | null>;
  acks: string[];
};

/** Fake Android Publisher: tokens map to a mutable snapshot, acks are recorded. */
function fakeClient(): FakePlay {
  const subs = new Map<string, GoogleSubscription | null>();
  const acks: string[] = [];
  const play: GooglePlayClient = {
    async getSubscription(token) {
      if (!subs.has(token)) throw new Error("google subscriptionsv2.get 500");
      return subs.get(token) ?? null;
    },
    async acknowledge(productId, token) {
      acks.push(`${productId}:${token}`);
    },
  };
  return { play, subs, acks };
}

let fake: FakePlay;
let deps: GoogleBillingDeps;

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM google_purchase; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
  fake = fakeClient();
  deps = {
    db,
    client: fake.play,
    config: { testEmails: ["tester@test.id"] },
    fallbackPriceIdr: { monthly: 15000, yearly: 150000 },
    now: () => NOW,
  };
});

const until = async (id: string) =>
  (await db.select({ f: user.founderUntil }).from(user).where(eq(user.id, id)))[0]?.f ?? null;
const ledger = () => db.select().from(payment);
const links = () => db.select().from(googlePurchase);

describe("verifyGooglePurchase", () => {
  test("credits a monthly purchase, links the token, acknowledges after the credit", async () => {
    fake.subs.set(TOKEN, sub());
    const result = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 15000 });
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(fake.acks).toEqual([`pro:${TOKEN}`]);

    const [row] = await ledger();
    expect(row).toMatchObject({
      orderId: "google:GPA.1111-2222-3333-44444",
      userId: "u1",
      status: "paid",
      amountIdr: 15000,
      months: 1,
    });
    expect((await links())[0]).toMatchObject({
      purchaseToken: TOKEN,
      userId: "u1",
      basePlanId: "monthly",
      state: "active",
      latestOrderId: "GPA.1111-2222-3333-44444",
    });
  });

  test("yearly credits 12 months stacked on the remaining period", async () => {
    await client.execute(
      `UPDATE "user" SET founder_until = ${Date.UTC(2026, 11, 1)} WHERE id = 'u1'`,
    );
    fake.subs.set(TOKEN, sub({ basePlanId: "yearly", priceIdr: 150000 }));
    const result = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 150000 });
    expect((await until("u1"))?.toISOString()).toBe("2027-12-01T00:00:00.000Z");
    expect((await ledger())[0]?.months).toBe(12);
  });

  test("replaying the same token credits once and does not re-acknowledge an acknowledged purchase", async () => {
    fake.subs.set(TOKEN, sub());
    await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    fake.subs.set(TOKEN, sub({ acknowledged: true }));
    const again = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(again).toMatchObject({ ok: true, status: "already" });
    expect((await ledger()).length).toBe(1);
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(fake.acks.length).toBe(1);
  });

  test("a failed acknowledge is retried by the next replay without crediting twice", async () => {
    fake.subs.set(TOKEN, sub());
    const failing: GooglePlayClient = {
      ...fake.play,
      acknowledge: async () => {
        throw new Error("google subscriptions.acknowledge 500");
      },
    };
    await expect(
      verifyGooglePurchase({ ...deps, client: failing }, { purchaseToken: TOKEN, userId: "u1" }),
    ).rejects.toThrow("acknowledge");
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");

    const retry = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(retry).toMatchObject({ ok: true, status: "already" });
    expect(fake.acks).toEqual([`pro:${TOKEN}`]);
    expect((await ledger()).length).toBe(1);
  });

  test("a token linked to one account is refused for another, and grants nothing", async () => {
    fake.subs.set(TOKEN, sub());
    await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    const stolen = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u2" });
    expect(stolen).toEqual({ ok: false, error: "other-account" });
    expect(await until("u2")).toBeNull();
    expect((await links()).map((l) => l.userId)).toEqual(["u1"]);
  });

  test("a purchase the app made for another account (obfuscatedAccountId) is refused before linking", async () => {
    fake.subs.set(TOKEN, sub({ accountId: "u1" }));
    expect(await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u2" })).toEqual({
      ok: false,
      error: "other-account",
    });
    expect(await links()).toHaveLength(0);
    expect(await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" })).toMatchObject({
      ok: true,
      status: "granted",
    });
  });

  test("unknown tokens and wrong products or plans grant nothing", async () => {
    fake.subs.set("unknown-token-aaaa", null);
    expect(
      await verifyGooglePurchase(deps, { purchaseToken: "unknown-token-aaaa", userId: "u1" }),
    ).toEqual({
      ok: false,
      error: "invalid-token",
    });
    fake.subs.set("other-product-aaaa", sub({ productId: "something-else" }));
    fake.subs.set("other-plan-aaaaaaa", sub({ basePlanId: "weekly" }));
    fake.subs.set("no-plan-aaaaaaaaaa", sub({ basePlanId: null }));
    for (const token of ["other-product-aaaa", "other-plan-aaaaaaa", "no-plan-aaaaaaaaaa"]) {
      expect(await verifyGooglePurchase(deps, { purchaseToken: token, userId: "u1" })).toEqual({
        ok: false,
        error: "wrong-product",
      });
    }
    expect(await links()).toHaveLength(0);
    expect(await ledger()).toHaveLength(0);
    expect(await until("u1")).toBeNull();
  });

  test("a pending purchase is linked but neither credited nor acknowledged", async () => {
    fake.subs.set(TOKEN, sub({ state: "pending", orderId: null, expiresAt: null }));
    expect(await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" })).toEqual({
      ok: true,
      status: "pending",
    });
    expect(await until("u1")).toBeNull();
    expect(fake.acks).toEqual([]);
    expect((await links())[0]?.state).toBe("pending");

    // The buyer pays later: the same token now verifies as a purchase.
    fake.subs.set(TOKEN, sub());
    expect(await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" })).toMatchObject({
      ok: true,
      status: "granted",
    });
  });

  test("lapsed states (on hold, paused, expired, past expiry) credit nothing", async () => {
    for (const [i, override] of [
      { state: "hold" as const },
      { state: "paused" as const },
      { state: "expired" as const },
      { state: "active" as const, expiresAt: new Date(NOW.getTime() - 1000) },
    ].entries()) {
      const token = `lapsed-token-${i}-aaaa`;
      fake.subs.set(token, sub(override));
      expect(await verifyGooglePurchase(deps, { purchaseToken: token, userId: "u1" })).toEqual({
        ok: true,
        status: "inactive",
      });
    }
    expect(await until("u1")).toBeNull();
    expect(fake.acks).toEqual([]);
  });

  test("canceled (still running) and grace-period subscriptions are entitled", async () => {
    fake.subs.set("canceled-token-aaaa", sub({ state: "canceled", orderId: "GPA.C" }));
    fake.subs.set("grace-token-aaaaaaa", sub({ state: "grace", orderId: "GPA.G" }));
    for (const token of ["canceled-token-aaaa", "grace-token-aaaaaaa"]) {
      expect(
        await verifyGooglePurchase(deps, { purchaseToken: token, userId: "u1" }),
      ).toMatchObject({
        ok: true,
        status: "granted",
      });
    }
  });

  test("license-tester purchase: 24h at Rp0 unless the buyer is allowlisted", async () => {
    fake.subs.set(TOKEN, sub({ test: true }));
    const trial = await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(trial).toMatchObject({ ok: true, status: "granted", amountIdr: 0 });
    expect((await until("u1"))?.toISOString()).toBe("2026-10-17T03:00:00.000Z");

    await client.execute(`UPDATE "user" SET email = 'Tester@test.id' WHERE id = 'u2'`);
    fake.subs.set("tester-token-aaaaaa", sub({ test: true, orderId: "GPA.T" }));
    const full = await verifyGooglePurchase(deps, {
      purchaseToken: "tester-token-aaaaaa",
      userId: "u2",
    });
    expect(full).toMatchObject({ ok: true, status: "granted", amountIdr: 15000 });
    expect((await until("u2"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });

  test("uses the configured plan price when Play does not bill in IDR", async () => {
    fake.subs.set(TOKEN, sub({ priceIdr: null, basePlanId: "yearly" }));
    expect(await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" })).toMatchObject({
      status: "granted",
      amountIdr: 150000,
    });
  });

  test("two concurrent submissions of one token credit exactly once", async () => {
    fake.subs.set(TOKEN, sub());
    const results = await Promise.all([
      verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" }),
      verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" }),
    ]);
    expect(results.filter((r) => r.ok && r.status === "granted")).toHaveLength(1);
    expect((await ledger()).filter((p) => p.status === "paid")).toHaveLength(1);
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });

  test("a Play outage surfaces as a throw and credits nothing", async () => {
    await expect(
      verifyGooglePurchase(deps, { purchaseToken: "never-seen-token-a", userId: "u1" }),
    ).rejects.toThrow("500");
    expect(await ledger()).toHaveLength(0);
  });
});

describe("handleGoogleNotification", () => {
  const renewal = (type = 2) => ({
    packageName: "com.joyodigitama.joyorogo",
    subscription: { notificationType: type, purchaseToken: TOKEN, subscriptionId: "pro" },
    test: false,
  });

  async function purchased() {
    fake.subs.set(TOKEN, sub({ orderId: "GPA.1111-2222-3333-44444" }));
    await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    fake.subs.set(TOKEN, sub({ acknowledged: true, orderId: "GPA.1111-2222-3333-44444" }));
  }

  test("a renewal credits the new order once, even when the notification is redelivered", async () => {
    await purchased();
    fake.subs.set(
      TOKEN,
      sub({
        acknowledged: true,
        orderId: "GPA.1111-2222-3333-44444..0",
        expiresAt: new Date(NOW.getTime() + 60 * 86_400_000),
      }),
    );
    const first = await handleGoogleNotification(deps, renewal());
    expect(first).toEqual({
      kind: "synced",
      granted: { userId: "u1", orderId: "GPA.1111-2222-3333-44444..0", amountIdr: 15000 },
    });
    expect((await until("u1"))?.toISOString()).toBe("2026-12-16T03:00:00.000Z");
    const again = await handleGoogleNotification(deps, renewal());
    expect(again).toEqual({ kind: "synced", granted: null });
    expect((await until("u1"))?.toISOString()).toBe("2026-12-16T03:00:00.000Z");
    expect((await ledger()).map((p) => p.orderId).sort()).toEqual([
      "google:GPA.1111-2222-3333-44444",
      "google:GPA.1111-2222-3333-44444..0",
    ]);
  });

  test("a pending purchase that completes is credited from its notification", async () => {
    fake.subs.set(TOKEN, sub({ state: "pending", orderId: null, expiresAt: null }));
    await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    fake.subs.set(TOKEN, sub());
    const result = await handleGoogleNotification(deps, renewal(4));
    expect(result.granted).toMatchObject({ userId: "u1", amountIdr: 15000 });
    expect(fake.acks).toEqual([`pro:${TOKEN}`]);
  });

  test("cancellation and expiry credit nothing and keep the period already paid for", async () => {
    await purchased();
    fake.subs.set(TOKEN, sub({ state: "canceled", acknowledged: true }));
    expect(await handleGoogleNotification(deps, renewal(3))).toEqual({
      kind: "synced",
      granted: null,
    });
    fake.subs.set(TOKEN, sub({ state: "expired", acknowledged: true }));
    expect(await handleGoogleNotification(deps, renewal(13))).toEqual({
      kind: "synced",
      granted: null,
    });
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect((await links())[0]?.state).toBe("expired");
  });

  test("notifications for unlinked tokens, other products, and test pings are ignored", async () => {
    expect(await handleGoogleNotification(deps, renewal())).toEqual({
      kind: "ignored",
      granted: null,
    });
    fake.subs.set(TOKEN, sub({ productId: "other" }));
    await client.execute(
      `INSERT INTO google_purchase (purchase_token, user_id, product_id, base_plan_id, state) VALUES ('${TOKEN}', 'u1', 'other', 'monthly', 'active')`,
    );
    expect(await handleGoogleNotification(deps, renewal())).toEqual({
      kind: "ignored",
      granted: null,
    });
    expect(await handleGoogleNotification(deps, { packageName: "p", test: true })).toEqual({
      kind: "ignored",
      granted: null,
    });
    expect(await ledger()).toHaveLength(0);
  });

  test("a refund (voided purchase) takes back that order's months, once", async () => {
    await purchased();
    fake.subs.set(
      TOKEN,
      sub({
        acknowledged: true,
        orderId: "GPA.1111-2222-3333-44444..0",
        expiresAt: new Date(NOW.getTime() + 60 * 86_400_000),
      }),
    );
    await handleGoogleNotification(deps, renewal());
    expect((await until("u1"))?.toISOString()).toBe("2026-12-16T03:00:00.000Z");

    const voided = {
      packageName: "com.joyodigitama.joyorogo",
      voided: { purchaseToken: TOKEN, orderId: "GPA.1111-2222-3333-44444..0", productType: 1 },
      test: false,
    };
    expect(await handleGoogleNotification(deps, voided)).toEqual({
      kind: "revoked",
      granted: null,
    });
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(await handleGoogleNotification(deps, voided)).toEqual({
      kind: "ignored",
      granted: null,
    });
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");

    // The refunded order is never credited again, even if Play still reports it.
    fake.subs.set(TOKEN, sub({ acknowledged: true, orderId: "GPA.1111-2222-3333-44444..0" }));
    expect(await handleGoogleNotification(deps, renewal())).toEqual({
      kind: "synced",
      granted: null,
    });
    expect((await until("u1"))?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });

  test("SUBSCRIPTION_REVOKED revokes the latest charged order; one-time-product voids are ignored", async () => {
    await purchased();
    expect(await handleGoogleNotification(deps, renewal(12))).toEqual({
      kind: "revoked",
      granted: null,
    });
    expect(((await until("u1")) as Date).getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(
      await handleGoogleNotification(deps, {
        packageName: "p",
        voided: { purchaseToken: "t", orderId: "GPA.1", productType: 2 },
        test: false,
      }),
    ).toEqual({ kind: "ignored", granted: null });
  });

  test("a Play outage rethrows so Pub/Sub redelivers", async () => {
    await purchased();
    fake.subs.delete(TOKEN);
    await expect(handleGoogleNotification(deps, renewal())).rejects.toThrow("500");
  });
});

describe("revokeGoogleOrder", () => {
  test("unknown orders and zero-revenue tester trials are left alone", async () => {
    expect(await revokeGoogleOrder(deps, "GPA.nope")).toBe("none");
    fake.subs.set(TOKEN, sub({ test: true }));
    await verifyGooglePurchase(deps, { purchaseToken: TOKEN, userId: "u1" });
    expect(await revokeGoogleOrder(deps, "GPA.1111-2222-3333-44444")).toBe("none");
    expect((await until("u1"))?.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });
});
