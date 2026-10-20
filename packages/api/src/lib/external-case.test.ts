import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATASET_PREFIX, EXTERNAL_DATASET_PREFIX } from "./dataset";
import {
  ateReference,
  buildExternalMeta,
  caseIdOf,
  externalCaseKey,
  itemKcal,
  labelProblems,
  labelsSchema,
  resolveRef,
  truthOf,
} from "./external-case";
import type { Labels } from "./external-case";

// The invented example the importer documents: no real person's data.
const labels: Labels = labelsSchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dir, "../../../../scripts/external-cases/example.labels.json"),
      "utf8",
    ),
  ),
);
const photo = { sourceSha256: "x", prepared: "test", bytes: 1 };
const NOW = "2026-10-20T00:00:00.000Z";
const [weighed, grouped] = labels.cases;

describe("keys", () => {
  test("external cases live under dataset/external/<source>/<caseId>/, apart from <userId> folders", () => {
    expect(EXTERNAL_DATASET_PREFIX).toBe(`${DATASET_PREFIX}external/`);
    expect(externalCaseKey("someone", "Post1-2", "photo.jpg")).toBe(
      "dataset/external/someone/Post1-2/photo.jpg",
    );
    expect(externalCaseKey("someone", "Post1-2", "meta.json")).toBe(
      "dataset/external/someone/Post1-2/meta.json",
    );
    expect(caseIdOf(weighed!)).toBe("Xexample01-1");
  });
});

describe("reference kcal", () => {
  test("a TKPI 2019 row, a library dish and a manual number resolve to kcal per 100 g", () => {
    expect(resolveRef({ source: "tkpi2019", row: "Tahu goreng" })).toMatchObject({
      kcalPer100g: 115,
      proxy: false,
    });
    expect(resolveRef({ source: "library", dish: "nasi putih" })).toMatchObject({
      kcalPer100g: 130,
      proxy: false,
    });
    expect(resolveRef({ source: "manual", kcalPer100g: 50, note: "label" })).toMatchObject({
      kcalPer100g: 50,
      proxy: true,
    });
    expect(resolveRef({ source: "tkpi2019", row: "Kol merah, kol putih", proxy: true }).proxy).toBe(
      true,
    );
  });

  test("a row or dish that does not exist is an error, never a guess", () => {
    expect(() => resolveRef({ source: "tkpi2019", row: "tahu goreng" })).toThrow("no row");
    expect(() => resolveRef({ source: "library", dish: "ayam kecap" })).toThrow("no dish");
  });

  test("kcal comes from the weighed grams, else the assumed grams, else nothing", () => {
    const ref = resolveRef({ source: "tkpi2019", row: "Tahu goreng" });
    expect(itemKcal({ grams: 100, assumedGrams: undefined }, ref)).toBe(115);
    expect(itemKcal({ grams: null, assumedGrams: 50 }, ref)).toBe(58);
    expect(itemKcal({ grams: null, assumedGrams: undefined }, ref)).toBeUndefined();
    expect(itemKcal({ grams: 100, assumedGrams: undefined }, undefined)).toBeUndefined();
  });
});

