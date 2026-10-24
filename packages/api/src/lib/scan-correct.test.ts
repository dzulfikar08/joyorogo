import { describe, expect, test } from "bun:test";

import {
  CorrectionError,
  applyCorrection,
  correctScanItems,
  correctionPrompt,
} from "./scan-correct";
import type { CorrectionItemInput } from "./scan-correct";

const plate: CorrectionItemInput[] = [
  { name: "nasi putih", portion: "1 piring", grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.4, kind: "makanan", box: [100, 100, 500, 500] },
  { name: "perkedel", portion: "1 buah", grams: 60, kcal: 130, protein: 3, carbs: 12, fat: 8, kind: "makanan", box: [100, 500, 400, 900] },
  { name: "ayam goreng", portion: "1 potong", grams: 80, kcal: 240, protein: 20, carbs: 6, fat: 15, kind: "makanan" },
  { name: "sambal", portion: "1 sdm", grams: 20, kcal: 25, kind: "makanan" },
];

const ops = (...list: unknown[]) => JSON.stringify({ ops: list });

describe("applyCorrection: the weight includes the container (wadah)", () => {
  const soto: CorrectionItemInput[] = [
    { name: "soto daging", grams: 668, kcal: 418, protein: 25, carbs: 15, fat: 22, kind: "makanan" },
  ];

  test("the bowl's grams come off the weighed soto, not a rename that keeps 668 g", () => {
    const patch = applyCorrection(soto, ops({ op: "wadah", grams: 350 }));
    expect(patch.items[0]?.name).toBe("soto daging");
    expect(patch.items[0]?.grams).toBeCloseTo(318, 0);
    expect(patch.items[0]!.kcal).toBeLessThan(418);
    expect(patch.changes).toEqual([{ index: 0, kind: "portion" }]);
  });

  test("on a plate the food rows share the container in their proportions; the drink is left alone", () => {
    const meal: CorrectionItemInput[] = [
      { name: "nasi putih", grams: 300, kcal: 390, kind: "makanan" },
      { name: "ayam goreng", grams: 100, kcal: 260, kind: "makanan" },
      { name: "es teh manis", grams: 250, kcal: 90, kind: "minuman" },
    ];
    const patch = applyCorrection(meal, ops({ op: "wadah", grams: 200 }));
    expect(patch.items[0]?.grams).toBeCloseTo(150, 0);
    expect(patch.items[1]?.grams).toBeCloseTo(50, 0);
    expect(patch.items[2]).toMatchObject({ grams: 250, kcal: 90 });
  });

  test("a container as heavy as the food (or no number) changes nothing", () => {
    expect(() => applyCorrection(soto, ops({ op: "wadah", grams: 660 }))).toThrow(CorrectionError);
    expect(() => applyCorrection(soto, ops({ op: "wadah" }))).toThrow(CorrectionError);
  });

  test("a rename to the same dish beside the container does not re-price the soto", () => {
    const patch = applyCorrection(
      soto,
      ops({ op: "rename", i: 1, name: "Soto Daging", grams: 668, kcal100: 120 }, { op: "wadah", grams: 380 }),
    );
    expect(patch.items[0]?.grams).toBeCloseTo(288, 0);
    expect(patch.changes).toEqual([{ index: 0, kind: "portion" }]);
  });
});

