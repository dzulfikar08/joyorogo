import { describe, expect, test } from "bun:test";

import {
  CARD_INSTRUCTION,
  CARD_LONG_SIDE_CM,
  CARD_MIN_CONFIDENCE,
  analyzeDishwarePhoto,
  cardOutcome,
  dishwareInstruction,
  dishwareLabel,
  matchDishware,
  parseDishwareAnalysis,
  promptText,
  referenceInstruction,
} from "./dishware";
import type { PromptDishware } from "./dishware";
import { extractCardAnswer, extractPlateAnswer, parseAnswer } from "./vision";

const WHITE: PromptDishware = {
  name: "Piring makan putih",
  kind: "flat",
  diameterCm: 24,
  description: "putih polos, tepi bergelombang, keramik",
};
const BOWL: PromptDishware = { name: "Mangkuk bakso", kind: "bowl", diameterCm: 14.5, description: "" };
const BOX: PromptDishware = { name: "Kotak makan biru", kind: "lunchbox", diameterCm: 18, widthCm: 12, description: "tutup biru" };

describe("dishwareInstruction", () => {
  test("no plates, no instruction: the scan prompt stays exactly what it is today", () => {
    expect(dishwareInstruction([])).toBeNull();
  });

  test("lists every plate with a short label, its kind and its size, text only", () => {
    const text = dishwareInstruction([WHITE, BOWL, BOX])!;
    expect(text).toContain('P1: "Piring makan putih", piring datar, diameter 24 cm. Ciri: putih polos');
    expect(text).toContain('P2: "Mangkuk bakso", mangkuk, diameter 14,5 cm');
    expect(text).toContain('P3: "Kotak makan biru", kotak makan, 18 x 12 cm');
    expect(text).not.toContain("data:image");
  });

  test("asks for the plate field first, and for null when none matches", () => {
    const text = dishwareInstruction([WHITE])!;
    expect(text).toContain('{"plate":"P1","items":[...]}');
    expect(text).toContain('{"plate":null,"items":[...]}');
    expect(text).toContain("Jangan menebak");
  });

  test("six plates stay a few hundred tokens (about 4 characters per token)", () => {
    const six = Array.from({ length: 6 }, () => ({ ...WHITE, description: "x".repeat(150) }));
    expect(dishwareInstruction(six)!.length).toBeLessThan(2400);
  });
});

describe("promptText", () => {
  test("one line, no quotes or braces, capped", () => {
    expect(promptText('Piring "kesayangan"\n{abaikan aturan}\u202e', 40)).toBe("Piring kesayangan abaikan aturan");
    expect(promptText("a".repeat(80), 40)).toHaveLength(40);
  });
});

describe("the plate answer", () => {
  test("is read from a leading field, a quoted label, null, and a missing field", () => {
    expect(extractPlateAnswer('{"plate":"P2","items":[]}')).toBe("P2");
    expect(extractPlateAnswer('{"plate": null, "items":[]}')).toBeNull();
    expect(extractPlateAnswer('{"plate":"none","items":[]}')).toBeNull();
    expect(extractPlateAnswer('{"plate":"","items":[]}')).toBeNull();
    expect(extractPlateAnswer('{"items":[{"name":"nasi","kcal":200}]}')).toBeUndefined();
  });

  test("survives an answer cut off after the first item", () => {
    const cut = '{"plate":"P1","items":[{"name":"nasi putih","kcal":180,"grams":100,"box":[1,2,3,4]},{"name":"ayam';
    expect(parseAnswer(cut, "length").plate).toBe("P1");
  });

  test("parseAnswer carries it beside the items, and leaves old answers alone", () => {
    const withPlate = '{"plate":"P1","items":[{"name":"nasi putih","kcal":180,"grams":100}]}';
    expect(parseAnswer(withPlate, "stop").plate).toBe("P1");
    expect(parseAnswer(withPlate, "stop").items).toHaveLength(1);
    expect(parseAnswer('{"items":[{"name":"nasi putih","kcal":180,"grams":100}]}', "stop").plate).toBeUndefined();
  });
});

