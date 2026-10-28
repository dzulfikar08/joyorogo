import { describe, expect, test } from "bun:test";

import { scaleGrams, scaleValue, swapScaleRead, withoutScaleRead } from "./scale-chip";
import {
  CONTAINER_GRAMS,
  SCALE_MIN_CONFIDENCE,
  SCALE_PROMPT,
  applyScaleReading,
  parseScaleDigits,
  parseScaleReading,
  readScaleDisplay,
  scaleLedger,
  scaleReadoutEnabled,
} from "./scale-reading";
import type { AiRunner, ScheduleTimeout } from "./vision";

const item = (name: string, grams: number, kcal: number, extra: Record<string, unknown> = {}) => ({
  name,
  grams,
  kcal,
  protein: 4,
  carbs: 40,
  fat: 1,
  fiber: 1,
  matched: false,
  ...extra,
});

const PLATE = [item("nasi putih", 150, 195), item("ayam goreng", 100, 245), item("tumis kangkung", 50, 40)];

const reading = (over: Record<string, unknown> = {}) => ({
  reading: "100",
  unit: "g",
  confidence: 0.9,
  appliesTo: "nasi putih",
  ...over,
});

describe("parseScaleDigits", () => {
  test("integers and either decimal mark", () => {
    expect(parseScaleDigits("100", "g")).toBe(100);
    expect(parseScaleDigits("3.5", "oz")).toBe(3.5);
    expect(parseScaleDigits("3,5", "oz")).toBe(3.5);
    expect(parseScaleDigits("1.25", "kg")).toBe(1.25);
    expect(parseScaleDigits("0.0", "g")).toBe(0);
    // The LCD's decimal point after the last digit (the owner's 258. and 260. photos).
    expect(parseScaleDigits("260.", "g")).toBe(260);
    expect(parseScaleDigits("260,", "g")).toBe(260);
  });

  test("anything else is unreadable, and a grams display with three decimals is ambiguous", () => {
    for (const text of ["", "abc", "1,2,3", "-5", "1e3", "100 g", "123456"]) {
      expect(parseScaleDigits(text, "g")).toBeNull();
    }
    expect(parseScaleDigits("1.250", "g")).toBeNull();
    expect(parseScaleDigits("1.250", "kg")).toBe(1.25);
  });
});

describe("parseScaleReading", () => {
  test("reads the shape the prompt asks for", () => {
    expect(parseScaleReading(reading())).toEqual({
      text: "100",
      unit: "g",
      confidence: 0.9,
      appliesTo: ["nasi putih"],
    });
  });

  test("plate wording, name lists and quoted numbers", () => {
    expect(parseScaleReading(reading({ appliesTo: "plate" }))?.appliesTo).toBe("plate");
    expect(parseScaleReading(reading({ appliesTo: "piring" }))?.appliesTo).toBe("plate");
    expect(parseScaleReading(reading({ appliesTo: "nasi putih|ayam goreng" }))?.appliesTo).toEqual([
      "nasi putih",
      "ayam goreng",
    ]);
    expect(parseScaleReading(reading({ appliesTo: ["nasi putih"], confidence: "0.8", reading: 250 }))).toMatchObject({
      text: "250",
      confidence: 0.8,
      appliesTo: ["nasi putih"],
    });
  });

  test("unit aliases and a unit written into the reading", () => {
    expect(parseScaleReading(reading({ unit: "Grams" }))?.unit).toBe("g");
    expect(parseScaleReading(reading({ unit: "OZ." }))?.unit).toBe("oz");
    expect(parseScaleReading(reading({ unit: "fl oz" }))?.unit).toBe("fl oz");
    expect(parseScaleReading(reading({ reading: "100g", unit: undefined }))).toMatchObject({ text: "100", unit: "g" });
  });

  test("a missing or invented unit, a missing reading or confidence: no reading", () => {
    expect(parseScaleReading(reading({ unit: "g|kg|oz|lb|ml", reading: "100" }))).toBeNull();
    expect(parseScaleReading(reading({ unit: "stone" }))).toBeNull();
    expect(parseScaleReading({ unit: "g", confidence: 1 })).toBeNull();
    expect(parseScaleReading(reading({ confidence: undefined }))).toBeNull();
    expect(parseScaleReading("100 g")).toBeNull();
    expect(parseScaleReading(null)).toBeNull();
  });
});

