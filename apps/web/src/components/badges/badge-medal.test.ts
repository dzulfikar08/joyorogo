import { describe, expect, test } from "bun:test";

import { badgeKey, badgeMetal } from "./badge-medal";

describe("badgeMetal", () => {
  test("locked has no ring", () => {
    expect(badgeMetal({ tiers: [7, 30, 100], tier: 0 })).toBeNull();
  });
  test("three tiers: bronze, silver, gold", () => {
    expect(badgeMetal({ tiers: [7, 30, 100], tier: 1 })).toBe("bronze");
    expect(badgeMetal({ tiers: [7, 30, 100], tier: 2 })).toBe("silver");
    expect(badgeMetal({ tiers: [7, 30, 100], tier: 3 })).toBe("gold");
  });
  test("top tier of a shorter ladder and one-time badges are gold", () => {
    expect(badgeMetal({ tiers: [7, 30], tier: 1 })).toBe("bronze");
    expect(badgeMetal({ tiers: [7, 30], tier: 2 })).toBe("gold");
    expect(badgeMetal({ tiers: [1], tier: 1 })).toBe("gold");
  });
  test("i18n key per id", () => {
    expect(badgeKey("konsisten", "desc")).toBe("konsisten.desc");
  });
});
