import { describe, expect, test } from "bun:test";

import {
  analyzeFoodPhoto,
  dropDuplicateBroth,
  MAX_ITEMS,
  normalizeBox,
  runVisionOnce,
  salvageItems,
  VisionError,
  visionResultSchema,
  type AiRunner,
  type ScheduleTimeout,
  type VisionEvent,
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
  test("timed-out attempt is not retried -> timeout error after one run", async () => {
    const calls: string[] = [];
    await expect(
      analyzeFoodPhoto(hangingRunner(calls), { ...OPTS, schedule: microtaskSchedule }),
    ).rejects.toMatchObject({ reason: "timeout" });
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

  test("a busy plate is capped at 10 items and flagged tooMany, not rejected", async () => {
    const many = {
      items: Array.from({ length: 12 }, (_, i) => ({ name: `item${i}`, kcal: 100 })),
    };
    expect(() => visionResultSchema.parse(many)).not.toThrow();
    const result = await analyzeFoodPhoto(jsonRunner(many), OPTS);
    expect(result.items.length).toBe(MAX_ITEMS);
    expect(result.tooMany).toBe(true);
  });

  test("a normal plate is not flagged tooMany", async () => {
    const result = await analyzeFoodPhoto(jsonRunner(PLATE), OPTS);
    expect(result.tooMany).toBe(false);
  });

  // Prod 2026-10-15: an americano + a donut came back as 1 item with tooMany=true.
  test("the model's tooMany flag on a small plate is ignored: both items kept, no tooMany", async () => {
    const coffeeAndDonut = {
      items: [
        { name: "Americano", kind: "minuman", kcal: 5, grams: 240 },
        { name: "Donat cokelat", kind: "camilan", kcal: 290, grams: 70 },
      ],
      tooMany: true,
    };
    const result = await analyzeFoodPhoto(jsonRunner(coffeeAndDonut), OPTS);
    expect(result.items.map((item) => item.name)).toEqual(["Americano", "Donat cokelat"]);
    expect(result.tooMany).toBe(false);
    expect(result.modelTooMany).toBe(true);
  });

  test("the model's tooMany flag counts once the list is nearly full", async () => {
    const nine = {
      items: Array.from({ length: 9 }, (_, i) => ({ name: `item${i}`, kcal: 100 })),
      tooMany: true,
    };
    expect((await analyzeFoodPhoto(jsonRunner(nine), OPTS)).tooMany).toBe(true);
    const nineNoFlag = { items: nine.items };
    expect((await analyzeFoodPhoto(jsonRunner(nineNoFlag), OPTS)).tooMany).toBe(false);
  });

  test("a list that fills the cap is flagged even without a model flag", async () => {
    const ten = {
      items: Array.from({ length: MAX_ITEMS }, (_, i) => ({ name: `item${i}`, kcal: 100 })),
    };
    const result = await analyzeFoodPhoto(jsonRunner(ten), OPTS);
    expect(result.items).toHaveLength(MAX_ITEMS);
    expect(result.tooMany).toBe(true);
  });

  test("a malformed item is skipped, the rest of the answer is kept", async () => {
    const result = await analyzeFoodPhoto(
      jsonRunner({ items: [{ name: "Sate", kcal: "banyak" }, ...PLATE.items] }),
      OPTS,
    );
    expect(result.items.map((item) => item.name)).toEqual(["Nasi goreng", "Telur dadar"]);
  });
});

describe("truncated answers", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({
    name: `Item ${i}`,
    kcal: 100 + i,
    box: [10, 10, 200, 200],
  }));
  const full = JSON.stringify({ items: twelve, tooMany: false });
  // Cut in the middle of the 8th item, as max_tokens does.
  const cutAt = full.indexOf('"name":"Item 7"') + 15;
  const truncated = full.slice(0, cutAt);

  test("salvageItems returns only the complete items of a cut-off answer", () => {
    expect(truncated.endsWith('"name":"Item 7"')).toBe(true);
    const salvaged = salvageItems(truncated) as Array<{ name: string }>;
    expect(salvaged.map((item) => item.name)).toEqual([
      "Item 0",
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
      "Item 5",
      "Item 6",
    ]);
  });

  test("salvageItems ignores braces inside strings and handles a clean cut after an item", () => {
    const text = '{"items":[{"name":"Nasi } goreng","kcal":300},{"name":"Es teh","kcal":90},';
    expect((salvageItems(text) as Array<{ name: string }>).map((item) => item.name)).toEqual([
      "Nasi } goreng",
      "Es teh",
    ]);
    expect(salvageItems("bukan json")).toEqual([]);
  });

  test("analyzeFoodPhoto keeps the salvaged items and flags tooMany without a retry", async () => {
    const calls: string[] = [];
    const runner: AiRunner = {
      run: (model) => {
        calls.push(model);
        return Promise.resolve({
          choices: [{ message: { content: truncated }, finish_reason: "length" }],
        });
      },
    };
    const result = await analyzeFoodPhoto(runner, OPTS);
    expect(calls.length).toBe(1);
    expect(result.items).toHaveLength(7);
    expect(result.tooMany).toBe(true);
  });

  test("a cut-off answer with no complete item is a plain failure", async () => {
    const runner: AiRunner = {
      run: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"items":[{"name":"Item 0","kc' }, finish_reason: "length" }],
        }),
    };
    const outcome = await analyzeFoodPhoto(runner, OPTS).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(VisionError);
    expect((outcome as VisionError).reason).toBe("failed");
  });
});

