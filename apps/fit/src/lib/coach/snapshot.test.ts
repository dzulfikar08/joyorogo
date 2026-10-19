import { describe, expect, test } from "bun:test";

import { shiftDate } from "@joyorogo/api/lib/engine";
import type { RecoveryDayView } from "@joyorogo/api/lib/fit-data";
import { ORPCError } from "@orpc/client";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";
import {
  COACH_LIMITS,
  coachChatInputSchema,
  coachSnapshotSchema,
} from "@joyorogo/api/lib/coach-chat";

import {
  COACH_INPUT_LIMITS,
  classifyCoachError,
  parseStored,
  storageKey,
  toPayload,
} from "./conversation";
import type { ChatMessage } from "./conversation";
import { SNAPSHOT_WORKOUTS, buildCoachSnapshot } from "./snapshot";

const TODAY = "2026-10-19";
const NOW = Date.parse("2026-10-19T03:30:00Z");

const day = (offset: number, over: Partial<RecoveryDayView> = {}): RecoveryDayView => ({
  date: shiftDate(TODAY, offset),
  sleepHours: null,
  sleepSource: null,
  sleepPct: null,
  recoveryPct: null,
  strain: null,
  readiness: null,
  restingHrBpm: null,
  hrvMs: null,
  hrvStatus: null,
  vo2maxMlKgMin: null,
  trainingStatus: null,
  loadRatio: null,
  recoveryHoursLeft: null,
  steps: null,
  distanceKm: null,
  activeKcal: null,
  exerciseMin: null,
  ...over,
});

const workout = (n: number, over: Partial<FitWebWorkout> = {}): FitWebWorkout => ({
  start: 1_790_000_000 - n * 86_400,
  date: shiftDate(TODAY, -n),
  sportName: "Run",
  sportKind: "run",
  elapsedSec: 3000,
  movingSec: 2940,
  distanceM: 8123.4,
  elevGainM: 40,
  avgHr: 151,
  maxHr: 175,
  calories: 500,
  hasGps: true,
  hasAnalysis: true,
  imported: false,
  ...over,
});

