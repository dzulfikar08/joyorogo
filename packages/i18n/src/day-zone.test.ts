import { describe, expect, test } from "bun:test";

import {
  clockHourIn,
  dayBoundsIn,
  dayIn,
  dayOfMs,
  dayZoneOffsetMs,
  getActiveDayZone,
  instantIn,
  isoInZone,
  matchDayZone,
  resolveDayZone,
  setActiveDayZone,
  weekdayOfMs,
  yesterdayIn,
  zoneForRegion,
} from "./day-zone";

const JKT = "Asia/Jakarta";
const KL = "Asia/Kuala_Lumpur";

describe("day boundaries", () => {
  test("Jakarta is the default zone and cuts the day at 17:00 UTC", () => {
    expect(dayIn(undefined, new Date("2026-10-20T16:59:59Z"))).toBe("2026-10-20");
    expect(dayIn(undefined, new Date("2026-10-20T17:00:00Z"))).toBe("2026-10-21");
    expect(dayIn(JKT, new Date("2026-10-20T17:00:00Z"))).toBe("2026-10-21");
  });

  test("Kuala Lumpur cuts the day at 16:00 UTC, an hour before Jakarta", () => {
    expect(dayIn(KL, new Date("2026-10-20T15:59:59Z"))).toBe("2026-10-20");
    expect(dayIn(KL, new Date("2026-10-20T16:00:00Z"))).toBe("2026-10-21");
  });

  test("Singapore is UTC+8 with the same cut as Kuala Lumpur", () => {
    const SG = "Asia/Singapore";
    expect(dayIn(SG, new Date("2026-10-20T15:59:59Z"))).toBe("2026-10-20");
    expect(dayIn(SG, new Date("2026-10-20T16:00:00Z"))).toBe("2026-10-21");
    expect(yesterdayIn(SG, new Date("2026-10-20T16:30:00Z"))).toBe("2026-10-20");
    expect(clockHourIn(SG, new Date("2026-10-20T16:15:00Z"))).toBe(0.25);
    expect(dayZoneOffsetMs(SG)).toBe(dayZoneOffsetMs(KL));
  });

  test("00:30 in Kuala Lumpur is still yesterday in Jakarta: the hour where the zones disagree", () => {
    const at = new Date("2026-10-20T16:30:00Z");
    expect(dayIn(KL, at)).toBe("2026-10-21");
    expect(dayIn(JKT, at)).toBe("2026-10-20");
  });

  test("yesterday follows the zone and crosses month and year ends", () => {
    expect(yesterdayIn(KL, new Date("2026-10-20T16:30:00Z"))).toBe("2026-10-20");
    expect(yesterdayIn(JKT, new Date("2026-10-20T16:30:00Z"))).toBe("2026-10-19");
    expect(yesterdayIn(KL, new Date("2026-12-31T16:00:00Z"))).toBe("2026-12-31");
    expect(yesterdayIn(KL, new Date("2026-02-28T16:00:00Z"))).toBe("2026-02-28");
    expect(dayIn(KL, new Date("2026-02-28T16:00:00Z"))).toBe("2026-03-01");
  });

  test("clock hour is a decimal in the zone", () => {
    const at = new Date("2026-10-20T05:30:00Z");
    expect(clockHourIn(JKT, at)).toBe(12.5);
    expect(clockHourIn(KL, at)).toBe(13.5);
    expect(clockHourIn(KL, new Date("2026-10-20T16:15:00Z"))).toBe(0.25);
  });

  test("neither zone has daylight saving: the cut is 16:00 UTC in January and in July", () => {
    expect(dayIn(KL, new Date("2026-01-15T15:59:00Z"))).toBe("2026-01-15");
    expect(dayIn(KL, new Date("2026-01-15T16:00:00Z"))).toBe("2026-01-16");
    expect(dayIn(KL, new Date("2026-07-15T15:59:00Z"))).toBe("2026-07-15");
    expect(dayIn(KL, new Date("2026-07-15T16:00:00Z"))).toBe("2026-07-16");
    expect(dayZoneOffsetMs(KL) - dayZoneOffsetMs(JKT)).toBe(3_600_000);
  });
});

