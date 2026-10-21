import { describe, expect, test } from "bun:test";

import { planDayZone } from "./day-zone-sync";

describe("planDayZone", () => {
  test("a device in a served zone wins and is saved when the profile differs", () => {
    expect(planDayZone({ device: "Asia/Kuala_Lumpur", stored: "Asia/Jakarta", hasProfile: true, region: "MY" })).toEqual({
      zone: "Asia/Kuala_Lumpur",
      persist: true,
    });
  });

  test("nothing to save when the profile already holds the zone", () => {
    expect(planDayZone({ device: "Asia/Jakarta", stored: "Asia/Jakarta", hasProfile: true, region: "ID" }).persist).toBe(false);
  });

  test("an unsupported device keeps the stored zone", () => {
    expect(planDayZone({ device: "Europe/London", stored: "Asia/Singapore", hasProfile: true, region: "SG" })).toEqual({
      zone: "Asia/Singapore",
      persist: false,
    });
  });

  test("a legacy profile without a zone stays on Jakarta", () => {
    expect(planDayZone({ device: null, stored: null, hasProfile: true, region: "MY" }).zone).toBe("Asia/Jakarta");
  });

  test("no profile: the region's zone, nothing saved", () => {
    expect(planDayZone({ device: null, stored: null, hasProfile: false, region: "MY" })).toEqual({
      zone: "Asia/Kuala_Lumpur",
      persist: false,
    });
  });
});
