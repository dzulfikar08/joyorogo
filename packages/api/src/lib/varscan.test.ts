import { describe, expect, test } from "bun:test";

import {
  VAR_FRIENDLY_ERROR,
  analyzeVarPhotos,
  varResultFromText,
} from "./varscan";

type ContentPart = { type: string };
type RunPayload = { messages?: Array<{ content?: ContentPart[] }> };

function isRunPayload(value: unknown): value is RunPayload {
  return typeof value === "object" && value !== null && "messages" in value;
}

/** AiRunner tiruan: mengembalikan teks antrean, menghitung panggilan. */
function fakeAi(answers: string[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async run(_model: string, input: unknown) {
      const answer = answers[Math.min(calls, answers.length - 1)]!;
      calls++;
      if (!isRunPayload(input)) throw new Error("payload tanpa messages");
      const parts = input.messages?.[0]?.content ?? [];
      // Prompt wiring: satu teks + dua foto (lama, baru).
      expect(parts.filter((part) => part.type === "image_url").length).toBe(2);
      expect(parts[0]?.type).toBe("text");
      return { response: answer };
    },
  };
}

/** DI seam untuk test: jadwal yang tidak pernah membatalkan. */
const neverSchedule = () => () => {};

const OPTS = {
  previous: { imageBase64: "cHJldg==", label: "scan 1 Okt" },
  current: { imageBase64: "Y3Vy", mimeType: "image/jpeg", label: "hari ini" },
  waistCm: null,
} as const;

describe("varResultFromText", () => {
  test("parses a clean single-line answer", () => {
    const text = `{"verdict":"turun","confidence":0.72,"reason":"Perut terlihat lebih rata dari foto lama."}`;
    expect(varResultFromText(text)).toEqual({
      verdict: "turun",
      confidence: 0.72,
      reason: "Perut terlihat lebih rata dari foto lama.",
    });
  });

  test("cuts the JSON out of prose and fences", () => {
    const text = 'Tentu! ```json\n{"verdict":"sama","confidence":0.5}\n``` semoga membantu.';
    expect(varResultFromText(text).verdict).toBe("sama");
  });

  test("defaults confidence and clamps reason length", () => {
    const parsed = varResultFromText(`{"verdict":"naik","reason":"${"x".repeat(500)}"}`);
    expect(parsed.confidence).toBe(0.6);
    expect(parsed.reason.length).toBe(200);
  });

  test("rejects an unknown verdict", () => {
    expect(() => varResultFromText(`{"verdict":"offside","confidence":1}`)).toThrow();
  });
});

describe("analyzeVarPhotos", () => {
  test("happy path returns parsed verdict plus model", async () => {
    const ai = fakeAi([`{"verdict":"turun","confidence":0.8,"reason":"Lebih rata."}`]);
    const result = await analyzeVarPhotos(ai as never, {
      ...OPTS,
      waistCm: 88.5,
      schedule: neverSchedule,
    });
    expect(result.verdict).toBe("turun");
    expect(result.model).toContain("gemma");
    expect(ai.calls).toBe(1);
  });

  test("retries once after a fast unparseable answer", async () => {
    const ai = fakeAi(["saya tidak bisa memproses", `{"verdict":"sama","confidence":0.4}`]);
    const result = await analyzeVarPhotos(ai as never, { ...OPTS, schedule: neverSchedule });
    expect(ai.calls).toBe(2);
    expect(result.verdict).toBe("sama");
  });

  test("a failure over the fast budget never chains a retry", async () => {
    const ai = fakeAi(["sampah"]);
    // budget -1: setiap kegagalan dianggap sudah memakan kesabaran pengguna.
    await expect(
      analyzeVarPhotos(ai as never, { ...OPTS, schedule: neverSchedule, budgetMs: -1 }),
    ).rejects.toThrow(VAR_FRIENDLY_ERROR);
    expect(ai.calls).toBe(1);
  });

  test("a timeout never chains a retry", async () => {
    let calls = 0;
    const slowAi = {
      run() {
        calls++;
        return new Promise(() => {}); // never settles; the deadline fires
      },
    };
    const fired: Array<() => void> = [];
    const schedule = (fn: () => void) => {
      fired.push(fn);
      return () => {};
    };
    const pending = analyzeVarPhotos(slowAi as never, {
      ...OPTS,
      timeouts: [1, 2],
      schedule,
    });
    fired[0]?.();
    await expect(pending).rejects.toThrow(VAR_FRIENDLY_ERROR);
    expect(calls).toBe(1);
  });
});