describe("applyCorrection", () => {
  test("rename swaps the dish, keeps the box and leaves other items byte-identical", () => {
    const patch = applyCorrection(
      plate,
      ops({ op: "rename", i: 2, name: "rolade", kcal: 170, grams: 60, protein: 8, carbs: 9, fat: 10 }),
    );
    expect(patch.items.map((i) => i.name)).toEqual(["nasi putih", "rolade", "ayam goreng", "sambal"]);
    expect(patch.items[1]?.kcal).toBe(170);
    expect(patch.items[1]?.box).toEqual([100, 500, 400, 900]);
    // Untouched rows are the exact objects' data, not recalibrated.
    expect(patch.items[0]).toMatchObject({ name: "nasi putih", kcal: 195, grams: 150, protein: 4, portion: "1 piring" });
    expect(patch.items[3]).toMatchObject({ name: "sambal", kcal: 25 });
    expect(patch.changes).toEqual([{ index: 1, kind: "renamed" }]);
    expect(patch.origins).toEqual([0, 1, 2, 3]);
    expect(patch.removed).toEqual([]);
  });

  test("a rename that states no weight does not carry the old one", () => {
    const patch = applyCorrection(plate, ops({ op: "rename", i: 3, name: "ayam bakar" }));
    expect(patch.items[2]?.name).toBe("ayam bakar");
    expect(patch.items[2]?.grams).not.toBe(80);
    expect(patch.items[2]?.portion).toBeUndefined();
  });

  test("a rename takes the weight re-estimated for the new food, not the old 250 g", () => {
    const milk: CorrectionItemInput[] = [{ name: "susu plastik", portion: "1 bungkus", grams: 250, kcal: 150, kind: "minuman" }];
    const patch = applyCorrection(milk, ops({ op: "rename", i: 1, name: "putih telur rebus", grams: 100, kcal100: 52 }));
    expect(patch.items[0]).toMatchObject({ name: "putih telur rebus", grams: 100, kcal: 52 });
    expect(patch.items[0]?.grams).not.toBe(milk[0]!.grams);
    expect(patch.items[0]?.portion).toBeUndefined();
  });

  test("nasi putih renamed nasi konjac keeps the heap and takes the library's kcal, not the model's rice figure", () => {
    const patch = applyCorrection(plate, ops({ op: "rename", i: 1, name: "nasi konjac", kcal100: 130 }));
    expect(patch.items[0]).toMatchObject({ name: "nasi konjac", grams: 150, kcal: 105 });
    const pure = applyCorrection(plate, ops({ op: "rename", i: 1, name: "shirataki rice" }));
    expect(pure.items[0]).toMatchObject({ grams: 150, kcal: 23 });
  });

  test("a rename with a stated amount honours it exactly", () => {
    const milk: CorrectionItemInput[] = [{ name: "susu plastik", grams: 250, kcal: 150, kind: "minuman" }];
    const patch = applyCorrection(milk, ops({ op: "rename", i: 1, name: "putih telur rebus", grams: 2 * 33, kcal100: 52 }));
    expect(patch.items[0]).toMatchObject({ grams: 66, kcal: 34.3 });
  });

  test("a pure portion correction still scales the old weight", () => {
    const rice = applyCorrection(plate, ops({ op: "portion", i: 1, scale: 0.5 })).items[0]!;
    expect(rice).toMatchObject({ name: "nasi putih", grams: 75 });
  });

  describe("a rename recomputes kcal for the new dish at the kept weight", () => {
    test("TKPI library hit with no model figure uses the library, not the old dish's kcal", () => {
      // perkedel 60 g / 130 kcal -> rendang (library 290 kcal/100 g): 174 kcal at 60 g.
      const patch = applyCorrection(plate, ops({ op: "rename", i: 2, name: "rendang", grams: 60 }));
      expect(patch.items[1]).toMatchObject({ name: "rendang", grams: 60, kcal: 174, matched: true });
      expect(patch.items[1]?.kcal).not.toBe(130);
      // Macros described the old dish and are not carried over.
      expect(patch.items[1]?.protein).toBeUndefined();
    });

    test("TKPI miss scales the model's per-100 g estimate to the item's weight", () => {
      const patch = applyCorrection(
        plate,
        ops({ op: "rename", i: 2, name: "rolade", grams: 60, kcal100: 250, protein100: 15, carbs100: 10, fat100: 17 }),
      );
      expect(patch.items[1]).toMatchObject({ name: "rolade", grams: 60, kcal: 150, matched: false });
      expect(patch.items[1]?.protein).toBe(9);
      expect(patch.items[1]?.fat).toBe(10.2);
    });

    test("model and library disagree: the higher figure wins, never under-counting", () => {
      // library nasi goreng 108 kcal at 60 g vs a model guess of 70.
      const low = applyCorrection(plate, ops({ op: "rename", i: 2, name: "nasi goreng", grams: 60, kcal100: 117 }));
      expect(low.items[1]?.kcal).toBe(108);
      // model above the library is kept (inside the band for that portion).
      const high = applyCorrection(plate, ops({ op: "rename", i: 2, name: "nasi goreng", grams: 60, kcal100: 250 }));
      expect(high.items[1]?.kcal).toBe(150);
    });

    test("a stated weight replaces the old one before scaling", () => {
      const patch = applyCorrection(
        plate,
        ops({ op: "rename", i: 2, name: "rolade", grams: 100, kcal100: 250 }),
      );
      expect(patch.items[1]).toMatchObject({ grams: 100, kcal: 250 });
    });

    test("with no figure from the model or the library the old kcal stays for calibration to bound", () => {
      const patch = applyCorrection(plate, ops({ op: "rename", i: 2, name: "rolade" }));
      expect(patch.items[1]?.grams).toBeUndefined();
      expect(patch.items[1]?.kcal).toBe(130);
    });

    test("with a stated weight and no figure at all the old kcal scales with the weight", () => {
      // perkedel 60 g / 130 kcal -> "rolade" at a weighed 120 g: 260, not 130.
      const patch = applyCorrection(plate, ops({ op: "rename", i: 2, name: "rolade", grams: 120 }));
      expect(patch.items[1]).toMatchObject({ grams: 120, kcal: 260 });
    });
  });

  test("half the rice scales kcal and macros, and the TKPI band follows the portion", () => {
    const patch = applyCorrection(plate, ops({ op: "portion", i: 1, scale: 0.5 }));
    const rice = patch.items[0]!;
    expect(rice.grams).toBe(75);
    // 97.5 kcal (library 130 /100 g, rounded): a plain 150-350 band would have clamped this up to 150.
    expect(rice.kcal).toBe(98);
    expect(rice.carbs).toBeCloseTo(21, 0);
    expect(rice.portion).toBe("75 g");
    expect(rice.matched).toBe(true);
    expect(patch.changes).toEqual([{ index: 0, kind: "portion" }]);
  });

  test("absolute grams set the weight and scale kcal by the ratio", () => {
    const patch = applyCorrection(plate, ops({ op: "portion", i: 3, grams: 160 }));
    expect(patch.items[2]?.grams).toBe(160);
    expect(patch.items[2]?.kcal).toBe(480);
  });

  describe("piece counts", () => {
    const snacks: CorrectionItemInput[] = [
      { name: "pisang goreng", portion: "5 pcs", grams: 250, kcal: 500, protein: 5, carbs: 70, fat: 22, kind: "camilan" },
      { name: "teh manis", portion: "1 gelas", grams: 250, kcal: 90, kind: "minuman" },
    ];

    test("'cuma 2' of 5 pcs is 2 pieces, kcal and macros scaled to 2/5", () => {
      const patch = applyCorrection(snacks, ops({ op: "portion", i: 1, count: 2 }));
      expect(patch.items[0]).toMatchObject({ portion: "2 pcs", grams: 100, kcal: 200, protein: 2, carbs: 28, fat: 8.8 });
      expect(patch.changes).toEqual([{ index: 0, kind: "portion" }]);
      expect(patch.items[1]).toEqual(expect.objectContaining({ name: "teh manis", kcal: 90 }));
    });

    test("the count in the dish name follows the new number", () => {
      const named = [{ name: "pisang goreng 5 pcs", grams: 250, kcal: 500 }];
      const patch = applyCorrection(named, ops({ op: "portion", i: 1, count: 2 }));
      expect(patch.items[0]).toMatchObject({ name: "pisang goreng 2 pcs", portion: "2 pcs", kcal: 200 });
    });

    test("a model that answers grams: 2 for the count still gets 2 pieces, not 2 g", () => {
      const patch = applyCorrection(snacks, ops({ op: "portion", i: 1, grams: 2 }));
      expect(patch.items[0]).toMatchObject({ portion: "2 pcs", grams: 100, kcal: 200 });
    });

    test("a real weight is still a weight", () => {
      const patch = applyCorrection(snacks, ops({ op: "portion", i: 1, grams: 100 }));
      expect(patch.items[0]).toMatchObject({ grams: 100, kcal: 200 });
      expect(patch.items[0]?.portion).toBe("100 g");
    });

    test("a count on an item that is not counted by piece falls back to its other fields", () => {
      const patch = applyCorrection(snacks, ops({ op: "portion", i: 2, count: 2, scale: 0.5 }));
      expect(patch.items[1]).toMatchObject({ kcal: 38, grams: 125 });
    });

    test("eating more than listed scales up", () => {
      const patch = applyCorrection(snacks, ops({ op: "portion", i: 1, count: 7 }));
      expect(patch.items[0]).toMatchObject({ portion: "7 pcs", kcal: 700 });
    });

    test("end to end: the user says 'yang dimakan cuma 2' and the model's count op patches the list", async () => {
      let prompt = "";
      const ai = {
        async run(_model: string, input: unknown) {
          prompt = (input as { messages: Array<{ content: string }> }).messages[0]!.content;
          return { response: ops({ op: "portion", i: 1, count: 2 }) };
        },
      };
      const run = await correctScanItems(ai, { items: snacks, text: "yang dimakan cuma 2" });
      expect(prompt).toContain("1. pisang goreng | 5 pcs | 500 kkal");
      expect(prompt).toContain("yang dimakan cuma 2");
      expect(prompt).toContain('"count"');
      expect(run.patch.items[0]).toMatchObject({ portion: "2 pcs", kcal: 200 });
    });
  });

  test("remove drops the item and reports its name", () => {
    const patch = applyCorrection(plate, ops({ op: "remove", i: 4 }));
    expect(patch.items.map((i) => i.name)).toEqual(["nasi putih", "perkedel", "ayam goreng"]);
    expect(patch.removed).toEqual(["sambal"]);
    expect(patch.origins).toEqual([0, 1, 2]);
    expect(patch.changes).toEqual([]);
  });

  test("add appends a calibrated item with no origin or box", () => {
    const patch = applyCorrection(
      plate,
      ops({ op: "add", name: "es teh manis", kind: "minuman", portion: "1 gelas", grams: 250, kcal: 90 }),
    );
    expect(patch.items).toHaveLength(5);
    const added = patch.items[4]!;
    expect(added.name).toBe("es teh manis");
    expect(added.kind).toBe("minuman");
    expect(added.matched).toBe(true);
    expect(added.box).toBeUndefined();
    expect(patch.origins[4]).toBeNull();
    expect(patch.changes).toEqual([{ index: 4, kind: "added" }]);
  });

  test("several ops in one correction, indices counted against the list that was sent", () => {
    const patch = applyCorrection(
      plate,
      ops(
        { op: "portion", i: 1, scale: 0.5 },
        { op: "remove", i: 4 },
        { op: "add", name: "kerupuk", grams: 15, kcal: 70 },
      ),
    );
    expect(patch.items.map((i) => i.name)).toEqual(["nasi putih", "perkedel", "ayam goreng", "kerupuk"]);
    expect(patch.origins).toEqual([0, 1, 2, null]);
    expect(patch.changes).toEqual([
      { index: 0, kind: "portion" },
      { index: 3, kind: "added" },
    ]);
  });

  test("an unknown reference changes nothing and says so", () => {
    expect(() => applyCorrection(plate, ops({ op: "remove", i: 9 }))).toThrow(CorrectionError);
    try {
      applyCorrection(plate, ops());
    } catch (error) {
      expect((error as CorrectionError).reason).toBe("unknown_reference");
    }
  });

  test("ops that name a removed item or carry no usable numbers are ignored", () => {
    const patch = applyCorrection(
      plate,
      ops({ op: "remove", i: 4 }, { op: "portion", i: 4, scale: 2 }, { op: "portion", i: 1 }, { op: "add", name: "x" }),
    );
    expect(patch.items).toHaveLength(3);
    expect(patch.changes).toEqual([]);
  });

  test("numbers sent as strings and fenced JSON still parse", () => {
    const patch = applyCorrection(plate, `\`\`\`json\n{"ops":[{"op":"portion","i":"1","scale":"0.5"}]}\n\`\`\``);
    expect(patch.items[0]?.grams).toBe(75);
  });

  test("removing every item is refused", () => {
    expect(() =>
      applyCorrection(plate.slice(0, 1), ops({ op: "remove", i: 1 })),
    ).toThrow(expect.objectContaining({ reason: "empty_result" }));
  });

  test("a non-JSON answer is unclear", () => {
    expect(() => applyCorrection(plate, "Maaf, saya tidak mengerti")).toThrow(
      expect.objectContaining({ reason: "unclear" }),
    );
  });

  test("english users see the localName of a new dish while calibration used the Indonesian name", () => {
    const patch = applyCorrection(
      plate,
      ops({ op: "add", name: "es teh manis", localName: "Sweet iced tea", grams: 250, kcal: 90 }),
      "en",
    );
    expect(patch.items[4]?.name).toBe("Sweet iced tea");
    expect(patch.items[4]?.matched).toBe(true);
  });

  test("the list never grows past what addScan accepts", () => {
    const full = Array.from({ length: 15 }, (_, i) => ({ name: `item ${i}`, kcal: 100 }));
    expect(() => applyCorrection(full, ops({ op: "add", name: "kerupuk", kcal: 70 }))).toThrow(
      expect.objectContaining({ reason: "unknown_reference" }),
    );
  });
});

