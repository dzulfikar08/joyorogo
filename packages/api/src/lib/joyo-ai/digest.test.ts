import { describe, expect, test } from "bun:test";

import { CONSENT_VERSION } from "./consent";
import { FORBIDDEN_KEYS, SECRET, TODAY, fakeRpc } from "./data-fixtures";
import {
  CONSENT_FIELDS_HASH,
  DIGEST_FIELDS,
  DIGEST_MAX_CHARS,
  buildDigest,
  digestJson,
  fieldsHash,
  fitToBudget,
  flat,
  gatherDigestSource,
} from "./digest";
import type { Digest, DigestSource } from "./digest";
import type { Person } from "./person";
import { createToolData } from "./tool-data";
import type { DayData } from "./tool-data";
import { TOOL_NAMES, runTool } from "./tools";

const person: Person = { ageYears: 36, sex: "female", heightCm: 165, goal: "lose" };

async function sourceFor(maternal = false, locale: "id" | "en" = "id"): Promise<DigestSource> {
  return gatherDigestSource(createToolData(fakeRpc({ maternal }), { today: () => TODAY, engine: "hosted" }), person, locale);
}

/** Every key path of a value, `[]` for list items: what `DIGEST_FIELDS` must list. */
function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [`${prefix}[]`] : [...new Set(value.flatMap((v) => (typeof v === "object" && v !== null ? paths(v, `${prefix}[]`) : [`${prefix}[]`])))];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => paths(v, prefix === "" ? k : `${prefix}.${k}`));
  }
  return [prefix];
}

describe("consent pin", () => {
  test("DIGEST_FIELDS is pinned to CONSENT_VERSION: change the fields and this fails until the version is bumped", () => {
    expect(CONSENT_VERSION).toBe(2);
    expect(fieldsHash(DIGEST_FIELDS)).toBe("f4b22e82");
    expect(CONSENT_FIELDS_HASH[CONSENT_VERSION]).toBe(fieldsHash(DIGEST_FIELDS));
  });

  test("the hash depends on the field list", () => {
    expect(fieldsHash(["a", "b"])).not.toBe(fieldsHash(["a", "c"]));
    expect(fieldsHash(["a", "b"])).toBe(fieldsHash(["a", "b"]));
  });

  test("DIGEST_FIELDS lists exactly the paths a fully populated digest carries", async () => {
    const source = await sourceFor();
    const digest = buildDigest(source);
    const actual = paths(digest).sort();
    expect(actual).toEqual([...DIGEST_FIELDS].sort());
  });

  test("no field names anything sensitive", () => {
    for (const field of DIGEST_FIELDS) {
      expect(field).not.toMatch(/maternal|pregnan|cycle|period|email|image|photo|scan|\blat\b|\blng\b|place|strava|device/i);
    }
  });
});

