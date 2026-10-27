import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lenientItem, scanItems } from "./item-stream";
import { ALT_MIN_KCAL_SHARE, carryAlternates, MAX_ALTERNATES, normalizeAlternates, withMaterialAlternates } from "./name-alternates";
import { ALT_RULE, ALT_SHAPE, parseAnswer, previewItem, visionPrompt } from "./vision";

describe("normalizeAlternates", () => {
  test("keeps up to two names, trimmed", () => {
    expect(normalizeAlternates([" nasi uduk ", "nasi  liwet", "nasi kebuli"], "nasi kuning")).toEqual([
      "nasi uduk",
      "nasi liwet",
    ]);
    expect(MAX_ALTERNATES).toBe(2);
  });

  test("drops the item's own name (any spelling), repeats, blanks and non-text", () => {
    expect(
      normalizeAlternates(["Nasi Kuning.", "nasi-uduk", "NASI UDUK", "", "  ", 7, null, { a: 1 }, ["x"]], "nasi kuning"),
    ).toEqual(["nasi-uduk"]);
    expect(normalizeAlternates(["nasi putih"], "nasi", "nasi putih")).toBeUndefined();
  });

  test("a broader name for the same item is no alternate, a more specific one is", () => {
    expect(normalizeAlternates(["nasi", "Putih nasi", "nasi uduk", "nasi putih polos"], "nasi putih")).toEqual([
      "nasi uduk",
      "nasi putih polos",
    ]);
    expect(normalizeAlternates(["martabak"], "martabak telur")).toBeUndefined();
  });

  test("a lone string is one or more names; anything else is none", () => {
    expect(normalizeAlternates("nasi uduk")).toEqual(["nasi uduk"]);
    expect(normalizeAlternates("nasi uduk | nasi liwet, nasi kebuli")).toEqual(["nasi uduk", "nasi liwet"]);
    for (const bad of [undefined, null, 5, true, {}, [], [[]], [""]]) {
      expect(normalizeAlternates(bad, "x")).toBeUndefined();
    }
  });

  test("a long name is cut at 80 characters", () => {
    expect(normalizeAlternates(["a".repeat(200)])![0]).toHaveLength(80);
  });
});

describe("withMaterialAlternates", () => {
  test("rows under the kcal share lose their chips, the rest keep them", () => {
    const items = [
      { name: "nasi kuning", kcal: 320, alt: ["nasi uduk"] },
      { name: "telur rebus", kcal: 77, alt: ["telur ayam"] },
      { name: "kerupuk", kcal: 20, alt: ["emping"] },
      { name: "tempe", kcal: 90 },
    ];
    const out = withMaterialAlternates(items);
    expect(out.map((i) => i.alt)).toEqual([["nasi uduk"], ["telur ayam"], undefined, undefined]);
    expect("alt" in out[2]!).toBe(false);
    expect(77 / 507).toBeGreaterThanOrEqual(ALT_MIN_KCAL_SHARE);
    expect(20 / 507).toBeLessThan(ALT_MIN_KCAL_SHARE);
  });

  test("a single item and an all-zero list keep theirs", () => {
    expect(withMaterialAlternates([{ name: "a", kcal: 50, alt: ["b"] }])[0]!.alt).toEqual(["b"]);
    expect(withMaterialAlternates([{ name: "teh", kcal: 0, alt: ["kopi"] }])[0]!.alt).toEqual(["kopi"]);
  });
});

