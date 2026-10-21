import { describe, expect, test } from "bun:test";

import { formatStorePrice, yearlySaving } from "./pro-plans";

const idr = (units: number) => ({ micros: units * 1_000_000, currency: "IDR" });

describe("yearlySaving", () => {
  test("Rp29.000 monthly vs Rp199.000 yearly", () => {
    const saving = yearlySaving(idr(29_000), idr(199_000));
    expect(saving).not.toBeNull();
    expect(Math.round(saving!.perMonth.micros / 1_000_000)).toBe(16_583);
    expect(saving!.saved.micros / 1_000_000).toBe(149_000);
    expect(saving!.percent).toBe(43);
  });

  test("works in any store currency", () => {
    const saving = yearlySaving(
      { micros: 9_990_000, currency: "USD" },
      { micros: 59_990_000, currency: "USD" },
    );
    expect(saving?.percent).toBe(50);
    expect(saving?.saved.currency).toBe("USD");
  });

  test("nothing to claim when a price is missing, currencies differ, or yearly is not cheaper", () => {
    expect(yearlySaving(null, idr(199_000))).toBeNull();
    expect(yearlySaving(idr(29_000), undefined)).toBeNull();
    expect(yearlySaving(idr(29_000), { micros: 5_000_000, currency: "USD" })).toBeNull();
    expect(yearlySaving(idr(29_000), idr(348_000))).toBeNull();
    expect(yearlySaving(idr(29_000), idr(400_000))).toBeNull();
    expect(yearlySaving(idr(0), idr(199_000))).toBeNull();
  });

  test("a saving under one percent is not advertised", () => {
    expect(yearlySaving(idr(29_000), idr(347_000))).toBeNull();
  });
});

describe("formatStorePrice", () => {
  test("rupiah uses the app's Rp style", () => {
    expect(formatStorePrice(idr(16_583), "id-ID")).toBe("Rp16.583");
    expect(formatStorePrice(idr(199_000), "en-US")).toBe("Rp199,000");
  });

  test("other currencies use the currency's own formatting", () => {
    expect(formatStorePrice({ micros: 59_990_000, currency: "USD" }, "en-US")).toBe("$59.99");
  });

  test("an unknown currency code still prints something readable", () => {
    expect(formatStorePrice({ micros: 1_500_000, currency: "ZZ" }, "en-US")).toContain("1.50");
  });
});