describe("failure reasons", () => {
  const fails = (payload: unknown) =>
    analyzeFoodPhoto(jsonRunner(payload), OPTS).catch((error: unknown) => error as VisionError);

  test("the model's verdict maps to its own reason and is not retried", async () => {
    let calls = 0;
    const runner: AiRunner = {
      run: () => {
        calls += 1;
        return Promise.resolve({ response: JSON.stringify({ items: [], problem: "gelap" }) });
      },
    };
    const outcome = (await analyzeFoodPhoto(runner, OPTS).catch((e: unknown) => e)) as VisionError;
    expect(outcome.reason).toBe("unclear");
    expect(calls).toBe(1);
    expect(((await fails({ items: [], problem: "buram" })) as VisionError).reason).toBe("unclear");
    expect(((await fails({ items: [], problem: "bukan_makanan" })) as VisionError).reason).toBe(
      "not_food",
    );
  });

  test("an empty list without a verdict means no food", async () => {
    expect(((await fails({ items: [] })) as VisionError).reason).toBe("not_food");
  });

  test("the model's tooMany flag with an empty list is still just no food", async () => {
    const outcome = (await fails({ items: [], tooMany: true })) as VisionError;
    expect(outcome.reason).toBe("not_food");
  });

  test("a deadline is the timeout reason", async () => {
    const outcome = (await analyzeFoodPhoto(hangingRunner(), {
      ...OPTS,
      schedule: microtaskSchedule,
    }).catch((e: unknown) => e)) as VisionError;
    expect(outcome.reason).toBe("timeout");
  });

  test("unreadable prose twice is the generic failure", async () => {
    const runner: AiRunner = { run: () => Promise.resolve({ response: "Maaf, tidak bisa." }) };
    const outcome = (await analyzeFoodPhoto(runner, OPTS).catch((e: unknown) => e)) as VisionError;
    expect(outcome.reason).toBe("failed");
    expect(outcome.detail.attempts).toBe(2);
  });
});

describe("item boxes", () => {
  test("each item keeps its own box through calibration", async () => {
    const plate = {
      items: [
        { name: "Nasi kuning", kcal: 300, grams: 150, box: [186, 3, 605, 545] },
        { name: "Ayam goreng", kcal: 250, grams: 100, box: [223, 679, 727, 1000] },
      ],
    };
    const result = await analyzeFoodPhoto(jsonRunner(plate), OPTS);
    expect(result.items.map((item) => item.box)).toEqual([
      [186, 3, 605, 545],
      [223, 679, 727, 1000],
    ]);
  });

  test("a malformed box drops only the box, never the item", async () => {
    const plate = {
      items: [
        { name: "Sambal", kcal: 30, box: [10, 10, 12, 12] },
        { name: "Kerupuk", kcal: 60, box: "kiri atas" },
        { name: "Teh", kcal: 80, box: [900, 100, 300, 400] },
      ],
    };
    const result = await analyzeFoodPhoto(jsonRunner(plate), OPTS);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.box === undefined)).toBe(true);
  });

  test("out-of-range coordinates clamp onto the 0-1000 grid", () => {
    expect(normalizeBox([-20, 50, 1200, 600.4])).toEqual([0, 50, 1000, 600]);
  });
});