describe("buildCoachSnapshot", () => {
  test("no data at all is a valid snapshot of nulls and no workouts", () => {
    const snapshot = buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: [], workouts: [] });
    expect(snapshot).toEqual({
      generatedAt: Math.floor(NOW / 1000),
      today: TODAY,
      readiness: null,
      load: null,
      hrv: null,
      sleep: null,
      strain: null,
      restingHr: null,
      vo2max: null,
      suggestion: null,
      plan: null,
      workouts: [],
    });
    expect(coachSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  test("reads the latest values and statistics of the recovery days", () => {
    // 60 days of HRV around 50 ms, the last 7 around 60 ms; sleep need 8 h from hours / share of need.
    const days = Array.from({ length: 60 }, (_, i) => {
      const offset = -(59 - i);
      return day(offset, {
        hrvMs: offset > -7 ? 60 : 50,
        hrvStatus: "balanced",
        sleepHours: 7,
        sleepPct: 87.5,
        strain: offset === 0 ? 11.26 : offset === -1 ? 9.04 : 8,
        restingHrBpm: 52 + (offset % 2 === 0 ? 1 : 0),
        vo2maxMlKgMin: offset === 0 ? 47.46 : 46,
        readiness: offset === 0 ? "Primed" : "Balanced",
        trainingStatus: "productive",
        loadRatio: offset === 0 ? 1.2345 : 1.1,
      });
    });
    const snapshot = buildCoachSnapshot({ today: TODAY, nowMs: NOW, days, workouts: [] });
    expect(snapshot.readiness).toEqual({ headline: "Primed" });
    expect(snapshot.load).toEqual({ status: "productive", ratio: 1.23 });
    // The mean of 60 days: 7 days of 60 ms and 53 of 50 ms.
    expect(snapshot.hrv?.state).toBe("balanced");
    expect(snapshot.hrv?.recentMs).toBe(60);
    expect(snapshot.hrv?.baselineMs).toBeCloseTo((7 * 60 + 53 * 50) / 60, 1);
    expect(snapshot.sleep).toEqual({ lastNightMin: 420, debtMin: 14 * 60, needTonightMin: 480 });
    expect(snapshot.strain).toEqual({ yesterday: 9, today: 11.3, avg7: expect.any(Number) });
    expect(snapshot.strain?.avg7).toBeCloseTo((11.26 + 9.04 + 5 * 8) / 7, 1);
    expect(snapshot.restingHr).toBe(53);
    expect(snapshot.vo2max).toBe(47.5);
    expect(coachSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  test("HRV needs enough readings and a status, or it is left out rather than guessed", () => {
    const fewNights = [
      day(-1, { hrvMs: 55, hrvStatus: "low" }),
      day(0, { hrvMs: 57, hrvStatus: "low" }),
    ];
    expect(
      buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: fewNights, workouts: [] }).hrv,
    ).toBeNull();
    const noStatus = Array.from({ length: 20 }, (_, i) => day(-i, { hrvMs: 50 }));
    expect(
      buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: noStatus, workouts: [] }).hrv,
    ).toBeNull();
    const unknownStatus = Array.from({ length: 20 }, (_, i) =>
      day(-i, { hrvMs: 50, hrvStatus: "great" }),
    );
    expect(
      buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: unknownStatus, workouts: [] }).hrv,
    ).toBeNull();
  });

  test("a word the server schema does not know is dropped, and a stale reading is not 'last night'", () => {
    const days = [
      day(-5, { readiness: "Fine", sleepHours: 8 }),
      day(-4, { trainingStatus: "peaking", loadRatio: 1 }),
    ];
    const snapshot = buildCoachSnapshot({ today: TODAY, nowMs: NOW, days, workouts: [] });
    expect(snapshot.readiness).toBeNull();
    expect(snapshot.load).toBeNull();
    expect(snapshot.sleep).toBeNull();
  });

  test("days after today are ignored", () => {
    const snapshot = buildCoachSnapshot({
      today: TODAY,
      nowMs: NOW,
      days: [day(1, { restingHrBpm: 99 }), day(0, { restingHrBpm: 51 })],
      workouts: [],
    });
    expect(snapshot.restingHr).toBe(51);
  });

  test("workouts: the newest ten, with what the list knows and nothing it does not", () => {
    const list = Array.from({ length: 14 }, (_, i) => workout(i));
    const snapshot = buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: [], workouts: list });
    expect(snapshot.workouts).toHaveLength(SNAPSHOT_WORKOUTS);
    expect(snapshot.workouts[0]).toEqual({
      start: list[0]!.start,
      sport: "Run",
      durationMin: 49,
      distanceKm: 8.12,
      avgHr: 151,
      strain: null,
      matchedPlan: false,
    });
    const indoor = buildCoachSnapshot({
      today: TODAY,
      nowMs: NOW,
      days: [],
      workouts: [workout(0, { distanceM: null, avgHr: null, sportName: "x".repeat(60) })],
    });
    expect(indoor.workouts[0]).toMatchObject({ distanceKm: null, avgHr: null });
    expect(indoor.workouts[0]!.sport).toHaveLength(40);
  });

  test("the snapshot is accepted by the server's coach.chat input schema", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      day(-i, {
        sleepHours: 7.2,
        sleepPct: 90,
        hrvMs: 48,
        hrvStatus: "unbalanced",
        strain: 10,
        readiness: "Strained",
      }),
    );
    const snapshot = buildCoachSnapshot({
      today: TODAY,
      nowMs: NOW,
      days,
      workouts: Array.from({ length: 12 }, (_, i) => workout(i)),
    });
    const parsed = coachChatInputSchema.safeParse({
      messages: [{ role: "user", content: "Apa latihan yang pas besok?" }],
      snapshot,
      locale: "id",
    });
    expect(parsed.success).toBe(true);
  });
});

const msg = (
  role: "user" | "assistant",
  content: string,
  flagged: ChatMessage["flagged"] = null,
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  flagged,
});

