import { describe, expect, test } from "bun:test";

import { DEFAULT_REMINDER_CONFIG } from "./reminder-config";
import {
  DEFAULT_STICKER_PREFS,
  ROGO_PREF_KEYS,
  isRogoPrefDefault,
  isRogoPrefKey,
  sanitizeRogoPref,
} from "./rogo-prefs";

const GARBAGE = [undefined, null, 0, 1, "", "nope", NaN, [], {}, [1, 2], () => 1];

describe("the registry", () => {
  test("lists every synced key, each short enough for a sync record id", () => {
    expect(ROGO_PREF_KEYS).toEqual([
      "theme",
      "reminders",
      "makan.view",
      "makan.kind",
      "sticker",
      "dismissed.handlePrompt",
      "dismissed.stravaRetention7d",
    ]);
    for (const key of ROGO_PREF_KEYS) expect(key.length).toBeLessThanOrEqual(64);
  });

  test("tells keys from anything else, prototype names included", () => {
    expect(isRogoPrefKey("theme")).toBe(true);
    expect(isRogoPrefKey("profile.locale")).toBe(false);
    expect(isRogoPrefKey("constructor")).toBe(false);
    expect(isRogoPrefKey("__proto__")).toBe(false);
    expect(sanitizeRogoPref("toString", "x")).toBeUndefined();
  });
});

describe("theme", () => {
  test.each(["light", "dark", "system"])("accepts %s", (value) => {
    expect(sanitizeRogoPref("theme", value)).toBe(value);
  });

  test("rejects everything else", () => {
    for (const value of [...GARBAGE, "Dark", "auto", true]) expect(sanitizeRogoPref("theme", value)).toBeUndefined();
  });

  test("system is the default", () => {
    expect(isRogoPrefDefault("theme", "system")).toBe(true);
    expect(isRogoPrefDefault("theme", "dark")).toBe(false);
  });
});

describe("makan.view and makan.kind", () => {
  test("accept the known values", () => {
    for (const view of ["daftar", "kalender", "stiker", "tempat"]) expect(sanitizeRogoPref("makan.view", view)).toBe(view);
    for (const kind of ["semua", "makanan", "camilan", "minuman", "lainnya"]) {
      expect(sanitizeRogoPref("makan.kind", kind)).toBe(kind);
    }
  });

  test("reject unknown values and other types", () => {
    for (const value of [...GARBAGE, "list", "Daftar"]) expect(sanitizeRogoPref("makan.view", value)).toBeUndefined();
    for (const value of [...GARBAGE, "snack"]) expect(sanitizeRogoPref("makan.kind", value)).toBeUndefined();
  });

  test("daftar and semua are the defaults", () => {
    expect(isRogoPrefDefault("makan.view", "daftar")).toBe(true);
    expect(isRogoPrefDefault("makan.view", "kalender")).toBe(false);
    expect(isRogoPrefDefault("makan.kind", "semua")).toBe(true);
    expect(isRogoPrefDefault("makan.kind", "minuman")).toBe(false);
  });
});

describe("sticker", () => {
  test("accepts a full object and fills missing members with the privacy-safe defaults", () => {
    expect(sanitizeRogoPref("sticker", { hideNumbers: false, showName: true, watermark: false })).toEqual({
      hideNumbers: false,
      showName: true,
      watermark: false,
    });
    expect(sanitizeRogoPref("sticker", { showName: true })).toEqual({ ...DEFAULT_STICKER_PREFS, showName: true });
    expect(sanitizeRogoPref("sticker", {})).toEqual(DEFAULT_STICKER_PREFS);
  });

  test("drops extra keys", () => {
    expect(sanitizeRogoPref("sticker", { watermark: false, extra: 1, __proto__: { x: 1 } })).toEqual({
      ...DEFAULT_STICKER_PREFS,
      watermark: false,
    });
  });

  test("rejects non-objects and a member of the wrong type", () => {
    for (const value of [undefined, null, 0, "x", true, [], [true]]) expect(sanitizeRogoPref("sticker", value)).toBeUndefined();
    expect(sanitizeRogoPref("sticker", { hideNumbers: "yes" })).toBeUndefined();
    expect(sanitizeRogoPref("sticker", { showName: 1 })).toBeUndefined();
    expect(sanitizeRogoPref("sticker", { watermark: null })).toBeUndefined();
  });

  test("the defaults are the default", () => {
    expect(isRogoPrefDefault("sticker", DEFAULT_STICKER_PREFS)).toBe(true);
    expect(isRogoPrefDefault("sticker", { ...DEFAULT_STICKER_PREFS, showName: true })).toBe(false);
  });
});

describe("reminders", () => {
  test("accepts a config and returns a complete, normalized one", () => {
    const config = sanitizeRogoPref("reminders", {
      meals: { sarapan: { enabled: true, time: "6:45" } },
      water: { enabled: true, start: "07:00", end: "21:00", everyHours: 3 },
      window: { open: true },
    });
    expect(config).toEqual({
      ...DEFAULT_REMINDER_CONFIG,
      meals: { ...DEFAULT_REMINDER_CONFIG.meals, sarapan: { enabled: true, time: "06:45" } },
      water: { enabled: true, start: "07:00", end: "21:00", everyHours: 3 },
      window: { open: true, close: false },
    });
  });

  test("falls back per member for bad times and intervals", () => {
    const config = sanitizeRogoPref("reminders", {
      weighIn: { enabled: true, time: "25:00" },
      water: { enabled: true, everyHours: 5 },
    }) as typeof DEFAULT_REMINDER_CONFIG;
    expect(config.weighIn).toEqual({ enabled: true, time: DEFAULT_REMINDER_CONFIG.weighIn.time });
    expect(config.water.everyHours).toBe(DEFAULT_REMINDER_CONFIG.water.everyHours);
  });

  test("drops extra keys", () => {
    const config = sanitizeRogoPref("reminders", { ...DEFAULT_REMINDER_CONFIG, extra: 1, meals: { ...DEFAULT_REMINDER_CONFIG.meals, brunch: {} } });
    expect(config).toEqual(DEFAULT_REMINDER_CONFIG);
  });

  test("rejects anything that is not an object", () => {
    for (const value of [undefined, null, 0, "dark", true, [], [1]]) expect(sanitizeRogoPref("reminders", value)).toBeUndefined();
  });

  test("the stock config is the default, one switched-on reminder is not", () => {
    expect(isRogoPrefDefault("reminders", sanitizeRogoPref("reminders", DEFAULT_REMINDER_CONFIG))).toBe(true);
    const on = sanitizeRogoPref("reminders", { ...DEFAULT_REMINDER_CONFIG, weighIn: { enabled: true, time: "07:00" } });
    expect(isRogoPrefDefault("reminders", on)).toBe(false);
  });
});

describe("dismissals", () => {
  test.each(["dismissed.handlePrompt", "dismissed.stravaRetention7d"])("%s is only ever true", (key) => {
    expect(sanitizeRogoPref(key, true)).toBe(true);
    for (const value of [false, ...GARBAGE, "1", "true"]) expect(sanitizeRogoPref(key, value)).toBeUndefined();
    expect(isRogoPrefDefault(key as "dismissed.handlePrompt", true)).toBe(false);
  });
});