describe("applyScaleReading", () => {
  test("a reading for one item sets that item's grams; kcal follow, the rest stay", () => {
    const { items, outcome } = applyScaleReading(PLATE, reading());
    expect(items[0]!.grams).toBe(100);
    expect(items[0]!.kcal).toBeLessThan(PLATE[0]!.kcal);
    expect(items[0]!.kcal).toBeGreaterThan(0);
    expect(items[0]!.scaleRead).toMatchObject({ active: "scale", text: "100", unit: "g", grams: 100, count: 1 });
    expect(items[0]!.scaleRead!.other).toMatchObject({ grams: 150, kcal: 195 });
    expect(items[1]).toBe(PLATE[1]!);
    expect(items[2]).toBe(PLATE[2]!);
    expect(outcome).toMatchObject({ applied: [0], before: [150], grams: 100 });
    expect(outcome?.skipped).toBeUndefined();
  });

  test("a plate total is shared in the model's proportions and adds up exactly", () => {
    const { items, outcome } = applyScaleReading(PLATE, reading({ reading: "301", appliesTo: "plate" }));
    const grams = items.map((i) => i.grams!);
    expect(grams.reduce((a, b) => a + b, 0)).toBe(301);
    expect(grams[0]! / grams[1]!).toBeCloseTo(1.5, 1);
    expect(grams[2]! / grams[1]!).toBeCloseTo(0.5, 1);
    expect(items.every((i) => i.scaleRead?.count === 3 && i.scaleRead.grams === 301)).toBe(true);
    expect(outcome?.applied).toEqual([0, 1, 2]);
  });

  test("a plate leaves drinks alone, unless a drink is all there is", () => {
    const withDrink = [...PLATE, item("es teh manis", 300, 100, { kind: "minuman" })];
    const { items } = applyScaleReading(withDrink, reading({ reading: "600", appliesTo: "plate" }));
    expect(items[3]).toBe(withDrink[3]!);
    expect(items.slice(0, 3).reduce((a, i) => a + i.grams!, 0)).toBe(600);
    const drinkOnly = [item("es teh manis", 300, 100, { kind: "minuman" })];
    expect(applyScaleReading(drinkOnly, reading({ reading: "250", unit: "ml", appliesTo: "plate" })).items[0]!.grams).toBe(250);
  });

  test("several named items share the reading, others stay", () => {
    const { items } = applyScaleReading(PLATE, reading({ reading: "250", appliesTo: ["nasi putih", "ayam goreng"] }));
    expect(items[0]!.grams! + items[1]!.grams!).toBe(250);
    expect(items[2]).toBe(PLATE[2]!);
  });

  test("ounces and kilograms become grams", () => {
    expect(applyScaleReading(PLATE, reading({ reading: "3.5", unit: "oz" })).items[0]!.grams).toBe(99);
    expect(applyScaleReading(PLATE, reading({ reading: "0.12", unit: "kg" })).items[0]!.grams).toBe(120);
    const { items } = applyScaleReading(PLATE, reading({ reading: "3.5", unit: "oz" }));
    expect(scaleValue(items[0]!.scaleRead!, (g) => `${g} g`)).toBe("3.5 oz (99 g)");
  });

  test("a low-confidence read is never used", () => {
    const { items, outcome } = applyScaleReading(PLATE, reading({ confidence: SCALE_MIN_CONFIDENCE - 0.01 }));
    expect(items).toEqual(PLATE);
    expect(outcome).toMatchObject({ skipped: "low_confidence", applied: [] });
    expect(applyScaleReading(PLATE, reading({ confidence: SCALE_MIN_CONFIDENCE })).outcome?.skipped).toBeUndefined();
  });

  test("zero (tare), garbage digits and out-of-range weights are set aside", () => {
    expect(applyScaleReading(PLATE, reading({ reading: "0.0" })).outcome?.skipped).toBe("zero");
    expect(applyScaleReading(PLATE, reading({ reading: "1.250" })).outcome?.skipped).toBe("unreadable");
    expect(applyScaleReading(PLATE, reading({ reading: "9", unit: "kg" })).outcome?.skipped).toBe("out_of_range");
    expect(applyScaleReading(PLATE, reading({ reading: "0.4" })).outcome?.skipped).toBe("out_of_range");
    expect(applyScaleReading(PLATE, { reading: "x", unit: "g", confidence: 1 }).outcome?.skipped).toBe("unreadable");
  });

  test("a total ten times off the model's is a misread decimal, not a weight", () => {
    expect(applyScaleReading(PLATE, reading({ reading: "1600" })).outcome?.skipped).toBe("implausible");
    expect(applyScaleReading(PLATE, reading({ reading: "14" })).outcome?.skipped).toBe("implausible");
    expect(applyScaleReading(PLATE, reading({ reading: "15" })).outcome?.skipped).toBeUndefined();
  });

  test("a name that matches nothing never lands on one of several items", () => {
    const { items, outcome } = applyScaleReading(PLATE, reading({ appliesTo: "rendang" }));
    expect(items).toEqual(PLATE);
    expect(outcome?.skipped).toBe("no_target");
    // The only item of a photo is the one that was weighed, whatever the model called it.
    const single = applyScaleReading([PLATE[0]!], reading({ appliesTo: "rendang" }));
    expect(single.items[0]!.grams).toBe(100);
  });

  test("hidden cups and items without a weight are never covered", () => {
    const list = [item("kopi", 350, 120, { cup: "M" }), { ...item("roti", 50, 130), grams: undefined }];
    expect(applyScaleReading(list, reading({ appliesTo: "plate" })).outcome?.skipped).toBe("no_target");
  });

  test("nothing from the model, nothing changed", () => {
    expect(applyScaleReading(PLATE, undefined)).toEqual({ items: PLATE, outcome: null });
    expect(applyScaleReading(PLATE, null).outcome).toBeNull();
  });
});

