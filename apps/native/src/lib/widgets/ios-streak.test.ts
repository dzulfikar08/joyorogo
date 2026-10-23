import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { dayIn, dayZoneOffsetMs } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";
import { shiftDate } from "@joyorogo/api/lib/engine";
import { streakState } from "@joyorogo/api/lib/streak";
import en from "../../../../../packages/i18n/src/locales/en/misc.json";
import id from "../../../../../packages/i18n/src/locales/id/misc.json";
import ms from "../../../../../packages/i18n/src/locales/ms/misc.json";

import {
  IOS_APP_GROUP,
  IOS_STREAK_COPY_KEYS,
  IOS_STREAK_KEY,
  IOS_STREAK_LANG_KEY,
  IOS_STREAK_VERSION,
  IOS_WIDGET_KIND,
  iosStreakPayload,
} from "./ios-streak";
import { CAMERA_WIDGET_URI } from "./names";
// Type-only: snapshot.ts reads files through expo, which bun cannot load.
import type { WidgetDaySnapshot, WidgetSnapshot } from "./snapshot";
import { MASCOT_ART, streakWidgetModel } from "./streak-model";

const NATIVE = resolve(import.meta.dir, "../../..");
const TARGET = resolve(NATIVE, "targets/widget");
const CHECK = resolve(NATIVE, "widget-ios-check");
const appJson = readFileSync(resolve(NATIVE, "app.json"), "utf8");
const COPY_FILE = resolve(TARGET, "streak-copy.json");
const VECTORS_FILE = resolve(CHECK, "streak-vectors.json");

/** `UPDATE_WIDGET_FILES=1 bun test src/lib/widgets/ios-streak.test.ts` rewrites the generated files; plain runs compare. */
const UPDATE = process.env.UPDATE_WIDGET_FILES === "1";

const TODAY = "2026-10-23";
const back = (n: number) => shiftDate(TODAY, -n);

function snap(day: Partial<WidgetDaySnapshot> | null, over: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    signedIn: true,
    updatedAt: 1,
    fasting: null,
    inbox: null,
    day:
      day === null
        ? null
        : { date: TODAY, eatenKcal: 0, eatKcal: 2000, proteinEatenG: null, proteinTargetG: null, streakDays: 0, ...day },
    ...over,
  };
}

/** A snapshot whose streak is the one the server computes from `dates` on TODAY. */
function fromDates(dates: string[], day: Partial<WidgetDaySnapshot> = {}): WidgetSnapshot {
  const state = streakState(dates, TODAY);
  return snap({ streak: { days: state.days, lastLoggedDate: state.lastLoggedDate }, ...day });
}

const LOCALES: Record<Locale, unknown> = { id, en, ms };

