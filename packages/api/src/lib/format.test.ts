import { describe, expect, test } from "bun:test";

import {
  dateKeyToUtcDate,
  daysInMonth,
  formatIdrInput,
  idrCaret,
  idrKeystroke,
  monthLabel,
  parseDateKey,
  parseIdrInput,
  recentDayLabel,
  shortDayLabel,
  weekdayIndex,
} from "./format";

describe("parseDateKey", () => {
  test("accepts a well-formed WIB day key", () => {
    expect(parseDateKey("2026-10-14")).toEqual({ year: 2026, month: 10, day: 14 });
  });

  test("rejects the shapes that crashed the calendar", () => {
    expect(parseDateKey("2026-10-01-01")).toBeNull(); // month key plus a day
    expect(parseDateKey("")).toBeNull();
    expect(parseDateKey("2026-2-6")).toBeNull(); // unpadded
    expect(parseDateKey("2026-13-01")).toBeNull();
    expect(parseDateKey("2026-00-10")).toBeNull();
    expect(parseDateKey("2026-10-00")).toBeNull();
    expect(parseDateKey("2026-10-32")).toBeNull();
  });
});

describe("dateKeyToUtcDate", () => {
  test("builds the exact UTC calendar date, no ctor string parsing", () => {
    const date = dateKeyToUtcDate("2026-10-14")!;
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(9);
    expect(date.getUTCDate()).toBe(14);
  });

  test("null on malformed keys instead of Invalid Date", () => {
    expect(dateKeyToUtcDate("2026-10-01-01")).toBeNull();
    expect(dateKeyToUtcDate("ngawur")).toBeNull();
  });
});

describe("weekdayIndex", () => {
  test("Monday-first: 6 Okt 2026 is Selasa (1)", () => {
    expect(weekdayIndex("2026-10-06")).toBe(1);
  });

  test("Sunday wraps to 6", () => {
    expect(weekdayIndex("2026-10-11")).toBe(6);
    expect(weekdayIndex("2026-10-12")).toBe(0);
  });
});

describe("daysInMonth", () => {
  test("regular and leap lengths", () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("shortDayLabel", () => {
  test("'Sen, 6 Okt' style without Intl", () => {
    expect(shortDayLabel("2026-10-05")).toBe("Sen, 5 Okt");
    expect(shortDayLabel("2026-01-01")).toBe("Kam, 1 Jan");
  });

  test("falls back to the raw key when malformed", () => {
    expect(shortDayLabel("ngawur")).toBe("ngawur");
  });
});

describe("recentDayLabel", () => {
  test("relative words for the two newest days, date otherwise", () => {
    const today = "2026-10-14";
    expect(recentDayLabel(today, today)).toBe("Hari ini");
    expect(recentDayLabel("2026-10-13", today)).toBe("Kemarin");
    expect(recentDayLabel("2026-10-05", today)).toBe("Sen, 5 Okt");
  });
});

describe("monthLabel", () => {
  test("'Okt 2026' for a YYYY-MM key", () => {
    expect(monthLabel("2026-10")).toBe("Okt 2026");
    expect(monthLabel("2026-01")).toBe("Jan 2026");
  });

  test("malformed keys pass through", () => {
    expect(monthLabel("ngawur")).toBe("ngawur");
  });
});

describe("formatIdrInput", () => {
  test("dots every three digits after the Rp prefix", () => {
    expect(formatIdrInput("15000")).toBe("Rp15.000");
    expect(formatIdrInput("1000")).toBe("Rp1.000");
    expect(formatIdrInput("999999999")).toBe("Rp999.999.999");
    expect(formatIdrInput("5")).toBe("Rp5");
  });

  test("empty stays empty, junk and overlong input are clamped", () => {
    expect(formatIdrInput("")).toBe("");
    expect(formatIdrInput("Rp15.000")).toBe("Rp15.000");
    expect(formatIdrInput("1234567890")).toBe("Rp123.456.789");
  });
});

describe("parseIdrInput", () => {
  test("round-trips the formatted text", () => {
    expect(parseIdrInput("Rp15.000")).toBe(15000);
    expect(parseIdrInput("15000")).toBe(15000);
    expect(parseIdrInput("")).toBeNull();
    expect(parseIdrInput("Rp")).toBeNull();
  });
});

describe("idrKeystroke", () => {
  const display = formatIdrInput;

  test("typing appends and reformats", () => {
    expect(idrKeystroke("Rp15.0005", display("15000"), 9)).toBe("150005");
  });

  test("deleting a digit at the end drops it", () => {
    expect(idrKeystroke("Rp15.00", display("15000"), 7)).toBe("1500");
  });

  test("deleting a separator deletes the digit before it", () => {
    // Backspace over the dot in "Rp15.|000" would otherwise pop right back.
    expect(idrKeystroke("Rp15000", display("15000"), 4)).toBe("1000");
  });

  test("typing a separator is a no-op", () => {
    expect(idrKeystroke("Rp15.000.", display("15000"), 9)).toBe("15000");
  });

  test("digits cap at nine", () => {
    expect(idrKeystroke("Rp999.999.9999", display("999999999"), 14)).toBe("999999999");
  });
});

describe("idrCaret", () => {
  test("stays glued to the edited digit when separators shift", () => {
    // The caret follows the freshly typed digit after reformatting.
    expect(idrCaret("Rp15.000", "Rp15000", 3)).toBe(3);
    expect(idrCaret("Rp150.000", "Rp150000", 4)).toBe(4);
  });

  test("start and end positions", () => {
    expect(idrCaret("Rp15.000", "Rp15.000", 2)).toBe(2);
    expect(idrCaret("Rp15.000", "Rp15.000", 8)).toBe(8);
    expect(idrCaret("", "", 0)).toBe(0);
  });
});
