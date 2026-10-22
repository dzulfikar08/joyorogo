import { describe, expect, test } from "bun:test";

import { defaultSettings } from "@joyorogo/api/lib/joyo-ai/settings";

import { createSettingsStore, SETTINGS_KEY } from "./settings-store";
import { createUsageStore, localDay, USAGE_KEY } from "./usage-store";

function memoryKv(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    get: async (k: string) => files.get(k) ?? null,
    set: async (k: string, v: string) => void files.set(k, v),
    remove: async (k: string) => void files.delete(k),
  };
}

describe("settings store", () => {
  test("defaults until the stored record is read, then the stored settings", async () => {
    const kv = memoryKv({
      [SETTINGS_KEY]: JSON.stringify({ engine: "byok", provider: "openai", dailyCeiling: 60 }),
    });
    const store = createSettingsStore(kv);
    expect(store.getSnapshot()).toEqual({ settings: defaultSettings, loaded: false });
    await store.load();
    expect(store.getSnapshot().loaded).toBe(true);
    expect(store.getSnapshot().settings.engine).toBe("byok");
    expect(store.getSnapshot().settings.provider).toBe("openai");
    expect(store.getSnapshot().settings.dailyCeiling).toBe(60);
  });

  test("a damaged file is the defaults, never an error", async () => {
    const store = createSettingsStore(memoryKv({ [SETTINGS_KEY]: "{not json" }));
    await store.load();
    expect(store.getSnapshot()).toEqual({ settings: defaultSettings, loaded: true });
  });

  test("an update before the read keeps what was stored", async () => {
    const kv = memoryKv({
      [SETTINGS_KEY]: JSON.stringify({ provider: "anthropic", keySaved: { anthropic: true } }),
    });
    const store = createSettingsStore(kv);
    await store.update({ fastMode: false });
    const now = store.getSnapshot().settings;
    expect(now.provider).toBe("anthropic");
    expect(now.keySaved).toEqual({ anthropic: true });
    expect(now.fastMode).toBe(false);
    expect(JSON.parse(kv.files.get(SETTINGS_KEY)!).fastMode).toBe(false);
  });

  test("values are clamped like the parser does, and listeners hear every change", async () => {
    const store = createSettingsStore(memoryKv());
    let heard = 0;
    store.subscribe(() => heard++);
    await store.update({ dailyCeiling: 100_000 });
    expect(store.getSnapshot().settings.dailyCeiling).toBe(200);
    expect(heard).toBeGreaterThan(0);
  });

  test("a failing disk keeps the session's settings", async () => {
    const kv = memoryKv();
    kv.set = async () => {
      throw new Error("disk full");
    };
    const store = createSettingsStore(kv);
    await store.update({ engine: "byok" });
    expect(store.getSnapshot().settings.engine).toBe("byok");
  });

  test("reset goes back to the defaults and removes the file", async () => {
    const kv = memoryKv();
    const store = createSettingsStore(kv);
    await store.update({ engine: "byok" });
    await store.reset();
    expect(store.getSnapshot().settings).toEqual(defaultSettings);
    expect(kv.files.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("usage store", () => {
  const day1 = new Date(2026, 9, 22, 10).getTime();
  const day2 = new Date(2026, 9, 23, 0, 5).getTime();

  test("the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
    expect(localDay(day2)).toBe("2026-10-23");
  });

  test("counts calls and tokens, written behind", async () => {
    const kv = memoryKv();
    const usage = createUsageStore(kv, () => day1);
    await usage.record({ inputTokens: 100, outputTokens: 20 });
    const after = await usage.record(null);
    expect(after).toEqual({ day: "2026-10-22", calls: 2, inputTokens: 100, outputTokens: 20 });
    expect(JSON.parse(kv.files.get(USAGE_KEY)!).calls).toBe(2);
    expect((await usage.today()).calls).toBe(2);
  });

  test("resumes today's stored count and starts over on a new day", async () => {
    const kv = memoryKv({
      [USAGE_KEY]: JSON.stringify({ day: "2026-10-22", calls: 7, inputTokens: 5, outputTokens: 5 }),
    });
    let now = day1;
    const usage = createUsageStore(kv, () => now);
    expect((await usage.today()).calls).toBe(7);
    now = day2;
    expect((await usage.today()).calls).toBe(0);
    expect((await usage.record(null)).calls).toBe(1);
  });

  test("clear zeroes the count and removes the file", async () => {
    const kv = memoryKv();
    const usage = createUsageStore(kv, () => day1);
    await usage.record(null);
    await usage.clear();
    expect((await usage.today()).calls).toBe(0);
    expect(kv.files.has(USAGE_KEY)).toBe(false);
  });
});
