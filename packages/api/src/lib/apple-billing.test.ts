import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { appleSubscription, payment } from "@joyorogo/db/schema/billing";

import {
  DEFAULT_APPLE_BUNDLE_ID,
  DEFAULT_APPLE_SUB_MONTHLY_PRODUCT_ID,
  DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID,
  appleAccountToken,
  verifyAppleNotificationJws,
} from "./apple";
import type { AppleVerifyOptions } from "./apple";
import { handleAppleNotification, redeemAppleTransaction } from "./apple-billing";
import type { AppleBillingDeps } from "./apple-billing";
import { createTestAppleChain } from "./apple-test-chain";
import type { TestAppleChain } from "./apple-test-chain";

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 16, 3, 0, 0));
const MONTHLY = DEFAULT_APPLE_SUB_MONTHLY_PRODUCT_ID;

const { client, db } = await d1TestDb();

let chain: TestAppleChain;
let opts: AppleVerifyOptions;
let deps: AppleBillingDeps;

beforeAll(async () => {
  chain = await createTestAppleChain();
  opts = {
    rootSha256: chain.rootSha256,
    bundleId: DEFAULT_APPLE_BUNDLE_ID,
    productIds: [MONTHLY, DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID],
  };
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM apple_subscription; DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
  deps = {
    db,
    now: () => NOW,
    config: {
      subscriptionIds: { monthly: MONTHLY, yearly: DEFAULT_APPLE_SUB_YEARLY_PRODUCT_ID },
      sandboxAllowlist: "u1@test.id",
      fallbackPriceIdr: { monthly: 29_000, yearly: 199_000 },
    },
  };
});

type TxOverrides = Record<string, unknown>;

const txPayload = (overrides: TxOverrides = {}) => ({
  transactionId: "1000",
  originalTransactionId: "900",
  bundleId: DEFAULT_APPLE_BUNDLE_ID,
  productId: MONTHLY,
  environment: "Production",
  signedDate: NOW.getTime(),
  purchaseDate: NOW.getTime(),
  expiresDate: NOW.getTime() + 30 * DAY,
  price: 29_000_000,
  currency: "IDR",
  ...overrides,
});

/** A verified notification built through the real JWS path. */
async function notify(
  notificationType: string,
  subtype: string | undefined,
  tx: TxOverrides | null,
  extra: { renewal?: Record<string, unknown>; environment?: string } = {},
) {
  const data: Record<string, unknown> = {
    environment: extra.environment ?? "Production",
    bundleId: DEFAULT_APPLE_BUNDLE_ID,
  };
  if (tx) {
    data.signedTransactionInfo = await chain.sign(
      txPayload({ environment: data.environment, ...tx }),
    );
  }
  if (extra.renewal) data.signedRenewalInfo = await chain.sign({
    signedDate: NOW.getTime(),
    ...extra.renewal,
  });
  const signedPayload = await chain.sign({
    notificationType,
    subtype,
    notificationUUID: `uuid-${notificationType}`,
    version: "2.0",
    signedDate: NOW.getTime(),
    data,
  });
  const verified = await verifyAppleNotificationJws(signedPayload, opts);
  if (!verified.ok) throw new Error(`fixture rejected: ${verified.reason}`);
  return verified.notification;
}

const founderUntil = async (id: string) =>
  (await db.select({ v: user.founderUntil }).from(user).where(eq(user.id, id)))[0]?.v ?? null;

/** Buys the monthly subscription for u1 through the client route's core. */
async function redeemFor(userId: string, overrides: TxOverrides = {}) {
  const n = await notify("TEST", undefined, txPayload(overrides));
  return redeemAppleTransaction(deps, {
    userId,
    email: `${userId}@test.id`,
    transaction: n.transaction!,
  });
}

