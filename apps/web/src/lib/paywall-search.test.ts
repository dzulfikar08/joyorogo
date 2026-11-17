import { describe, expect, test } from "bun:test";

import { ONBOARDING_NEXT, validatePaywallSearch } from "./paywall-search";

describe("validatePaywallSearch", () => {
  test("keeps the onboarding destination, so 'Nanti saja' opens the first scan", () => {
    expect(validatePaywallSearch({ from: "onboarding", next: ONBOARDING_NEXT })).toEqual({
      from: "onboarding",
      next: "/makan/ai",
      polar: undefined,
    });
  });

  test("drops off-site and protocol-relative destinations", () => {
    expect(validatePaywallSearch({ next: "https://evil.example" }).next).toBeUndefined();
    expect(validatePaywallSearch({ next: "//evil.example" }).next).toBeUndefined();
  });

  test("ignores an unknown source", () => {
    expect(validatePaywallSearch({ from: "nope" }).from).toBeUndefined();
  });
});
