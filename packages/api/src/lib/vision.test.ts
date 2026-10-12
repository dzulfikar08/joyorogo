import { describe, expect, test } from "bun:test";

import {
  analyzeFoodPhoto,
  FRIENDLY_ERROR,
  runVisionOnce,
  visionResultSchema,
  type AiRunner,
  type ScheduleTimeout,
} from "./vision";

const PLATE = {
  items: [
    { name: "Nasi goreng", kcal: 350, grams: 200, confidence: 0.9 },
    { name: "Telur dadar", kcal: 130, grams: 60, confidence: 0.8 },
  ],
};

const OPTS = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" as const };

/** Deadline fires after a couple of microtasks — deterministic, no wall clock. */
const microtaskSchedule: ScheduleTimeout = (fn) => {
  queueMicrotask(() => queueMicrotask(() => fn()));
  return () => {};
};

/** Hangs forever — the deadline fires and no retry is allowed. */
function hangingRunner(calls: string[] = []): AiRunner {
  const { promise } = Promise.withResolvers<never>();
  return {
    run: (model: string) => {
      calls.push(model);
      return promise;
    },
  };
}

/** Answers unusable prose first (fast failure), real JSON on the retry. */
function garbageThenAnswer(calls: string[] = []): AiRunner {
  let call = 0;
  return {
    run: (model: string) => {
      calls.push(model);
      call += 1;
      return Promise.resolve(
        call === 1
          ? { response: "Maaf, saya tidak bisa melihat makanan di foto ini." }
          : { response: JSON.stringify(PLATE) },
      );
    },
  };
}

function jsonRunner(payload: unknown): AiRunner {
  return { run: () => Promise.resolve({ response: JSON.stringify(payload) }) };
}

describe("analyzeFoodPhoto deadlines", () => {
  test("timed-out attempt is not retried -> friendly error after one run", async () => {
    const calls: string[] = [];
    await expect(
      analyzeFoodPhoto(hangingRunner(calls), { ...OPTS, schedule: microtaskSchedule }),
    ).rejects.toThrow(FRIENDLY_ERROR);
    expect(calls.length).toBe(1);
  });

  test("fast garbage output is retried once and succeeds", async () => {
    const calls: string[] = [];
    const result = await analyzeFoodPhoto(garbageThenAnswer(calls), {
      ...OPTS,
      schedule: microtaskSchedule,
    });
    expect(calls.length).toBe(2);
    expect(result.items.map((item) => item.name)).toContain("Nasi goreng");
  });

  test("runVisionOnce rejects with vision-timeout when the deadline fires", async () => {
    const never: ScheduleTimeout = (fn) => {
      fn();
      return () => {};
    };
    const outcome = runVisionOnce(hangingRunner(), "@cf/google/gemma-4-26b-a4b-it", OPTS, 1, never);
    const reason = await outcome.then(
      () => null,
      (error: unknown) => error,
    );
    expect(reason).toBeInstanceOf(Error);
    expect(reason).toMatchObject({ message: "vision-timeout" });
  });

  test("healthy model response skips the deadline entirely", async () => {
    const result = await analyzeFoodPhoto(jsonRunner(PLATE), OPTS);
    expect(result.items.length).toBe(2);
    expect(result.items[0]?.kcal).toBeGreaterThan(0);
    expect(result.items[0]?.name.length ?? 0).toBeGreaterThan(0);
  });

  test("requests disable model thinking (thinking costs ~40 s per scan)", async () => {
    let input: unknown;
    await analyzeFoodPhoto(
      {
        run: (_model, body) => {
          input = body;
          return Promise.resolve({ response: JSON.stringify(PLATE) });
        },
      },
      OPTS,
    );
    expect(input).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
  });

  test("a busy plate is truncated to 8 items, not rejected", async () => {
    const many = {
      items: Array.from({ length: 12 }, (_, i) => ({ name: `item${i}`, kcal: 100 })),
    };
    expect(() => visionResultSchema.parse(many)).not.toThrow();
    const result = await analyzeFoodPhoto(jsonRunner(many), OPTS);
    expect(result.items.length).toBe(8);
  });
});