describe("verifyAppleNotificationJws", () => {
  test("rejects a payload signed by an untrusted root", async () => {
    const other = await createTestAppleChain();
    const signed = await other.sign({ notificationType: "TEST", signedDate: NOW.getTime() });
    const result = await verifyAppleNotificationJws(signed, opts);
    expect(result.ok).toBe(false);
  });

  test("rejects another app's bundle id", async () => {
    const signed = await chain.sign({
      notificationType: "TEST",
      signedDate: NOW.getTime(),
      data: { bundleId: "com.other.app", environment: "Production" },
    });
    const result = await verifyAppleNotificationJws(signed, opts);
    expect(result).toEqual({ ok: false, reason: "bundle" });
  });

  test("decodes transaction and renewal info", async () => {
    const n = await notify("DID_RENEW", undefined, txPayload(), {
      renewal: { originalTransactionId: "900", autoRenewStatus: 1 },
    });
    expect(n.transaction?.originalTransactionId).toBe("900");
    expect(n.transaction?.expiresDate?.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(n.renewalInfo?.autoRenewStatus).toBe(1);
  });
});

describe("appleAccountToken", () => {
  test("is a stable UUID per user", async () => {
    const a = await appleAccountToken("u1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await appleAccountToken("u1")).toBe(a);
    expect(await appleAccountToken("u2")).not.toBe(a);
  });
});

describe("redeemAppleTransaction", () => {
  test("grants founderUntil = expiresDate and links the subscription", async () => {
    const result = await redeemFor("u1");
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 29_000 });
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 30 * DAY);
    const [link] = await db.select().from(appleSubscription);
    expect(link).toMatchObject({ originalTransactionId: "900", userId: "u1", state: "active" });
    const [row] = await db.select().from(payment);
    expect(row).toMatchObject({ orderId: "apple:1000", status: "paid", amountIdr: 29_000 });
  });

  test("replay of the same transaction extends once", async () => {
    await redeemFor("u1");
    const again = await redeemFor("u1");
    expect(again).toMatchObject({ ok: true, status: "already" });
    expect(await db.select().from(payment)).toHaveLength(1);
  });

  test("another account cannot take over a linked subscription", async () => {
    await redeemFor("u1");
    const stolen = await redeemFor("u2", { transactionId: "1001" });
    expect(stolen).toEqual({ ok: false, error: "other-account" });
    expect(await founderUntil("u2")).toBeNull();
  });

  test("rejects a transaction bought with another account's appAccountToken", async () => {
    const token = await appleAccountToken("u2");
    expect(await redeemFor("u1", { appAccountToken: token })).toEqual({
      ok: false,
      error: "other-account",
    });
    const own = await redeemFor("u1", { appAccountToken: await appleAccountToken("u1") });
    expect(own).toMatchObject({ ok: true, status: "granted" });
  });

  test("non-allowlisted sandbox buyer gets one day at zero revenue", async () => {
    const result = await redeemFor("u2", { environment: "Sandbox" });
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 0 });
    expect((await founderUntil("u2"))?.getTime()).toBe(NOW.getTime() + DAY);
  });

  test("allowlisted sandbox buyer gets the full period", async () => {
    await redeemFor("u1", { environment: "Sandbox" });
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  test("an already-expired subscription transaction grants nothing", async () => {
    const result = await redeemFor("u1", { expiresDate: NOW.getTime() - DAY });
    expect(result).toMatchObject({ ok: true, status: "inactive" });
    expect(await founderUntil("u1")).toBeNull();
  });
});

