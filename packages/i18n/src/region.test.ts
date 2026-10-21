import { describe, expect, test } from "bun:test";

import { regionFromCountry, resolveRegion } from "./region";

describe("regionFromCountry", () => {
  test("only served markets map", () => {
    expect(regionFromCountry("MY")).toBe("MY");
    expect(regionFromCountry("my")).toBe("MY");
    expect(regionFromCountry(" ID ")).toBe("ID");
    expect(regionFromCountry("SG")).toBe("SG");
    expect(regionFromCountry("sg")).toBe("SG");
    expect(regionFromCountry("BN")).toBeNull();
    expect(regionFromCountry("T1")).toBeNull();
    expect(regionFromCountry(undefined)).toBeNull();
  });
});

describe("resolveRegion", () => {
  test("a Bahasa Melayu UI is Malaysia whatever the network says", () => {
    expect(resolveRegion({ locale: "ms", country: "ID" })).toBe("MY");
    expect(resolveRegion({ locale: "ms" })).toBe("MY");
  });

  test("an English or Indonesian UI follows the network country", () => {
    expect(resolveRegion({ locale: "en", country: "MY" })).toBe("MY");
    expect(resolveRegion({ locale: "id", country: "MY" })).toBe("MY");
    expect(resolveRegion({ locale: "en", country: "ID" })).toBe("ID");
  });

  test("Singapore: the network country decides, an English or Indonesian UI stays in Singapore", () => {
    expect(resolveRegion({ locale: "en", country: "SG" })).toBe("SG");
    expect(resolveRegion({ locale: "id", country: "SG" })).toBe("SG");
    expect(resolveRegion({ country: "SG" })).toBe("SG");
  });

  test("a Bahasa Melayu UI is Malaysia even on a Singapore network", () => {
    expect(resolveRegion({ locale: "ms", country: "SG" })).toBe("MY");
  });

  test("unknown or unserved countries keep the original market", () => {
    expect(resolveRegion({ locale: "en", country: "BN" })).toBe("ID");
    expect(resolveRegion({ locale: "en" })).toBe("ID");
    expect(resolveRegion({})).toBe("ID");
  });
});
