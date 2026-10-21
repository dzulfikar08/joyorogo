import { describe, expect, test } from "bun:test";

import { FALLBACK_IDR_RATES, formatMinor, frankfurterRate, idrQuote, minorDigits, minorToIdr } from "./fx";

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("frankfurterRate", () => {
  test("asks for the order's day and returns the ECB fixing date as the source", async () => {
    let url = "";
    const source = frankfurterRate((async (u: string) => {
      url = u;
      return { ok: true, json: async () => ({ date: "2026-10-20", rates: { IDR: 4405.3 } }) };
    }) as unknown as typeof fetch);
    expect(await source("myr", new Date("2026-10-21T02:00:00Z"))).toEqual({ rate: 4405.3, source: "frankfurter:2026-10-20" });
    expect(url).toBe("https://api.frankfurter.dev/v1/2026-10-21?base=MYR&symbols=IDR");
  });

  test("null on an error status, a bad body or a thrown fetch", async () => {
    const at = new Date();
    expect(await frankfurterRate(answer({}, false))("MYR", at)).toBeNull();
    expect(await frankfurterRate(answer({ rates: {} }))("MYR", at)).toBeNull();
    expect(await frankfurterRate(answer({ rates: { IDR: -1 } }))("MYR", at)).toBeNull();
    expect(
      await frankfurterRate((async () => {
        throw new Error("timeout");
      }) as unknown as typeof fetch)("MYR", at),
    ).toBeNull();
  });
});

describe("idrQuote", () => {
  test("live first, then the fallback table, null for a currency neither knows", async () => {
    const at = new Date();
    expect(await idrQuote(async () => ({ rate: 1, source: "x" }), "MYR", at)).toEqual({ rate: 1, source: "x" });
    expect(await idrQuote(async () => null, "sgd", at)).toMatchObject({ rate: FALLBACK_IDR_RATES.SGD });
    expect(await idrQuote(undefined, "MYR", at)).toMatchObject({ rate: FALLBACK_IDR_RATES.MYR });
    expect(await idrQuote(undefined, "EUR", at)).toBeNull();
  });
});

describe("minor units", () => {
  test("digits, conversion and labels", () => {
    expect(minorDigits("MYR")).toBe(2);
    expect(minorDigits("jpy")).toBe(0);
    expect(minorToIdr(4399, "MYR", 4400)).toBe(193_556);
    expect(minorToIdr(1000, "JPY", 100)).toBe(100_000);
    expect(formatMinor(4399, "MYR")).toBe("RM43.99");
    expect(formatMinor(1398, "sgd")).toBe("S$13.98");
    expect(formatMinor(999, "USD")).toBe("US$9.99");
    expect(formatMinor(999, "EUR")).toBe("EUR 9.99");
  });
});