describe("handleAppleNotification", () => {
  test("TEST is acknowledged", async () => {
    const n = await notify("TEST", undefined, null);
    expect((await handleAppleNotification(deps, n)).kind).toBe("test");
  });

  test("verified but unmapped notification is acknowledged, nothing granted", async () => {
    const n = await notify("DID_RENEW", undefined, txPayload());
    const result = await handleAppleNotification(deps, n);
    expect(result.kind).toBe("unmapped");
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("SUBSCRIBED for a linked user extends to expiresDate and records the payment", async () => {
    await redeemFor("u1");
    const n = await notify("SUBSCRIBED", "RESUBSCRIBE", {
      transactionId: "1001",
      expiresDate: NOW.getTime() + 60 * DAY,
    });
    const result = await handleAppleNotification(deps, n);
    expect(result).toMatchObject({ kind: "synced", granted: { userId: "u1", amountIdr: 29_000 } });
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 60 * DAY);
  });

  test("DID_RENEW extends once; duplicate delivery does nothing", async () => {
    await redeemFor("u1");
    const renew = () =>
      notify("DID_RENEW", undefined, {
        transactionId: "1002",
        expiresDate: NOW.getTime() + 60 * DAY,
      });
    const first = await handleAppleNotification(deps, await renew());
    expect(first.granted?.orderId).toBe("apple:1002");
    const second = await handleAppleNotification(deps, await renew());
    expect(second).toEqual({ kind: "synced", granted: null });
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 60 * DAY);
    expect(await db.select().from(payment)).toHaveLength(2);
  });

  test("falls back to appAccountToken when the original transaction is new", async () => {
    const token = await appleAccountToken("u1");
    await redeemFor("u1", { appAccountToken: token });
    const n = await notify("DID_RENEW", undefined, {
      transactionId: "2000",
      originalTransactionId: "901",
      appAccountToken: token,
      expiresDate: NOW.getTime() + 40 * DAY,
    });
    const result = await handleAppleNotification(deps, n);
    expect(result.granted?.userId).toBe("u1");
    const links = await db.select().from(appleSubscription);
    expect(links.map((l) => l.originalTransactionId).sort()).toEqual(["900", "901"]);
  });

  test("non-allowlisted sandbox renewal keeps the one-day cap", async () => {
    await redeemFor("u2", { environment: "Sandbox" });
    const n = await notify(
      "DID_RENEW",
      undefined,
      { transactionId: "1003", expiresDate: NOW.getTime() + 30 * DAY },
      { environment: "Sandbox" },
    );
    const result = await handleAppleNotification(deps, n);
    expect(result.granted).toMatchObject({ userId: "u2", amountIdr: 0 });
    expect((await founderUntil("u2"))?.getTime()).toBe(NOW.getTime() + 2 * DAY);
  });

  test("EXPIRED and DID_FAIL_TO_RENEW never extend", async () => {
    await redeemFor("u1");
    const before = await founderUntil("u1");
    const failed = await handleAppleNotification(
      deps,
      await notify("DID_FAIL_TO_RENEW", "GRACE_PERIOD", { transactionId: "1004" }),
    );
    expect(failed.kind).toBe("lapsed");
    expect((await db.select().from(appleSubscription))[0]?.state).toBe("grace");
    const expired = await handleAppleNotification(
      deps,
      await notify("EXPIRED", "VOLUNTARY", { transactionId: "1005" }),
    );
    expect(expired.kind).toBe("lapsed");
    expect((await db.select().from(appleSubscription))[0]?.state).toBe("expired");
    expect(await founderUntil("u1")).toEqual(before);
    expect(await db.select().from(payment)).toHaveLength(1);
  });

  test("DID_CHANGE_RENEWAL_STATUS marks canceled but keeps the period", async () => {
    await redeemFor("u1");
    const before = await founderUntil("u1");
    await handleAppleNotification(
      deps,
      await notify("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", {}),
    );
    expect((await db.select().from(appleSubscription))[0]?.state).toBe("canceled");
    expect(await founderUntil("u1")).toEqual(before);
  });

  test("REFUND of the current period sets founderUntil back to now, once", async () => {
    await redeemFor("u1");
    const refund = () =>
      notify("REFUND", undefined, { revocationDate: NOW.getTime(), revocationReason: 0 });
    const result = await handleAppleNotification(deps, await refund());
    expect(result.kind).toBe("revoked");
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime());
    expect((await db.select().from(payment))[0]?.status).toBe("failed");
    expect((await handleAppleNotification(deps, await refund())).kind).toBe("ignored");
  });

  test("REVOKE takes the period back too", async () => {
    await redeemFor("u1");
    const n = await notify("REVOKE", undefined, { revocationDate: NOW.getTime() });
    expect((await handleAppleNotification(deps, n)).kind).toBe("revoked");
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime());
  });

  test("refunding an older period leaves the current one", async () => {
    await redeemFor("u1", { expiresDate: NOW.getTime() + 10 * DAY });
    await handleAppleNotification(
      deps,
      await notify("DID_RENEW", undefined, {
        transactionId: "1010",
        expiresDate: NOW.getTime() + 40 * DAY,
      }),
    );
    const n = await notify("REFUND", undefined, {
      revocationDate: NOW.getTime(),
      expiresDate: NOW.getTime() + 10 * DAY,
    });
    await handleAppleNotification(deps, n);
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime() + 40 * DAY);
  });

  test("a refunded transaction cannot be re-credited by a replay", async () => {
    await redeemFor("u1");
    await handleAppleNotification(
      deps,
      await notify("REFUND", undefined, { revocationDate: NOW.getTime() }),
    );
    const replay = await redeemFor("u1");
    expect(replay).toMatchObject({ ok: true, status: "inactive" });
    expect((await founderUntil("u1"))?.getTime()).toBe(NOW.getTime());
  });
});