describe("item kind", () => {
  test("the model's kind wins, the name heuristic fills the gaps", async () => {
    const plate = {
      items: [
        { name: "Nasi goreng", kind: "makanan", kcal: 450, grams: 250 },
        { name: "Pisang goreng", kind: "Camilan", kcal: 140, grams: 60 },
        { name: "Es teh manis", kcal: 90, grams: 250 },
        { name: "Martabak manis", kind: "gado-gado", kcal: 300, grams: 100 },
        { name: "Kopi susu", kind: "makanan berat", kcal: 120, grams: 200 },
      ],
    };
    const result = await analyzeFoodPhoto(jsonRunner(plate), OPTS);
    expect(result.items.map((item) => item.kind)).toEqual([
      "makanan",
      "camilan",
      "minuman",
      "camilan",
      "makanan",
    ]);
  });
});

describe("soup broth", () => {
  test("a separate broth line is dropped when the soup dish already counts it", async () => {
    // Prod scan 2026-10-13: bakso bowl + gorengan + a duplicate "kuah kaldu".
    const plate = {
      items: [
        { name: "bakso", kcal: 380, grams: 350 },
        { name: "pangsit goreng", kcal: 120, grams: 40 },
        { name: "tahu goreng", kcal: 90, grams: 50 },
        { name: "kuah kaldu", kcal: 50, grams: 150 },
      ],
    };
    const result = await analyzeFoodPhoto(jsonRunner(plate), OPTS);
    expect(result.items.map((item) => item.name)).toEqual([
      "bakso",
      "pangsit goreng",
      "tahu goreng",
    ]);
  });

  test("broth stays when no soup dish carries it", () => {
    const items = [{ name: "nasi putih" }, { name: "kuah opor" }];
    expect(dropDuplicateBroth(items)).toEqual(items);
    expect(dropDuplicateBroth([{ name: "mie ayam" }, { name: "kuah" }])).toEqual([
      { name: "mie ayam" },
    ]);
  });
});