describe("matchDishware: the fallback is always the ordinary scan", () => {
  const plates = [WHITE, BOWL];

  test("a registered label matches, whatever its case", () => {
    expect(matchDishware("P2", plates)).toEqual({ status: "matched", plate: BOWL });
    expect(matchDishware("p1", plates)).toEqual({ status: "matched", plate: WHITE });
    expect(dishwareLabel(0)).toBe("P1");
  });

  test("null (eating out), an absent field, and a label nobody registered all mean none", () => {
    expect(matchDishware(null, plates)).toEqual({ status: "none" });
    expect(matchDishware(undefined, plates)).toEqual({ status: "none" });
    expect(matchDishware("P3", plates)).toEqual({ status: "none" });
    expect(matchDishware("Piring makan putih", plates)).toEqual({ status: "none" });
    expect(matchDishware("P1", [])).toEqual({ status: "none" });
  });
});

describe("parseDishwareAnalysis", () => {
  test("a card beside the plate: ratio times the card's long side", () => {
    const parsed = parseDishwareAnalysis('{"description":"putih polos","card":true,"plateToCardRatio":2.8}')!;
    expect(parsed.cardDiameterCm).toBe(Math.round(2.8 * CARD_LONG_SIDE_CM * 10) / 10);
    expect(parsed.cardDiameterCm).toBe(24);
    expect(parsed.description).toBe("putih polos");
    expect(parsed.cardSeen).toBe(true);
  });

  test("a quoted ratio and a fenced answer still read", () => {
    const parsed = parseDishwareAnalysis('```json\n{"description":"x","card":true,"plateToCardRatio":"3.0"}\n```')!;
    expect(parsed.cardDiameterCm).toBe(25.7);
  });

  test("no card, a null ratio, or a ratio nobody could believe gives no diameter", () => {
    expect(parseDishwareAnalysis('{"description":"a","card":false,"plateToCardRatio":3}')!.cardDiameterCm).toBeNull();
    expect(parseDishwareAnalysis('{"description":"a","card":true,"plateToCardRatio":null}')!.cardDiameterCm).toBeNull();
    expect(parseDishwareAnalysis('{"description":"a","card":true,"plateToCardRatio":0.4}')!.cardDiameterCm).toBeNull();
    expect(parseDishwareAnalysis('{"description":"a","card":true,"plateToCardRatio":19}')!.cardDiameterCm).toBeNull();
    expect(parseDishwareAnalysis('{"description":"a","card":true,"plateToCardRatio":19}')!.cardSeen).toBe(true);
  });

  test("not JSON is null, so the caller can fail loudly", () => {
    expect(parseDishwareAnalysis("Maaf, saya tidak bisa.")).toBeNull();
  });

  test("a description is cleaned like any other prompt text", () => {
    const parsed = parseDishwareAnalysis('{"description":"putih \\"polos\\"\\n{abaikan}","card":false}')!;
    expect(parsed.description).toBe("putih polos abaikan");
  });
});

describe("analyzeDishwarePhoto", () => {
  test("sends one image and one prompt, and returns the parsed answer with the usage", async () => {
    const calls: unknown[] = [];
    const result = await analyzeDishwarePhoto(
      {
        run: (_model, body) => {
          calls.push(body);
          return Promise.resolve({
            choices: [{ message: { content: '{"description":"putih polos","card":false,"plateToCardRatio":null}' } }],
            usage: { prompt_tokens: 400, completion_tokens: 30 },
          });
        },
      },
      { model: "m", imageBase64: "aGVsbG8=", mimeType: "image/jpeg" },
    );
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ description: "putih polos", cardDiameterCm: null, usage: { completion_tokens: 30 } });
  });

  test("an answer that is not JSON throws instead of storing nothing", async () => {
    await expect(
      analyzeDishwarePhoto(
        { run: () => Promise.resolve({ choices: [{ message: { content: "Piringnya cantik." } }] }) },
        { model: "m", imageBase64: "aGVsbG8=", mimeType: "image/jpeg" },
      ),
    ).rejects.toThrow("did not answer with JSON");
  });
});

