import { describe, expect, test } from "bun:test";

import {
  DOKU_QRIS,
  WEBHOOK_TARGET,
  buildOrderId,
  createCheckout,
  isFailed,
  isOrderId,
  isPaid,
  parseNotification,
  requestTimestamp,
  signRequest,
  verifySignature,
} from "./doku";

const SECRET = "SK-test-secret";
const BODY = JSON.stringify({
  order: { invoice_number: "JRG-261012050000-abcdef12", amount: 15000 },
  transaction: { status: "SUCCESS" },
});
const INPUT = {
  clientId: "BRN-0001-0000000000001",
  requestId: "4b0e2f1a-1111-2222-3333-444455556666",
  timestamp: "2026-10-12T05:00:00Z",
  target: WEBHOOK_TARGET,
  body: BODY,
};

describe("DOKU signature", () => {
  test("known vector: components string, sha256 digest, HMAC-SHA256", async () => {
    // Independent computation of the documented scheme.
    const enc = new TextEncoder();
    const digest = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(BODY))),
      ),
    );
    const components = `Client-Id:${INPUT.clientId}\nRequest-Id:${INPUT.requestId}\nRequest-Timestamp:${INPUT.timestamp}\nRequest-Target:${INPUT.target}\nDigest:${digest}`;
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(components))),
      ),
    );
    expect(await signRequest(INPUT, SECRET)).toBe(`HMACSHA256=${mac}`);
  });

  test("GET (check status) signs without a Digest line", async () => {
    const enc = new TextEncoder();
    const get = { ...INPUT, target: "/orders/v1/status/JRG-261012050000-abcdef12", body: undefined };
    const components = `Client-Id:${get.clientId}\nRequest-Id:${get.requestId}\nRequest-Timestamp:${get.timestamp}\nRequest-Target:${get.target}`;
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(components))),
      ),
    );
    expect(await signRequest(get, SECRET)).toBe(`HMACSHA256=${mac}`);
  });

  test("verifies its own signature", async () => {
    const sig = await signRequest(INPUT, SECRET);
    expect(await verifySignature(INPUT, sig, SECRET)).toBe(true);
  });

  test("rejects a tampered body, wrong target, wrong key, or empty signature", async () => {
    const sig = await signRequest(INPUT, SECRET);
    expect(await verifySignature({ ...INPUT, body: BODY.replace("15000", "1") }, sig, SECRET)).toBe(
      false,
    );
    expect(await verifySignature({ ...INPUT, target: "/other" }, sig, SECRET)).toBe(false);
    expect(await verifySignature(INPUT, sig, "SK-other")).toBe(false);
    expect(await verifySignature(INPUT, "", SECRET)).toBe(false);
  });
});

describe("parseNotification", () => {
  test("reads invoice, amount and status", () => {
    expect(parseNotification(JSON.parse(BODY))).toEqual({
      invoiceNumber: "JRG-261012050000-abcdef12",
      amount: 15000,
      status: "SUCCESS",
    });
  });

  test("rejects malformed payloads", () => {
    expect(parseNotification(null)).toBeNull();
    expect(parseNotification({ order: {} })).toBeNull();
    expect(
      parseNotification({
        order: { invoice_number: "x", amount: "15000" },
        transaction: { status: "SUCCESS" },
      }),
    ).toBeNull();
  });

  test("status helpers: only SUCCESS is paid, pending is neither", () => {
    const n = (status: string) => ({ invoiceNumber: "x", amount: 1, status });
    expect(isPaid(n("SUCCESS"))).toBe(true);
    expect(isPaid(n("PENDING"))).toBe(false);
    expect(isFailed(n("PENDING"))).toBe(false);
    for (const s of ["EXPIRED", "FAILED", "VOIDED"]) expect(isFailed(n(s))).toBe(true);
  });
});

describe("order ids", () => {
  test("shape is stable and unique per call", () => {
    const now = new Date("2026-10-12T05:06:07Z");
    const a = buildOrderId(now);
    const b = buildOrderId(now);
    expect(a).toMatch(/^JRG-261012050607-[0-9a-f]{8}$/);
    expect(isOrderId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isOrderId("AGNI-x")).toBe(false);
  });

  test("timestamp drops millis", () => {
    expect(requestTimestamp(new Date("2026-10-12T05:06:07.890Z"))).toBe("2026-10-12T05:06:07Z");
  });
});

describe("DOKU Checkout channels", () => {
  const CONFIG = { clientId: "BRN-0001-0000000000001", secretKey: SECRET, baseUrl: "https://api.doku.test" };
  const PARAMS = {
    orderId: "JRG-261104050000-abcdef12",
    amountIdr: 29000,
    itemName: "Joyo Pro 1 bulan",
    customerEmail: "buyer@example.com",
    notifyUrl: "https://api.example.test/api/billing/webhook",
    returnUrl: "https://app.example.test/pembayaran?order=x",
  };

  async function sentPayment(paymentMethodTypes?: readonly string[]): Promise<Record<string, unknown>> {
    const realFetch = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent = (JSON.parse(init.body) as { payment: Record<string, unknown> }).payment;
      return new Response(JSON.stringify({ response: { payment: { url: "https://checkout.doku.test/p/1" } } }));
    }) as unknown as typeof fetch;
    try {
      await createCheckout(CONFIG, { ...PARAMS, paymentMethodTypes });
    } finally {
      globalThis.fetch = realFetch;
    }
    return sent;
  }

  test("the QRIS list includes QRIS", () => {
    expect(DOKU_QRIS).toContain("QRIS");
  });
  test("narrowed to QRIS when asked", async () => {
    expect(await sentPayment(DOKU_QRIS)).toEqual({ payment_due_date: 60, payment_method_types: ["QRIS"] });
  });
  test("no list = every channel enabled on the merchant (QRIS, VA, e-wallet)", async () => {
    expect(await sentPayment()).toEqual({ payment_due_date: 60 });
    expect(await sentPayment([])).toEqual({ payment_due_date: 60 });
  });
});
