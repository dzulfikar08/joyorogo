import { describe, expect, test } from "bun:test";

import {
  CONSENT_VERSION,
  grantConsent,
  grantHostedConsent,
} from "@joyorogo/api/lib/joyo-ai/consent";
import {
  defaultSettings,
  parseSettings,
  type AiSettings,
} from "@joyorogo/api/lib/joyo-ai/settings";

import { createKeyVault, type SecretStore } from "./key-vault";
import {
  deleteChats,
  deleteEverything,
  removeProvider,
  withdrawHostedConsent,
  type ResetDeps,
} from "./reset";
import { createSettingsStore } from "./settings-store";

function setup() {
  const files = new Map<string, string>();
  const secrets = new Map<string, string>();
  const secretStore: SecretStore = {
    getItemAsync: async (k) => secrets.get(k) ?? null,
    setItemAsync: async (k, v) => void secrets.set(k, v),
    deleteItemAsync: async (k) => void secrets.delete(k),
  };
  const kv = {
    get: async (k: string) => files.get(k) ?? null,
    set: async (k: string, v: string) => void files.set(k, v),
    remove: async (k: string) => void files.delete(k),
  };
  const settings = createSettingsStore(kv);
  const vault = createKeyVault(secretStore);
  const calls: string[] = [];
  const deps: ResetDeps = {
    settings,
    vault,
    chats: { clearAll: async () => void calls.push("chats") },
    usage: { clear: async () => void calls.push("usage") },
    files: { clear: async () => void (calls.push("files"), files.clear()) },
  };
  return { files, secrets, settings, vault, calls, deps };
}

async function ready(s: ReturnType<typeof setup>, tweak?: (x: AiSettings) => AiSettings) {
  await s.vault.set("openrouter", "sk-or-1");
  await s.vault.set("openai", "sk-2");
  await s.settings.update((cur) => {
    let next: AiSettings = {
      ...cur,
      engine: "byok",
      provider: "openrouter",
      keySaved: { openrouter: true, openai: true },
      models: { openrouter: "m1" },
    };
    next = grantConsent(next, "openrouter", "https://openrouter.ai/api/v1", 100);
    next = grantConsent(next, "openai", "https://api.openai.com/v1", 100);
    next = grantHostedConsent(next, 100);
    return tweak ? tweak(next) : next;
  });
}

describe("remove a provider", () => {
  test("the key, the consent and the marker go; the other provider stays", async () => {
    const s = setup();
    await ready(s);
    await removeProvider("openai", s.deps);
    expect(await s.vault.get("openai")).toBeNull();
    expect(await s.vault.get("openrouter")).toBe("sk-or-1");
    const now = s.settings.getSnapshot().settings;
    expect(now.keySaved).toEqual({ openrouter: true });
    expect(Object.keys(now.consents)).toEqual(["openrouter"]);
    expect(now.engine).toBe("byok");
    expect(now.provider).toBe("openrouter");
  });

  test("the provider in use: the chat falls back to the hosted engine, nothing selected", async () => {
    const s = setup();
    await ready(s);
    await removeProvider("openrouter", s.deps);
    const now = s.settings.getSnapshot().settings;
    expect(now.provider).toBeNull();
    expect(now.engine).toBe("hosted");
    expect(now.consents.openrouter).toBeUndefined();
    // The hosted yes is a different thing and stays.
    expect(now.hostedConsent?.version).toBe(CONSENT_VERSION);
  });

  test("the stored record matches, so a restart sees the same", async () => {
    const s = setup();
    await ready(s);
    await removeProvider("openrouter", s.deps);
    const stored = parseSettings(JSON.parse(s.files.get("joyorogo.ai.settings")!));
    expect(stored.keySaved).toEqual({ openai: true });
  });

  test("when the secure store fails nothing else changes", async () => {
    const s = setup();
    await ready(s);
    s.deps.vault = {
      delete: async () => {
        throw new Error("keystore locked");
      },
    };
    await expect(removeProvider("openrouter", s.deps)).rejects.toThrow("keystore locked");
    expect(s.settings.getSnapshot().settings.keySaved.openrouter).toBe(true);
  });
});

describe("withdraw and delete", () => {
  test("withdrawing the hosted consent clears only that", async () => {
    const s = setup();
    await ready(s);
    await withdrawHostedConsent(s.deps);
    const now = s.settings.getSnapshot().settings;
    expect(now.hostedConsent).toBeNull();
    expect(now.consents.openrouter).toBeDefined();
  });

  test("delete chats leaves keys and settings", async () => {
    const s = setup();
    await ready(s);
    await deleteChats(s.deps);
    expect(s.calls).toEqual(["chats"]);
    expect(await s.vault.get("openrouter")).toBe("sk-or-1");
  });

  test("delete everything: every key, the files, the counters and the settings", async () => {
    const s = setup();
    await ready(s);
    await deleteEverything(s.deps);
    expect(s.secrets.size).toBe(0);
    expect(s.files.size).toBe(0);
    expect(s.calls).toEqual(["chats", "usage", "files"]);
    expect(s.settings.getSnapshot().settings).toEqual(defaultSettings);
  });
});