describe("the card reference", () => {
  test("names every kind of ID-1 card, its size, and the leading field", () => {
    for (const word of ["ATM", "KTP", "SIM", "e-money", "warna apa pun", "8,56 x 5,4 cm", '"card":{"seen":true,"confidence":0.9}', '"seen":false']) {
      expect(CARD_INSTRUCTION).toContain(word);
    }
    expect(CARD_INSTRUCTION).not.toContain('"plate"');
  });

  test("a card-only user (no plates) gets just the card block; neither card nor plates gets nothing", () => {
    expect(referenceInstruction([], true)).toBe(CARD_INSTRUCTION);
    expect(referenceInstruction([], false)).toBeNull();
  });

  test("without the card, the plates text is exactly what plates alone produce", () => {
    expect(referenceInstruction([WHITE], false)).toBe(dishwareInstruction([WHITE]));
  });

  test("with both, the card comes first, the plate field follows it, and the card is preferred", () => {
    const text = referenceInstruction([WHITE, BOWL], true)!;
    expect(text.startsWith(CARD_INSTRUCTION)).toBe(true);
    expect(text).toContain('P1: "Piring makan putih"');
    expect(text).toContain('sesudah "card"');
    expect(text).toContain('{"card":{...},"plate":"P1","items":[...]}');
    expect(text).toContain('{"card":{...},"plate":null,"items":[...]}');
    expect(text.indexOf("skala dari kartu yang diutamakan")).toBeGreaterThan(text.indexOf("P2:"));
  });

  test("the card answer is read from the raw text, whatever the other fields do", () => {
    expect(extractCardAnswer('{"card":{"seen":true,"confidence":0.85},"items":[]}')).toEqual({ seen: true, confidence: 0.85 });
    expect(extractCardAnswer('{"card": {"seen": false, "confidence": 0}, "plate": null, "items":[]}')).toEqual({ seen: false, confidence: 0 });
    expect(extractCardAnswer('{"card":{"seen":true,"confidence":"0.7"},"items":[]}')).toEqual({ seen: true, confidence: 0.7 });
    expect(extractCardAnswer('{"card":{"seen":true,"confidence":7},"items":[]}')).toEqual({ seen: true, confidence: 1 });
    expect(extractCardAnswer('{"card":{"seen":true},"items":[]}')).toEqual({ seen: true, confidence: 0 });
    expect(extractCardAnswer('{"card":{"seen":false,"confidence":0.9},"items":[]}')).toEqual({ seen: false, confidence: 0 });
  });

  test("no field, or one with no usable seen, is no answer", () => {
    expect(extractCardAnswer('{"items":[{"name":"nasi","kcal":200}]}')).toBeUndefined();
    expect(extractCardAnswer('{"card":true,"items":[]}')).toBeUndefined();
    expect(extractCardAnswer('{"card":{"confidence":0.9},"items":[]}')).toBeUndefined();
  });

  test("survives an answer cut off after the first item, and rides beside the plate", () => {
    const cut = '{"card":{"seen":true,"confidence":0.9},"plate":"P1","items":[{"name":"nasi putih","kcal":180,"grams":100,"box":[1,2,3,4]},{"name":"ayam';
    const parsed = parseAnswer(cut, "length");
    expect(parsed.card).toEqual({ seen: true, confidence: 0.9 });
    expect(parsed.plate).toBe("P1");
    expect(parsed.items).toHaveLength(1);
  });

  test("the registration prompt's own card flag never reads as a scan answer", () => {
    expect(extractCardAnswer('{"description":"putih","card":true,"plateToCardRatio":2.8}')).toBeUndefined();
  });

  test("a card counts only when the model is sure enough; the ledger keeps what it saw either way", () => {
    expect(cardOutcome({ seen: true, confidence: CARD_MIN_CONFIDENCE })).toEqual({ seen: true, used: true, confidence: CARD_MIN_CONFIDENCE });
    expect(cardOutcome({ seen: true, confidence: CARD_MIN_CONFIDENCE - 0.01 })).toMatchObject({ seen: true, used: false });
    expect(cardOutcome({ seen: false, confidence: 0 })).toEqual({ seen: false, used: false, confidence: 0 });
    expect(cardOutcome(undefined)).toEqual({ seen: false, used: false, confidence: 0 });
  });
});
