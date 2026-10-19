import { describe, expect, test } from "bun:test";

import { getT, resources } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { buildFacts, FACT_VARIANTS, reflectionFacts } from "./recap-facts";
import type { Fact } from "./recap-facts";
import { ownerWeek, quietWeek, variantScenarios } from "./recap-fixtures";
import { formatParam, formatParams, renderFact, renderSelection } from "./recap-text";

const LOCALES: Locale[] = ["id", "en"];
const EMOJI = /\p{Extended_Pictographic}/u;

/** The one fact of `key` ("CODE/variant") that its scenario produces. */
const factOf = (key: string): Fact => {
  const input = variantScenarios()[key]!;
  const found = buildFacts(input).filter((f) => `${f.code}/${f.variant}` === key);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("every variant is reachable, worded and translated", () => {
  const keys = Object.entries(FACT_VARIANTS).flatMap(([code, variants]) => variants.map((v) => `${code}/${v}`));

  test("a scenario produces each declared variant", () => {
    expect(Object.keys(variantScenarios()).toSorted()).toEqual(keys.toSorted());
    for (const key of keys) factOf(key);
  });

  for (const locale of LOCALES) {
    test(`${locale}: every fact renders a title and text without a leftover placeholder, wins without advice, focus with`, () => {
      for (const key of keys) {
        const fact = factOf(key);
        const view = renderFact(fact, locale);
        for (const [field, value] of Object.entries({ title: view.title, text: view.text, advice: view.advice ?? "" })) {
          expect(value, `${locale} ${key} ${field}`).not.toContain("{{");
          expect(value, `${locale} ${key} ${field}`).not.toMatch(/^[a-zA-Z_.]+\.(title|text|advice)/);
          expect(value, `${locale} ${key} ${field}`).not.toMatch(EMOJI);
        }
        expect(view.title.length, key).toBeGreaterThan(3);
        expect(view.text.length, key).toBeGreaterThan(10);
        if (fact.role === "win") expect(view.advice, key).toBeNull();
        else expect(view.advice!.length, key).toBeGreaterThan(10);
      }
    });
  }

  test("English and Indonesian have the same shape, plural forms aside", () => {
    const shape = (node: unknown, prefix = ""): string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node).flatMap(([k, v]) => shape(v, `${prefix}${k.replace(/_(one|other)$/, "")}.`))
        : [prefix];
    expect([...new Set(shape(resources.en.reflection))].toSorted()).toEqual([...new Set(shape(resources.id.reflection))].toSorted());
  });

  test("Indonesian is casual kamu, never Anda", () => {
    expect(JSON.stringify(resources.id.reflection)).not.toMatch(/\b[Aa]nda\b/);
  });
});

describe("number formatting follows the language", () => {
  test("separators", () => {
    expect(formatParam(1950, "id")).toBe("1.950");
    expect(formatParam(1950, "en")).toBe("1,950");
    expect(formatParam(0.45, "id")).toBe("0,45");
    expect(formatParam(107.7, "en")).toBe("107.7");
  });
  test("an ISO day becomes a readable date, free text stays, null and booleans are left out", () => {
    expect(formatParam("2027-03-05", "id")).toMatch(/5.*2027/);
    expect(formatParam("2027-03-05", "en")).toMatch(/Mar.*5.*2027/);
    expect(formatParam("fried", "en")).toBe("fried");
    expect(formatParams({ a: 1, b: null, c: true, d: "x" }, "en")).toEqual({ a: "1", d: "x" });
  });
});

describe("plural forms", () => {
  const weighIns = (n: number) => {
    const fact = buildFacts(quietWeek({ weighIns: Array.from({ length: n }, (_, i) => ({ date: `2026-10-1${2 + i}`, weightKg: 80 })) })).find((f) => f.code === "WEIGH_INS")!;
    return fact;
  };
  test("English says once / times", () => {
    expect(renderFact(weighIns(1), "en").text).toBe("You weighed in only once this week.");
    expect(renderFact(weighIns(2), "en").text).toBe("You weighed in only 2 times this week.");
  });
  test("Indonesian has one form", () => {
    expect(renderFact(weighIns(1), "id").text).toBe("Kamu baru menimbang berat 1 kali minggu ini.");
  });
});

describe("the extra sentences", () => {
  test("a projected date is appended to the pace sentence", () => {
    const text = renderFact(factOf("WEIGHT_PACE/behind"), "id").text;
    expect(text).toContain("tercapai sekitar");
    expect(text).toMatch(/2027/);
  });
  test("a heart rate and a load are appended to a hard session, with the rest days in its advice", () => {
    const fact = reflectionFacts(ownerWeek()).focus.find((f) => f.code === "RUN_INTENSITY")!;
    const view = renderFact(fact, "id");
    expect(view.text).toContain("163");
    expect(view.text).toContain("177 bpm");
    expect(view.text).toContain("sekitar 4 kali");
    expect(view.advice).toContain("istirahat penuh");
  });
});

describe("the template text", () => {
  const owner = reflectionFacts(ownerWeek());

  test("wins, then what to watch, then the numbered focus list under its label", () => {
    const body = renderSelection(owner, "id", "lose");
    const paragraphs = body.templateText.split("\n\n");
    expect(paragraphs[0]).toStartWith("Kabar baiknya:");
    expect(paragraphs[1]).toStartWith("Yang perlu diperhatikan:");
    expect(paragraphs[2]!.split("\n")).toHaveLength(4);
    expect(paragraphs[2]).toStartWith(`${body.closingLabel}\n1. `);
    expect(body.closingLabel).toBe("Fokus minggu depan:");
    expect(body.focus).toHaveLength(3);
  });

  test("the owner's week in English", () => {
    const text = renderSelection(owner, "en", "lose").templateText;
    expect(text).toContain("1,950 kcal");
    expect(text).toContain("See a doctor before adding intensity");
    expect(text).toContain("Focus for next week:");
  });

  test("a week with wins and no focus ends on the keep-going line, no list", () => {
    const body = renderSelection({ wins: owner.wins, focus: [] }, "id", "lose");
    expect(body.templateText.split("\n\n").at(-1)).toBe("Pertahankan ritme ini minggu depan.");
    expect(body.templateText).not.toContain("1. ");
  });

  test("Hamil / Menyusui ends with the no-targets note", () => {
    const text = renderSelection(owner, "id", "maternal").templateText;
    expect(text.split("\n\n").at(-1)).toBe("Angka-angka ini cuma gambaran, bukan target yang harus dikejar.");
    expect(renderSelection(owner, "id", "lose").templateText).not.toContain("bukan target yang harus dikejar");
  });

  test("the same facts always give the same text", () => {
    expect(renderSelection(reflectionFacts(ownerWeek()), "id", "lose").templateText).toBe(renderSelection(owner, "id", "lose").templateText);
  });

  test("no emoji, no Anda, no unfilled placeholder in either language", () => {
    for (const locale of LOCALES) {
      const text = renderSelection(owner, locale, "lose").templateText;
      expect(text).not.toMatch(EMOJI);
      expect(text).not.toContain("{{");
      expect(text).not.toMatch(/\bAnda\b/);
    }
  });

  test("a medical-sounding word only appears where the advice sends the person to a doctor", () => {
    const quiet = renderSelection(reflectionFacts(quietWeek({ trend: { weeklyRateKg: -0.5, projectedDate: null } })), "id", "lose").templateText;
    expect(quiet.toLowerCase()).not.toContain("dokter");
    expect(getT("id", "reflection")("facts.RUN_INTENSITY.hard_check_doctor.advice")).toContain("dokter");
  });
});
