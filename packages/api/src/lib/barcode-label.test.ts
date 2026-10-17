import { describe, expect, test } from "bun:test";

import { LABEL_PROMPT, LabelReadError, buildDraft, readLabelPhotos } from "./barcode-label";
import { checkPer100, energyMismatch, toPer100 } from "./barcode-nutrition";
import type { Per100Values } from "./barcode-nutrition";
import type { AiRunner } from "./vision";

// Answers shaped like Gemma 4's single-line JSON for typical Indonesian panels.
// The numbers are the printed ones (Chitato Sapi Panggang 68 g pack, Teh Pucuk
// 350 ml, a per-100-g-only import) so the arithmetic below is checkable by hand.
const CHITATO = JSON.stringify({
  servingSize: 34,
  unit: "g",
  servingsPerPack: 2,
  perServing: { kcal: 180, kj: null, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 },
  per100: null,
  problem: null,
});
const TEH_PUCUK = JSON.stringify({
  servingSize: 350,
  unit: "ml",
  servingsPerPack: 1,
  perServing: { kcal: "100 kkal", protein: "0", carbs: "25 g", fat: "0", fiber: null, sugar: "24" },
  per100: null,
  problem: null,
});
const PER_100_ONLY = JSON.stringify({
  servingSize: null,
  unit: "g",
  perServing: null,
  per100: { kcal: 520, protein: 7, carbs: 60, fat: 27, fiber: 2, sugar: 30 },
});
const BOTH_COLUMNS = JSON.stringify({
  servingSize: 30,
  unit: "g",
  perServing: { kcal: 150, protein: 3, carbs: 18, fat: 7, fiber: 1, sugar: 5 },
  per100: { kcal: 500, protein: 10, carbs: 60, fat: 23, fiber: 3, sugar: 17 },
});
const KJ_ONLY = JSON.stringify({
  servingSize: 25,
  unit: "g",
  perServing: { kcal: null, kj: 418, protein: 1, carbs: 15, fat: 5, fiber: null, sugar: 8 },
});

const FRONT = JSON.stringify({ name: "Sapi Panggang", brand: "Chitato", quantity: "68 g" });

