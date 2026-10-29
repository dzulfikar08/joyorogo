import { describe, expect, test } from "bun:test";

import { buildScanReference } from "./dishware-store";
import type { DishwareRow } from "./dishware-store";
import {
  cardPlateLedger,
  MEASURE_PROMPT,
  measureCardPlate,
  measureFromAnswer,
  parseMeasureAnswer,
  plateOf,
  scanWithMeasuredPlate,
} from "./card-plate";
import type { CardPlateResult, RawMeasure } from "./card-plate";
import { imageSize } from "./image-size";
import { applyPieceGeometry } from "./piece-geometry";
import type { VisionEvent } from "./vision";

/** A JPEG header of the given size: SOI, an APP0 segment (the parser must skip it), SOF0. Not decodable, readable. */
function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

describe("imageSize", () => {
  test("reads a JPEG past its APP0 segment, a PNG and a WebP", () => {
    expect(imageSize(jpegHeader(768, 1024))).toEqual({ width: 768, height: 1024 });
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x03, 0x00, 0, 0, 0x02, 0x00], 8);
    expect(imageSize(png)).toEqual({ width: 768, height: 512 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([0xff, 0x02, 0x00], 24); // width - 1 = 767
    webp.set([0xff, 0x03, 0x00], 27); // height - 1 = 1023
    expect(imageSize(webp)).toEqual({ width: 768, height: 1024 });
  });

  test("anything else is null, never a guess", () => {
    expect(imageSize(new TextEncoder().encode("hello world hello world"))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(jpegHeader(0, 0))).toBeNull();
  });
});

/** An axis-aligned card from its top-left grid corner and size in pixels, on a photo of `w` x `h` pixels. */
const corners = (w: number, h: number, x: number, y: number, cw: number, ch: number): Array<[number, number]> => [
  [(x / w) * 1000, (y / h) * 1000],
  [((x + cw) / w) * 1000, (y / h) * 1000],
  [((x + cw) / w) * 1000, ((y + ch) / h) * 1000],
  [(x / w) * 1000, ((y + ch) / h) * 1000],
];
const gridBox = (w: number, h: number, x: number, y: number, bw: number, bh: number): [number, number, number, number] => [
  (y / h) * 1000,
  (x / w) * 1000,
  ((y + bh) / h) * 1000,
  ((x + bw) / w) * 1000,
];
/** A card of 8.56 cm = 200 px (23.36 px/cm); a 24 cm plate is 560.7 px. */
const CARD_W = 200;
const CARD_H = 126;
const answer = (over: Partial<RawMeasure> = {}): RawMeasure => ({
  seen: true,
  corners: corners(1000, 1000, 50, 400, CARD_W, CARD_H),
  kind: "flat",
  box: gridBox(1000, 1000, 300, 200, 561, 561),
  ...over,
});
const SQUARE = { width: 1000, height: 1000 };

