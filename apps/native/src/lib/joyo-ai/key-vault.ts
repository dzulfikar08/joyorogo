// Ported from JoyoFit (watch-fit) src/features/ai/keyVault.ts, adapted for JoyoRogo.
import type { ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

/** The platform's secure store, injected so the vault runs in tests without the native module. */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Secure store keys allow letters, digits, `.`, `-` and `_`. One key per provider so switching back needs no re-paste. */
export const keyName = (provider: ProviderId): string => `joyorogo.ai.key.${provider}`;

/**
 * The API keys, in the platform's secure store and nowhere else: never in a file, the query cache, a log or a request to
 * JoyoRogo.
 */
export function createKeyVault(store: SecretStore) {
  return {
    get: (provider: ProviderId): Promise<string | null> => store.getItemAsync(keyName(provider)),
    async set(provider: ProviderId, key: string): Promise<void> {
      await store.setItemAsync(keyName(provider), key.trim());
    },
    delete: (provider: ProviderId): Promise<void> => store.deleteItemAsync(keyName(provider)),
  };
}
export type KeyVault = ReturnType<typeof createKeyVault>;

/** "sk-...Ab3f": enough to tell keys apart, nothing that could be used. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "\u2022\u2022\u2022\u2022";
  const head = k.startsWith("sk-") ? "sk-" : k.slice(0, 3);
  return `${head}...${k.slice(-4)}`;
}

/** Pasted keys come with spaces, line breaks and a leading `Bearer `; none of it is part of the key. */
export function cleanPastedKey(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .replace(/^bearer/i, "")
    .replace(/^["']|["']$/g, "");
}
