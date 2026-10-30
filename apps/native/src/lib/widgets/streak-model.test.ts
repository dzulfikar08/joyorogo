import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { shiftDate } from "@joyorogo/api/lib/engine";
import { streakAt, streakState } from "@joyorogo/api/lib/streak";
import en from "../../../../../packages/i18n/src/locales/en/misc.json";
import id from "../../../../../packages/i18n/src/locales/id/misc.json";
import ms from "../../../../../packages/i18n/src/locales/ms/misc.json";

// Type-only: snapshot.ts reads files through expo, which bun cannot load.
import type { WidgetDaySnapshot, WidgetSnapshot } from "./snapshot";
import { COMEBACK_AFTER_DAYS, MASCOT_ART, MOOD_HOURS, isMilestone, streakWidgetModel } from "./streak-model";
import type { StreakPose } from "./streak-model";

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
        : {
            date: TODAY,
            eatenKcal: 0,
            eatKcal: 2000,
            proteinEatenG: null,
            proteinTargetG: null,
            streakDays: 0,
            ...day,
          },
    ...over,
  };
}

/** A snapshot whose streak is the one the server computes from `dates` on TODAY. */
function fromDates(dates: string[], day: Partial<WidgetDaySnapshot> = {}): WidgetSnapshot {
  const state = streakState(dates, TODAY);
  return snap({ streak: { days: state.days, lastLoggedDate: state.lastLoggedDate }, ...day });
}

/** A snapshot with this exact stamp. */
function stamped(days: number, lastLoggedDate: string | null, previousLoggedDate?: string | null, day: Partial<WidgetDaySnapshot> = {}) {
  return snap({ streak: { days, lastLoggedDate, previousLoggedDate }, ...day });
}

/** Midday: no mood boundary is near it, so tests that do not care about the hour read it at this one. */
const NOON = 13;