describe("toPayload", () => {
  test("limits match the server's", () => {
    expect(COACH_INPUT_LIMITS.maxMessages).toBe(COACH_LIMITS.maxMessages);
    expect(COACH_INPUT_LIMITS.maxMessageChars).toBe(COACH_LIMITS.maxMessageChars);
  });

  test("the newest twelve, ending with the person's message", () => {
    const list = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    );
    list.push(msg("user", "last"));
    const payload = toPayload(list);
    expect(payload).toHaveLength(12);
    expect(payload[11]).toEqual({ role: "user", content: "last" });
  });

  test("an unanswered tail of assistant messages is cut so the last one is the person's", () => {
    expect(toPayload([msg("user", "hi"), msg("assistant", "hello")])).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(toPayload([msg("assistant", "hello")])).toEqual([]);
  });

  test("blank messages are dropped and long ones cut to the server limit", () => {
    const payload = toPayload([msg("user", "   "), msg("user", `  ${"a".repeat(2500)}  `)]);
    expect(payload).toHaveLength(1);
    expect(payload[0]!.content).toHaveLength(2000);
  });

  test("the server schema accepts what it builds", () => {
    const list = Array.from({ length: 15 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `text ${i}`),
    );
    const snapshot = buildCoachSnapshot({ today: TODAY, nowMs: NOW, days: [], workouts: [] });
    expect(coachChatInputSchema.safeParse({ messages: toPayload(list), snapshot }).success).toBe(
      true,
    );
  });
});

describe("parseStored", () => {
  test("round trips and drops anything that is not a message", () => {
    const list = [msg("user", "hi"), msg("assistant", "careful", "injury")];
    expect(parseStored(JSON.stringify(list))).toEqual(list);
    expect(parseStored(null)).toEqual([]);
    expect(parseStored("not json")).toEqual([]);
    expect(parseStored('{"a":1}')).toEqual([]);
    expect(
      parseStored(
        JSON.stringify([
          { id: 1, role: "user", content: "x" },
          { id: "a", role: "system", content: "x" },
          { id: "b", role: "user", content: "" },
          null,
          msg("user", "ok"),
        ]),
      ),
    ).toHaveLength(1);
    expect(
      parseStored(
        JSON.stringify([{ id: "a", role: "assistant", content: "x", flagged: "bogus" }]),
      )[0]!.flagged,
    ).toBeNull();
  });

  test("each account has its own key", () => {
    expect(storageKey("u1")).not.toBe(storageKey("u2"));
  });
});

describe("classifyCoachError", () => {
  test("the server's answers", () => {
    expect(classifyCoachError(new ORPCError("FORBIDDEN", { data: { paywall: true } })).kind).toBe(
      "paywall",
    );
    expect(classifyCoachError(new ORPCError("FORBIDDEN", { data: {} })).kind).toBe("failed");
    expect(
      classifyCoachError(
        new ORPCError("TOO_MANY_REQUESTS", { data: { coachCapReached: true, cap: 20 } }),
      ),
    ).toEqual({
      kind: "capReached",
      message: null,
      cap: 20,
    });
    expect(classifyCoachError(new ORPCError("SERVICE_UNAVAILABLE", { message: "off" })).kind).toBe(
      "unavailable",
    );
    expect(
      classifyCoachError(
        new ORPCError("UNPROCESSABLE_CONTENT", { message: "Coba lagi", data: { reason: "empty" } }),
      ),
    ).toEqual({
      kind: "failed",
      message: "Coba lagi",
      cap: null,
    });
    expect(
      classifyCoachError(
        new ORPCError("INTERNAL_SERVER_ERROR", { message: "x", data: { reason: "timeout" } }),
      ).kind,
    ).toBe("failed");
    expect(classifyCoachError(new ORPCError("BAD_GATEWAY", { message: "x" })).kind).toBe("network");
  });

  test("anything that is not an oRPC error did not reach the server", () => {
    expect(classifyCoachError(new TypeError("Failed to fetch")).kind).toBe("network");
  });
});
