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

  test("a rename without numbers keeps the old weight and kcal for calibration to bound", () => {
    const patch = applyCorrection(plate, ops({ op: "rename", i: 3, name: "ayam bakar" }));
    expect(patch.items[2]?.name).toBe("ayam bakar");
    expect(patch.items[2]?.grams).toBe(80);
    expect(patch.items[2]?.portion).toBe("1 potong");
  });

  describe("a rename recomputes kcal for the new dish at the kept weight", () => {
    test("TKPI library hit with no model figure uses the library, not the old dish's kcal", () => {
      // perkedel 60 g / 130 kcal -> rendang (library 290 kcal/100 g): 174 kcal at 60 g.
      const patch = applyCorrection(plate, ops({ op: "rename", i: 2, name: "rendang" }));
      expect(patch.items[1]).toMatchObject({ name: "rendang", grams: 60, kcal: 174, matched: true });
      expect(patch.items[1]?.kcal).not.toBe(130);
      // Macros described the old dish and are not carried over.
      expect(patch.items[1]?.protein).toBeUndefined();
    });

    test("TKPI miss scales the model's per-100 g estimate to the item's weight", () => {
      const patch = applyCorrection(
        plate,
        ops({ op: "rename", i: 2, name: "rolade", kcal100: 250, protein100: 15, carbs100: 10, fat100: 17 }),
      );
      expect(patch.items[1]).toMatchObject({ name: "rolade", grams: 60, kcal: 150, matched: false });
      expect(patch.items[1]?.protein).toBe(9);
      expect(patch.items[1]?.fat).toBe(10.2);
    });

    test("model and library disagree: the higher figure wins, never under-counting", () => {
      // library nasi goreng 108 kcal at 60 g vs a model guess of 70.
      const low = applyCorrection(plate, ops({ op: "rename", i: 2, name: "nasi goreng", kcal100: 117 }));
      expect(low.items[1]?.kcal).toBe(108);
      // model above the library is kept (inside the band for that portion).
      const high = applyCorrection(plate, ops({ op: "rename", i: 2, name: "nasi goreng", kcal100: 250 }));
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
      expect(patch.items[1]?.grams).toBe(60);
      expect(patch.items[1]?.kcal).toBe(130);
    });
  });

  test("half the rice scales kcal and macros, and the TKPI band follows the portion", () => {
    const patch = applyCorrection(plate, ops({ op: "portion", i: 1, scale: 0.5 }));
    const rice = patch.items[0]!;
    expect(rice.grams).toBe(75);
    // 97.5 kcal: a plain 150-350 band would have clamped this up to 150.
    expect(rice.kcal).toBeCloseTo(97.5, 0);
    expect(rice.carbs).toBe(21);
    expect(rice.portion).toBe("75 g");
    expect(rice.matched).toBe(true);
    expect(patch.changes).toEqual([{ index: 0, kind: "portion" }]);
  });

  test("absolute grams set the weight and scale kcal by the ratio", () => {
    const patch = applyCorrection(plate, ops({ op: "portion", i: 3, grams: 160 }));
    expect(patch.items[2]?.grams).toBe(160);
    expect(patch.items[2]?.kcal).toBe(480);
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
    expect(prompt).toContain("4. sambal | 1 sdm | 20 g | 25 kcal");
    expect(prompt).toContain("ga ada sambel");
    expect(seen!.chat_template_kwargs).toEqual({ enable_thinking: false });
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