/** The model's reply as a Workers AI chat stream, `size` characters per chunk. */
function sseBytes(text: string, size: number, finish = "stop"): Uint8Array[] {
  const encoder = new TextEncoder();
  const frames: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    const delta = { content: text.slice(i, i + size) };
    const usage = { prompt_tokens: 0, completion_tokens: 1, neurons: 0.03 };
    frames.push(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }], usage })}\n\n`);
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  frames.push(
    `data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 300, completion_tokens: 9, neurons: 4 } })}\n\n`,
  );
  frames.push("data: [DONE]\n\n");
  return frames.map((frame) => encoder.encode(frame));
}

function streamOf(parts: Uint8Array[], stall = false): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < parts.length) controller.enqueue(parts[next++]);
      else if (!stall) controller.close();
      else return new Promise<void>(() => {});
    },
  });
}

function streamRunner(texts: string[], size = 6, stall = false): AiRunner {
  let call = 0;
  return {
    run: (_model, body) => {
      expect(body).toMatchObject({ stream: true });
      const text = texts[Math.min(call++, texts.length - 1)]!;
      const parts = sseBytes(text, size);
      // A stalled stream goes quiet after a few chunks, before [DONE].
      return Promise.resolve(streamOf(stall ? parts.slice(0, 4) : parts, stall));
    },
  };
}

const STREAM_PLATE = JSON.stringify({
  items: [
    { name: "nasi goreng", kind: "makanan", kcal: 350, grams: 200, box: [100, 100, 600, 600] },
    { name: "telur dadar", kind: "makanan", kcal: 130, grams: 60, box: [0, 0, 300, 300] },
    { name: "kuah kaldu", kcal: 40, grams: 100 },
  ],
});

describe("streaming scan", () => {
  test("reports names before items, and the final analysis equals the plain run", async () => {
    const events: VisionEvent[] = [];
    const streamed = await analyzeFoodPhoto(streamRunner([STREAM_PLATE]), {
      ...OPTS,
      onEvent: (event) => events.push(event),
    });
    const plain = await analyzeFoodPhoto(jsonRunner(JSON.parse(STREAM_PLATE)), OPTS);

    expect(streamed.items).toEqual(plain.items);
    expect(streamed.tooMany).toBe(plain.tooMany);
    expect(streamed.usage).toEqual({ prompt_tokens: 300, completion_tokens: 9, neurons: 4 });
    expect(streamed.timing.ttftMs).toBeNumber();

    expect(events.map((event) => `${event.type}${"index" in event ? event.index : ""}`)).toEqual([
      "name0",
      "item0",
      "name1",
      "item1",
      "name2",
      "item2",
    ]);
    const first = events.find((event) => event.type === "item");
    expect(first).toMatchObject({ item: { name: "nasi goreng", kind: "makanan" } });
  });

  test("a streamed item is calibrated like its final counterpart", async () => {
    const events: VisionEvent[] = [];
    const streamed = await analyzeFoodPhoto(streamRunner([STREAM_PLATE], 1), {
      ...OPTS,
      onEvent: (event) => events.push(event),
    });
    for (const event of events) {
      if (event.type !== "item") continue;
      expect(streamed.items.find((item) => item.name === event.item.name)).toEqual(event.item);
    }
  });

  test("dedupe and the broth rule apply only to the final answer", async () => {
    const answer = JSON.stringify({
      items: [
        { name: "bakso", kcal: 380, grams: 350 },
        { name: "kuah kaldu", kcal: 50, grams: 150 },
      ],
    });
    const events: VisionEvent[] = [];
    const streamed = await analyzeFoodPhoto(streamRunner([answer]), {
      ...OPTS,
      onEvent: (event) => events.push(event),
    });
    expect(events.filter((event) => event.type === "item")).toHaveLength(2);
    expect(streamed.items.map((item) => item.name)).toEqual(["bakso"]);
  });

  test("a cut-off stream keeps its complete items and is flagged tooMany", async () => {
    const cut = STREAM_PLATE.slice(0, STREAM_PLATE.indexOf("telur dadar") + 20);
    const result = await analyzeFoodPhoto(streamRunner([cut]), { ...OPTS, onEvent: () => {} });
    expect(result.items.map((item) => item.name)).toEqual(["nasi goreng"]);
    expect(result.tooMany).toBe(true);
  });

  test("an unusable answer resets the display, then the retry streams a good one", async () => {
    const events: VisionEvent[] = [];
    const result = await analyzeFoodPhoto(
      streamRunner(["Maaf, tidak bisa membantu.", STREAM_PLATE]),
      { ...OPTS, onEvent: (event) => events.push(event), schedule: microtaskSchedule },
    );
    expect(result.items).toHaveLength(3);
    expect(result.timing.attempts).toBe(2);
    expect(events[0]).toEqual({ type: "reset" });
  });

  test("a stream that stalls mid-answer times out", async () => {
    const stalled = streamRunner([STREAM_PLATE], 6, true);
    const timer: ScheduleTimeout = (fn) => {
      const handle = setTimeout(fn, 20);
      return () => clearTimeout(handle);
    };
    await expect(
      analyzeFoodPhoto(stalled, { ...OPTS, onEvent: () => {}, schedule: timer }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  test("a runner that ignores stream and answers plainly still works, without events", async () => {
    const events: VisionEvent[] = [];
    const result = await analyzeFoodPhoto(jsonRunner(JSON.parse(STREAM_PLATE)), {
      ...OPTS,
      onEvent: (event) => events.push(event),
    });
    expect(result.items).toHaveLength(3);
    expect(events).toEqual([]);
  });

  test("other languages report the localName as the name", async () => {
    const answer = JSON.stringify({
      items: [{ name: "nasi goreng", localName: "Fried rice", kcal: 350, grams: 200 }],
    });
    const events: VisionEvent[] = [];
    const result = await analyzeFoodPhoto(streamRunner([answer]), {
      ...OPTS,
      locale: "en",
      onEvent: (event) => events.push(event),
    });
    expect(events[0]).toEqual({ type: "name", index: 0, name: "Fried rice" });
    expect(result.items[0]?.name).toBe("Fried rice");
  });
});