describe("what the digest holds", () => {
  test("person, targets, today with remaining, days, weight and coverage; units follow the language", async () => {
    const id = buildDigest(await sourceFor(false, "id"));
    expect(id.units.energy).toBe("kkal");
    expect(buildDigest(await sourceFor(false, "en")).units.energy).toBe("kcal");
    expect(id.person).toEqual({ ageYears: 36, sex: "female", heightCm: 165, goal: "lose" });
    expect(id.targets).toEqual({ eatKcal: 2000, proteinG: 100, carbsG: 215, fatG: 56, fiberG: 28, tdeeKcal: 2300, targetWeightKg: 65, targetDate: "2027-02-01" });
    expect(id.today?.eaten).toEqual({ kcal: 410, proteinG: 11, carbsG: 40.8, fatG: 9.3, fiberG: 0.2 });
    expect(id.today?.remaining?.kcal).toBe(1590);
    expect(id.today?.partial).toEqual(["protein", "carbs", "fat", "fiber"]);
    expect(id.today?.water).toEqual({ glasses: 3, goal: 8 });
    expect(id.today?.fasting?.pattern).toBe("16:8");
    expect(id.days).toHaveLength(7);
    expect(id.days.at(-1)).toEqual({ d: TODAY, kcal: 410, proteinG: 11, fiberG: 0.2, water: 3 });
    expect(id.weight).toEqual({ latestKg: 69.4, change14dKg: -0.6 });
    expect(id.coverage).toEqual({ loggedDays: 2, days: 7, weighIns: 3 });
  });

  test("missing is null, never 0: a day nothing was logged, no weigh-ins, nothing readable", async () => {
    const source = await sourceFor();
    const digest = buildDigest({ ...source, weights: [] });
    expect(digest.weight).toBeNull();
    expect(digest.days[0]).toEqual({ d: "2026-10-16", kcal: null, proteinG: null, fiberG: null, water: 0 });
    const bare = buildDigest({ now: TODAY, locale: "en", person: { ageYears: null, sex: null, heightCm: null, goal: null }, profile: null, day: null, days: [], weights: [] });
    expect(bare).toMatchObject({ targets: null, today: null, weight: null, days: [] });
    expect(bare.person).toEqual({ ageYears: null, sex: null, heightCm: null, goal: null });
    expect(bare.coverage).toEqual({ loggedDays: 0, days: 0, weighIns: 0 });
  });

  test("gather survives a data source that fails: that part is null", async () => {
    const rpc = fakeRpc();
    rpc.daySummary = async () => {
      throw new Error("down");
    };
    rpc.weightHistory = async () => {
      throw new Error("down");
    };
    const source = await gatherDigestSource(createToolData(rpc, { today: () => TODAY, engine: "hosted" }), person, "en");
    expect(source.day).toBeNull();
    expect(source.weights).toEqual([]);
    expect(source.days.length).toBe(7);
    expect(buildDigest(source).today).toBeNull();
  });

  test("a maternal plan: the profile's withheld goal wins over the caller's person.goal", async () => {
    const digest = buildDigest(await sourceFor(true));
    expect(digest.person.goal).toBeNull();
    expect(digest.targets?.targetWeightKg).toBeNull();
    expect(digest.targets?.targetDate).toBeNull();
  });

  test("free text is flattened", () => {
    expect(flat("a\nb\u2028c\t d   e", 100)).toBe("a b c d e");
    expect(flat("x".repeat(500), 10)).toHaveLength(10);
  });
});

