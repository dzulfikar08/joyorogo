// Ported from JoyoFit (watch-fit) src/features/ai/reset.ts, adapted for JoyoRogo.
import { PROVIDER_IDS, type ProviderId } from "@joyorogo/api/lib/joyo-ai/types";
import { revokeConsent } from "@joyorogo/api/lib/joyo-ai/consent";
import type { AiSettings } from "@joyorogo/api/lib/joyo-ai/settings";

import type { KeyVault } from "./key-vault";

export interface ResetDeps {
  settings: {
    update(
      patch: Partial<AiSettings> | ((current: AiSettings) => AiSettings | Partial<AiSettings>),
    ): Promise<AiSettings>;
    reset(): Promise<void>;
  };
  vault: Pick<KeyVault, "delete">;
  /** Every saved conversation. */
  chats: { clearAll(): Promise<void> };
  usage: { clear(): Promise<void> };
  /** Every file Joyo AI wrote on this phone. */
  files: { clear(): Promise<void> };
}

/**
 * Removes one own-key provider: its key from the secure store (first: when that fails nothing else changes), then the consent
 * for it and the saved marker. When it was the provider in use, the chat goes back to the hosted engine until a new one is set up.
 */
export async function removeProvider(provider: ProviderId, deps: ResetDeps): Promise<void> {
  await deps.vault.delete(provider);
  await deps.settings.update((s) => {
    const { [provider]: _key, ...keySaved } = s.keySaved;
    const active = s.provider === provider;
    return {
      ...revokeConsent(s, provider),
      keySaved,
      provider: active ? null : s.provider,
      engine: active ? "hosted" : s.engine,
    };
  });
}

/** The saved conversations, kept apart from the key so clearing the history does not log the person out of their provider. */
export const deleteChats = (deps: Pick<ResetDeps, "chats">): Promise<void> => deps.chats.clearAll();

/** Withdraws the one-time yes for the hosted engine; the person is asked again before the next hosted question. */
export async function withdrawHostedConsent(deps: Pick<ResetDeps, "settings">): Promise<void> {
  await deps.settings.update({ hostedConsent: null });
}

/** Everything Joyo AI keeps on this phone: every key, consent, setting, conversation and usage count. The engine goes back to hosted. */
export async function deleteEverything(deps: ResetDeps): Promise<void> {
  await Promise.all(PROVIDER_IDS.map((p) => deps.vault.delete(p)));
  await deps.chats.clearAll();
  await deps.usage.clear();
  await deps.files.clear();
  await deps.settings.reset();
}
