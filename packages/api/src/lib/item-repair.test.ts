import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ItemScanner, lenientItem, repairKeys, scanItems } from "./item-stream";
import { analyzeFoodPhoto, parseAnswer } from "./vision";
import type { AiRunner } from "./vision";

// Raw Gemma 4 answers (Workers AI REST, 2026-10-17) whose JSON did not parse:
// the `":` after a numeric key replaced by junk (`"protein0,`, `"carbs;">2`,
// `"fat Lap7,`, `"carbs<td>70"`, newline runs, free text), one cut off in a
// newline loop, one answered twice back to back. Before the repair each lost
// the garbled item (or every item after it) and showed "too many".
const fixture = (name: string): string[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8")) as string[];
const FIXTURES = fixture("vision-garbled.json");
const misnamed = fixture("vision-misnamed-keys.json");
const valid = fixture("vision-valid.json");

/** Items the model really wrote: names before a repeated `{"items"` restart. */
function writtenItems(text: string): number {
  const second = text.indexOf('{"items"', 1);
  return (text.slice(0, second === -1 ? undefined : second).match(/"name"\s*:/g) ?? []).length;
}

describe("garbled numeric keys", () => {
  test("every raw failing answer keeps all of its items", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(11);
    for (const text of FIXTURES) {
      const answer = parseAnswer(text, "stop");
      expect(answer.found).toBe(writtenItems(text));
      expect(answer.items.length).toBeGreaterThan(0);
    }
  });

  test("the scanner finds the same items however the text is chunked", () => {
    for (const text of FIXTURES) {
      const whole = scanItems(text);
      const scanner = new ItemScanner();
      const chunked: unknown[] = [];
      for (let i = 0; i < text.length; i += 7) {
        for (const event of scanner.push(text.slice(i, i + 7))) {
          if (event.kind === "item") chunked.push(event.raw);
        }
      }
      for (const event of scanner.end()) if (event.kind === "item") chunked.push(event.raw);
      expect(chunked).toEqual(whole);
      expect(whole).toHaveLength(writtenItems(text));
    }
  });

  test("streamed and plain analysis agree on every fixture", async () => {
    const encoder = new TextEncoder();
    const streaming = (text: string): AiRunner => ({
      run: () => {
        const frames = [text.slice(0, 40), text.slice(40, 333), text.slice(333)].map(
          (content) =>
            `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
        );
        frames.push(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
          "data: [DONE]\n\n",
        );
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const frame of frames) controller.enqueue(encoder.encode(frame));
              controller.close();
            },
          }),
        );
      },
    });
    const plain = (text: string): AiRunner => ({
      run: () =>
        Promise.resolve({ choices: [{ message: { content: text }, finish_reason: "stop" }] }),
    });
    const opts = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };
    for (const text of FIXTURES) {
      const streamed = await analyzeFoodPhoto(streaming(text), { ...opts, onEvent: () => {} });
      const direct = await analyzeFoodPhoto(plain(text), opts);
      expect(streamed.items).toEqual(direct.items);
      expect(streamed.tooMany).toBe(direct.tooMany);
    }
  });

  test("a repaired answer is not flagged too many", () => {
    const complete = FIXTURES.find((text) => text.includes(";\">") && text.trimEnd().endsWith("]}"));
    expect(complete).toBeDefined();
    expect(parseAnswer(complete!, "stop").tooMany).toBe(false);
  });

  test("keys that parse but are misnamed (carbsAT, proteinGene) get their macros back", () => {
    const known = new Set(["name", "kind", "portion", "grams", "kcal", "protein", "carbs", "fat", "fiber", "confidence", "box", "localName"]);
    expect(misnamed.length).toBeGreaterThanOrEqual(5);
    for (const text of misnamed) {
      const before = (JSON.parse(text.replace(/```(?:json)?/g, "")) as { items: object[] }).items;
      expect(before.some((item) => Object.keys(item).some((key) => !known.has(key)))).toBe(true);
      const after = (JSON.parse(repairKeys(text.replace(/```(?:json)?/g, ""))) as { items: object[] }).items;
      expect(after.every((item) => Object.keys(item).every((key) => known.has(key)))).toBe(true);
    }
  });
});

describe("repairKeys", () => {
  test.each([
    ['{"carbs;">2,"fat":2}', '{"carbs":2,"fat":2}'],
    ['{"kcal":5,"protein0,"carbs4}', '{"kcal":5,"protein":0,"carbs":4}'],
    ['{"carbs Lap65,"fat Lap7,"fiber":0}', '{"carbs":65,"fat":7,"fiber":0}'],
    ['{"carbs<td>70","fat<td>20","fiber":1}', '{"carbs":70,"fat":20,"fiber":1}'],
    ['{"protein Gene:12,"fat:20,"fiber":1}', '{"protein":12,"fat":20,"fiber":1}'],
    ['{"carbs成20,"fat":3}', '{"carbs":20,"fat":3}'],
    ['{"kcal":5,"protein Pay,"carbs":70}', '{"kcal":5,"carbs":70}'],
    ['{"kcal":5,"protein Too many, limit 10","carbs":70}', '{"kcal":5,"carbs":70}'],
    ['{"grams\n\n\n50,"kcal\n\n90}', '{"grams":50,"kcal":90}'],
    ['{"fat":1,"box\n\n[1,2,3,4]}', '{"fat":1,"box":[1,2,3,4]}'],
    ['{"carbs|":15,"fat|":5}', '{"carbs":15,"fat":5}'],
    ['{"carbsAT":18,"proteinGene":10,"fat ease":4}', '{"carbs":18,"protein":10,"fat":4}'],
  ])("%j", (garbledText, repaired) => {
    expect(repairKeys(garbledText)).toBe(repaired);
    expect(() => JSON.parse(repairKeys(garbledText))).not.toThrow();
  });

  test("valid answers pass through untouched, including strings that look like keys", () => {
    for (const text of valid) expect(repairKeys(text)).toBe(text);
    const tricky = '{"items":[{"name":"fat 2 \\",\\"fat 5","portion":"kcal 90,","kcal":1}]}';
    expect(repairKeys(tricky)).toBe(tricky);
  });
});

describe("cut-off and unreadable objects", () => {
  test("a last item cut off after its kcal is kept", () => {
    const cut = '{"items":[{"name":"a","kcal":10},{"name":"nasi","grams":60,"kcal":150,"protein\n\n\n\n';
    expect(scanItems(cut)).toEqual([
      { name: "a", kcal: 10 },
      { name: "nasi", grams: 60, kcal: 150 },
    ]);
  });

  test("a cut-off number is not read as a value", () => {
    expect(scanItems('{"items":[{"name":"nasi","kcal":15')).toEqual([]);
  });

  test("lenientItem keeps what it can read and needs a name and a kcal", () => {
    expect(lenientItem('{"name":"x","kcal":50,"protein":???,"box":[1,2,3,4]}')).toEqual({
      name: "x",
      kcal: 50,
      box: [1, 2, 3, 4],
    });
    expect(lenientItem('{"name":"x","kcal":??}')).toBeNull();
  });
});