describe("carryAlternates", () => {
  const sent = [
    { name: "nasi kuning", alt: ["nasi uduk", "nasi liwet"] },
    { name: "telur dadar", alt: ["omelet"] },
    { name: "kerupuk" },
  ];
  const answer = (
    items: Array<{ name: string; alt?: string[] }>,
    origins: Array<number | null>,
    changes: Array<{ index: number; kind: string }>,
  ) => ({ items, origins, changes, removed: [] as string[] });

  test("rows the correction left alone keep their alternates", () => {
    const out = carryAlternates(
      answer([{ name: "nasi kuning" }, { name: "telur dadar" }, { name: "kerupuk" }], [0, 1, 2], []),
      sent,
    );
    expect(out.items.map((i) => i.alt)).toEqual([["nasi uduk", "nasi liwet"], ["omelet"], undefined]);
  });

  test("a tapped row offers the name it replaced and the other alternate", () => {
    const out = carryAlternates(
      answer([{ name: "nasi uduk" }, { name: "telur dadar" }], [0, 1], [{ index: 0, kind: "renamed" }]),
      sent,
      { index: 0, name: "nasi uduk" },
    );
    expect(out.items[0]!.alt).toEqual(["nasi kuning", "nasi liwet"]);
    expect(out.items[1]!.alt).toEqual(["omelet"]);
  });

  test("a row renamed by typing, or added, has none; a removed row shifts the origins", () => {
    const out = carryAlternates(
      answer(
        [{ name: "nasi goreng" }, { name: "kerupuk" }, { name: "sambal" }],
        [0, 2, null],
        [{ index: 0, kind: "renamed" }, { index: 2, kind: "added" }],
      ),
      sent,
    );
    expect(out.items.map((i) => i.alt)).toEqual([undefined, undefined, undefined]);
  });

  test("alternates the answer already carries are not replaced, and the rest of the answer is untouched", () => {
    const out = carryAlternates(
      { ...answer([{ name: "nasi kuning", alt: ["jagung"] }], [0], []), transcript: "t" },
      sent,
    );
    expect(out.items[0]!.alt).toEqual(["jagung"]);
    expect(out.transcript).toBe("t");
  });
});

describe("alternates in the scan answer", () => {
  const item = (extra: Record<string, unknown>) => ({
    name: "nasi kuning",
    kind: "makanan",
    portion: "satu piring",
    grams: 200,
    kcal: 320,
    confidence: 0.8,
    box: [100, 100, 700, 700],
    ...extra,
  });
  const parse = (items: unknown[]) => parseAnswer(JSON.stringify({ items }), "stop");

  test("alt reaches the item, cleaned", () => {
    const { items } = parse([item({ alt: ["nasi uduk", "Nasi Kuning", "nasi liwet", "nasi kebuli"] })]);
    expect(items[0]!.alt).toEqual(["nasi uduk", "nasi liwet"]);
  });

  test("no alt, an empty alt and a garbled alt all give an item without the key", () => {
    for (const extra of [{}, { alt: [] }, { alt: null }, { alt: "" }, { alt: 5 }, { alt: [1, {}] }, { alt: {} }]) {
      const { items, found } = parse([item(extra)]);
      expect(found).toBe(1);
      expect(items).toHaveLength(1);
      expect("alt" in items[0]!).toBe(false);
    }
  });

  test("a small row of the plate gets no chips", () => {
    const { items } = parse([item({ alt: ["nasi uduk"] }), { name: "kerupuk", kcal: 20, grams: 8, alt: ["emping"] }]);
    expect(items[0]!.alt).toEqual(["nasi uduk"]);
    expect("alt" in items[1]!).toBe(false);
  });

  test("a bad alt never changes the numbers or sinks the item", () => {
    const plain = parse([item({})]).items[0]!;
    const withAlt = parse([item({ alt: [{ x: 1 }, 3, "nasi uduk"] })]).items[0]!;
    const { alt, ...rest } = withAlt;
    expect(alt).toEqual(["nasi uduk"]);
    expect(rest).toEqual(plain);
  });

  test("alt that names the dish the library renamed the item to is dropped", () => {
    const { items } = parse([{ name: "white rice", kcal: 260, grams: 200, alt: ["nasi putih", "nasi uduk"] }]);
    expect(items[0]!.name).toBe("nasi putih");
    expect(items[0]!.alt).toEqual(["nasi uduk"]);
  });

  test("a hidden cup has no alternates", () => {
    const { items } = parse([{ name: "Coca-Cola", kind: "minuman", cup: "M", kcal: 0, alt: ["Pepsi"] }]);
    expect(items[0]!.cup).toBeDefined();
    expect("alt" in items[0]!).toBe(false);
  });

  test("the streamed preview carries alt like the final parse", () => {
    expect(previewItem(item({ alt: ["nasi uduk"] }))!.alt).toEqual(["nasi uduk"]);
  });

  test("an answer cut off after the last alt, or inside it, keeps the item", () => {
    const whole = '{"items":[{"name":"nasi kuning","kcal":320,"grams":200,"box":[10,10,500,500],"alt":["nasi uduk","nasi liwet"]},{"name":"telur","kcal":90,"grams":50,"box":[10,10,500,500],"alt":["nasi';
    const answer = parseAnswer(whole, "length");
    expect(answer.items.map((i) => i.name)).toEqual(["nasi kuning", "telur"]);
    expect(answer.items[0]!.alt).toEqual(["nasi uduk", "nasi liwet"]);
    expect(answer.items[1]!.alt).toBeUndefined();
    expect(answer.tooMany).toBe(true);
  });

  test("lenientItem reads a complete alt array and nothing else", () => {
    expect(lenientItem('{"name":"a","kcal":10,"alt":["b","c"]')).toMatchObject({ alt: ["b", "c"] });
    expect(lenientItem('{"name":"a","kcal":10,"alt":["b","c"')).not.toHaveProperty("alt");
    expect(lenientItem('{"name":"a","kcal":10,"alt":[]}')).toMatchObject({ alt: [] });
  });

  test("a garbled numeric key before alt does not swallow it", () => {
    const text = '{"items":[{"name":"nasi kuning","kcal":320,"protein Too many items, limit 10","grams":200,"box":[1,1,500,500],"alt":["nasi uduk"]}]}';
    const items = scanItems(text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "nasi kuning", grams: 200, alt: ["nasi uduk"] });
  });
});

