import { afterEach, describe, expect, test } from "bun:test";

import { setActiveDayZone } from "@joyorogo/i18n";

import { localDay } from "./format";

afterEach(() => setActiveDayZone("Asia/Jakarta"));

describe("localDay", () => {
  // 2026-10-21T16:30:00Z: 23:30 WIB, already 00:30 the next day in Kuala Lumpur.
  const sec = Date.parse("2026-10-21T16:30:00Z") / 1000;

  test("Jakarta cuts the day at UTC+7", () => {
    expect(localDay(sec)).toBe("2026-10-21");
  });

  test("Kuala Lumpur cuts the day at UTC+8", () => {
    setActiveDayZone("Asia/Kuala_Lumpur");
    expect(localDay(sec)).toBe("2026-10-22");
  });
});