describe("matchDayZone", () => {
  test("supported device zones", () => {
    expect(matchDayZone("Asia/Kuala_Lumpur")).toBe(KL);
    expect(matchDayZone("Asia/Kuching")).toBe(KL);
    expect(matchDayZone("Asia/Singapore")).toBe("Asia/Singapore");
    expect(matchDayZone("Asia/Jakarta")).toBe(JKT);
    expect(matchDayZone("Asia/Makassar")).toBeNull();
    expect(matchDayZone("Europe/Paris")).toBeNull();
    expect(matchDayZone(undefined)).toBeNull();
  });
});

describe("instants and windows", () => {
  test("a day window is 16:00Z..16:00Z in Kuala Lumpur and 17:00Z..17:00Z in Jakarta", () => {
    expect(dayBoundsIn("2026-10-21", KL)).toEqual({ startMs: Date.parse("2026-10-20T16:00:00Z"), endMs: Date.parse("2026-10-21T16:00:00Z") });
    expect(dayBoundsIn("2026-10-21", JKT).startMs).toBe(Date.parse("2026-10-20T17:00:00Z"));
  });

  test("23:30 on a Malaysian day is that day, 00:30 the next is the next", () => {
    const late = instantIn("2026-10-21", 23, 30, KL);
    expect(late).toBe(Date.parse("2026-10-21T15:30:00Z"));
    expect(dayOfMs(late, KL)).toBe("2026-10-21");
    expect(dayOfMs(late, JKT)).toBe("2026-10-21");
    const after = late + 3_600_000;
    expect(dayOfMs(after, KL)).toBe("2026-10-22");
    expect(dayOfMs(after, JKT)).toBe("2026-10-21");
  });

  test("ISO text carries the zone offset and the weekday follows the zone", () => {
    expect(isoInZone(Date.parse("2026-10-21T15:30:00Z"), KL)).toBe("2026-10-21T23:30:00+08:00");
    expect(isoInZone(Date.parse("2026-10-21T15:30:00Z"), JKT)).toBe("2026-10-21T22:30:00+07:00");
    // 2026-10-21 is a Wednesday; 17:00Z on the 21st is Thursday 00:00 WIB.
    expect(weekdayOfMs(Date.parse("2026-10-21T16:30:00Z"), KL)).toBe(4);
    expect(weekdayOfMs(Date.parse("2026-10-21T16:30:00Z"), JKT)).toBe(3);
  });
});

describe("active zone", () => {
  test("zone-less helpers follow it, an explicit zone does not", () => {
    const at = new Date("2026-10-21T16:30:00Z");
    expect(getActiveDayZone()).toBe(JKT);
    expect(dayIn(undefined, at)).toBe("2026-10-21");
    setActiveDayZone(KL);
    try {
      expect(dayIn(undefined, at)).toBe("2026-10-22");
      expect(dayIn(JKT, at)).toBe("2026-10-21");
      expect(dayOfMs(at.getTime())).toBe("2026-10-22");
      expect(dayBoundsIn("2026-10-22").startMs).toBe(Date.parse("2026-10-21T16:00:00Z"));
    } finally {
      setActiveDayZone(JKT);
    }
  });
});

describe("resolveDayZone", () => {
  test("a served device zone wins, then the stored zone", () => {
    expect(resolveDayZone({ device: "Asia/Kuala_Lumpur", stored: JKT, hasProfile: true, region: "ID" })).toBe(KL);
    expect(resolveDayZone({ device: "Asia/Makassar", stored: KL, hasProfile: true, region: "ID" })).toBe(KL);
  });

  test("a legacy profile stays on WIB whatever the region; a person not onboarded gets the region's zone", () => {
    expect(resolveDayZone({ device: "Asia/Makassar", stored: null, hasProfile: true, region: "MY" })).toBe(JKT);
    expect(resolveDayZone({ stored: undefined, hasProfile: false, region: "MY" })).toBe(KL);
    expect(resolveDayZone({ stored: undefined, hasProfile: false, region: "SG" })).toBe("Asia/Singapore");
    expect(resolveDayZone({ stored: undefined, hasProfile: false, region: "ID" })).toBe(JKT);
  });

  test("regions map to their market's zone", () => {
    expect(zoneForRegion("ID")).toBe(JKT);
    expect(zoneForRegion("MY")).toBe(KL);
    expect(zoneForRegion("SG")).toBe("Asia/Singapore");
  });
});
