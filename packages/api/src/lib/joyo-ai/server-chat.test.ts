import { describe, expect, test, vi } from "bun:test";

import type { Database } from "@joyorogo/db";

import {
  JOYO_CHAT_LIMITS,
  deviceDay,
  isMinorAge,
  joyoChatInputSchema,
  joyoModel,
  readJoyoPerson,
  refusingAdapter,
  runJoyoChat,
} from "./server-chat";
import type { UsageTally } from "./server-chat";
import type { ToolData } from "./tool-data";
import { AiError } from "./types";
import type { Adapter, ModelReply } from "./types";
import { DEFAULT_CORRECT_MODEL } from "../scan-correct";

const TODAY = "2026-10-22";

describe("input", () => {
  const valid = { messages: [{ role: "user", content: "Apa kabar?" }], consentVersion: 1 };

  test("the last message must be the user's; 1..12 messages of at most 2000 characters", () => {
    expect(joyoChatInputSchema.safeParse(valid).success).toBe(true);
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: [] }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }).success).toBe(false);
    const many = Array.from({ length: JOYO_CHAT_LIMITS.maxMessages + 1 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: "x" }));
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: many }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: many.slice(1, 12) }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: [{ role: "user", content: "x".repeat(2001) }] }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, messages: [{ role: "user", content: "   " }] }).success).toBe(false);
  });

  test("consentVersion is required, locale is one of the three, today is a day", () => {
    expect(joyoChatInputSchema.safeParse({ messages: valid.messages }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, consentVersion: 1.5 }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, locale: "ms", today: TODAY }).success).toBe(true);
    expect(joyoChatInputSchema.safeParse({ ...valid, locale: "fr" }).success).toBe(false);
    expect(joyoChatInputSchema.safeParse({ ...valid, today: "kemarin" }).success).toBe(false);
  });
});

describe("deviceDay and the model", () => {
  test("the device's day counts only within two days of the zone's day", () => {
    expect(deviceDay(undefined, TODAY)).toBe(TODAY);
    expect(deviceDay("2026-10-21", TODAY)).toBe("2026-10-21");
    expect(deviceDay("2026-10-24", TODAY)).toBe("2026-10-24");
    expect(deviceDay("2026-10-25", TODAY)).toBe(TODAY);
    expect(deviceDay("2026-10-19", TODAY)).toBe(TODAY);
    expect(deviceDay("2026-13-45", TODAY)).toBe(TODAY);
  });

  test("model: AI_JOYO_MODEL, then AI_COACH_MODEL, then AI_CORRECT_MODEL, then the default text model", () => {
    expect(joyoModel({ AI_JOYO_MODEL: "j", AI_COACH_MODEL: "c", AI_CORRECT_MODEL: "x" })).toBe("j");
    expect(joyoModel({ AI_JOYO_MODEL: "", AI_COACH_MODEL: "c", AI_CORRECT_MODEL: "x" })).toBe("c");
    expect(joyoModel({ AI_CORRECT_MODEL: "x" })).toBe("x");
    expect(joyoModel({})).toBe(DEFAULT_CORRECT_MODEL);
  });

  test("under 18 is a known age below 18; unknown is not a minor", () => {
    expect(isMinorAge(17)).toBe(true);
    expect(isMinorAge(18)).toBe(false);
    expect(isMinorAge(null)).toBe(false);
  });
});

describe("readJoyoPerson", () => {
  /** A database whose select records which columns were asked for. */
  function recordingDb(row: Record<string, unknown> | undefined) {
    const asked: string[][] = [];
    const db = {
      select: (fields: Record<string, unknown>) => {
        asked.push(Object.keys(fields));
        return { from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) };
      },
    } as unknown as Database;
    return { db, asked };
  }

  test("reads birth year, gender and height only: nothing maternal, no name or email, no goal", async () => {
    const { db, asked } = recordingDb({ birthYear: 1990, gender: "female", heightCm: 160 });
    const person = await readJoyoPerson(db, "u1", 2026);
    expect(asked).toEqual([["birthYear", "gender", "heightCm"]]);
    expect(person).toEqual({ ageYears: 36, sex: "female", heightCm: 160, goal: null });
  });

  test("no profile row, or an unusable birth year, is unknown and never a minor by accident", async () => {
    expect(await readJoyoPerson(recordingDb(undefined).db, "u1", 2026)).toEqual({ ageYears: null, sex: null, heightCm: null, goal: null });
    const odd = await readJoyoPerson(recordingDb({ birthYear: 0, gender: "x", heightCm: 0 }).db, "u1", 2026);
    expect(odd).toEqual({ ageYears: null, sex: null, heightCm: null, goal: null });
  });
});