describe("measureFromAnswer: the diameter", () => {
  test("plate major axis over the card's long side times 8.56 cm", () => {
    const outcome = measureFromAnswer(answer(), SQUARE);
    expect(outcome).toMatchObject({ seen: true, used: true, plate: { kind: "flat" } });
    expect(outcome.diameterCm).toBeCloseTo(24, 0);
    expect(outcome.card?.aspect).toBeCloseTo(1.59, 2);
    expect(outcome.card?.pxPerCm).toBeCloseTo(23.36, 1);
  });

  test("the 0-1000 grid is stretched by the photo's aspect ratio: pixels come from the real width and height", () => {
    // Same scene on a 768 x 1024 photo: a grid unit is 0.768 px wide and 1.024 px tall.
    const tall = { width: 768, height: 1024 };
    const outcome = measureFromAnswer(
      answer({ corners: corners(768, 1024, 50, 400, CARD_W, CARD_H), box: gridBox(768, 1024, 100, 200, 561, 561) }),
      tall,
    );
    expect(outcome.used).toBe(true);
    expect(outcome.diameterCm).toBeCloseTo(24, 0);
    // The same grid answer read as square pixels is another card shape on this photo: never 24 cm.
    expect(measureFromAnswer(answer(), tall).used).toBe(false);
  });

  test("a rotated card gives the same scale as a straight one, whatever order the corners come in", () => {
    const angle = (35 * Math.PI) / 180;
    const [cx, cy] = [150, 463];
    const rotated = ([
      [-CARD_W / 2, -CARD_H / 2],
      [CARD_W / 2, -CARD_H / 2],
      [CARD_W / 2, CARD_H / 2],
      [-CARD_W / 2, CARD_H / 2],
    ] as const).map(([dx, dy]): [number, number] => [
      ((cx + dx * Math.cos(angle) - dy * Math.sin(angle)) / 1000) * 1000,
      ((cy + dx * Math.sin(angle) + dy * Math.cos(angle)) / 1000) * 1000,
    ]);
    const straight = measureFromAnswer(answer(), SQUARE);
    for (const order of [rotated, [rotated[2]!, rotated[0]!, rotated[3]!, rotated[1]!]]) {
      const outcome = measureFromAnswer(answer({ corners: order }), SQUARE);
      expect(outcome.used).toBe(true);
      expect(outcome.diameterCm).toBeCloseTo(straight.diameterCm!, 0);
    }
  });

  test("an axis-aligned box around a rotated card is no card shape and is skipped, not mismeasured", () => {
    // 35 degrees: the bounding box of a 8.56 x 5.4 card is about 1.2 : 1.
    const w = 8.56 * Math.cos(0.61) + 5.4 * Math.sin(0.61);
    const h = 8.56 * Math.sin(0.61) + 5.4 * Math.cos(0.61);
    const outcome = measureFromAnswer(answer({ corners: corners(1000, 1000, 50, 400, w * 23.36, h * 23.36) }), SQUARE);
    expect(outcome).toMatchObject({ used: false, skipped: "card_shape" });
  });

  test("perspective: a card foreshortened by 15% still measures, a skewed quadrilateral does not", () => {
    const trapezoid = (top: number): Array<[number, number]> => [
      [100, 400],
      [100 + top, 400],
      [100 + CARD_W - 10, 400 + CARD_H],
      [110, 400 + CARD_H],
    ];
    expect(measureFromAnswer(answer({ corners: trapezoid(CARD_W) }), SQUARE).used).toBe(true);
    // top side 1.5 times the bottom side: the corners cannot be a card's.
    expect(measureFromAnswer(answer({ corners: trapezoid(CARD_W * 1.5) }), SQUARE)).toMatchObject({ used: false, skipped: "card_shape" });
  });

  test("corners that are not a convex quadrilateral (one inside the others), or none at all, are not a card", () => {
    const dart: Array<[number, number]> = [[50, 400], [250, 400], [250, 526], [150, 430]];
    expect(measureFromAnswer(answer({ corners: dart }), SQUARE).skipped).toBe("card_corners");
    expect(measureFromAnswer(answer({ corners: null }), SQUARE).skipped).toBe("card_corners");
  });

  test("a square-ish rectangle (a coaster, a note) and a speck are skipped", () => {
    expect(measureFromAnswer(answer({ corners: corners(1000, 1000, 50, 400, 150, 130) }), SQUARE).skipped).toBe("card_shape");
    expect(measureFromAnswer(answer({ corners: corners(1000, 1000, 50, 400, 30, 19) }), SQUARE).skipped).toBe("card_size");
  });

  test("no card, a plate answered as none, and a missing plate box each skip with their own reason", () => {
    expect(measureFromAnswer(answer({ seen: false }), SQUARE)).toEqual({ seen: false, used: false, skipped: "no_card" });
    expect(measureFromAnswer(answer({ kind: "none" }), SQUARE)).toMatchObject({ seen: true, used: false, skipped: "no_plate" });
    expect(measureFromAnswer(answer({ box: null }), SQUARE)).toMatchObject({ used: false, skipped: "plate_box" });
    expect(measureFromAnswer(answer({ kind: null }), SQUARE)).toMatchObject({ used: false, skipped: "plate_box" });
  });

  test("a plate the photo's border cuts off is measured on the other axis; cut on both axes it is skipped", () => {
    // Wider than the photo: the box runs to the right border, its height is the diameter.
    const cutX = measureFromAnswer(answer({ box: [200 / 1, 300, 200 + 561 / 1, 1000] }), SQUARE);
    expect(cutX).toMatchObject({ used: true, plate: { clipped: "x" } });
    expect(cutX.diameterCm).toBeCloseTo(24, 0);
    expect(measureFromAnswer(answer({ box: [0, 300, 561, 1000] }), SQUARE)).toMatchObject({ used: false, skipped: "plate_cut_off" });
  });

  test("a box that is far from round is skipped (an oval tray or a wrong box), a plate tilted a little is not", () => {
    expect(measureFromAnswer(answer({ box: gridBox(1000, 1000, 100, 200, 600, 300) }), SQUARE).skipped).toBe("not_round");
    expect(measureFromAnswer(answer({ box: gridBox(1000, 1000, 100, 200, 561, 440) }), SQUARE).used).toBe(true);
  });

  test("outside 12-34 cm there is no diameter used; the edges themselves are accepted", () => {
    const at = (cm: number) => measureFromAnswer(answer({ box: gridBox(1000, 1000, 20, 20, cm * 23.364, cm * 23.364) }), SQUARE);
    expect(at(8)).toMatchObject({ used: false, skipped: "implausible_diameter", diameterCm: 8 });
    expect(at(40)).toMatchObject({ used: false, skipped: "implausible_diameter" });
    expect(at(12).used).toBe(true);
    expect(at(33.9).used).toBe(true);
    expect(at(34.5).skipped).toBe("implausible_diameter");
  });
});

