import * as SecureStore from "expo-secure-store";

import { createChatStore } from "@joyorogo/api/lib/joyo-ai/conversations";
import type { ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

import { createFileKeyValue } from "./file-kv";
import { createKeyVault, type SecretStore } from "./key-vault";
import { nativeFileIo } from "./native-io";
import {
  deleteChats,
  deleteEverything,
  removeProvider,
  withdrawHostedConsent,
  type ResetDeps,
} from "./reset";
import { createSettingsStore } from "./settings-store";
import { createUsageStore } from "./usage-store";

/**
 * The phone's own stores for Joyo AI. Settings, usage and conversations are files in the app's documents folder (not synced, not
 * sent anywhere); the API keys are only in the secure store.
 */
const files = createFileKeyValue(nativeFileIo);

/** Keys stay on this device: not in iCloud Keychain, not in a backup, not on a new phone. */
const secrets: SecretStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export const joyoSettings = createSettingsStore(files);
export const joyoUsage = createUsageStore(files);
export const joyoChats = createChatStore(files);
export const joyoVault = createKeyVault(secrets);

const resetDeps: ResetDeps = {
  settings: joyoSettings,
  vault: joyoVault,
  chats: joyoChats,
  usage: joyoUsage,
  files,
};

/** "Hapus kunci" for one provider (also withdraws its consent). */
export const removeOwnProvider = (provider: ProviderId): Promise<void> =>
  removeProvider(provider, resetDeps);
/** "Hapus percakapan". */
export const deleteAllChats = (): Promise<void> => deleteChats(resetDeps);
/** "Cabut izin" for the hosted engine. */
export const withdrawHosted = (): Promise<void> => withdrawHostedConsent(resetDeps);
/** Everything Joyo AI keeps on the phone. */
export const deleteAllJoyoData = (): Promise<void> => deleteEverything(resetDeps);
