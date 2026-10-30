import { useCallback, useSyncExternalStore } from "react";

// The day Beranda and Makan show, shared so picking a day on one shows it on the other. null = follow the live day,
// so the screens roll over at midnight on their own; a past day is pinned only once the person picks it. Not
// persisted: a cold start opens on today.
let pinned: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => pinned;

/** Pin `next`, or follow the live day again when `next` is `today` or later. */
export function pickDay(next: string, today: string): void {
  const value = next >= today ? null : next;
  if (value === pinned) return;
  pinned = value;
  for (const l of listeners) l();
}

/** The shared selected day (a past pin, else `today`) and its setter. */
export function useSelectedDay(today: string): [string, (next: string) => void] {
  const value = useSyncExternalStore(subscribe, read, read);
  const set = useCallback((next: string) => pickDay(next, today), [today]);
  return [value !== null && value < today ? value : today, set];
}
