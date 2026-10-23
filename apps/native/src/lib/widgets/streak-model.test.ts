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
import { MASCOT_ART, SLEEPY_AFTER_DAYS, streakWidgetModel } from "./streak-model";
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

describe("streakWidgetModel", () => {
  test("today logged: lit flame with the run, Joyo cheering", () => {
    const m = streakWidgetModel(fromDates([back(2), back(1), TODAY]), TODAY);
    expect(m).toMatchObject({ kind: "done", pose: "cheer", count: 3, lit: true, labelKey: "misc:widget.streak.days" });
    expect(m.lineKey).toMatch(/^misc:widget\.streak\.done\.[12]$/);
  });

  test("today not logged, yesterday was: the run still shows, Jaga apinya, Joyo nudging", () => {
    const m = streakWidgetModel(fromDates([back(3), back(2), back(1)]), TODAY);
    expect(m).toMatchObject({ kind: "at_risk", pose: "surprised", count: 3, lit: true });
    expect(m.lineKey).toMatch(/^misc:widget\.streak\.atRisk\.[12]$/);
  });

  test("yesterday missed: a cold flame with the days since the last log and the judging Joyo", () => {
    const m = streakWidgetModel(fromDates([back(9), back(4), back(3)]), TODAY);
    expect(m).toMatchObject({
      kind: "broken",
      pose: "determined",
      count: 3,
      lit: false,
      labelKey: "misc:widget.streak.lapse",
    });
    expect(m.lineKey).toMatch(/^misc:widget\.streak\.broken\.[123]$/);
  });

  test("two days is the first broken count; a week of silence puts Joyo to sleep", () => {
    expect(streakWidgetModel(fromDates([back(2)]), TODAY)).toMatchObject({ kind: "broken", count: 2, pose: "determined" });
    const asleep = streakWidgetModel(fromDates([back(SLEEPY_AFTER_DAYS)]), TODAY);
    expect(asleep).toMatchObject({ kind: "broken", count: SLEEPY_AFTER_DAYS, pose: "sleepy", lineKey: "misc:widget.streak.asleep" });
    expect(streakWidgetModel(fromDates([back(SLEEPY_AFTER_DAYS - 1)]), TODAY).pose).toBe("determined");
  });

  test("nothing in the window: a title in place of the number, no flame, Joyo ready", () => {
    const m = streakWidgetModel(fromDates([]), TODAY);
    expect(m).toMatchObject({ kind: "fresh", pose: "ready", count: null, titleKey: "misc:widget.streak.freshTitle" });
  });

  test("a Naikin BB plan words the at-risk, broken and fresh lines by the eating target", () => {
    expect(streakWidgetModel(fromDates([back(2), back(1)], { gain: true }), TODAY).lineKey).toBe("misc:widget.streak.atRisk.gain");
    expect(streakWidgetModel(fromDates([back(5)], { gain: true }), TODAY).labelKey).toBe("misc:widget.streak.lapseGain");
    expect(streakWidgetModel(fromDates([], { gain: true }), TODAY).lineKey).toBe("misc:widget.streak.freshGain");
  });

  test("Hamil / Menyusui and a snapshot from before the streak shipped show no streak at all", () => {
    for (const day of [{ maternal: true, streak: null }, { streak: undefined }, { streak: null }]) {
      const m = streakWidgetModel(snap(day), TODAY);
      expect(m).toMatchObject({ kind: "off", count: null, lit: false, pose: "relax" });
    }
  });

  test("signed out and no plan explain what is missing", () => {
    expect(streakWidgetModel(snap(null, { signedIn: false }), TODAY)).toMatchObject({ kind: "signedOut", count: null });
    expect(streakWidgetModel(snap(null), TODAY)).toMatchObject({ kind: "noTarget", lineKey: "misc:widget.setTarget" });
  });

  test("a snapshot nobody refreshed ages on the phone's date: lit last night, at risk this morning, broken the day after", () => {
    const night = fromDates([back(2), back(1), TODAY]);
    expect(streakWidgetModel(night, TODAY)).toMatchObject({ kind: "done", count: 3 });
    expect(streakWidgetModel(night, shiftDate(TODAY, 1))).toMatchObject({ kind: "at_risk", count: 3, lit: true });
    expect(streakWidgetModel(night, shiftDate(TODAY, 2))).toMatchObject({ kind: "broken", count: 2, lit: false });
  });

  test("the model agrees with the server's own status for every stamp", () => {
    for (const dates of [[TODAY], [back(1)], [back(4)], []]) {
      const server = streakState(dates, TODAY);
      const m = streakWidgetModel(fromDates(dates), TODAY);
      const aged = streakAt({ days: server.days, lastLoggedDate: server.lastLoggedDate }, TODAY);
      expect(aged.status).toBe(server.status);
      expect(m.kind).toBe(server.status === "none" ? "fresh" : server.status);
    }
  });

  test("the nudge line changes with the calendar day and is stable within it", () => {
    const stuck = fromDates([back(3)]);
    const lines = new Set([0, 1, 2].map((d) => streakWidgetModel(stuck, shiftDate(TODAY, d)).lineKey));
    expect(lines.size).toBeGreaterThan(1);
    expect(streakWidgetModel(stuck, TODAY).lineKey).toBe(streakWidgetModel(stuck, TODAY).lineKey);
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
    fromDates([back(1)]),
    fromDates([back(3)]),
    fromDates([back(9)]),
    fromDates([]),
    fromDates([back(1)], { gain: true }),
    fromDates([back(3)], { gain: true }),
    fromDates([], { gain: true }),
    snap({ maternal: true }),
    snap(null, { signedIn: false }),
    snap(null),
  ];
  // Every day of the rotation, so every nudge line of every state is reached.
  const models = states.flatMap((s) => [0, 1, 2].map((d) => streakWidgetModel(s, shiftDate(TODAY, d))));

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
