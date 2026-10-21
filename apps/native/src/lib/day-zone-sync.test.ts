import { describe, expect, test } from "bun:test";

import { planDayZone } from "./day-zone-sync";

describe("planDayZone", () => {
  test("device in Kuala Lumpur beats a stored Jakarta and is persisted", () => {
    expect(planDayZone({ device: "Asia/Kuala_Lumpur", stored: "Asia/Jakarta", region: "MY" })).toEqual({
      zone: "Asia/Kuala_Lumpur",
      persist: true,
    });
  });

  test("unsupported device zone keeps the stored zone without a write", () => {
    expect(planDayZone({ device: "Asia/Makassar", stored: "Asia/Singapore", region: "SG" })).toEqual({
      zone: "Asia/Singapore",
      persist: false,
    });
  });

  test("legacy profile without a stored zone stays Jakarta and records it", () => {
    expect(planDayZone({ device: null, stored: null, region: "MY" })).toEqual({
      zone: "Asia/Jakarta",
      persist: true,
    });
  });
});