// The scale readout inside the scan prompt once broke the item's keys (docs/scale-readout.md). Every raw answer the
// repair tests keep, with `alt` written into every item (after the name, then after the box), must parse to the
// same items with the same numbers as without it: the chips may never cost an item.
describe("alt on the real raw answers", () => {
  const fixture = (name: string): string[] =>
    JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8")) as string[];
  const all = ["vision-valid.json", "vision-garbled.json", "vision-misnamed-keys.json", "vision-quoted.json"].flatMap(fixture);
  const ALT = ',"alt":["nasi uduk","nasi liwet"]';
  const afterName = (text: string) => text.replace(/("name"\s*:\s*"[^"]*")/g, `$1${ALT}`);
  const afterBox = (text: string) => text.replace(/("box"\s*:\s*\[[^\]]*\])/g, `$1${ALT}`);
  const numbers = (text: string) => {
    const { items, found, tooMany } = parseAnswer(text, "stop");
    return { found, tooMany, items: items.map(({ name, grams, kcal }) => ({ name, grams, kcal })) };
  };

  test("there are real answers to try", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.some((text) => afterBox(text) !== text)).toBe(true);
  });

  test("the same items and numbers with alt after the name and after the box", () => {
    for (const text of all) {
      const plain = numbers(text);
      expect(numbers(afterName(text))).toEqual(plain);
      expect(numbers(afterBox(text))).toEqual(plain);
    }
  });

  test("alt is read on the answers that carry a whole box", () => {
    let withChips = 0;
    for (const text of all) {
      for (const item of parseAnswer(afterBox(text), "stop").items) {
        if (item.alt) {
          expect(item.alt.length).toBeLessThanOrEqual(2);
          withChips += 1;
        }
      }
    }
    expect(withChips).toBeGreaterThan(20);
  });
});

describe("the prompt", () => {
  test("asks for alt, last key of the item, with its rule", () => {
    const prompt = visionPrompt();
    expect(prompt).toContain(`"box":[ymin,xmin,ymax,xmax]${ALT_SHAPE}}`);
    expect(prompt).toContain(ALT_RULE);
  });
});
