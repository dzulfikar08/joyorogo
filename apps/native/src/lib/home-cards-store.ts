import {
  DEFAULT_HOME_CARDS,
  homeCardsFor,
  isDefaultHomeCards,
  moveHomeCard,
  parseHomeCards,
  serializeHomeCards,
  setHomeCardHidden,
  type HomeCardId,
  type HomeCardPrefs,
} from "@joyorogo/api/lib/home-cards";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Arrangement of the Beranda cards on this phone. Local only: it is not part of the account sync (rogo-prefs.ts).
const KEY = "joyorogo.beranda.cards";
const NATIVE_CARDS = homeCardsFor("native");

let current: HomeCardPrefs = DEFAULT_HOME_CARDS;
let loadStarted = false;
const listeners = new Set<() => void>();

const read = () => current;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: HomeCardPrefs): void {
  current = next;
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const stored = parseHomeCards(await SecureStore.getItemAsync(KEY));
    // A change made while the read was pending wins over what was stored.
    if (current === DEFAULT_HOME_CARDS) publish(stored);
  } catch {
    // Unreadable store: the default arrangement stays.
  }
}

async function persist(next: HomeCardPrefs): Promise<void> {
  try {
    if (isDefaultHomeCards(next)) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, serializeHomeCards(next));
  } catch {
    // Best-effort: the session keeps the arrangement either way.
  }
}

function write(next: HomeCardPrefs): void {
  if (next === current) return;
  // Settled before the stored value arrives: do not let a late read overwrite it.
  loadStarted = true;
  publish(next);
  void persist(next);
}

/** The arrangement of the Beranda cards and the ways to change it. Changes show at once on every screen that uses it. */
export function useHomeCards() {
  useEffect(() => {
    void load();
  }, []);
  const prefs = useSyncExternalStore(subscribe, read, read);
  const setHidden = useCallback((id: HomeCardId, hide: boolean) => write(setHomeCardHidden(current, id, hide)), []);
  const move = useCallback((id: HomeCardId, delta: number) => write(moveHomeCard(current, id, delta, NATIVE_CARDS)), []);
  const reset = useCallback(() => write(DEFAULT_HOME_CARDS), []);
  return { prefs, setHidden, move, reset };
}
