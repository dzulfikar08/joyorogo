import { describe, expect, test } from "bun:test";

import { cleanPastedKey, createKeyVault, keyName, maskKey, type SecretStore } from "./key-vault";

function memorySecrets(): SecretStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItemAsync: async (key) => map.get(key) ?? null,
    setItemAsync: async (key, value) => void map.set(key, value),
    deleteItemAsync: async (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("key vault", () => {
  test("one entry per provider, named for JoyoRogo, trimmed on save", async () => {
    const secrets = memorySecrets();
    const vault = createKeyVault(secrets);
    await vault.set("openrouter", "  sk-or-abc123  ");
    await vault.set("openai", "sk-xyz");
    expect(secrets.dump()).toEqual({
      "joyorogo.ai.key.openrouter": "sk-or-abc123",
      "joyorogo.ai.key.openai": "sk-xyz",
    });
    expect(await vault.get("openrouter")).toBe("sk-or-abc123");
    expect(await vault.get("gemini")).toBeNull();
    await vault.delete("openrouter");
    expect(await vault.get("openrouter")).toBeNull();
    expect(await vault.get("openai")).toBe("sk-xyz");
  });

  test("entry names only use characters the secure store allows", () => {
    for (const provider of ["openrouter", "openai", "anthropic", "gemini", "custom"] as const) {
      expect(keyName(provider)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  test("a masked key shows the start and the last four characters only", () => {
    expect(maskKey("sk-or-v1-abcdef1234567890")).toBe("sk-...7890");
    expect(maskKey("AIzaSyA-secret-key-1234")).toBe("AIz...1234");
    expect(maskKey("short")).toBe("\u2022\u2022\u2022\u2022");
  });

  test("a pasted key loses spaces, line breaks, quotes and a Bearer prefix", () => {
    expect(cleanPastedKey("  sk-abc \n def  ")).toBe("sk-abcdef");
    expect(cleanPastedKey("Bearer sk-abc")).toBe("sk-abc");
    expect(cleanPastedKey('"sk-abc"')).toBe("sk-abc");
  });
});
