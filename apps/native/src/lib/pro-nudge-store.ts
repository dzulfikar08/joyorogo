import * as SecureStore from "expo-secure-store";

// The highest streak milestone whose Pro card was shown or dismissed. Local to this phone and keyed by user id (the phone
// can hold several accounts); it is a convenience, so it is not synced to the account and a failure only repeats a card.

const streakKey = (userId: string) => `joyorogo.proNudge.streak.${userId}`;

export async function readStreakNudge(userId: string): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(streakKey(userId));
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export async function writeStreakNudge(userId: string, milestone: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(streakKey(userId), String(milestone));
  } catch {
    // Best-effort: the card may show again once.
  }
}
