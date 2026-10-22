// The own-key engine never gets data a health store (Health Connect on Android, HealthKit on iOS) wrote; the hosted engine keeps it.
import { describe, expect, test } from "bun:test";

import { answer } from "./answer";
import { CONSENT_FIELDS_HASH, DIGEST_FIELDS, buildDigest, digestJson, fieldsHash, gatherDigestSource } from "./digest";
import { CONSENT_VERSION } from "./consent";
import { FORBIDDEN_HEALTH_KEYS, HEALTH, TODAY, fakeRpc } from "./data-fixtures";
import type { Person } from "./person";
import { assessMessages, buildSystemPrompt, personMode } from "./safety";
import { adult, safetyText, scriptedAdapter, textReply, toolReply } from "./testFixtures";
import { BYOK_HEALTH_NOTE, createToolData } from "./tool-data";
import type { RogoRpc } from "./tool-data";
import { TOOL_NAMES, TOOL_SPECS, runTool, toolSpecsFor } from "./tools";
import type { Engine } from "./types";

const person: Person = { ageYears: 36, sex: "female", heightCm: 165, goal: "lose" };
const dataFor = (engine: Engine, rpc: RogoRpc = fakeRpc({ health: true })) => createToolData(rpc, { today: () => TODAY, engine });

const digestOf = async (engine: Engine, rpc?: RogoRpc) => buildDigest(await gatherDigestSource(dataFor(engine, rpc), person, "id"));

const HEALTH_VALUES = [HEALTH.steps, HEALTH.activeCalories, HEALTH.exerciseMinutes, HEALTH.sleepHours, HEALTH.heartRate, HEALTH.weightKg].map(String);

function expectNoHealth(text: string): void {
  for (const key of FORBIDDEN_HEALTH_KEYS) expect(text).not.toContain(`"${key}":`);
  for (const value of HEALTH_VALUES) expect(text).not.toContain(value);
  expect(text).not.toContain("health_connect");
  expect(text).not.toContain("apple_health");
}

const CALLS: Record<(typeof TOOL_NAMES)[number], Record<string, unknown>> = {
  get_day: { date: TODAY },
  get_range: { from: "2026-10-01", to: TODAY },
  get_weight_trend: { days: 60 },
  get_targets: {},
  search_foods: { query: "pepaya" },
  compare_foods: { foods: ["pepaya", "melon"] },
  fits_today: { food: "nasi putih" },
};

describe("own-key digest", () => {
  test("a source with Health Connect rows gives a digest without any health-sourced field", async () => {
    const byok = await digestOf("byok");
    expectNoHealth(digestJson(byok));
    // the weigh-in Health Connect wrote is dropped: the latest weight is the last one the person logged
    expect(byok.weight).toEqual({ latestKg: 69.4, change14dKg: -0.6 });
    expect(byok.coverage.weighIns).toBe(3);
  });

  test("the activity credit is out of the budget: base eat target, and what is left follows from it", async () => {
    const byok = await digestOf("byok");
    expect(byok.targets?.eatKcal).toBe(1850);
    expect(byok.today?.remaining?.kcal).toBe(1850 - 410);
  });

  test("a server that does not say how much of the budget is exercise gives no target rather than one that may carry it", async () => {
    const rpc = fakeRpc({ health: true });
    const summary = rpc.daySummary;
    rpc.daySummary = async (date) => {
      const out = (await summary(date)) as unknown as { targets: Record<string, unknown> };
      const { exerciseKcal: _gone, ...targets } = out.targets;
      return { ...out, targets } as never;
    };
    const byok = await digestOf("byok", rpc);
    expect(byok.targets?.eatKcal).toBeNull();
    expect(byok.today?.remaining).toBeNull();
    expect((await digestOf("hosted", rpc)).targets?.eatKcal).toBe(2000);
  });

  test("a source object that carries health fields at every level cannot add them", async () => {
    const base = await gatherDigestSource(dataFor("byok"), person, "id");
    const health = { steps: HEALTH.steps, activeCalories: HEALTH.activeCalories, exerciseMinutes: HEALTH.exerciseMinutes, sleepHoursLastNight: HEALTH.sleepHours, heartRate: HEALTH.heartRate };
    const poisoned = {
      ...health,
      ...base,
      day: base.day && { ...base.day, ...health, targets: base.day.targets && { ...base.day.targets, ...health } },
      days: base.days.map((d) => ({ ...d, ...health })),
      weights: base.weights.map((w) => ({ ...w, ...health })),
    };
    expectNoHealth(digestJson(buildDigest(poisoned as never)));
  });

  test("the digest's field list did not change, so the consent hash is the one of version 1", () => {
    expect(fieldsHash(DIGEST_FIELDS)).toBe("f4b22e82");
    expect(CONSENT_FIELDS_HASH[CONSENT_VERSION]).toBe(fieldsHash(DIGEST_FIELDS));
    expect(CONSENT_FIELDS_HASH[2]).toBe(CONSENT_FIELDS_HASH[1]!);
  });
});

