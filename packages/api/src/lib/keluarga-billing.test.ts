import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { household, householdMember } from "@joyorogo/db/schema/household";

import type { AppleTransaction } from "./apple";
import { appleLedgerId, handleAppleNotification, redeemAppleTransaction, revokeAppleTransaction } from "./apple-billing";
import type { GooglePlayClient, GoogleSubscription } from "./google-play";
import { googleLedgerId, revokeGoogleOrder, verifyGooglePurchase } from "./google-play-billing";
import { polarConfig, polarLedgerId, polarProduct } from "./polar";
import { processPolarEvent } from "./polar-billing";
import type { PolarBillingDeps } from "./polar-billing";

// Joyo Keluarga on the card and store rails (docs/pricing/joyo-keluarga.md 4.2 to 4.4): a Keluarga order extends the
// household the payer owns (made on first payment), never the payer's own founder_until, and a refund takes it back.

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 10, 18, 3, 0, 0));
const ROGO = "com.joyodigitama.joyorogo";

const { client, db } = await d1TestDb();

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM household_event; DELETE FROM household_invite; DELETE FROM household_member; DELETE FROM household;
    DELETE FROM polar_event; DELETE FROM polar_subscription; DELETE FROM google_purchase; DELETE FROM apple_subscription;
    DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'U1', 'u1@test.id'), ('u2', 'U2', 'u2@test.id');
  `);
});

const ownUntil = async (id: string) =>
  (await db.select({ v: user.founderUntil }).from(user).where(eq(user.id, id)))[0]?.v ?? null;
const householdOfOwner = async (id: string) =>
  (await db.select().from(household).where(eq(household.ownerId, id)))[0] ?? null;
const ledgerRow = async (orderId: string) =>
  (await db.select().from(payment).where(eq(payment.orderId, orderId)))[0];

describe("Polar", () => {
  const config = {
    productIds: { monthly: "pro-m", yearly: "pro-y" },
    priceUsdCents: { monthly: 999, yearly: 5999 },
    keluarga: { productIds: { monthly: "kel-m", yearly: "kel-y" }, priceUsdCents: { monthly: 1998, yearly: 11998 } },
  };
  const deps: PolarBillingDeps = {
    db,
    now: () => NOW,
    config,
    fallbackPriceIdr: { monthly: 29_000, yearly: 199_000 },
  };
  const subscription = (over: Record<string, unknown> = {}) => ({
    id: "sub-k",
    status: "active",
    customer_id: "cus1",
    product_id: "kel-m",
    created_at: NOW.toISOString(),
    modified_at: NOW.toISOString(),
    current_period_end: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    cancel_at_period_end: false,
    metadata: {},
    customer: { id: "cus1", external_id: "u1" },
    ...over,
  });
  const order = (over: Record<string, unknown> = {}) => ({
    id: "ord-k",
    status: "paid",
    billing_reason: "subscription_create",
    currency: "usd",
    net_amount: 1998,
    customer_id: "cus1",
    product_id: "kel-m",
    subscription_id: "sub-k",
    metadata: {},
    customer: { id: "cus1", external_id: "u1" },
    subscription: subscription(),
    ...over,
  });
  const send = (eventId: string, type: string, data: unknown) =>
    processPolarEvent(deps, eventId, { type, timestamp: NOW.toISOString(), data });

  test("config maps both Keluarga ids only when both are set; prices default to 2x Pro", () => {
    const base = { POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s", POLAR_PRODUCT_MONTHLY_ID: "pm", POLAR_PRODUCT_YEARLY_ID: "py" };
    expect(polarConfig(base)?.keluarga).toBeNull();
    expect(polarConfig({ ...base, POLAR_PRODUCT_KELUARGA_MONTHLY_ID: "km" })?.keluarga).toBeNull();
    const full = polarConfig({ ...base, POLAR_PRODUCT_KELUARGA_MONTHLY_ID: "km", POLAR_PRODUCT_KELUARGA_YEARLY_ID: "ky" })!;
    expect(full.keluarga).toEqual({ productIds: { monthly: "km", yearly: "ky" }, priceUsdCents: { monthly: 1998, yearly: 11998 } });
    expect(polarProduct(full, "km")).toEqual({ product: "keluarga", plan: "monthly" });
    expect(polarProduct(full, "pm")).toEqual({ product: "pro", plan: "monthly" });
    expect(polarProduct(polarConfig(base)!, "km")).toBeNull();
  });

  test("order.paid credits the household, not the payer's own period, and tags the ledger row", async () => {
    const result = await send("e1", "order.paid", order());
    expect(result.outcome).toBe("granted");
    expect(await ownUntil("u1")).toBeNull();
    const home = await householdOfOwner("u1");
    expect(home?.paidUntil?.getTime()).toBe(Date.UTC(2026, 11, 18, 3, 0, 0));
    const row = await ledgerRow(polarLedgerId("ord-k"));
    expect(row?.product).toBe("keluarga");
    // USD list price paid in full: the ledger books 2x the Pro IDR price.
    expect(row?.amountIdr).toBe(58_000);
    const members = await db.select().from(householdMember).where(eq(householdMember.userId, "u1"));
    expect(members.map((m) => m.role)).toEqual(["owner"]);
  });

  test("a renewal stacks on the household period; a refund takes it back", async () => {
    await send("e1", "order.paid", order());
    await send("e2", "order.paid", order({ id: "ord-k2", billing_reason: "subscription_cycle" }));
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(Date.UTC(2027, 0, 18, 3, 0, 0));
    const refunded = await send("e3", "order.refunded", order({ id: "ord-k2", status: "refunded" }));
    expect(refunded.outcome).toBe("refunded");
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(Date.UTC(2026, 11, 18, 3, 0, 0));
    expect(await ownUntil("u1")).toBeNull();
  });

  test("an immediate revoke cuts the household to now, and leaves the payer's own Pro alone", async () => {
    const own = new Date(NOW.getTime() + 10 * DAY);
    await db.update(user).set({ founderUntil: own }).where(eq(user.id, "u1"));
    await send("e1", "order.paid", order());
    const result = await send("e2", "subscription.revoked", subscription({ status: "canceled" }));
    expect(result.outcome).toBe("revoked");
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(NOW.getTime());
    expect((await ownUntil("u1"))?.getTime()).toBe(own.getTime());
  });

  test("a revoked Pro subscription does not cut the household", async () => {
    await send("e1", "order.paid", order());
    await send("e2", "order.paid", order({ id: "ord-p", product_id: "pro-m", net_amount: 999, subscription_id: "sub-p", subscription: subscription({ id: "sub-p", product_id: "pro-m" }) }));
    const result = await send("e3", "subscription.revoked", subscription({ id: "sub-p", product_id: "pro-m", status: "canceled" }));
    expect(result.outcome).toBe("revoked");
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(Date.UTC(2026, 11, 18, 3, 0, 0));
    expect((await ownUntil("u1"))?.getTime()).toBe(NOW.getTime());
  });
});

describe("Google Play", () => {
  const sub = (over: Partial<GoogleSubscription> = {}): GoogleSubscription => ({
    state: "active",
    acknowledged: false,
    test: false,
    accountId: null,
    productId: "keluarga",
    basePlanId: "monthly",
    expiresAt: new Date(NOW.getTime() + 30 * DAY),
    orderId: "GPA.9999-0000-1111-22222",
    priceIdr: 58_000,
    freeTrial: false,
    ...over,
  });
  const subs = new Map<string, GoogleSubscription>();
  const play: GooglePlayClient = {
    async getSubscription(token) {
      return subs.get(token) ?? null;
    },
    async acknowledge() {},
  };
  const deps = {
    db,
    clientFor: (name: string) => (name === ROGO ? play : null),
    config: { testEmails: [] },
    fallbackPriceIdr: { monthly: 29_000, yearly: 199_000 },
    now: () => NOW,
  };

  test("the keluarga subscription credits the household; voiding the order takes it back", async () => {
    subs.set("tok-k", sub());
    const result = await verifyGooglePurchase(deps, { purchaseToken: "tok-k", userId: "u1", packageName: ROGO });
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 58_000 });
    expect(await ownUntil("u1")).toBeNull();
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(Date.UTC(2026, 11, 18, 3, 0, 0));
    expect((await ledgerRow(googleLedgerId("GPA.9999-0000-1111-22222")))?.product).toBe("keluarga");

    expect(await revokeGoogleOrder(deps, "GPA.9999-0000-1111-22222")).toBe("revoked");
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(NOW.getTime());
  });

  test("Pro -> Keluarga replacement: the new token credits the household, the own Pro period stays", async () => {
    subs.set("tok-p", sub({ productId: "pro", orderId: "GPA.1", priceIdr: 29_000 }));
    await verifyGooglePurchase(deps, { purchaseToken: "tok-p", userId: "u1", packageName: ROGO });
    const own = await ownUntil("u1");
    subs.set("tok-k", sub({ orderId: "GPA.2" }));
    const result = await verifyGooglePurchase(deps, { purchaseToken: "tok-k", userId: "u1", packageName: ROGO });
    expect(result).toMatchObject({ ok: true, status: "granted" });
    expect((await ownUntil("u1"))?.getTime()).toBe(own!.getTime());
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(Date.UTC(2026, 11, 18, 3, 0, 0));
  });

  test("a member of another household who buys on Play becomes owner of their own", async () => {
    await db.insert(household).values({ id: "h2", ownerId: "u2", paidUntil: new Date(NOW.getTime() + 90 * DAY) });
    await db.insert(householdMember).values([
      { householdId: "h2", userId: "u2", role: "owner" },
      { householdId: "h2", userId: "u1", role: "member" },
    ]);
    subs.set("tok-k", sub());
    await verifyGooglePurchase(deps, { purchaseToken: "tok-k", userId: "u1", packageName: ROGO });
    const rows = await db.select().from(householdMember).where(eq(householdMember.userId, "u1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("owner");
    expect(rows[0]?.householdId).not.toBe("h2");
  });
});

describe("App Store", () => {
  const deps = {
    db,
    now: () => NOW,
    config: { sandboxAllowlist: "", fallbackPriceIdr: { monthly: 29_000, yearly: 199_000 } },
  };
  const tx = (over: Partial<AppleTransaction> = {}): AppleTransaction => ({
    transactionId: "2000",
    productId: "com.joyodigitama.joyorogo.keluarga.monthly",
    environment: "Production",
    signedDate: NOW,
    priceIdr: 58_000,
    freeTrial: false,
    originalTransactionId: "1900",
    expiresDate: new Date(NOW.getTime() + 30 * DAY),
    revocationDate: null,
    appAccountToken: null,
    inAppOwnershipType: "PURCHASED",
    ...over,
  });

  test("a Keluarga transaction credits the household to the store's period end; a refund cuts it to now", async () => {
    const result = await redeemAppleTransaction(deps, { userId: "u1", email: "u1@test.id", transaction: tx() });
    expect(result).toMatchObject({ ok: true, status: "granted", amountIdr: 58_000 });
    expect(await ownUntil("u1")).toBeNull();
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect((await ledgerRow(appleLedgerId("2000")))?.product).toBe("keluarga");

    expect(await revokeAppleTransaction(deps, tx({ revocationDate: NOW }))).toBe("revoked");
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(NOW.getTime());
  });

  test("a Family Sharing copy is refused and credits nothing", async () => {
    const shared = tx({ inAppOwnershipType: "FAMILY_SHARED" });
    expect(await redeemAppleTransaction(deps, { userId: "u1", email: "u1@test.id", transaction: shared })).toEqual({
      ok: false,
      error: "family-shared",
    });
    const pro = tx({ productId: "com.joyodigitama.joyorogo.founder.monthly", inAppOwnershipType: "FAMILY_SHARED" });
    expect((await redeemAppleTransaction(deps, { userId: "u1", email: "u1@test.id", transaction: pro })).ok).toBe(false);
    expect(await ownUntil("u1")).toBeNull();
    expect(await householdOfOwner("u1")).toBeNull();
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  test("a renewal notification for a shared copy credits nothing", async () => {
    await redeemAppleTransaction(deps, { userId: "u1", email: "u1@test.id", transaction: tx() });
    const before = (await householdOfOwner("u1"))?.paidUntil?.getTime();
    const result = await handleAppleNotification(deps, {
      notificationType: "DID_RENEW",
      subtype: undefined,
      transaction: tx({ transactionId: "2001", inAppOwnershipType: "FAMILY_SHARED", expiresDate: new Date(NOW.getTime() + 60 * DAY) }),
    } as never);
    expect(result.granted).toBeNull();
    expect((await householdOfOwner("u1"))?.paidUntil?.getTime()).toBe(before);
  });
});