describe("buildDraft", () => {
  test("a per-serving panel stays per serving with its serving size", () => {
    const read = buildDraft(CHITATO, FRONT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.draft).toMatchObject({
      name: "Sapi Panggang",
      brand: "Chitato",
      quantity: "68 g",
      servingSize: 34,
      unit: "g",
      basis: "serving",
      nutrients: { kcal: 180, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 },
      warnings: [],
    });
  });

  test("numbers printed with units, quotes or a comma decimal are still read", () => {
    const read = buildDraft(TEH_PUCUK, null);
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.unit).toBe("ml");
    expect(read.draft.nutrients).toEqual({ kcal: 100, protein: 0, carbs: 25, fat: 0, fiber: null, sugar: 24 });
    const comma = buildDraft(
      JSON.stringify({ servingSize: "30 g", perServing: { kcal: "120", protein: "1,5", carbs: "<1", fat: "4,5" } }),
      null,
    );
    if (!comma.ok) throw new Error("expected a draft");
    expect(comma.draft.servingSize).toBe(30);
    expect(comma.draft.nutrients).toMatchObject({ kcal: 120, protein: 1.5, carbs: 0, fat: 4.5 });
  });

  test("no front photo leaves name, brand and quantity empty for the user to type", () => {
    const read = buildDraft(CHITATO, null);
    if (!read.ok) throw new Error("expected a draft");
    expect([read.draft.name, read.draft.brand, read.draft.quantity]).toEqual([null, null, null]);
    const garbled = buildDraft(CHITATO, "maaf, tidak bisa");
    if (!garbled.ok) throw new Error("expected a draft");
    expect(garbled.draft.name).toBeNull();
  });

  test("a panel with only per-100 numbers is per 100 with no serving size", () => {
    const read = buildDraft(PER_100_ONLY, null);
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.basis).toBe("per100");
    expect(read.draft.servingSize).toBeNull();
    expect(read.draft.warnings).toEqual([]);
  });

  test("both columns: the per-serving one is shown, a contradiction between them is flagged", () => {
    const agree = buildDraft(BOTH_COLUMNS, null);
    if (!agree.ok) throw new Error("expected a draft");
    expect(agree.draft.basis).toBe("serving");
    expect(agree.draft.nutrients.kcal).toBe(150);
    expect(agree.draft.warnings).toEqual([]);
    const off = JSON.stringify({
      servingSize: 30,
      perServing: { kcal: 150, protein: 3, carbs: 18, fat: 7 },
      per100: { kcal: 900, protein: 10, carbs: 60, fat: 23 },
    });
    const read = buildDraft(off, null);
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.warnings).toContain("columns_disagree");
  });

  test("energy printed only in kJ is converted to kcal", () => {
    const read = buildDraft(KJ_ONLY, null);
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.nutrients.kcal).toBe(100);
  });

  test("a per-serving panel without a serving size keeps the user in the loop", () => {
    const read = buildDraft(
      JSON.stringify({ servingSize: null, perServing: { kcal: 200, protein: 4, carbs: 30, fat: 7 } }),
      null,
    );
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.basis).toBe("serving");
    expect(read.draft.warnings).toContain("no_serving_size");
  });

  test("missing energy is flagged, not guessed", () => {
    const read = buildDraft(
      JSON.stringify({ servingSize: 30, perServing: { kcal: null, protein: 4, carbs: 30, fat: 7 } }),
      null,
    );
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.nutrients.kcal).toBeNull();
    expect(read.draft.warnings).toContain("no_energy");
  });

  test("a misread panel is flagged with the same rules the save applies", () => {
    // Energy of a whole 500 ml bottle beside macros of 100 ml: the classic per-serving mix-up.
    const read = buildDraft(
      JSON.stringify({ servingSize: 100, perServing: { kcal: 600, protein: 1, carbs: 10, fat: 0 } }),
      null,
    );
    if (!read.ok) throw new Error("expected a draft");
    expect(read.draft.warnings).toContain("energy_mismatch");
    const absurd = buildDraft(
      JSON.stringify({ servingSize: 10, perServing: { kcal: 300, protein: 1, carbs: 5, fat: 1 } }),
      null,
    );
    if (!absurd.ok) throw new Error("expected a draft");
    expect(absurd.draft.warnings).toContain("implausible");
  });

  test("not a label, blurry or garbage answers are refused", () => {
    expect(buildDraft(JSON.stringify({ problem: "bukan label" }), null)).toEqual({ ok: false, reason: "not_label" });
    expect(buildDraft(JSON.stringify({ servingSize: 30, problem: "buram" }), null)).toEqual({
      ok: false,
      reason: "unclear",
    });
    expect(buildDraft("Maaf, saya tidak bisa membaca gambar ini.", null)).toEqual({ ok: false, reason: "unclear" });
    expect(buildDraft('{"perServing":{"kcal":null,"protein":null}}', null)).toEqual({ ok: false, reason: "unclear" });
  });

  test("an answer wrapped in prose or fences still parses", () => {
    const read = buildDraft("Ini hasilnya:\n```json\n" + CHITATO + "\n```", null);
    expect(read.ok).toBe(true);
  });
});

describe("toPer100 and plausibility", () => {
  const nutrients = { kcal: 180, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 };

  test("per serving scales by 100 / serving size, per 100 passes through", () => {
    expect(toPer100("serving", 34, nutrients)).toEqual({
      kcal100: 529.4,
      protein100: 5.9,
      carbs100: 52.9,
      fat100: 32.4,
      fiber100: 2.9,
      sugar100: 2.9,
    });
    expect(toPer100("per100", null, nutrients)?.kcal100).toBe(180);
    expect(toPer100("serving", 100, { ...nutrients, fiber: null })?.fiber100).toBeNull();
  });

  test("no energy or no serving size cannot be converted", () => {
    expect(toPer100("serving", null, nutrients)).toBeNull();
    expect(toPer100("serving", 0, nutrients)).toBeNull();
    expect(toPer100("per100", null, { ...nutrients, kcal: null })).toBeNull();
  });

  test("implausible numbers are refused, as for lookup data", () => {
    const heavy: Per100Values = { kcal100: 1200, protein100: 0, carbs100: 0, fat100: 0, fiber100: null, sugar100: null };
    expect(checkPer100(heavy)).toBe("implausible");
    const crowded: Per100Values = { kcal100: 400, protein100: 60, carbs100: 60, fat100: 20, fiber100: null, sugar100: null };
    expect(checkPer100(crowded)).toBe("implausible");
  });

  test("kJ typed as kcal or a per-serving energy beside per-100 macros fails the energy cross-check", () => {
    const kj: Per100Values = { kcal100: 628, protein100: 2, carbs100: 30, fat100: 1, fiber100: null, sugar100: null };
    expect(energyMismatch(kj)).toBe(true);
    expect(checkPer100(kj)).toBe("energy_mismatch");
    const mixed: Per100Values = { kcal100: 150, protein100: 6, carbs100: 60, fat100: 30, fiber100: null, sugar100: null };
    expect(checkPer100(mixed)).toBe("energy_mismatch");
  });

  test("real panels pass: rounding, drinks, zero-calorie products", () => {
    const indomie: Per100Values = { kcal100: 470.6, protein100: 8.2, carbs100: 64.7, fat100: 18.8, fiber100: 3.5, sugar100: null };
    expect(checkPer100(indomie)).toBeNull();
    const pocari: Per100Values = { kcal100: 25, protein100: 0, carbs100: 6.2, fat100: 0, fiber100: 0, sugar100: 5.6 };
    expect(checkPer100(pocari)).toBeNull();
    const water: Per100Values = { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, fiber100: null, sugar100: null };
    expect(checkPer100(water)).toBeNull();
    // Macros unknown: nothing to cross-check against.
    expect(energyMismatch({ kcal100: 300, protein100: null, carbs100: 40, fat100: 5, fiber100: null, sugar100: null })).toBe(false);
  });
});

