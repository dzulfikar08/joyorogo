import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import i18next from "i18next";

import { resources } from "@joyorogo/i18n/resources";

// Hermes ships no Intl.PluralRules. polyfills.js (first import of index.js)
// installs one; these tests run the real polyfills file with the native
// implementation removed.
const original = Intl.PluralRules;

async function translator(lng: "id" | "en") {
  const instance = i18next.createInstance();
  await instance.init({ resources, lng, fallbackLng: "en", initAsync: false });
  return instance.getFixedT(lng, "scan");
}

beforeAll(async () => {
  // @ts-expect-error simulate Hermes
  delete Intl.PluralRules;
  expect(Intl.PluralRules).toBeUndefined();
  await import("../../polyfills.js?hermes");
});

afterAll(() => {
  Intl.PluralRules = original;
});

describe("Intl.PluralRules polyfill (Hermes)", () => {
  test("installs PluralRules", () => {
    expect(typeof Intl.PluralRules).toBe("function");
  });

  test("id plural key resolves", async () => {
    const t = await translator("id");
    expect(t("result.save.items", { count: 1 })).toBe("Simpan 1 item");
    expect(t("result.save.items", { count: 2 })).toBe("Simpan 2 item");
  });

  test("en one/other", async () => {
    const t = await translator("en");
    expect(t("result.save.items", { count: 1 })).toBe("Save 1 item");
    expect(t("result.save.items", { count: 2 })).toBe("Save 2 items");
  });
});