describe("hosted digest keeps everything", () => {
  test("the budget with the activity credit and the Health Connect weigh-in", async () => {
    const hosted = await digestOf("hosted");
    expect(hosted.targets?.eatKcal).toBe(2000);
    expect(hosted.today?.remaining?.kcal).toBe(2000 - 410);
    expect(hosted.weight?.latestKg).toBe(HEALTH.weightKg);
    expect(hosted.coverage.weighIns).toBe(4);
  });
});

describe("own-key tool results", () => {
  test("every tool, over data with Health Connect rows: no health field or value, and the budget tools carry the note", async () => {
    const data = dataFor("byok");
    for (const name of TOOL_NAMES) {
      const out = await runTool({ id: name, name, args: CALLS[name] }, data);
      expect(JSON.parse(out.content).error).toBeUndefined();
      expectNoHealth(out.content);
      const noted = JSON.parse(out.content).healthDataNote === BYOK_HEALTH_NOTE;
      expect(noted).toBe(name === "get_day" || name === "get_targets" || name === "fits_today");
    }
    const day = JSON.parse((await runTool({ id: "d", name: "get_day", args: { date: TODAY } }, data)).content);
    expect(day.targets.kcal).toBe(1850);
    const targets = JSON.parse((await runTool({ id: "t", name: "get_targets", args: {} }, data)).content);
    expect(targets.today.eatKcal).toBe(1850);
    expect(targets.latestWeightKg).toBe(69.4);
    const trend = JSON.parse((await runTool({ id: "w", name: "get_weight_trend", args: { days: 60 } }, data)).content);
    expect(trend.last.kg).toBe(69.4);
  });

  test("the hosted results keep the credit and the Health Connect weigh-in, with no note", async () => {
    const data = dataFor("hosted");
    const day = JSON.parse((await runTool({ id: "d", name: "get_day", args: { date: TODAY } }, data)).content);
    expect(day.targets.kcal).toBe(2000);
    expect(day.healthDataNote).toBeUndefined();
    const targets = JSON.parse((await runTool({ id: "t", name: "get_targets", args: {} }, data)).content);
    expect(targets.latestWeightKg).toBe(HEALTH.weightKg);
    const trend = JSON.parse((await runTool({ id: "w", name: "get_weight_trend", args: { days: 60 } }, data)).content);
    expect(trend.last.kg).toBe(HEALTH.weightKg);
  });

  test("tool descriptions: the own-key budget is the base one, hosted is unchanged", () => {
    expect(toolSpecsFor("hosted")).toBe(TOOL_SPECS);
    const byok = toolSpecsFor("byok");
    expect(byok.map((s) => s.name)).toEqual(TOOL_SPECS.map((s) => s.name));
    for (const spec of byok) expect(spec.description).not.toContain("including counted exercise");
    expect(byok.find((s) => s.name === "get_day")?.description).toContain("not shared with own-key AI");
    expect(byok.find((s) => s.name === "get_targets")?.description).toContain("base eat budget");
    expect(TOOL_SPECS.find((s) => s.name === "get_day")?.description).toContain("including counted exercise");
  });
});

describe("system prompt", () => {
  const prompt = (engine: Engine) =>
    buildSystemPrompt({ locale: "en", digestJson: "{}", foodBlock: null, safety: assessMessages([{ role: "user", content: "Mana yang lebih tinggi serat?" }]), mode: personMode(adult, false), tools: true, engine });

  test("own-key: health-app data is not shared and is unknown, not zero; hosted has no such sentence", () => {
    expect(prompt("byok")).toContain(BYOK_HEALTH_NOTE);
    expect(prompt("byok")).toContain("not shared with the AI key being used");
    expect(prompt("hosted")).not.toContain("Health Connect");
  });
});

describe("the whole answer loop over the own-key engine", () => {
  test("the system prompt, the tool list and the tool result sent to the provider carry no health data", async () => {
    const data = dataFor("byok");
    const adapter = scriptedAdapter([toolReply({ id: "c1", name: "get_day", args: { date: TODAY } }), textReply("Sisa 1.440 kkal.")]);
    const text = safetyText("id");
    const out = await answer([{ role: "user", content: "Sisa kkal hari ini?" }], {
      adapter,
      conn: { baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m" },
      person: adult,
      locale: "id",
      text,
      gather: () => gatherDigestSource(data, person, "id"),
      data,
    });
    expect(out.reply).toContain("1.440");
    const seen = JSON.stringify(adapter.requests);
    expectNoHealth(seen);
    expect(seen).toContain("not shared with own-key AI");
  });
});