describe("streakWidgetModel", () => {
  test("today logged: lit flame with the run, Joyo cheering", () => {
    const m = streakWidgetModel(fromDates([back(2), back(1), TODAY]), TODAY, NOON);
    expect(m).toMatchObject({ kind: "done", pose: "cheer", count: 3, lit: true, labelKey: "misc:widget.streak.days" });
    expect(m.lineKey).toMatch(/^misc:widget\.streak\.done\.[12]$/);
  });

  test("a logged day does not care about the hour", () => {
    const night = streakWidgetModel(fromDates([back(1), TODAY]), TODAY, 23);
    const morning = streakWidgetModel(fromDates([back(1), TODAY]), TODAY, 0);
    expect(night).toEqual(morning);
  });

  test("the mood hours are 12, 17 and 21", () => {
    expect([...MOOD_HOURS]).toEqual([12, 17, 21]);
  });

  describe("at risk (run alive, today blank): Joyo worries by the phone's hour", () => {
    const stuck = fromDates([back(3), back(2), back(1)]);
    const cases: Array<[number, StreakPose, string]> = [
      [0, "morning", "misc:widget.streak.atRisk.morning"],
      [11, "morning", "misc:widget.streak.atRisk.morning"],
      [12, "sideeye", "misc:widget.streak.atRisk.sideeye"],
      [16, "sideeye", "misc:widget.streak.atRisk.sideeye"],
      [17, "panic", "misc:widget.streak.atRisk.panic"],
      [20, "panic", "misc:widget.streak.atRisk.panic"],
      [21, "lastchance", "misc:widget.streak.atRisk.lastchance"],
      [23, "lastchance", "misc:widget.streak.atRisk.lastchance"],
    ];

    for (const [hour, pose, lineKey] of cases) {
      test(`${String(hour).padStart(2, "0")}:00 is ${pose}`, () => {
        expect(streakWidgetModel(stuck, TODAY, hour)).toMatchObject({
          kind: "at_risk",
          pose,
          lineKey,
          count: 3,
          lit: true,
          labelKey: "misc:widget.streak.days",
        });
      });
    }

    test("a Naikin BB plan keeps its own line but the same poses", () => {
      const gain = fromDates([back(2), back(1)], { gain: true });
      for (const [hour, pose] of cases) {
        expect(streakWidgetModel(gain, TODAY, hour)).toMatchObject({ pose, lineKey: "misc:widget.streak.atRisk.gain", gain: true });
      }
    });

    test("a milestone number that is not logged yet is still an at-risk day, not a party", () => {
      expect(streakWidgetModel(stamped(7, back(1)), TODAY, NOON)).toMatchObject({ kind: "at_risk", pose: "sideeye", count: 7 });
    });
  });

  describe("broken: Joyo's mood follows the days the run has been gone", () => {
    // lapseDays is the count the tile shows (2 = last logged the day before yesterday); the run has been gone lapseDays - 1.
    const cases: Array<[gone: number, pose: StreakPose, lineKey: RegExp | string]> = [
      [1, "teary", "misc:widget.streak.broken.teary"],
      [2, "mopey", /^misc:widget\.streak\.broken\.mopey\.[123]$/],
      [3, "mopey", /^misc:widget\.streak\.broken\.mopey\.[123]$/],
      [4, "frozen", "misc:widget.streak.broken.frozen"],
      [6, "frozen", "misc:widget.streak.broken.frozen"],
      [7, "dusty", "misc:widget.streak.broken.dusty"],
      [13, "dusty", "misc:widget.streak.broken.dusty"],
      [14, "ghost", "misc:widget.streak.broken.ghost"],
      [60, "ghost", "misc:widget.streak.broken.ghost"],
    ];

    for (const [gone, pose, lineKey] of cases) {
      test(`${gone} day${gone === 1 ? "" : "s"} gone is ${pose}`, () => {
        const lapseDays = gone + 1;
        const m = streakWidgetModel(stamped(9, back(lapseDays)), TODAY, NOON);
        expect(m).toMatchObject({ kind: "broken", pose, count: lapseDays, lit: false, labelKey: "misc:widget.streak.lapse" });
        if (typeof lineKey === "string") expect(m.lineKey).toBe(lineKey);
        else expect(m.lineKey).toMatch(lineKey);
      });
    }

    test("the first broken day is a cold flame with 2 days without a log and a teary Joyo", () => {
      expect(streakWidgetModel(fromDates([back(2), back(3)]), TODAY, NOON)).toMatchObject({
        kind: "broken",
        count: 2,
        pose: "teary",
        lit: false,
      });
    });

    test("the hour does not move a broken run", () => {
      for (const hour of [0, 11, 12, 17, 21, 23]) {
        expect(streakWidgetModel(stamped(9, back(5)), TODAY, hour).pose).toBe("frozen");
      }
    });

    test("a Naikin BB plan counts days short of the target, with the same poses", () => {
      expect(streakWidgetModel(stamped(9, back(5), null, { gain: true }), TODAY, NOON)).toMatchObject({
        pose: "frozen",
        labelKey: "misc:widget.streak.lapseGain",
        gain: true,
      });
    });

    test("the mopey line changes with the calendar day and is stable within it", () => {
      // Last log 3 days back: the run has been gone 2 days today and 3 tomorrow, both mopey.
      const stuck = stamped(9, back(3));
      const today = streakWidgetModel(stuck, TODAY, NOON);
      const tomorrow = streakWidgetModel(stuck, shiftDate(TODAY, 1), NOON);
      expect([today.pose, tomorrow.pose]).toEqual(["mopey", "mopey"]);
      expect(today.lineKey).not.toBe(tomorrow.lineKey);
      expect(streakWidgetModel(stuck, TODAY, 20).lineKey).toBe(today.lineKey);
    });
  });

  describe("done: milestones and comebacks", () => {
    test("isMilestone: 7, 30, 100 and every further 100", () => {
      for (const days of [7, 30, 100, 200, 300, 1000]) expect(isMilestone(days)).toBe(true);
      for (const days of [0, 1, 6, 8, 29, 31, 99, 101, 150, 199, 201]) expect(isMilestone(days)).toBe(false);
    });

    for (const days of [7, 30, 100, 200]) {
      test(`day ${days} of a run logged today is a milestone`, () => {
        expect(streakWidgetModel(stamped(days, TODAY), TODAY, NOON)).toMatchObject({
          kind: "done",
          pose: "milestone",
          count: days,
          lit: true,
          lineKey: "misc:widget.streak.done.milestone",
        });
      });
    }

    for (const days of [6, 8, 29, 31, 99, 101, 199]) {
      test(`day ${days} is an ordinary cheer`, () => {
        const m = streakWidgetModel(stamped(days, TODAY), TODAY, NOON);
        expect(m).toMatchObject({ kind: "done", pose: "cheer", count: days });
        expect(m.lineKey).toMatch(/^misc:widget\.streak\.done\.[12]$/);
      });
    }

    test(`day one after ${COMEBACK_AFTER_DAYS} or more days away is a welcome back`, () => {
      for (const away of [COMEBACK_AFTER_DAYS, COMEBACK_AFTER_DAYS + 1, 30, 400]) {
        expect(streakWidgetModel(stamped(1, TODAY, back(away)), TODAY, NOON)).toMatchObject({
          kind: "done",
          pose: "welcome",
          count: 1,
          lit: true,
          lineKey: "misc:widget.streak.done.welcome",
        });
      }
    });

    test("a normal day one (the log before it was less than a week ago, unknown, or unreadable) is a plain cheer", () => {
      for (const previous of [back(1), back(2), back(COMEBACK_AFTER_DAYS - 1), null, undefined, "garbage"]) {
        const m = streakWidgetModel(stamped(1, TODAY, previous), TODAY, NOON);
        expect(m).toMatchObject({ kind: "done", pose: "cheer", count: 1 });
        expect(m.lineKey).toMatch(/^misc:widget\.streak\.done\.[12]$/);
      }
    });

    test("only day one is a comeback: a longer run keeps its cheer, whatever came before it", () => {
      expect(streakWidgetModel(stamped(2, TODAY, back(30)), TODAY, NOON).pose).toBe("cheer");
      expect(streakWidgetModel(stamped(7, TODAY, back(30)), TODAY, NOON).pose).toBe("milestone");
    });

    test("a comeback is only for the day it happens: the next morning is an ordinary at-risk day", () => {
      expect(streakWidgetModel(stamped(1, TODAY, back(30)), shiftDate(TODAY, 1), 9)).toMatchObject({ kind: "at_risk", pose: "morning" });
    });
  });

  test("nothing in the window: a title in place of the number, no flame, Joyo ready", () => {
    const m = streakWidgetModel(fromDates([]), TODAY, NOON);
    expect(m).toMatchObject({ kind: "fresh", pose: "ready", count: null, titleKey: "misc:widget.streak.freshTitle" });
  });

  test("a Naikin BB plan words the at-risk, broken and fresh lines by the eating target", () => {
    expect(streakWidgetModel(fromDates([back(2), back(1)], { gain: true }), TODAY, NOON).lineKey).toBe("misc:widget.streak.atRisk.gain");
    expect(streakWidgetModel(fromDates([back(5)], { gain: true }), TODAY, NOON).labelKey).toBe("misc:widget.streak.lapseGain");
    expect(streakWidgetModel(fromDates([], { gain: true }), TODAY, NOON).lineKey).toBe("misc:widget.streak.freshGain");
  });

  test("Hamil / Menyusui and a snapshot from before the streak shipped show no streak at all", () => {
    for (const day of [{ maternal: true, streak: null }, { streak: undefined }, { streak: null }]) {
      for (const hour of [9, 22]) {
        const m = streakWidgetModel(snap(day), TODAY, hour);
        expect(m).toMatchObject({ kind: "off", count: null, lit: false, pose: "relax" });
      }
    }
  });

  test("signed out and no plan explain what is missing", () => {
    expect(streakWidgetModel(snap(null, { signedIn: false }), TODAY, NOON)).toMatchObject({ kind: "signedOut", count: null, pose: "ready" });
    expect(streakWidgetModel(snap(null), TODAY, NOON)).toMatchObject({ kind: "noTarget", lineKey: "misc:widget.setTarget" });
  });

  test("a snapshot nobody refreshed ages on the phone's date: lit last night, at risk this morning, broken the day after", () => {
    const night = fromDates([back(2), back(1), TODAY]);
    expect(streakWidgetModel(night, TODAY, 22)).toMatchObject({ kind: "done", count: 3 });
    expect(streakWidgetModel(night, shiftDate(TODAY, 1), 7)).toMatchObject({ kind: "at_risk", pose: "morning", count: 3, lit: true });
    expect(streakWidgetModel(night, shiftDate(TODAY, 2), 7)).toMatchObject({ kind: "broken", pose: "teary", count: 2, lit: false });
  });

  test("the model agrees with the server's own status for every stamp", () => {
    for (const dates of [[TODAY], [back(1)], [back(4)], []]) {
      const server = streakState(dates, TODAY);
      const m = streakWidgetModel(fromDates(dates), TODAY, NOON);
      const aged = streakAt({ days: server.days, lastLoggedDate: server.lastLoggedDate }, TODAY);
      expect(aged.status).toBe(server.status);
      expect(m.kind).toBe(server.status === "none" ? "fresh" : server.status);
    }
  });
});