describe("meta.json", () => {
  test("the example labels are valid", () => {
    expect(labelProblems(labels)).toEqual([]);
  });

  test("weighed case: every scored item has grams-derived reference kcal; the assumed egg is kcal only", () => {
    const meta = buildExternalMeta(labels, weighed!, photo, NOW);
    expect(meta.version).toBe("external-1");
    expect(meta.items.map((i) => [i.name, i.kcal])).toEqual([
      ["nasi putih", 156],
      ["ayam goreng", 248],
      ["telur rebus", 77],
      ["kol mentah", 9],
    ]);
    // Kol is "uncertain": not scored. The egg has no weight, so the plate has no gram total.
    expect(meta.truth).toEqual({ kcalComplete: true, plateKcal: 481, plateGrams: null });
    expect(meta.items[1]!.ref).toMatchObject({ name: "Ayam goreng kalasan, paha", proxy: true });
    expect(meta.source).toMatchObject({
      name: "example",
      postId: "Xexample01",
      photoIndex: 1,
      day: 1,
      meal: "lunch",
    });
    expect(meta.consent.scope).toContain("Internal use only");
    expect(meta).not.toHaveProperty("final");
  });

  test("combined weight: counted once, no kcal for the members, so the plate has grams but no kcal", () => {
    const meta = buildExternalMeta(labels, grouped!, photo, NOW);
    expect(meta.truth).toEqual({ kcalComplete: false, plateKcal: null, plateGrams: 500 });
    expect(meta.items.filter((i) => i.group).every((i) => i.kcal === undefined)).toBe(true);
    // Scoring the uncertain tempe too changes nothing: it shares the group's weight.
    expect(truthOf(meta.items, meta.groups, true).plateGrams).toBe(500);
  });

  test("comparators ride along in the meta, never in the truth; the meal reference counts everything eaten", () => {
    const meta = buildExternalMeta(labels, weighed!, photo, NOW);
    expect(meta.comparators.map((c) => [c.source, c.scope, c.kcalLow, c.kcalHigh])).toEqual([
      ["example-chatbot", "meal", 480, 520],
      ["example-chatbot", "day", 1500, 1600],
    ]);
    // The uncertain kol is eaten too: 156 + 248 + 77 + 9.
    expect(ateReference(meta.items)).toEqual({ kcal: 490, missing: [] });
    expect(meta.truth.plateKcal).toBe(481);
    const dinner = buildExternalMeta(labels, grouped!, photo, NOW);
    expect(dinner.comparators).toEqual([]);
    // Combined-weight members have no kcal: they are listed, and the sum is a floor.
    expect(ateReference(dinner.items)).toEqual({
      kcal: 115,
      missing: ["nasi putih", "sayur lodeh", "tempe"],
    });
  });

  test("a comparator range must be ordered and positive", () => {
    const bad = JSON.parse(JSON.stringify(labels));
    bad.cases[0].comparators[0] = { source: "x", scope: "meal", kcalLow: 600, kcalHigh: 500 };
    expect(labelsSchema.safeParse(bad).success).toBe(false);
    bad.cases[0].comparators[0] = { source: "x", scope: "week", kcalLow: 1, kcalHigh: 2 };
    expect(labelsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("label problems", () => {
  const withItems = (
    items: Labels["cases"][number]["items"],
    groups: Labels["cases"][number]["groups"] = [],
  ): Labels => ({
    ...labels,
    cases: [{ ...weighed!, items, groups }],
  });
  const rice = { name: "nasi putih", said: "x", grams: 100, inPhoto: "yes" as const };

  test("catches the mistakes a hand-written file makes", () => {
    expect(labelProblems({ ...labels, cases: [weighed!, weighed!] })).toContain(
      "Xexample01-1: listed twice",
    );
    expect(labelProblems(withItems([{ ...rice, group: "nope", grams: null }]))).toContain(
      'Xexample01-1 / nasi putih: group "nope" is not defined',
    );
    expect(
      labelProblems(withItems([{ ...rice, group: "g" }], [{ id: "g", name: "g", grams: 5 }])),
    ).toContain("Xexample01-1 / nasi putih: has its own grams and a group; pick one");
    expect(labelProblems(withItems([{ ...rice, grams: null }]))).toContain(
      "Xexample01-1 / nasi putih: no grams, no group and no assumedGrams",
    );
    expect(labelProblems(withItems([{ ...rice, inPhoto: "no" }]))).toContain(
      'Xexample01-1: no item is marked inPhoto "yes"; nothing to score',
    );
    expect(
      labelProblems(withItems([{ ...rice, ref: { source: "library", dish: "bubur" } }]))[0],
    ).toContain("no dish");
    expect(labelProblems(withItems([rice], [{ id: "g", name: "g", grams: 5 }]))).toContain(
      'Xexample01-1: group "g" has no items',
    );
  });

  test("the schema rejects a manual reference with no source note", () => {
    const bad = JSON.parse(JSON.stringify(labels));
    bad.cases[0].items[0].ref = { source: "manual", kcalPer100g: 100, note: "" };
    expect(labelsSchema.safeParse(bad).success).toBe(false);
  });
});