describe("parseMeasureAnswer", () => {
  const ok = '{"card":{"seen":true,"corners":[[26,435],[257,435],[257,678],[26,678]]},"plate":{"kind":"bowl","box":[271,261,831,995]}}';
  test("reads the answer, with or without a fence or prose around it", () => {
    for (const text of [ok, "```json\n" + ok + "\n```", "Ini jawabannya: " + ok + " selesai"]) {
      expect(parseMeasureAnswer(text)).toEqual({
        seen: true,
        corners: [[26, 435], [257, 435], [257, 678], [26, 678]],
        kind: "bowl",
        box: [271, 261, 831, 995],
      });
    }
  });

  test("a card that is not seen, bad corners and a bad box degrade field by field", () => {
    expect(parseMeasureAnswer('{"card":{"seen":false,"corners":null},"plate":{"kind":"none","box":null}}')).toEqual({ seen: false, corners: null, kind: "none", box: null });
    expect(parseMeasureAnswer('{"card":{"seen":true,"corners":[[1,2],[3,4]]},"plate":{"kind":"tray","box":[5,5,5,5]}}')).toEqual({ seen: true, corners: null, kind: null, box: null });
    expect(parseMeasureAnswer('{"card":{"seen":"yes"},"plate":{"kind":"flat","box":[10,10,900,2000]}}')).toMatchObject({ seen: false, box: [10, 10, 900, 1000] });
  });

  test("text that is not the asked object is null", () => {
    expect(parseMeasureAnswer("tidak ada kartu")).toBeNull();
    expect(parseMeasureAnswer('{"items":[]}')).toBeNull();
    expect(parseMeasureAnswer("{broken")).toBeNull();
  });
});

const chat = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 555, completion_tokens: 67 } });
const GOOD = JSON.stringify({
  card: { seen: true, corners: corners(1000, 1000, 50, 400, CARD_W, CARD_H) },
  plate: { kind: "flat", box: gridBox(1000, 1000, 300, 200, 561, 561) },
});
const photo = (w = 1000, h = 1000) => ({ imageBase64: "AAAA", mimeType: "image/jpeg", bytes: jpegHeader(w, h) });

/** The model's answer for a plate of `cm` cm on the square 1000 px photo (card 200 px = 8.56 cm). */
const answerFor = (cm: number, kind = "flat") =>
  JSON.stringify({ card: { seen: true, corners: corners(1000, 1000, 50, 400, CARD_W, CARD_H) }, plate: { kind, box: gridBox(1000, 1000, 20, 20, cm * 23.364, cm * 23.364) } });

