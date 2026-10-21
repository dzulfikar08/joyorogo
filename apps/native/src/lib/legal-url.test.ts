import { describe, expect, test } from "bun:test";

import { privacyUrl, termsUrl } from "./legal-url";

const base = "https://joyorogo.com";

describe("legal urls", () => {
  test("ms opens the Malay pages", () => {
    expect(privacyUrl(base, "ms")).toBe("https://joyorogo.com/my/privasi");
    expect(termsUrl(base, "ms")).toBe("https://joyorogo.com/my/syarat");
  });

  test("id and en keep the Indonesian pages", () => {
    for (const locale of ["id", "en"]) {
      expect(privacyUrl(base, locale)).toBe("https://joyorogo.com/privasi");
      expect(termsUrl(base, locale)).toBe("https://joyorogo.com/syarat");
    }
  });
});