describe("the container on the scale", () => {
  const SOTO = [item("soto daging", 668, 418)];
  const bowl = (over: Record<string, unknown> = {}) =>
    reading({ reading: "668", appliesTo: "plate", container: "bowl", material: "ceramic", tared: false, ...over });

  test("the prompt asks for the container, its material and whether the display was tared", () => {
    expect(SCALE_PROMPT).toContain('"container":"bowl|plate|box|cup|bag|wrapper|none"');
    expect(SCALE_PROMPT).toContain('"material":"ceramic|plastic|paper|other"');
    expect(SCALE_PROMPT).toContain('"tared"');
  });

  test("parseScaleReading reads kind, material and tared, with Indonesian words and a safe default", () => {
    expect(parseScaleReading(bowl())?.container).toEqual({ kind: "bowl", material: "ceramic", tared: false });
    expect(parseScaleReading(bowl({ container: "Mangkuk", material: "keramik", tared: "true" }))?.container).toEqual({
      kind: "bowl",
      material: "ceramic",
      tared: true,
    });
    expect(parseScaleReading(bowl({ container: "none", material: undefined, tared: undefined }))?.container).toEqual({
      kind: "none",
      material: "other",
      tared: null,
    });
    expect(parseScaleReading(bowl({ container: "wok" }))).not.toHaveProperty("container");
    expect(parseScaleReading(reading())).not.toHaveProperty("container");
  });

  test("not tared: the bowl comes off, the chip and the ledger say so, and kcal follow the food grams", () => {
    const { items, outcome } = applyScaleReading(SOTO, bowl());
    expect(items[0]!.grams).toBe(668 - CONTAINER_GRAMS.bowl.ceramic);
    expect(items[0]!.kcal).toBeLessThan(418);
    expect(items[0]!.scaleRead).toMatchObject({ active: "scale", grams: 668, tare: 250, tareKind: "bowl", count: 1 });
    expect(outcome?.container).toEqual({ kind: "bowl", material: "ceramic", tared: false, tare: 250 });
    // The photo estimate stays what the model said, one tap away.
    expect(items[0]!.scaleRead!.other).toMatchObject({ grams: 668 });
    expect(scaleLedger({ reading: bowl(), usage: null, ms: 1 }, outcome)).toMatchObject({
      container: { kind: "bowl", tare: 250 },
    });
  });

  test("a plate total shares reading minus container over the items, exactly", () => {
    const { items } = applyScaleReading(
      PLATE,
      reading({ reading: "550", appliesTo: "plate", container: "plate", material: "ceramic", tared: false }),
    );
    expect(items.reduce((a, i) => a + i.grams!, 0)).toBe(550 - 300);
    expect(items.every((i) => i.scaleRead?.tare === 300 && i.scaleRead.tareKind === "plate" && i.scaleRead.grams === 550)).toBe(true);
  });

  test("material picks the estimate; an unnamed material gets the light 'other' value", () => {
    const grams = (over: Record<string, unknown>) => applyScaleReading(SOTO, bowl(over)).items[0]!.grams;
    expect(grams({ material: "plastic" })).toBe(668 - 90);
    expect(grams({ container: "box", material: "paper" })).toBe(668 - 40);
    expect(grams({ material: undefined })).toBe(668 - 120);
  });

  test("tare detection: a tared display, no container, or no answer takes nothing off and says why", () => {
    const why = (over: Record<string, unknown>) => {
      const { items, outcome } = applyScaleReading(SOTO, bowl(over));
      expect(items[0]!.grams).toBe(668);
      expect(items[0]!.scaleRead).not.toHaveProperty("tare");
      expect(items[0]!.scaleRead).not.toHaveProperty("tareKind");
      return outcome?.container;
    };
    expect(why({ tared: true })).toMatchObject({ tare: 0, skipped: "tared" });
    expect(why({ container: "none", tared: false })).toMatchObject({ tare: 0, skipped: "none" });
    expect(why({ tared: undefined })).toMatchObject({ tare: 0, skipped: "tare_unknown" });
  });

  test("a reading too small to hold the container plus food can only have been zeroed", () => {
    // 300 g on the display with a 250 g ceramic bowl would leave 50 g (< a fifth): the display was zeroed.
    const small = applyScaleReading(SOTO, bowl({ reading: "300" }));
    expect(small.items[0]!.grams).toBe(300);
    expect(small.outcome?.container).toMatchObject({ tare: 0, skipped: "too_light" });
    // Just enough food left (a fifth of 400 g = 80 g; 150 g remain): taken off.
    expect(applyScaleReading(SOTO, bowl({ reading: "400" })).items[0]!.grams).toBe(150);
  });

  test("an answer without the container fields behaves as before", () => {
    const { items, outcome } = applyScaleReading(SOTO, reading({ reading: "668", appliesTo: "plate" }));
    expect(items[0]!.grams).toBe(668);
    expect(outcome).not.toHaveProperty("container");
  });

  test("the gates run on the raw reading: a set-aside reading never reaches the container", () => {
    const out = applyScaleReading(SOTO, bowl({ confidence: 0.3 }));
    expect(out.outcome?.skipped).toBe("low_confidence");
    expect(out.items).toEqual(SOTO);
    expect(applyScaleReading(SOTO, bowl({ reading: "9000" })).outcome?.skipped).toBe("out_of_range");
  });
});

