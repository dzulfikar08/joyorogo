// The day (YYYY-MM-DD) the person closed the "pelan-pelan" note (api lib/safety isFastLossDismissed hides it for a few
// days). Local to this browser and keyed by user id (a browser can hold several accounts): a few-day snooze is a
// convenience, not a fact about the account, so it is not synced and blocked storage only shows the note again.

const key = (userId: string) => `jrg-fast-loss-closed-${userId}`;

export function readFastLossClosedOn(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function writeFastLossClosedOn(userId: string, day: string): void {
  try {
    localStorage.setItem(key(userId), day);
  } catch {
    // Storage blocked: the state in the component still hides it for this visit.
  }
}
