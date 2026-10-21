import { describe, expect, test } from "bun:test";

import {
  clockHourIn,
  dayIn,
  dayZoneOffsetMs,
  matchDayZone,
  yesterdayIn,
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
