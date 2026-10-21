import { describe, expect, test } from "bun:test";

import { matchAcceptLanguage, matchLocale, matchRegionLocale, resolveLocale } from "./locale";

describe("matchLocale", () => {
  test("maps regional and legacy tags", () => {
    expect(matchLocale("en-US")).toBe("en");
    expect(matchLocale("id-ID")).toBe("id");
    expect(matchLocale("in_ID")).toBe("id");
    expect(matchLocale("fr-FR")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  test("Malay in every spelling a device or browser sends", () => {
    expect(matchLocale("ms")).toBe("ms");
    expect(matchLocale("ms-MY")).toBe("ms");
    expect(matchLocale("ms_MY")).toBe("ms");
    expect(matchLocale("MS-my")).toBe("ms");
    expect(matchLocale("ms-BN")).toBe("ms");
    expect(matchLocale("ms-Latn-MY")).toBe("ms");
    expect(matchLocale("zsm")).toBe("ms");
    expect(matchLocale("msa")).toBe("ms");
  });

  test("a region never overrides a shipped language: English in Malaysia stays English", () => {
    expect(matchLocale("en-MY")).toBe("en");
    expect(matchLocale("id-MY")).toBe("id");
    expect(matchLocale("zh-MY")).toBeNull();
  });
});

describe("matchRegionLocale", () => {
  test("Malaysia defaults to Bahasa Melayu, other regions to nothing", () => {
    expect(matchRegionLocale("zh-MY")).toBe("ms");
    expect(matchRegionLocale("ta_MY")).toBe("ms");
    expect(matchRegionLocale("zh-Hans-MY")).toBe("ms");
    expect(matchRegionLocale("zh-SG")).toBeNull();
    expect(matchRegionLocale("fr-FR")).toBeNull();
    expect(matchRegionLocale("zh")).toBeNull();
    expect(matchRegionLocale(null)).toBeNull();
  });
});

describe("matchAcceptLanguage", () => {
  test("honours q weights", () => {
    expect(matchAcceptLanguage("fr;q=0.9, en;q=0.8, id;q=0.7")).toBe("en");
    expect(matchAcceptLanguage("id-ID,id;q=0.9,en;q=0.8")).toBe("id");
    expect(matchAcceptLanguage("de")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });

  test("Malaysian browsers", () => {
    expect(matchAcceptLanguage("ms-MY,ms;q=0.9,en;q=0.8")).toBe("ms");
    expect(matchAcceptLanguage("en-MY,en;q=0.9,ms;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("zh-MY,zh;q=0.9")).toBe("ms");
    expect(matchAcceptLanguage("zh-MY,zh;q=0.9,en;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("zh-CN,zh;q=0.9")).toBeNull();
  });
});

describe("resolveLocale", () => {
  test("saved choice beats stored beats device beats fallback", () => {
    expect(resolveLocale({ saved: "en", stored: "id", device: "id-ID" })).toBe("en");
    expect(resolveLocale({ saved: null, stored: "en", device: "id-ID" })).toBe("en");
    expect(resolveLocale({ stored: null, device: ["fr-FR", "en-GB"] })).toBe("en");
    expect(resolveLocale({ device: ["fr-FR"] })).toBe("id");
    expect(resolveLocale({})).toBe("id");
  });

  test("Malaysian devices", () => {
    expect(resolveLocale({ device: ["ms-MY"] })).toBe("ms");
    expect(resolveLocale({ device: "ms" })).toBe("ms");
    expect(resolveLocale({ device: ["en-MY"] })).toBe("en");
    expect(resolveLocale({ device: ["zh-Hans-MY"] })).toBe("ms");
    expect(resolveLocale({ device: ["ta-MY", "en-GB"] })).toBe("en");
    expect(resolveLocale({ device: ["zh-SG"] })).toBe("id");
    expect(resolveLocale({ saved: "id", device: ["ms-MY"] })).toBe("id");
    expect(resolveLocale({ stored: "en", device: ["ms-MY"] })).toBe("en");
  });

  test("ignores an unknown saved value", () => {
    expect(resolveLocale({ saved: "xx", stored: "en" })).toBe("en");
  });
});