describe("runJoyoChat", () => {
  const person = { ageYears: 30, sex: "male" as const, heightCm: 175, goal: null };
  const never = (): Promise<never> => Promise.withResolvers<never>().promise;
  const data: ToolData = {
    today: () => TODAY,
    day: () => never(),
    range: () => Promise.reject(new Error("no")),
    weights: () => Promise.reject(new Error("no")),
    profile: () => Promise.reject(new Error("no")),
  };
  const history = [{ role: "user" as const, content: "Apa kabar?" }];
  const reply = (over: Partial<ModelReply>): ModelReply => ({ text: "Baik.", thinking: "", toolCalls: [], usage: { inputTokens: 100, outputTokens: 10 }, stop: "end", finish: "stop", ...over });
  const ai = { run: () => never() };
  const base = { ai, model: "@cf/test/m", history, person, locale: "id" as const, data };

  test("the deadline ends the question with a timeout whatever it was waiting for", async () => {
    vi.useFakeTimers();
    try {
      // `data.day` never answers: the question is stuck gathering the digest, which only the deadline can end.
      const pending = runJoyoChat({ ...base, deadlineMs: 1_000 }).then(() => null, (e: unknown) => e);
      vi.advanceTimersByTime(1_000);
      const error = await pending;
      expect(error).toBeInstanceOf(AiError);
      expect(error).toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a client that leaves aborts the model call: the call sees the signal and the error is aborted, not timeout", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    let sawSignal: AbortSignal | undefined;
    const adapter: Adapter = {
      async complete(_conn, _request, options) {
        sawSignal = options?.signal;
        started.resolve();
        const aborted = Promise.withResolvers<never>();
        options?.signal?.addEventListener("abort", () => aborted.reject(new AiError("aborted")));
        return aborted.promise;
      },
      listModels: async () => [],
    };
    const pending = runJoyoChat({ ...base, data: { ...data, day: () => Promise.reject(new Error("no")) }, adapter, signal: controller.signal }).then(() => null, (e: unknown) => e);
    await started.promise;
    expect(sawSignal?.aborted).toBe(false);
    controller.abort();
    expect(await pending).toMatchObject({ kind: "aborted" });
    expect(sawSignal?.aborted).toBe(true);
  });

  test("the tally keeps what finished calls cost even when the question then fails", async () => {
    const tally: UsageTally = { calls: 0, inputTokens: 0, outputTokens: 0 };
    let call = 0;
    const adapter: Adapter = {
      async complete() {
        call += 1;
        if (call === 1) return reply({ text: "", toolCalls: [{ id: "c1", name: "get_targets", args: {} }], stop: "tools", finish: "tool_calls", usage: { inputTokens: 300, outputTokens: 25 } });
        throw new AiError("server", 500);
      },
      listModels: async () => [],
    };
    const failed = runJoyoChat({ ...base, data: { ...data, day: () => Promise.reject(new Error("no")) }, adapter, tally }).then(() => null, (e: unknown) => e);
    expect(await failed).toMatchObject({ kind: "server" });
    // the first call finished (counted); the second was refused by the provider with a status (counted as a call too)
    expect(tally.inputTokens).toBe(300);
    expect(tally.outputTokens).toBe(25);
    expect(tally.calls).toBe(2);
  });

  test("the model is asked with thinking off and tools offered", async () => {
    const seen: Array<{ system: string; tools: number; fast: boolean | undefined; fastFields: Record<string, unknown> | undefined; model: string }> = [];
    const adapter: Adapter = {
      async complete(conn, request) {
        seen.push({ system: request.system, tools: request.tools?.length ?? 0, fast: request.fast, fastFields: request.fastFields, model: conn.model });
        return reply({});
      },
      listModels: async () => [],
    };
    const answer = await runJoyoChat({ ...base, data: { ...data, day: () => Promise.reject(new Error("no")) }, adapter });
    expect(answer.reply).toContain("Baik.");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ fast: true, fastFields: { chat_template_kwargs: { enable_thinking: false } }, model: "@cf/test/m" });
    expect(seen[0]!.tools).toBeGreaterThan(0);
  });

  test("a message the safety pass answers never reaches the model, and the guard adapter would refuse a call", async () => {
    await expect(refusingAdapter.complete({ baseUrl: "workers-ai://", apiKey: "-", model: "m" }, { model: "m", system: "", messages: [], maxTokens: 1 })).rejects.toThrow();
    const answer = await runJoyoChat({
      ...base,
      history: [{ role: "user", content: "nyeri dada waktu lari" }],
      adapter: refusingAdapter,
    });
    expect(answer).toMatchObject({ fixed: true, flagged: "medical", usage: { calls: 0 } });
  });
});
