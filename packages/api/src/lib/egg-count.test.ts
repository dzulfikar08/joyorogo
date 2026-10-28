import { describe, expect, test } from "bun:test";

import { applyEggCount, EGG_COUNT_PROMPT, eggCountOf, readEggCount, withEggCount } from "./egg-count";
import { isBoiledEgg } from "./piece-count";
import type { AiRunner } from "./vision";

const half = (box?: unknown) => ({ kind: "belahan", ...(box ? { box } : {}) });
const whole = (box?: unknown) => ({ kind: "utuh", ...(box ? { box } : {}) });

describe("isBoiledEgg", () => {
  test("eggs eaten as eggs", () => {
    for (const name of ["telur rebus", "Telur ayam rebus", "telur", "boiled egg telur"]) expect(isBoiledEgg(name)).toBe(true);
  });

  test("not fried, scrambled, quail, white, or built into a dish", () => {
    for (const name of ["telur ceplok", "telur mata sapi", "telur goreng", "telur orak-arik", "telur puyuh rebus", "putih telur", "telur dadar", "telur balado", "nasi goreng telur", "martabak telur", "ayam goreng"]) {
      expect(isBoiledEgg(name)).toBe(false);
    }
  });
});

describe("eggCountOf", () => {
  test("whole entries and halves are counted apart", () => {
    expect(eggCountOf({ eggs: [whole(), half(), half()] })).toEqual({ whole: 1, halves: 2 });
  });

  test("a missing or odd kind is a half, the piece an egg half shows", () => {
    expect(eggCountOf({ eggs: [{ box: [0, 0, 100, 100] }, { kind: 3 }] })).toEqual({ whole: 0, halves: 2 });
  });

  test("an entry whose box sits on an earlier one is the same piece listed twice", () => {
    const list = { eggs: [half([100, 100, 300, 300]), half([110, 105, 300, 305]), half([500, 500, 700, 700])] };
    expect(eggCountOf(list)).toEqual({ whole: 0, halves: 2 });
  });

  test("touching pieces stay apart", () => {
    expect(eggCountOf({ eggs: [half([100, 100, 300, 300]), half([100, 250, 300, 450])] })).toEqual({ whole: 0, halves: 2 });
  });

  test("an entry without a usable box still counts", () => {
    expect(eggCountOf({ eggs: [half([1, 2]), half("x"), half()] })).toEqual({ whole: 0, halves: 3 });
  });

  test("no list, an empty list or another shape is no count", () => {
    expect(eggCountOf({ eggs: [] })).toBeUndefined();
    expect(eggCountOf({ eggs: "tiga" })).toBeUndefined();
    expect(eggCountOf(null)).toBeUndefined();
    expect(eggCountOf({})).toBeUndefined();
  });

  test("a list of dozens is read up to the cap", () => {
    expect(eggCountOf({ eggs: Array.from({ length: 80 }, () => half()) })).toEqual({ whole: 0, halves: 40 });
  });
});

const egg = { name: "telur rebus", portion: "2 belahan", grams: 50, kcal: 77, protein: 6.3, carbs: 0.6, fat: 5.3, pieces: { count: 2, unit: "belahan", unitGrams: 25 } };

describe("applyEggCount", () => {
  test("six halves for two: grams, kcal, macros and the stepper follow", () => {
    const [row] = applyEggCount([egg], { whole: 0, halves: 6 });
    expect(row).toMatchObject({ portion: "6 belahan", grams: 150, kcal: 231, protein: 18.9, pieces: { count: 6, unit: "belahan", unitGrams: 25 } });
  });

  test("whole eggs only: butir at 50 g", () => {
    const [row] = applyEggCount([egg], { whole: 3, halves: 0 });
    expect(row).toMatchObject({ portion: "3 butir", grams: 150, pieces: { count: 3, unit: "butir", unitGrams: 50 } });
  });

  test("whole and halves together are halves (a whole egg is two)", () => {
    const [row] = applyEggCount([egg], { whole: 1, halves: 2 });
    expect(row).toMatchObject({ portion: "4 belahan", grams: 100 });
  });

  test("the count can also bring a too-high scan down", () => {
    const [row] = applyEggCount([{ ...egg, grams: 150, kcal: 231, pieces: { count: 6, unit: "belahan", unitGrams: 25 } }], { whole: 1, halves: 0 });
    expect(row).toMatchObject({ portion: "1 butir", grams: 50, kcal: 77 });
  });

  test("other rows are left alone", () => {
    const rice = { name: "nasi putih", grams: 150, kcal: 195 };
    expect(applyEggCount([rice, egg], { whole: 0, halves: 4 })[0]).toBe(rice);
  });

  test("no count, no egg row, or no weight to scale from: the scan's rows", () => {
    expect(applyEggCount([egg], undefined)).toEqual([egg]);
    expect(applyEggCount([{ name: "nasi putih", grams: 150, kcal: 195 }], { whole: 0, halves: 4 })).toEqual([{ name: "nasi putih", grams: 150, kcal: 195 }]);
    expect(applyEggCount([{ name: "telur rebus", kcal: 77 }], { whole: 0, halves: 4 })).toEqual([{ name: "telur rebus", kcal: 77 }]);
  });

  test("one pile listed twice becomes one row", () => {
    const rice = { name: "nasi putih", grams: 80, kcal: 104 };
    const again = { ...egg, portion: "2 butir", grams: 100, kcal: 154, pieces: { count: 2, unit: "butir", unitGrams: 50 } };
    const out = applyEggCount([rice, egg, again], { whole: 0, halves: 4 });
    expect(out.map((row) => row.name)).toEqual(["nasi putih", "telur rebus"]);
    expect(out[1]).toMatchObject({ portion: "4 belahan", grams: 100, kcal: 154 });
  });

  test("the weight comes from the stepper when the row has no grams", () => {
    const [row] = applyEggCount([{ name: "telur rebus", kcal: 77, pieces: { count: 2, unit: "belahan", unitGrams: 25 } }], { whole: 0, halves: 4 });
    expect(row).toMatchObject({ grams: 100, kcal: 154 });
  });
});