describe("the chip", () => {
  test("a tap swaps the scale's numbers and the photo estimate, both ways, losing nothing", () => {
    const { items } = applyScaleReading(PLATE, reading());
    const scaled = items[0]!;
    const toAi = swapScaleRead(scaled);
    expect(toAi).toMatchObject({ grams: 150, kcal: 195 });
    expect(scaleGrams(toAi)).toEqual({ ai: 150, scale: 100 });
    const back = swapScaleRead(toAi);
    expect(back.grams).toBe(100);
    expect(back.kcal).toBe(scaled.kcal);
    expect(scaleGrams(back)).toEqual({ ai: 150, scale: 100 });
  });

  test("the stored list carries no chip", () => {
    const { items } = applyScaleReading(PLATE, reading());
    expect(withoutScaleRead(items)[0]).not.toHaveProperty("scaleRead");
  });
});

describe("the flag", () => {
  test("only listed ids", () => {
    expect(scaleReadoutEnabled({ SCALE_READOUT_USER_IDS: "a, b" }, "b")).toBe(true);
    expect(scaleReadoutEnabled({ SCALE_READOUT_USER_IDS: "a,b" }, "c")).toBe(false);
    expect(scaleReadoutEnabled({ SCALE_READOUT_USER_IDS: "" }, "")).toBe(false);
    expect(scaleReadoutEnabled({}, "a")).toBe(false);
  });

  test("* switches it on for everyone", () => {
    expect(scaleReadoutEnabled({ SCALE_READOUT_USER_IDS: "*" }, "anyone")).toBe(true);
    expect(scaleReadoutEnabled({ SCALE_READOUT_USER_IDS: "a, *" }, "b")).toBe(true);
  });
});

