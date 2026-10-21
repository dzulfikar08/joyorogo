import { describe, expect, test } from "bun:test";

import { zoneToLocalMinutes } from "./reminder-time";

describe("zoneToLocalMinutes", () => {
  test("device in the same zone keeps the time", () => {
    expect(zoneToLocalMinutes(8 * 60, 7 * 60, 7 * 60)).toBe(8 * 60);
    expect(zoneToLocalMinutes(8 * 60, 8 * 60, 8 * 60)).toBe(8 * 60);
  });

  test("Jakarta reminder on a UTC+8 device moves an hour later", () => {
    expect(zoneToLocalMinutes(8 * 60, 8 * 60, 7 * 60)).toBe(9 * 60);
  });

  test("Kuala Lumpur 00:30 reminder on a UTC+7 device is 23:30 the evening before", () => {
    expect(zoneToLocalMinutes(30, 7 * 60, 8 * 60)).toBe(23 * 60 + 30);
  });
});
