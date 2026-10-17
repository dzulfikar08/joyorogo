import { describe, expect, test } from "bun:test";

import { matchAcceptLanguage, matchLocale, resolveLocale } from "./locale";

describe("matchLocale", () => {
  test("maps regional and legacy tags", () => {
    expect(matchLocale("en-US")).toBe("en");
    expect(matchLocale("id-ID")).toBe("id");
    expect(matchLocale("in_ID")).toBe("id");
    expect(matchLocale("fr-FR")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe("matchAcceptLanguage", () => {
  test("honours q weights", () => {
    expect(matchAcceptLanguage("fr;q=0.9, en;q=0.8, id;q=0.7")).toBe("en");
    expect(matchAcceptLanguage("id-ID,id;q=0.9,en;q=0.8")).toBe("id");
    expect(matchAcceptLanguage("de")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
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

  test("ignores an unknown saved value", () => {
    expect(resolveLocale({ saved: "xx", stored: "en" })).toBe("en");
  });
});