describe("readScaleDisplay", () => {
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
  const reply = (response: string, usage?: Record<string, unknown>) => ({ response, ...(usage ? { usage } : {}) });

  test("asks the scale prompt about the photo, at temperature 0, and returns the raw reading", async () => {
    const { ai, seen } = answering(
      reply(JSON.stringify({ scale: reading({ appliesTo: "plate" }) }), { prompt_tokens: 1100, completion_tokens: 40 }),
    );
    const call = await readScaleDisplay(ai, OPTS);
    expect(call.reading).toMatchObject({ reading: "100", unit: "g" });
    expect(call.error).toBeUndefined();
    expect(call.usage).toMatchObject({ completion_tokens: 40 });
    const body = seen[0] as { messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>; temperature: number };
    expect(body.messages[0]!.content[0]!.text).toBe(SCALE_PROMPT);
    expect(body.messages[0]!.content[1]!.image_url!.url).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(body.temperature).toBe(0);
  });

  test("no display in the photo: no reading, and no error", async () => {
    const { ai } = answering(reply('{"scale":null}'));
    const call = await readScaleDisplay(ai, OPTS);
    expect(call.reading).toBeUndefined();
    expect(call.error).toBeUndefined();
  });

  test("a malformed answer gets one more try", async () => {
    const { ai, seen } = answering(reply('{"scale":{"reading":"61"'), reply(JSON.stringify({ scale: reading({ reading: "61" }) })));
    const call = await readScaleDisplay(ai, OPTS);
    expect(seen.length).toBe(2);
    expect(call.reading).toMatchObject({ reading: "61" });
  });

  test("never throws: bad answers, a failing model and a timeout are a scan without a reading", async () => {
    const bad = await readScaleDisplay(answering(reply("Maaf, saya tidak bisa.")).ai, OPTS);
    expect(bad).toMatchObject({ reading: undefined });
    expect(bad.error).toBeDefined();
    const down = await readScaleDisplay(answering(new Error("boom")).ai, OPTS);
    expect(down).toMatchObject({ reading: undefined, error: "boom" });
    const { promise } = Promise.withResolvers<never>();
    const hung = await readScaleDisplay(
      { run: () => promise },
      { ...OPTS, schedule: (fn) => { queueMicrotask(() => queueMicrotask(fn)); return () => {}; } },
    );
    expect(hung).toMatchObject({ reading: undefined, error: "scale-timeout" });
  });

  describe("a stalled call", () => {
    // A schedule the test fires by hand, by the delay it was asked for.
    const manual = () => {
      const timers: Array<{ ms: number; fn: () => void; live: boolean }> = [];
      const schedule: ScheduleTimeout = (fn, ms) => {
        const timer = { ms, fn, live: true };
        timers.push(timer);
        return () => {
          timer.live = false;
        };
      };
      const fire = (ms: number) => timers.find((t) => t.ms === ms && t.live)?.fn();
      return { schedule, fire, live: () => timers.filter((t) => t.live).map((t) => t.ms) };
    };
    const ok = reply(JSON.stringify({ scale: reading({ reading: "12" }) }), { completion_tokens: 40 });
    // First call never answers, later ones answer.
    const stalling = (): { ai: AiRunner; calls: () => number } => {
      let n = 0;
      return { calls: () => n, ai: { run: () => (n++ === 0 ? new Promise<never>(() => {}) : Promise.resolve(ok)) } };
    };

    test("a second identical call goes out after the hedge delay and its answer is used", async () => {
      const { schedule, fire } = manual();
      const { ai, calls } = stalling();
      const pending = readScaleDisplay(ai, { ...OPTS, schedule, timeoutMs: 12_000, hedgeAfterMs: 4_000 });
      await Promise.resolve();
      expect(calls()).toBe(1);
      fire(4_000);
      const call = await pending;
      expect(calls()).toBe(2);
      expect(call.reading).toMatchObject({ reading: "12", unit: "g" });
      expect(call.error).toBeUndefined();
      expect(call.retried).toBe(true);
      expect(scaleLedger(call, null)).toMatchObject({ retried: true });
    });

    test("a call that answers in time sends no second one, and leaves no timer behind", async () => {
      const { schedule, fire, live } = manual();
      const { ai, seen } = answering(ok);
      const call = await readScaleDisplay(ai, { ...OPTS, schedule, timeoutMs: 12_000, hedgeAfterMs: 4_000 });
      fire(4_000);
      expect(seen.length).toBe(1);
      expect(call.retried).toBeUndefined();
      expect(live()).toEqual([]);
    });

    test("when both calls stall the timeout still ends it, with no reading", async () => {
      const { schedule, fire } = manual();
      const never = { run: () => new Promise<never>(() => {}) };
      const pending = readScaleDisplay(never, { ...OPTS, schedule, timeoutMs: 12_000, hedgeAfterMs: 4_000 });
      fire(4_000);
      fire(12_000);
      expect(await pending).toMatchObject({ reading: undefined, error: "scale-timeout", retried: true });
    });

    test("an infinite hedge delay never sends a second call for slowness", async () => {
      const { schedule, fire } = manual();
      const { ai, calls } = stalling();
      const pending = readScaleDisplay(ai, { ...OPTS, schedule, timeoutMs: 12_000, hedgeAfterMs: Infinity });
      fire(12_000);
      expect(await pending).toMatchObject({ reading: undefined, error: "scale-timeout" });
      expect(calls()).toBe(1);
    });

    test("a malformed first answer is retried at once, not after the delay; a hedge only ever adds one call", async () => {
      const { schedule, fire } = manual();
      const { ai, seen } = answering(reply('{"scale":{"reading":"61"'), reply("Maaf"), ok);
      const call = await readScaleDisplay(ai, { ...OPTS, schedule, hedgeAfterMs: 4_000 });
      fire(4_000);
      // Two malformed answers end it: two calls, never three.
      expect(seen.length).toBe(2);
      expect(call.reading).toBeUndefined();
      expect(call.error).toBeDefined();
    });
  });
});

describe("scaleLedger", () => {
  test("carries the outcome, the call's cost and its failure", () => {
    const { outcome } = applyScaleReading(PLATE, reading());
    expect(scaleLedger({ reading: reading(), usage: { completion_tokens: 40 }, ms: 1800 }, outcome)).toMatchObject({
      text: "100",
      applied: [0],
      ms: 1800,
      usage: { completion_tokens: 40 },
    });
    expect(scaleLedger({ reading: undefined, usage: null, ms: 12000, error: "scale-timeout" }, null)).toEqual({
      ms: 12000,
      error: "scale-timeout",
    });
  });
});