type ModelRequest = {
  temperature: number;
  messages: Array<{ content: Array<{ text?: string; image_url?: { url: string } }> }>;
};

function runnerReplying(answers: Record<"label" | "front", string | Error>, seen: ModelRequest[] = []): AiRunner {
  return {
    run: (_model, input) => {
      // The runner is the typed boundary of what barcode-label sends.
      const request = input as ModelRequest;
      seen.push(request);
      const kind = request.messages[0]!.content[0]!.text === LABEL_PROMPT ? "label" : "front";
      const answer = answers[kind];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ response: answer });
    },
  };
}

describe("readLabelPhotos", () => {
  const photo = { imageBase64: "QUJD", mimeType: "image/jpeg" };

  test("reads the panel and the front concurrently into one draft", async () => {
    const seen: ModelRequest[] = [];
    const run = await readLabelPhotos(runnerReplying({ label: CHITATO, front: FRONT }, seen), {
      model: "m",
      label: photo,
      front: photo,
    });
    expect(seen).toHaveLength(2);
    expect(run.draft.name).toBe("Sapi Panggang");
    expect(run.draft.nutrients.kcal).toBe(180);
    expect(seen[0]!.temperature).toBe(0);
    expect(seen[0]!.messages[0]!.content[1]!.image_url!.url).toBe("data:image/jpeg;base64,QUJD");
  });

  test("without a front photo the model is called once", async () => {
    const seen: ModelRequest[] = [];
    await readLabelPhotos(runnerReplying({ label: CHITATO, front: FRONT }, seen), { model: "m", label: photo });
    expect(seen).toHaveLength(1);
  });

  test("a failing front photo never fails the label read", async () => {
    const run = await readLabelPhotos(runnerReplying({ label: CHITATO, front: new Error("boom") }), {
      model: "m",
      label: photo,
      front: photo,
    });
    expect(run.draft.name).toBeNull();
    expect(run.draft.nutrients.kcal).toBe(180);
  });

  test("unreadable panels and model failures map to stable reasons", async () => {
    const blurry = JSON.stringify({ problem: "buram" });
    await expect(readLabelPhotos(runnerReplying({ label: blurry, front: FRONT }), { model: "m", label: photo })).rejects.toMatchObject({
      reason: "unclear",
    });
    await expect(
      readLabelPhotos(runnerReplying({ label: new Error("503"), front: FRONT }), { model: "m", label: photo }),
    ).rejects.toMatchObject({ reason: "failed" });
  });

  test("a model that never answers hits the deadline", async () => {
    const hanging: AiRunner = { run: () => new Promise(() => {}) };
    const outcome = await readLabelPhotos(hanging, {
      model: "m",
      label: photo,
      // The deadline fires on the next microtask instead of after real time.
      schedule: (fn) => {
        queueMicrotask(fn);
        return () => {};
      },
    }).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(LabelReadError);
    expect((outcome as LabelReadError).reason).toBe("timeout");
  });
});
