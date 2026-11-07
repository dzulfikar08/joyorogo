import { describe, expect, test } from "bun:test";

import { DOKU_QRIS } from "@joyorogo/api/lib/doku";
import type { createCheckout } from "@joyorogo/api/lib/doku";

import { createDokuCheckout, defaultProvider, methodGateway, methodOffered, orderSource, qrisOn } from "./billing-gateway";

describe("Pakasir switch (PAKASIR_ENABLED)", () => {
  test("QRIS goes to DOKU while Pakasir is off, to Pakasir only while it is on", () => {
    expect(methodGateway("qris", false)).toBe("doku");
    expect(methodGateway("qris", true)).toBe("pakasir");
    expect(methodGateway("transfer", false)).toBe("doku");
    expect(methodGateway("transfer", true)).toBe("doku");
  });
  test("older apps without a method never land on Pakasir once it is off", () => {
    // `configured.pakasir` is false whenever PAKASIR_ENABLED is off, even with BILLING_PROVIDER=pakasir.
    expect(defaultProvider("pakasir", { doku: true, pakasir: false })).toBe("doku");
    expect(defaultProvider("", { doku: false, pakasir: false })).toBeNull();
    expect(defaultProvider("pakasir", { doku: true, pakasir: true })).toBe("pakasir");
  });
});

describe("QRIS switch (QRIS_ENABLED)", () => {
  test("on unless explicitly off", () => {
    for (const value of [undefined, "", "1", "on", "true"]) expect(qrisOn(value)).toBe(true);
    for (const value of ["0", "off", "OFF", " false "]) expect(qrisOn(value)).toBe(false);
  });
  test("off hides QRIS only; bank transfer stays", () => {
    expect(methodOffered("qris", false)).toBe(false);
    expect(methodOffered("transfer", false)).toBe(true);
    expect(methodOffered("qris", true)).toBe(true);
  });
});

describe("order source", () => {
  test("only joyoarto is accepted", () => {
    expect(orderSource("joyoarto")).toBe("joyoarto");
    for (const value of ["JoyoArto", "https://evil.example", "", null, undefined, 1]) expect(orderSource(value)).toBeNull();
  });
});

describe("DOKU QRIS checkout", () => {
  const CONFIG = { clientId: "c", secretKey: "s", baseUrl: "https://api.doku.test" };
  const PARAMS = {
    orderId: "JRG-261104050000-abcdef12",
    amountIdr: 29000,
    itemName: "Joyo Pro 1 bulan",
    customerEmail: "buyer@example.com",
    notifyUrl: "https://n",
    returnUrl: "https://r",
  };

  test("asks DOKU for the QRIS channel", async () => {
    const asked: Array<readonly string[] | undefined> = [];
    const create = (async (_config, params) => {
      asked.push(params.paymentMethodTypes);
      return { paymentUrl: "https://doku/qris" };
    }) as typeof createCheckout;
    expect(await createDokuCheckout(CONFIG, { ...PARAMS, paymentMethodTypes: DOKU_QRIS }, create)).toEqual({
      paymentUrl: "https://doku/qris",
    });
    expect(asked).toEqual([DOKU_QRIS]);
  });
  test("falls back to DOKU's full page when the QRIS-only request is refused", async () => {
    const asked: Array<readonly string[] | undefined> = [];
    const create = (async (_config, params) => {
      asked.push(params.paymentMethodTypes);
      if (params.paymentMethodTypes) throw new Error("doku checkout failed: HTTP 400");
      return { paymentUrl: "https://doku/all" };
    }) as typeof createCheckout;
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await createDokuCheckout(CONFIG, { ...PARAMS, paymentMethodTypes: DOKU_QRIS }, create)).toEqual({
        paymentUrl: "https://doku/all",
      });
    } finally {
      console.error = quiet;
    }
    expect(asked).toEqual([DOKU_QRIS, undefined]);
  });
  test("a failure without a channel list is not retried", async () => {
    let calls = 0;
    const create = (async () => {
      calls++;
      throw new Error("down");
    }) as typeof createCheckout;
    expect(createDokuCheckout(CONFIG, PARAMS, create)).rejects.toThrow("down");
    expect(calls).toBe(1);
  });
});