describe("no sensitive field reaches the digest or any tool result", () => {
  const poison = {
    maternalMode: "pregnant",
    maternalDueDate: SECRET.due,
    maternalTrimester: SECRET.maternal,
    cyclePhase: SECRET.cycle,
    periodStart: SECRET.period,
    name: SECRET.name,
    email: SECRET.email,
    image: SECRET.image,
    photoId: SECRET.photoId,
    scanId: SECRET.scanId,
    lat: SECRET.lat,
    lng: SECRET.lng,
  };

  // `name` is a food's own name on an item: there the poison keeps the item's name and carries everything else.
  const { name: _personName, ...poisonWithoutName } = poison;

  test("a digest source whose every level carries maternal/cycle/name/email/photo/gps fields drops them", async () => {
    const base = await sourceFor();
    const poisoned = {
      ...poison,
      ...base,
      person: { ...base.person, ...poison },
      profile: base.profile && { ...base.profile, ...poison },
      day: base.day && {
        ...base.day,
        ...poison,
        items: base.day.items.map((i) => ({ ...i, ...poisonWithoutName })),
        totals: { ...base.day.totals, ...poison },
        targets: base.day.targets && { ...base.day.targets, ...poison },
        remaining: base.day.remaining && { ...base.day.remaining, ...poison },
        water: base.day.water && { ...base.day.water, ...poison },
        fasting: base.day.fasting && { ...base.day.fasting, ...poison },
      },
      days: base.days.map((d) => ({ ...d, ...poison })),
      weights: base.weights.map((w) => ({ ...w, ...poison })),
    } as DigestSource;
    const json = digestJson(buildDigest(poisoned));
    for (const key of FORBIDDEN_KEYS) expect(json).not.toContain(`"${key}":`);
    for (const value of Object.values(SECRET)) expect(json).not.toContain(value);
    expect(json).not.toContain("pregnant");
  });

  test("the full path: digest built from the fake RogoRpc, then every tool, for a normal and a maternal account", async () => {
    const toolCalls: Record<(typeof TOOL_NAMES)[number], Record<string, unknown>> = {
      get_day: { date: TODAY },
      get_range: { from: "2026-10-01", to: TODAY },
      get_weight_trend: { days: 60 },
      get_targets: {},
      search_foods: { query: "pepaya" },
      compare_foods: { foods: ["pepaya", "melon", "semangka"] },
      fits_today: { food: "nasi putih" },
    };
    for (const maternal of [false, true]) {
      const rpc = fakeRpc({ maternal });
      const data = createToolData(rpc, { today: () => TODAY, engine: "hosted" });
      const texts: string[] = [digestJson(buildDigest(await gatherDigestSource(data, person, "id")))];
      for (const name of TOOL_NAMES) {
        const out = await runTool({ id: name, name, args: toolCalls[name] }, data);
        expect(JSON.parse(out.content).error).toBeUndefined();
        texts.push(out.content, JSON.stringify(out.trace));
      }
      for (const text of texts) {
        for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}":`);
        for (const value of Object.values(SECRET)) expect(text).not.toContain(value);
        expect(text).not.toContain("pregnant");
        expect(text).not.toContain("founder");
      }
    }
  });
});

describe("size cap", () => {
  const manyItems = (n: number): DayData["items"] =>
    Array.from({ length: n }, (_, i) => ({ meal: "makan_malam", name: `Makanan nomor ${i} `.padEnd(120, "x"), grams: 123, kcal: 456, protein: 1, carbs: 1, fat: 1, fiber: 1, scanned: false }));

  test("the worst case (40 listed items, 60-char names, 7 days) stays under the cap", async () => {
    const base = await sourceFor();
    const day = { ...(base.day as DayData), items: manyItems(200) };
    const digest = buildDigest({ ...base, day });
    expect(digestJson(digest).length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(digest.today?.items.length).toBeLessThanOrEqual(40);
    expect(digest.today?.items[0]?.name.length).toBeLessThanOrEqual(60);
  });

  test("the drop order: days 7 -> 3, today's items shortened, then optional blocks; the essentials stay", async () => {
    const base = await sourceFor();
    const day = { ...(base.day as DayData), items: manyItems(40) };
    const full = buildDigest({ ...base, day });
    const size = (d: Digest) => digestJson(d).length;
    const lengthOf = (max: number) => fitToBudget(full, max);

    const afterDays = lengthOf(size(full) - 1);
    expect(afterDays.days).toHaveLength(3);
    expect(afterDays.today?.items).toHaveLength(full.today?.items.length ?? 0);

    const afterItems = lengthOf(size(afterDays) - 1);
    expect(afterItems.days).toHaveLength(3);
    expect(afterItems.today?.items.length).toBe(12);

    const tiny = lengthOf(1);
    expect(tiny.days).toEqual([]);
    expect(tiny.today?.items).toEqual([]);
    expect(tiny.today?.fasting).toBeNull();
    expect(tiny.targets?.targetWeightKg).toBeNull();
    // never dropped: targets, today's totals and remaining, weight, coverage
    expect(tiny.targets?.eatKcal).toBe(2000);
    expect(tiny.today?.eaten.kcal).toBe(410);
    expect(tiny.today?.remaining?.kcal).toBe(1590);
    expect(tiny.weight).not.toBeNull();
    expect(tiny.coverage.weighIns).toBe(3);
  });

  test("a normal digest is small", async () => {
    expect(digestJson(buildDigest(await sourceFor())).length).toBeLessThan(2_000);
  });
});