/** "misc:widget.streak.done.1" in a locale's misc.json. */
function copy(misc: unknown, key: string): string {
  let node: unknown = misc;
  for (const part of key.replace("misc:", "").split(".")) {
    if (typeof node !== "object" || node === null) throw new Error(`${key} missing`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`${key} is not a string`);
  return node;
}

function copyTable(): Record<Locale, Record<string, string>> {
  const keys = Object.keys(IOS_STREAK_COPY_KEYS).sort();
  const table = {} as Record<Locale, Record<string, string>>;
  for (const locale of Object.keys(LOCALES) as Locale[]) {
    table[locale] = Object.fromEntries(keys.map((key) => [key, copy(LOCALES[locale], key)]));
  }
  return table;
}

/** The scenarios the Swift port is checked against: every state, every day of the rotation, both plans, all edges. */
const SCENARIOS: Array<{ name: string; snapshot: WidgetSnapshot }> = [
  { name: "done", snapshot: fromDates([back(2), back(1), TODAY]) },
  { name: "done, a run of 1000", snapshot: snap({ streak: { days: 1000, lastLoggedDate: TODAY } }) },
  { name: "at risk", snapshot: fromDates([back(3), back(2), back(1)]) },
  { name: "broken, 3 days", snapshot: fromDates([back(9), back(4), back(3)]) },
  { name: "broken, 6 days", snapshot: fromDates([back(6)]) },
  { name: "asleep, 7 days", snapshot: fromDates([back(7)]) },
  { name: "asleep, a month", snapshot: fromDates([back(30)]) },
  { name: "fresh", snapshot: fromDates([]) },
  { name: "gain: done", snapshot: fromDates([TODAY], { gain: true }) },
  { name: "gain: at risk", snapshot: fromDates([back(2), back(1)], { gain: true }) },
  { name: "gain: broken", snapshot: fromDates([back(5)], { gain: true }) },
  { name: "gain: asleep", snapshot: fromDates([back(12)], { gain: true }) },
  { name: "gain: fresh", snapshot: fromDates([], { gain: true }) },
  { name: "maternal", snapshot: snap({ maternal: true, streak: null }) },
  { name: "maternal with a stale streak", snapshot: snap({ maternal: true, streak: { days: 4, lastLoggedDate: TODAY } }) },
  { name: "no streak in the snapshot", snapshot: snap({ streak: undefined }) },
  { name: "no plan", snapshot: snap(null) },
  { name: "signed out", snapshot: snap(null, { signedIn: false }) },
  { name: "signed out with a stale day", snapshot: snap({ streak: { days: 5, lastLoggedDate: TODAY } }, { signedIn: false }) },
  { name: "Kuala Lumpur", snapshot: fromDates([back(1)], { zone: "Asia/Kuala_Lumpur" }) },
  { name: "a last day after today (phone clock behind)", snapshot: snap({ streak: { days: 2, lastLoggedDate: shiftDate(TODAY, 1) } }) },
];

/** Each scenario read on the day it was written and on the nine days after, so it ages through every state. */
const AGE_DAYS = Array.from({ length: 10 }, (_, d) => d);

function modelVectors() {
  return SCENARIOS.flatMap(({ name, snapshot }) =>
    AGE_DAYS.map((age) => {
      const today = shiftDate(TODAY, age);
      const m = streakWidgetModel(snapshot, today);
      return {
        name: `${name} +${age}d`,
        snapshot: iosStreakPayload(snapshot),
        today,
        expected: {
          kind: m.kind,
          pose: m.pose,
          count: m.count,
          titleKey: m.titleKey,
          lit: m.lit,
          labelKey: m.labelKey,
          lineKey: m.lineKey,
          gain: m.gain,
        },
      };
    }),
  );
}

const ZONES: DayZone[] = ["Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Singapore"];

/** Instants around the midnights of every zone: 16:59 UTC is still the 23rd in Jakarta and already the 24th in Kuala Lumpur. */
function dayVectors() {
  const instants = ["2026-10-23T00:00:00Z", "2026-10-23T16:59:59Z", "2026-10-23T17:00:00Z", "2026-10-23T15:59:59Z", "2026-10-23T16:00:00Z", "2026-12-31T16:59:59Z", "2026-12-31T17:00:00Z", "2027-02-28T16:30:00Z"];
  return ZONES.flatMap((zone) =>
    instants.map((at) => ({ at, zone, day: dayIn(zone, new Date(at)) })),
  );
}

/** The instant a day starts in a zone, in whole seconds since 1970 (fixed offsets, no daylight saving). */
function midnightSeconds(zone: DayZone, day: string): number {
  return (Date.parse(`${day}T00:00:00Z`) - dayZoneOffsetMs(zone)) / 1000;
}

function timelineVectors() {
  const starts = ["2026-10-23T05:00:00Z", "2026-10-23T16:59:00Z", "2026-10-23T17:00:00Z", "2026-12-30T20:00:00Z"];
  return ZONES.flatMap((zone) =>
    starts.map((from) => {
      const days = 8;
      const first = dayIn(zone, new Date(from));
      return {
        from,
        fromSeconds: Date.parse(from) / 1000,
        zone,
        days,
        dates: [Date.parse(from) / 1000, ...Array.from({ length: days }, (_, k) => midnightSeconds(zone, shiftDate(first, k + 1)))],
      };
    }),
  );
}

/** One vector per line, so a changed answer is one line in the diff. */
function vectorLines(groups: Record<string, unknown[]>): string {
  const body = Object.entries(groups).map(([name, rows]) => `  "${name}": [\n${rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
  return `{\n${body.join(",\n")}\n}\n`;
}

/** Writes `text` as `file` (UPDATE_WIDGET_FILES=1) or fails when the file on disk differs. */
function expectFile(file: string, text: string, hint: string) {
  if (UPDATE) {
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file) ? readFileSync(file, "utf8") : "", `${hint}: run UPDATE_WIDGET_FILES=1 bun test src/lib/widgets/ios-streak.test.ts`).toBe(text);
}

describe("iosStreakPayload", () => {
  test("keeps exactly what the streak model reads", () => {
    expect(iosStreakPayload(fromDates([TODAY], { zone: "Asia/Kuala_Lumpur", gain: true }))).toEqual({
      v: IOS_STREAK_VERSION,
      signedIn: true,
      day: { zone: "Asia/Kuala_Lumpur", streak: { days: 1, lastLoggedDate: TODAY }, maternal: false, gain: true },
    });
  });

  test("an old snapshot without a zone is cut in Jakarta, Hamil / Menyusui has no streak, no plan has no day", () => {
    expect(iosStreakPayload(snap({ streak: { days: 2, lastLoggedDate: TODAY } })).day?.zone).toBe("Asia/Jakarta");
    expect(iosStreakPayload(snap({ maternal: true, streak: null })).day).toMatchObject({ maternal: true, streak: null });
    expect(iosStreakPayload(snap(null))).toEqual({ v: IOS_STREAK_VERSION, signedIn: true, day: null });
  });

  test("a signed-out snapshot carries no day, so the last person's numbers never stay on the home screen", () => {
    expect(iosStreakPayload(snap({ streak: { days: 9, lastLoggedDate: TODAY } }, { signedIn: false }))).toEqual({
      v: IOS_STREAK_VERSION,
      signedIn: false,
      day: null,
    });
  });

  test("serialises to plain JSON the Swift decoder reads", () => {
    const json = JSON.stringify(iosStreakPayload(fromDates([TODAY])));
    expect(JSON.parse(json)).toEqual(iosStreakPayload(fromDates([TODAY])));
  });
});

describe("the widget extension and the app agree", () => {
  const swift = (file: string) => readFileSync(resolve(TARGET, file), "utf8");

  test("the App Group is the same string in the entitlements, the JS store and the Swift store", () => {
    // app.json has comments, so it is read as text.
    expect(appJson).toContain(`"com.apple.security.application-groups": ["${IOS_APP_GROUP}"]`);
    expect(swift("StreakStore.swift")).toContain(`let streakAppGroup = "${IOS_APP_GROUP}"`);
  });

  test("the widget kind, storage keys and tap link are the same on both sides", () => {
    expect(swift("StreakWidget.swift")).toContain(`let streakWidgetKind = "${IOS_WIDGET_KIND}"`);
    expect(swift("StreakWidget.swift")).toContain(`URL(string: "${CAMERA_WIDGET_URI}")`);
    expect(swift("StreakStore.swift")).toContain(`static let snapshotKey = "${IOS_STREAK_KEY}"`);
    expect(swift("StreakStore.swift")).toContain(`static let languageKey = "${IOS_STREAK_LANG_KEY}"`);
  });

  test("the config plugin is on and the target is signed as an extension of the app", () => {
    expect(appJson).toContain('"@bacons/apple-targets"');
    const config = readFileSync(resolve(TARGET, "expo-target.config.js"), "utf8");
    expect(config).toContain('type: "widget"');
    expect(config).toContain('bundleIdentifier: ".widget"');
    expect(config).toContain('"com.apple.security.application-groups"');
  });

  test("every pose has its Joyo image in the asset catalog, at the Android art's aspect ratio", () => {
    for (const [pose, art] of Object.entries(MASCOT_ART)) {
      const dir = resolve(TARGET, `Assets.xcassets/mascot-${pose}.imageset`);
      const png = readFileSync(resolve(dir, `${pose}.png`));
      expect(png.toString("ascii", 1, 4)).toBe("PNG");
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(Math.abs(width / height - art.width / art.height)).toBeLessThan(0.02);
      expect(JSON.parse(readFileSync(resolve(dir, "Contents.json"), "utf8")).images[0].filename).toBe(`${pose}.png`);
    }
  });

  test("the fonts the Swift code names are bundled and registered in Info.plist", () => {
    const plist = readFileSync(resolve(TARGET, "Info.plist"), "utf8");
    for (const file of ["PlusJakartaSans-Bold.ttf", "PlusJakartaSans-ExtraBold.ttf"]) {
      expect(existsSync(resolve(TARGET, file))).toBe(true);
      expect(plist).toContain(`<string>${file}</string>`);
    }
    expect(plist).toContain("com.apple.widgetkit-extension");
    expect(swift("StreakWidget.swift")).toContain('"PlusJakartaSans-Bold"');
    expect(swift("StreakWidget.swift")).toContain('"PlusJakartaSans-ExtraBold"');
  });
});

describe("generated widget files", () => {
  test("streak-copy.json is the Android copy (misc.json) in id, en and ms", () => {
    expectFile(COPY_FILE, `${JSON.stringify(copyTable(), null, 2)}\n`, "targets/widget/streak-copy.json is out of date with packages/i18n misc.json");
  });

  test("every locale has every key, none empty", () => {
    for (const table of Object.values(copyTable())) {
      expect(Object.keys(table).length).toBe(Object.keys(IOS_STREAK_COPY_KEYS).length);
      for (const text of Object.values(table)) expect(text.length).toBeGreaterThan(0);
    }
  });

  test("widget-ios-check/streak-vectors.json is the TypeScript model's answers (the Swift port is checked against it)", () => {
    expectFile(VECTORS_FILE, vectorLines({ models: modelVectors(), days: dayVectors(), timelines: timelineVectors() }), "widget-ios-check/streak-vectors.json is out of date with streak-model.ts");
  });
});
