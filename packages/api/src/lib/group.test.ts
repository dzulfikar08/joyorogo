import { describe, expect, test } from "bun:test";

import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  newInviteCode,
  normalizeInviteCode,
  rateLimited,
  varVerdict,
} from "./group";
import { shiftDate, streakFromDates } from "../lib/engine";

describe("invite codes", () => {
  test("newInviteCode is 8 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      expect(code.length).toBe(INVITE_CODE_LENGTH);
      for (const ch of code) expect(INVITE_ALPHABET.includes(ch)).toBe(true);
    }
    // Unambiguous alphabet: no I/L/O/0/1 lookalikes.
    expect(/[ILO01]/.test(newInviteCode())).toBe(false);
  });

  test("normalizeInviteCode uppercases, strips noise and lookalikes", () => {
    expect(normalizeInviteCode("ab-cd ef23")).toBe("ABCDEF23");
    expect(normalizeInviteCode("abcd ilo1")).toBe("ABCD");
    expect(normalizeInviteCode("  wxyz-2345 ")).toBe("WXYZ2345");
    expect(normalizeInviteCode("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGH");
  });
});

describe("streak computation", () => {
  const today = "2026-10-13";

  test("consecutive days up to today", () => {
    const dates = [0, 1, 2].map((d) => shiftDate(today, -d));
    expect(streakFromDates(dates, today)).toBe(3);
  });

  test("today not logged yet still counts through yesterday", () => {
    const dates = [1, 2, 3].map((d) => shiftDate(today, -d));
    expect(streakFromDates(dates, today)).toBe(3);
  });

  test("a gap resets the streak", () => {
    const dates = [today, shiftDate(today, -2)];
    expect(streakFromDates(dates, today)).toBe(1);
  });

  test("no logs means zero", () => {
    expect(streakFromDates([], today)).toBe(0);
  });
});

describe("VAR verdict thresholds", () => {
  test("nothing logged is kosong", () => {
    expect(varVerdict(0, 2000, 0)).toBe("kosong");
    expect(varVerdict(0, 2000, 2)).toBe("kosong");
  });

  test("at or below target is aman", () => {
    expect(varVerdict(2000, 2000, 3)).toBe("aman");
    expect(varVerdict(1500, 2000, 1)).toBe("aman");
  });

  test("above target is offside", () => {
    expect(varVerdict(2001, 2000, 3)).toBe("offside");
  });

  test("logged food without a profile target is offside", () => {
    expect(varVerdict(800, null, 1)).toBe("offside");
  });
});

describe("poke rate-limit window", () => {
  const now = 1_000_000;

  test("inside the window is limited", () => {
    expect(rateLimited(now - 60_000, now, 3_600_000)).toBe(true);
    expect(rateLimited(now, now, 3_600_000)).toBe(true);
  });

  test("outside the window is not limited", () => {
    expect(rateLimited(now - 3_600_001, now, 3_600_000)).toBe(false);
  });

  test("no previous poke is never limited", () => {
    expect(rateLimited(null, now, 3_600_000)).toBe(false);
  });
});