/** "misc:widget.streak.done.1" in a locale's misc.json; undefined when the path is missing. */
function copy(misc: unknown, key: string): string | undefined {
  let node: unknown = misc;
  for (const part of key.replace("misc:", "").split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

describe("streak widget copy", () => {
  const LOCALES = { id, en, ms } as const;
  const states = [
    fromDates([TODAY]),
    stamped(7, TODAY),
    stamped(100, TODAY),
    stamped(1, TODAY, back(10)),
    fromDates([back(1)]),
    // Last log 2, 3, 4, 5, 7, 8, 14 and 15 days back: every broken bucket.
    ...[2, 3, 4, 5, 7, 8, 14, 15, 40].map((n) => stamped(5, back(n))),
    fromDates([]),
    fromDates([back(1)], { gain: true }),
    fromDates([back(3)], { gain: true }),
    fromDates([], { gain: true }),
    snap({ maternal: true }),
    snap(null, { signedIn: false }),
    snap(null),
  ];
  // Every hour bucket and every day of the rotation, so every line of every state is reached.
  const models = states.flatMap((s) =>
    [0, 1, 2].flatMap((d) => [9, 13, 18, 22].map((hour) => streakWidgetModel(s, shiftDate(TODAY, d), hour))),
  );

  test("every state reaches every mood", () => {
    const poses = new Set(models.map((m) => m.pose));
    for (const pose of ["cheer", "milestone", "welcome", "morning", "sideeye", "panic", "lastchance", "teary", "mopey", "frozen", "dusty", "ghost", "ready", "relax"] as const) {
      expect(poses.has(pose)).toBe(true);
    }
  });

  test("every key a state can use resolves in id, en and ms (no key shown raw)", () => {
    for (const misc of Object.values(LOCALES)) {
      for (const m of models) {
        for (const key of [m.lineKey, m.labelKey, m.titleKey]) {
          if (key !== null) expect(copy(misc, key)?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("the lines never talk about weight, body or failure", () => {
    const banned = /\b(gemuk|kurus|berat badan|weight|lazy|malas|gagal|fail|bodoh|shame|malu)\b/i;
    for (const misc of Object.values(LOCALES)) {
      for (const m of models) expect(copy(misc, m.lineKey)).not.toMatch(banned);
    }
  });

  test("the owner's lines read as written in Indonesian", () => {
    expect(copy(id, "misc:widget.streak.atRisk.morning")).toBe("Sarapan apa?");
    expect(copy(id, "misc:widget.streak.atRisk.sideeye")).toBe("Belum foto makan nih.");
    expect(copy(id, "misc:widget.streak.atRisk.panic")).toBe("Jaga apinya!");
    expect(copy(id, "misc:widget.streak.atRisk.lastchance")).toBe("Kesempatan terakhir!");
    expect(copy(id, "misc:widget.streak.broken.teary")).toBe("Yah, putus…");
    expect(copy(id, "misc:widget.streak.broken.frozen")).toBe("Cairkan lagi?");
    expect(copy(id, "misc:widget.streak.broken.ghost")).toBe("Kamu ngilang ya?");
  });
});

describe("widget mascot art", () => {
  const dir = resolve(import.meta.dir, "../../../assets/widget/mascot");

  /** Width and height of a WebP, read from its header (VP8X canvas, or a lossy / lossless bitstream). */
  function webpSize(file: string): { width: number; height: number } {
    const b = readFileSync(file);
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  test("every pose has a file whose size matches MASCOT_ART", () => {
    for (const pose of Object.keys(MASCOT_ART) as StreakPose[]) {
      const file = resolve(dir, `${pose}.webp`);
      expect(existsSync(file)).toBe(true);
      expect(webpSize(file)).toEqual(MASCOT_ART[pose]);
    }
  });
});
