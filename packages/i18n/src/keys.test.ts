import { describe, expect, test } from "bun:test";

import { LOCALES } from "./locale";
import { missingKeys, orphanKeys } from "./keys";

describe("translation completeness", () => {
  for (const locale of LOCALES.filter((l) => l !== "id")) {
    test(`${locale} has every key of the source language`, () => {
      expect(missingKeys(locale)).toEqual([]);
    });
    test(`${locale} has no orphan keys`, () => {
      expect(orphanKeys(locale)).toEqual([]);
    });
  }
});
