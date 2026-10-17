import { describe, expect, test } from "bun:test";

import { ItemScanner, scanItems } from "./item-stream";
import type { ItemScanEvent } from "./item-stream";

const ANSWER =
  '{"items":[{"name":"nasi goreng","kind":"makanan","kcal":350,"box":[10,20,300,400]},' +
  '{"name":"telur \\"mata\\" sapi","kind":"makanan","kcal":90,"box":[0,0,100,100]}],"tooMany":false}';

/** Every event of `text` pushed in pieces of `size` characters. */
function pushAll(text: string, size: number, needLocalName = false): ItemScanEvent[] {
  const scanner = new ItemScanner(needLocalName);
  const events: ItemScanEvent[] = [];
  for (let i = 0; i < text.length; i += size) events.push(...scanner.push(text.slice(i, i + size)));
  return events;
}

const items = (events: ItemScanEvent[]) =>
  events.flatMap((event) => (event.kind === "item" ? [event.raw] : []));

describe("ItemScanner", () => {
  test("one push and character-by-character pushes find the same items", () => {
    const whole = items(pushAll(ANSWER, ANSWER.length));
    expect(whole).toHaveLength(2);
    expect(items(pushAll(ANSWER, 1))).toEqual(whole);
    expect(items(pushAll(ANSWER, 7))).toEqual(whole);
    expect(whole[1]).toMatchObject({ name: 'telur "mata" sapi', kcal: 90 });
  });

  test("a name is reported once its string closes, before the item is complete", () => {
    const scanner = new ItemScanner();
    expect(scanner.push('{"items":[{"name":"nasi go')).toEqual([]);
    expect(scanner.push('reng","kind":"makan')).toEqual([
      { kind: "name", index: 0, name: "nasi goreng" },
    ]);
    expect(scanner.push('an","kcal":3')).toEqual([]);
    const done = scanner.push('50}');
    expect(done).toEqual([{ kind: "item", index: 0, raw: { name: "nasi goreng", kind: "makanan", kcal: 350 } }]);
    // the next object gets its own name event with the next index
    expect(scanner.push(',{"name":"teh","kc')).toEqual([{ kind: "name", index: 1, name: "teh" }]);
    expect(scanner.push('al":10}')).toEqual([
      { kind: "item", index: 1, raw: { name: "teh", kcal: 10 } },
    ]);
  });

  test("a name that arrives with its closing brace in one chunk gives only the item", () => {
    const events = new ItemScanner().push('{"items":[{"name":"teh","kcal":10}]}');
    expect(events.map((event) => event.kind)).toEqual(["item"]);
  });

  test("an escaped quote does not end the name early", () => {
    const scanner = new ItemScanner();
    expect(scanner.push('{"items":[{"name":"sate \\')).toEqual([]);
    expect(scanner.push('"manis\\" ayam","kcal":1')).toEqual([
      { kind: "name", index: 0, name: 'sate "manis" ayam' },
    ]);
  });

  test("with needLocalName the name event waits for the localName", () => {
    const scanner = new ItemScanner(true);
    expect(scanner.push('{"items":[{"name":"nasi goreng","kind":"makanan"')).toEqual([]);
    expect(scanner.push(',"localName":"Fried rice","kcal":1')).toEqual([
      { kind: "name", index: 0, name: "nasi goreng", localName: "Fried rice" },
    ]);
  });

  test("a malformed object is skipped but still takes an index", () => {
    const events = pushAll('{"items":[{"name":"a","kcal":1},{"name":"b","kcal":},{"name":"c","kcal":3}]}', 5);
    const found = events.flatMap((event) => (event.kind === "item" ? [[event.index, event.raw]] : []));
    expect(found).toEqual([
      [0, { name: "a", kcal: 1 }],
      [2, { name: "c", kcal: 3 }],
    ]);
  });

  test("braces inside strings do not close or open an item", () => {
    const text = '{"items":[{"name":"a } b","portion":"{x","kcal":5}]}';
    expect(items(pushAll(text, 3))).toEqual([{ name: "a } b", portion: "{x", kcal: 5 }]);
  });

  test("the items key can be split across chunks and fences before it are ignored", () => {
    const text = '```json\n{"it' + 'ems": [{"name":"a","kcal":1}]}\n```';
    expect(items(pushAll(text, 4))).toEqual([{ name: "a", kcal: 1 }]);
  });

  test("an unfinished last object is dropped and nothing after the closing bracket counts", () => {
    expect(scanItems('{"items":[{"name":"a","kcal":1},{"name":"b","kc')).toEqual([
      { name: "a", kcal: 1 },
    ]);
    const scanner = new ItemScanner();
    scanner.push('{"items":[{"name":"a","kcal":1}],"extra":[{"name":"z","kcal":9}]}');
    expect(scanner.done).toBe(true);
    expect(scanner.push('{"name":"q","kcal":1}')).toEqual([]);
  });

  test("text without an items array yields nothing", () => {
    expect(pushAll("bukan json", 3)).toEqual([]);
  });
});
