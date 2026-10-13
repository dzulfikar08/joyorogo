import { describe, expect, test } from "bun:test";

import { isFailed, isPaid, parseTransaction, secretMatches } from "./pakasir";

// Documented webhook body (https://pakasir.com/p/webhook).
const HOOK = {
  txn_id: "vwiqpcriq",
  order_id: "JRG-261012050000-abcdef12",
  amount: 15000,
  is_sandbox: false,
  status: "completed",
  completed_at: "2025-09-19T01:18:49.678622564Z",
};

describe("parseTransaction", () => {
  test("reads txn, order, amount, status and sandbox flag", () => {
    expect(parseTransaction(HOOK)).toEqual({
      txnId: "vwiqpcriq",
      orderId: "JRG-261012050000-abcdef12",
      amount: 15000,
      status: "completed",
      isSandbox: false,
    });
    expect(parseTransaction({ ...HOOK, is_sandbox: true })?.isSandbox).toBe(true);
  });

  test("rejects malformed payloads", () => {
    expect(parseTransaction(null)).toBeNull();
    expect(parseTransaction({ ...HOOK, amount: "15000" })).toBeNull();
    expect(parseTransaction({ ...HOOK, txn_id: "" })).toBeNull();
    expect(parseTransaction({ ...HOOK, order_id: undefined })).toBeNull();
  });

  test("only completed is paid; only canceled is failed", () => {
    const t = (status: string) => ({ ...parseTransaction(HOOK)!, status });
    expect(isPaid(t("completed"))).toBe(true);
    expect(isPaid(t("pending"))).toBe(false);
    expect(isFailed(t("pending"))).toBe(false);
    expect(isFailed(t("canceled"))).toBe(true);
  });
});

describe("secretMatches", () => {
  test("exact match only; an unset secret never matches", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3creT", "s3cret")).toBe(false);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});
