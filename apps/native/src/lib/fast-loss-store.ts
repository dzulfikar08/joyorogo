import * as SecureStore from "expo-secure-store";

// The day (YYYY-MM-DD) the person closed the "pelan-pelan" note (api lib/safety isFastLossDismissed hides it for a few
// days). Local to this phone and keyed by user id (the phone can hold several accounts): a few-day snooze is a
// convenience, not a fact about the account, so it is not synced and a failure only shows the note again.

const key = (userId: string) => `joyorogo.fastLoss.closedOn.${userId}`;

export async function readFastLossClosedOn(userId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key(userId));
  } catch {
    return null;
  }
}

export async function writeFastLossClosedOn(userId: string, day: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(userId), day);
  } catch {
    // Best-effort: the note may show again.
  }
}