describe("readEggCount", () => {
  const OPTS = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };
  const answering = (...answers: unknown[]): { ai: AiRunner; seen: unknown[] } => {
    const seen: unknown[] = [];
    let call = 0;
    return {
      seen,
      ai: {
        run: (_model, body) => {
          seen.push(body);
          const next = answers[Math.min(call++, answers.length - 1)];
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        },
      },
    };
  };
  const reply = (response: string) => ({ response });

  test("asks the list prompt about the photo, at temperature 0", async () => {
    const { ai, seen } = answering(reply('{"eggs":[{"kind":"belahan","box":[100,100,300,300]},{"kind":"utuh","box":[500,500,700,700]}]}'));
    const call = await readEggCount(ai, OPTS);
    expect(call.count).toEqual({ whole: 1, halves: 1 });
    const body = seen[0] as { messages: Array<{ content: Array<{ text?: string; image_url?: { url: string } }> }>; temperature: number };
    expect(body.messages[0]!.content[0]!.text).toBe(EGG_COUNT_PROMPT);
    expect(body.messages[0]!.content[1]!.image_url!.url).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(body.temperature).toBe(0);
  });

  test("never throws: prose, a failing model and a timeout are no count", async () => {
    const bad = await readEggCount(answering(reply("Maaf.")).ai, OPTS);
    expect(bad.count).toBeUndefined();
    expect(bad.error).toBeDefined();
    const down = await readEggCount(answering(new Error("boom")).ai, OPTS);
    expect(down.count).toBeUndefined();
    expect(down.error).toBe("boom");
    const { promise } = Promise.withResolvers<never>();
    const hung = await readEggCount(
      { run: () => promise },
      { ...OPTS, schedule: (fn) => { queueMicrotask(() => queueMicrotask(fn)); return () => {}; } },
    );
    expect(hung.count).toBeUndefined();
    expect(hung.error).toBe("egg-timeout");
  });
});

describe("withEggCount", () => {
  const OPTS = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };
  const list = { response: '{"eggs":[{"kind":"belahan"},{"kind":"belahan"},{"kind":"belahan"},{"kind":"belahan"},{"kind":"belahan"},{"kind":"belahan"}]}' };

  test("a plate with one boiled-egg row is recounted", async () => {
    const { analysis, call } = await withEggCount({ run: () => Promise.resolve(list) }, OPTS, { items: [egg] });
    expect(analysis.items[0]).toMatchObject({ grams: 150, portion: "6 belahan" });
    expect(call?.count).toEqual({ whole: 0, halves: 6 });
  });

  test("no egg row: no call is made", async () => {
    let calls = 0;
    const ai: AiRunner = { run: () => { calls++; return Promise.resolve(list); } };
    const answer = { items: [{ name: "nasi goreng", grams: 250, kcal: 400 }] };
    const out = await withEggCount(ai, OPTS, answer);
    expect(calls).toBe(0);
    expect(out.analysis).toBe(answer);
    expect(out.call).toBeUndefined();
  });

  test("a failed call leaves the scan's count", async () => {
    const { analysis, call } = await withEggCount({ run: () => Promise.reject(new Error("down")) }, OPTS, { items: [egg] });
    expect(analysis.items).toEqual([egg]);
    expect(call?.error).toBe("down");
  });
});