describe("measureCardPlate: two calls that must agree, never an error", () => {
  test("temperature 0, the measure prompt and the image; two calls; the averaged diameter and the summed usage come back", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const result = await measureCardPlate(
      { run: (_m, body) => (sent.push(body as Record<string, unknown>), Promise.resolve(chat(GOOD))) },
      photo(),
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ temperature: 0 });
    expect(JSON.stringify(sent[0])).toContain(MEASURE_PROMPT.slice(0, 40));
    expect(result.outcome).toMatchObject({ seen: true, used: true });
    expect(result.outcome.diameterCm).toBeCloseTo(24, 0);
    expect(result.outcome.diameters).toHaveLength(2);
    expect(result.usage).toEqual({ prompt_tokens: 1110, completion_tokens: 134 });
    expect(result.error).toBeUndefined();
  });

  test("two answers within 10% are averaged; further apart is no measurement, however plausible each is", async () => {
    const run = (first: number, second: number) => {
      let calls = 0;
      return measureCardPlate({ run: () => Promise.resolve(chat(answerFor(++calls === 1 ? first : second))) }, photo());
    };
    const agree = await run(24, 25);
    expect(agree.outcome).toMatchObject({ used: true, diameterCm: 24.5, diameters: [24, 25] });
    const apart = await run(19, 27);
    expect(apart.outcome).toMatchObject({ used: false, skipped: "no_consensus", diameters: [19, 27] });
    expect(apart.outcome.diameterCm).toBeUndefined();
  });

  test("a card seen by one call and not by the other, or one call lost, is no measurement; no card twice is simply no card", async () => {
    let calls = 0;
    const split = await measureCardPlate({ run: () => Promise.resolve(chat(++calls === 1 ? GOOD : '{"card":{"seen":false,"corners":null},"plate":{"kind":"none","box":null}}')) }, photo());
    expect(split.outcome).toMatchObject({ used: false, skipped: "no_consensus" });
    let n = 0;
    const lost = await measureCardPlate({ run: () => (++n === 1 ? Promise.resolve(chat(GOOD)) : new Promise(() => {})) }, { ...photo(), timeoutMs: 30 });
    expect(lost.outcome).toMatchObject({ used: false, skipped: "no_consensus" });
    const none = await measureCardPlate({ run: () => Promise.resolve(chat('{"card":{"seen":false,"corners":null},"plate":{"kind":"none","box":null}}')) }, photo());
    expect(none.outcome).toEqual({ seen: false, used: false, skipped: "no_card" });
  });

  test("a photo whose size cannot be read makes no call at all", async () => {
    let calls = 0;
    const result = await measureCardPlate({ run: () => (calls++, Promise.resolve(chat(GOOD))) }, { ...photo(), bytes: new Uint8Array(10) });
    expect(calls).toBe(0);
    expect(result.outcome).toEqual({ seen: false, used: false, skipped: "no_size" });
  });

  test("an unparseable answer is asked once more per call, then skipped as unparseable", async () => {
    let calls = 0;
    const result = await measureCardPlate({ run: () => (calls++, Promise.resolve(chat("maaf, saya tidak bisa"))) }, photo());
    expect(calls).toBe(4);
    expect(result).toMatchObject({ outcome: { used: false, skipped: "unparseable" }, retried: true, error: "unparseable" });
  });

  test("the second try can rescue a malformed first answer", async () => {
    let calls = 0;
    const result = await measureCardPlate({ run: () => Promise.resolve(chat(++calls === 1 ? "???" : GOOD)) }, photo());
    expect(result.outcome.used).toBe(true);
    expect(result.retried).toBe(true);
  });

  test("a model error is a skipped outcome, never a throw", async () => {
    const result = await measureCardPlate({ run: () => Promise.reject(new Error("boom")) }, photo());
    expect(result).toMatchObject({ outcome: { used: false, skipped: "error" }, error: "boom" });
  });

  test("calls that never answer end at the timeout", async () => {
    const result = await measureCardPlate({ run: () => new Promise(() => {}) }, { ...photo(), timeoutMs: 20 });
    expect(result).toMatchObject({ outcome: { used: false, skipped: "timeout" } });
    expect(result.ms).toBeLessThan(1000);
  });
});