describe("correctScanItems", () => {
  test("sends a text-only prompt with the numbered list and the user's words", async () => {
    let seen: { messages: Array<{ content: string }>; chat_template_kwargs: unknown } | undefined;
    const ai = {
      async run(_model: string, input: unknown) {
        seen = input as typeof seen;
        return { response: ops({ op: "remove", i: 4 }) };
      },
    };
    const run = await correctScanItems(ai, { items: plate, text: "ga ada sambel" });
    expect(run.patch.removed).toEqual(["sambal"]);
    const prompt = seen!.messages[0]!.content;
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("4. sambal | 1 sdm | 25 kkal");
    expect(prompt).not.toContain("20 g");
    expect(prompt).toContain("ga ada sambel");
    expect(seen!.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  test("a stored photo travels with the prompt and tells the model to weigh from it", async () => {
    let seen: { messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> } | undefined;
    const ai = {
      async run(_model: string, input: unknown) {
        seen = input as typeof seen;
        return { response: ops({ op: "rename", i: 1, name: "putih telur rebus", grams: 120, kcal100: 52 }) };
      },
    };
    const milk: CorrectionItemInput[] = [{ name: "susu plastik", grams: 250, kcal: 150, kind: "minuman" }];
    const run = await correctScanItems(ai, {
      items: milk,
      text: "bukan susu, putih telor rebus",
      photo: { mimeType: "image/jpeg", imageBase64: "QUJD" },
    });
    const content = seen!.messages[0]!.content;
    expect(content[1]!.image_url!.url).toBe("data:image/jpeg;base64,QUJD");
    expect(content[0]!.text).toContain("dari foto");
    expect(content[0]!.text).not.toContain("250 g");
    expect(run.patch.items[0]).toMatchObject({ name: "putih telur rebus", grams: 120 });
  });

  test("a garbled first answer gets a second attempt", async () => {
    let calls = 0;
    const ai = {
      async run() {
        calls += 1;
        return { response: calls === 1 ? "hmm" : ops({ op: "remove", i: 1 }) };
      },
    };
    const run = await correctScanItems(ai, { items: plate, text: "tanpa nasi" });
    expect(calls).toBe(2);
    expect(run.patch.removed).toEqual(["nasi putih"]);
  });

  test("an answer naming nothing is final: no second attempt", async () => {
    let calls = 0;
    const ai = {
      async run() {
        calls += 1;
        return { response: ops() };
      },
    };
    await expect(correctScanItems(ai, { items: plate, text: "ga ada bakso" })).rejects.toMatchObject({
      reason: "unknown_reference",
    });
    expect(calls).toBe(1);
  });

  test("a hung model times out as failed", async () => {
    const ai = { run: () => new Promise<never>(() => {}) };
    let fire: () => void = () => {};
    const schedule = (fn: () => void) => {
      fire = fn;
      return () => {};
    };
    const pending = correctScanItems(ai, { items: plate, text: "x y", schedule });
    await Promise.resolve();
    fire();
    await expect(pending).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("correctionPrompt", () => {
  test("non-Indonesian locales ask for localName", () => {
    expect(correctionPrompt(plate, "half the rice", "en")).toContain("localName");
    expect(correctionPrompt(plate, "setengah", "id")).not.toContain("localName");
  });
});

describe("a correction keeps the Jumlah and Dengan tulang state of the rows it touches", () => {
  const egg: CorrectionItemInput = { name: "telur rebus", portion: "3 butir", grams: 150, kcal: 225, protein: 18, carbs: 2, fat: 15, kind: "makanan", pieces: { count: 3, unit: "butir", unitGrams: 50 } };
  const rice: CorrectionItemInput = { name: "nasi putih", portion: "1 piring", grams: 150, kcal: 195, kind: "makanan" };
  const chicken: CorrectionItemInput = { name: "ayam goreng", portion: "2 potong, dengan tulang", grams: 200, kcal: 400, kind: "makanan", grossGrams: 200, edibleGrams: 130, withBone: true, pieces: { count: 2, unit: "potong", unitGrams: 100 } };

  test("rows left alone come back with their pieces and bone weights", () => {
    const patch = applyCorrection([egg, chicken, rice], ops({ op: "portion", i: 3, scale: 0.5 }));
    expect(patch.items[0]?.pieces).toEqual(egg.pieces);
    expect(patch.items[1]).toMatchObject({ grossGrams: 200, edibleGrams: 130, withBone: true });
  });

  test("a count the user states moves the row's count with its grams", () => {
    const patch = applyCorrection([egg, rice], ops({ op: "portion", i: 1, count: 2 }));
    expect(patch.items[0]).toMatchObject({ grams: 100, portion: "2 butir", pieces: { count: 2, unit: "butir", unitGrams: 50 } });
  });

  test("half the chicken halves both weights and the count, bone side kept", () => {
    const patch = applyCorrection([chicken], ops({ op: "portion", i: 1, scale: 0.5 }));
    expect(patch.items[0]).toMatchObject({ grams: 100, grossGrams: 100, edibleGrams: 65, withBone: true, pieces: { count: 1 } });
  });

  test("a rename to a countable food gets a count from its new weight", () => {
    const patch = applyCorrection([rice], ops({ op: "rename", i: 1, name: "telur rebus", grams: 100, kcal100: 155 }));
    expect(patch.items[0]?.pieces).toEqual({ count: 2, unit: "butir", unitGrams: 50 });
  });
});
