import { describe, expect, test } from "bun:test";

import { regionFromCountry, resolveRegion } from "./region";

describe("regionFromCountry", () => {
  test("only served markets map", () => {
    expect(regionFromCountry("MY")).toBe("MY");
    expect(regionFromCountry("my")).toBe("MY");
    expect(regionFromCountry(" ID ")).toBe("ID");
    expect(regionFromCountry("SG")).toBeNull();
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

  test("unknown or unserved countries keep the original market", () => {
    expect(resolveRegion({ locale: "en", country: "SG" })).toBe("ID");
    expect(resolveRegion({ locale: "en" })).toBe("ID");
    expect(resolveRegion({})).toBe("ID");
  });
});