describe("a bowl wider than 24 cm is a misread card, a flat plate that wide is not", () => {
  test("by kind", () => {
    const at = (cm: number, kind: "flat" | "bowl") => measureFromAnswer(parseMeasureAnswer(answerFor(cm, kind))!, SQUARE);
    expect(at(27, "bowl")).toMatchObject({ used: false, skipped: "implausible_diameter" });
    expect(at(27, "flat").used).toBe(true);
    expect(at(23.5, "bowl").used).toBe(true);
  });
});

const measured = (over: Partial<CardPlateResult["outcome"]> = {}): CardPlateResult => ({
  outcome: { seen: true, used: true, diameterCm: 24, plate: { kind: "flat", box: [1, 2, 3, 4] }, ...over },
  usage: null,
  ms: 7,
});
const none: CardPlateResult = { outcome: { seen: false, used: false, skipped: "no_card" }, usage: null, ms: 7 };

describe("scanWithMeasuredPlate: the scan runs beside the measure", () => {
  test("nothing to measure: the scan alone, its events untouched, run once", async () => {
    const events: VisionEvent[] = [];
    const runs: unknown[] = [];
    const out = await scanWithMeasuredPlate({
      measure: null,
      onEvent: (e) => events.push(e),
      run: async (plate, emit) => {
        runs.push(plate);
        emit?.({ type: "name", index: 0, name: "nasi" });
        return "first";
      },
    });
    expect(out).toEqual({ value: "first", result: null });
    expect(runs).toEqual([undefined]);
    expect(events).toEqual([{ type: "name", index: 0, name: "nasi" }]);
  });

  test("no card found: the first scan stands and its held events are released in order, run once", async () => {
    const events: VisionEvent[] = [];
    const gate = Promise.withResolvers<CardPlateResult>();
    let runs = 0;
    const pending = scanWithMeasuredPlate({
      measure: gate.promise,
      onEvent: (e) => events.push(e),
      run: async (_plate, emit) => {
        runs++;
        emit?.({ type: "name", index: 0, name: "a" });
        emit?.({ type: "name", index: 1, name: "b" });
        return "first";
      },
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    gate.resolve(none);
    const out = await pending;
    expect(out.value).toBe("first");
    expect(out.plate).toBeUndefined();
    expect(runs).toBe(1);
    expect(events.map((e) => (e.type === "name" ? e.name : e.type))).toEqual(["a", "b"]);
  });

  test("a plate found: the scan runs again with it, the first answer and its events are dropped", async () => {
    const events: VisionEvent[] = [];
    const seen: unknown[] = [];
    const out = await scanWithMeasuredPlate({
      measure: Promise.resolve(measured()),
      onEvent: (e) => events.push(e),
      run: async (plate, emit) => {
        seen.push(plate);
        emit?.({ type: "name", index: 0, name: plate ? "second" : "first" });
        return plate ? "second" : "first";
      },
    });
    expect(out.value).toBe("second");
    expect(out.plate).toEqual({ diameterCm: 24, kind: "flat" });
    expect(seen).toEqual([undefined, { diameterCm: 24, kind: "flat" }]);
    expect(events).toEqual([{ type: "name", index: 0, name: "second" }]);
  });

  test("a verdict that comes after the hold ran out resets what was already shown", async () => {
    const events: VisionEvent[] = [];
    const gate = Promise.withResolvers<CardPlateResult>();
    const holds: Array<() => void> = [];
    const pending = scanWithMeasuredPlate({
      measure: gate.promise,
      onEvent: (e) => events.push(e),
      schedule: (fn) => (holds.push(fn), () => {}),
      run: async (plate, emit) => {
        emit?.({ type: "name", index: 0, name: plate ? "second" : "first" });
        return plate ? "second" : "first";
      },
    });
    await Promise.resolve();
    holds[0]!();
    expect(events.map((e) => (e.type === "name" ? e.name : e.type))).toEqual(["first"]);
    gate.resolve(measured());
    expect((await pending).value).toBe("second");
    expect(events.map((e) => (e.type === "name" ? e.name : e.type))).toEqual(["first", "reset", "second"]);
  });

  test("if the second scan fails the first answer stands", async () => {
    const out = await scanWithMeasuredPlate({
      measure: Promise.resolve(measured()),
      run: async (plate) => {
        if (plate) throw new Error("second failed");
        return "first";
      },
    });
    expect(out).toMatchObject({ value: "first", rescanFailed: true });
    expect(out.plate).toBeUndefined();
  });

  test("a failed first scan: no plate rethrows it, a plate lets the second scan answer", async () => {
    const run = async (plate: unknown) => {
      if (!plate) throw new Error("first failed");
      return "second";
    };
    await expect(scanWithMeasuredPlate({ measure: Promise.resolve(none), run })).rejects.toThrow("first failed");
    expect((await scanWithMeasuredPlate({ measure: Promise.resolve(measured()), run })).value).toBe("second");
  });

  test("a scan that finished does not wait on a measure that stalls: it gives up after the grace", async () => {
    const gate = Promise.withResolvers<CardPlateResult>();
    const graces: Array<() => void> = [];
    const pending = scanWithMeasuredPlate({
      measure: gate.promise,
      schedule: (fn) => (graces.push(fn), () => {}),
      run: async () => "first",
    });
    await Promise.resolve();
    await Promise.resolve();
    graces.at(-1)!();
    const out = await pending;
    expect(out.value).toBe("first");
    expect(out.result?.outcome).toMatchObject({ used: false, skipped: "late" });
    gate.resolve(measured());
  });

  test("a card that was seen but gave no usable diameter changes nothing", async () => {
    const skipped = measured({ used: false, skipped: "implausible_diameter" });
    const out = await scanWithMeasuredPlate({ measure: Promise.resolve(skipped), run: async (plate) => (plate ? "second" : "first") });
    expect(out.value).toBe("first");
  });
});

describe("the plate the card measured in the scan prompt", () => {
  test("plateOf is the diameter and kind only for a used outcome", () => {
    expect(plateOf(measured())).toEqual({ diameterCm: 24, kind: "flat" });
    expect(plateOf(measured({ used: false }))).toBeUndefined();
    expect(plateOf(none)).toBeUndefined();
    expect(plateOf(null)).toBeUndefined();
  });

  test("it is written like a registered plate, after the registered ones, and its label is read back with source card", () => {
    const registered = { id: "d1", name: "Piring makan putih", kind: "flat", diameterCm: 24, widthCm: null, description: "putih polos" } as DishwareRow;
    const alone = buildScanReference([]).withMeasured({ diameterCm: 19.7, kind: "bowl" });
    expect(alone.instruction).toContain('P1: "piring di foto", mangkuk, diameter 19,7 cm');
    expect(alone.plateNote("P1")).toEqual({ status: "matched", id: "card", name: "piring di foto", kind: "bowl", diameterCm: 19.7, widthCm: null, source: "card" });
    expect(alone.plateNote(null)).toEqual({ status: "none" });
    const both = buildScanReference([registered]).withMeasured({ diameterCm: 21, kind: "flat" });
    expect(both.instruction).toContain('P1: "Piring makan putih"');
    expect(both.instruction).toContain('P2: "piring di foto", piring datar, diameter 21 cm');
    expect(both.plateNote("P1")).toMatchObject({ id: "d1" });
    expect(both.plateNote("P2")).toMatchObject({ source: "card", diameterCm: 21 });
    // Without a measurement and without plates nothing is asked about plates, as before.
    expect(buildScanReference([]).plateNote("P1")).toBeUndefined();
    expect(buildScanReference([registered]).plateNote("P1")).not.toHaveProperty("source");
  });
});

describe("cardPlateLedger", () => {
  test("keeps what was seen, the boxes, the diameter, the verdict, the time and the tokens", () => {
    const outcome = measureFromAnswer(answer(), SQUARE);
    const ledger = cardPlateLedger({ outcome, usage: { prompt_tokens: 555 }, ms: 1800 }, { rescanned: true });
    expect(ledger).toMatchObject({
      seen: true,
      card: { box: expect.any(Array), aspect: 1.59 },
      plate: { kind: "flat", box: expect.any(Array) },
      diameterCm: expect.any(Number),
      used: true,
      ms: 1800,
      usage: { prompt_tokens: 555 },
      rescanned: true,
    });
    expect(ledger).not.toHaveProperty("skipped");
  });

  test("a skip keeps its reason; a failed rescan turns used into skipped rescan_failed", () => {
    expect(cardPlateLedger(none)).toMatchObject({ seen: false, used: false, skipped: "no_card" });
    expect(cardPlateLedger(measured(), { rescanned: true, rescanFailed: true })).toMatchObject({ used: false, skipped: "rescan_failed", rescanned: true });
    expect(cardPlateLedger({ ...none, error: "boom", retried: true })).toMatchObject({ error: "boom", retried: true });
  });
});

describe("piece geometry from the card scale", () => {
  const scale = { pxPerCm: 23.36, width: 1000, height: 1000 };
  /** A box of `cm` x `cm` centimetres at a grid position. */
  const box = (y: number, x: number, h: number, w: number): [number, number, number, number] => [y, x, y + (h * 23.36) / 1, x + (w * 23.36) / 1];
  const item = (name: string, grams: number, b?: [number, number, number, number], extra: object = {}) => ({ name, kcal: 100, grams, ...(b ? { box: b } : {}), ...extra });

  test("an isolated egg is sized from its box: 5.5 x 4.5 cm is about 55 g, and replaces the model's 80 g", () => {
    const { items, readings } = applyPieceGeometry([item("telur rebus", 80, box(100, 100, 5.5, 4.5))], scale);
    expect(readings[0]).toMatchObject({ applied: true, lenCm: 5.5, widCm: 4.5 });
    expect(readings[0]!.geoG).toBeGreaterThan(40);
    expect(readings[0]!.geoG).toBeLessThan(60);
    expect(items[0]!.grams).toBe(readings[0]!.geoG!);
  });

  test("outside 0.6-2x of the model's grams the model's number stays", () => {
    const { items, readings } = applyPieceGeometry([item("telur rebus", 150, box(100, 100, 5.5, 4.5))], scale);
    expect(readings[0]).toMatchObject({ applied: false, skip: "window" });
    expect(items[0]!.grams).toBe(150);
  });

  test("an item that other boxes cover by more than 20%, a counted row, a boxless item and a rice row are left alone", () => {
    const egg = item("telur rebus", 50, box(100, 100, 5.5, 4.5));
    const covering = item("sambal", 20, [100, 100, 400, 400]);
    expect(applyPieceGeometry([egg, covering], scale).readings[0]).toMatchObject({ applied: false, skip: "overlap" });
    const lightly = item("sambal", 20, [100, 100 + 4.5 * 23.36 - 5, 400, 600]);
    expect(applyPieceGeometry([egg, lightly], scale).readings[0]!.skip).not.toBe("overlap");
    expect(applyPieceGeometry([item("telur rebus", 150, box(100, 100, 5.5, 4.5), { pieces: { count: 3, unit: "butir", unitGrams: 50 } })], scale).readings[0]!.skip).toBe("counted");
    expect(applyPieceGeometry([item("tempe goreng", 40)], scale).readings[0]!.skip).toBe("no_box");
    expect(applyPieceGeometry([item("nasi putih", 150, [100, 100, 600, 600])], scale).readings[0]!.skip).toBe("not_piece");
  });

  test("tempe, tahu, bakwan and a fried chicken piece count as pieces", () => {
    for (const name of ["tempe goreng", "tahu goreng", "bakwan", "ayam goreng paha"]) {
      expect(applyPieceGeometry([item(name, 60, box(100, 100, 6, 4))], scale).readings[0]!.skip).not.toBe("not_piece");
    }
  });
});
