import { useEffect, useSyncExternalStore } from "react";

// The day Beranda and Makan show, shared so the day picked on one carries to the other through the nav links. The
// URL (?date=) stays the source of truth for each page; this only remembers the last day those pages showed. null =
// follow the live day (no param, rolls over at midnight); a past day is pinned only while a page is showing it.
// Same semantics as the native app's selected-day store. Not persisted: a fresh load opens on today.
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
function pickDay(next: string, today: string): void {
  const value = next >= today ? null : next;
  if (value === pinned) return;
  pinned = value;
  for (const l of listeners) l();
}

/** Mirror the day a page is showing into the shared store. Call from Beranda and Makan with their effective day. */
export function useShareSelectedDay(date: string, today: string): void {
  useEffect(() => {
    pickDay(date, today);
  }, [date, today]);
}

/**
 * Search params that carry the shared day to a Beranda/Makan link: `{ date }` for a pinned past day, `{}` for today
 * (clean URL). `today` is the live Jakarta day, so a pin never outlives its being in the past.
 */
export function useDaySearch(today: string): { date?: string } {
  const value = useSyncExternalStore(subscribe, read, read);
  return value !== null && value < today ? { date: value } : {};
}
