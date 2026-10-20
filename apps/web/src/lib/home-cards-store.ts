import { useSyncExternalStore } from "react";

import {
  DEFAULT_HOME_CARDS,
  homeCardsFor,
  isDefaultHomeCards,
  moveHomeCard,
  parseHomeCards,
  serializeHomeCards,
  setHomeCardHidden,
} from "@joyorogo/api/lib/home-cards";
import type { HomeCardId, HomeCardPrefs } from "@joyorogo/api/lib/home-cards";

// Which Beranda cards show and in what order. Local to this browser (not part of the account sync); the shared
// definition and normalising live in @joyorogo/api/lib/home-cards.
const STORE_KEY = "joyorogo.beranda.cards";
const WEB_CARDS = homeCardsFor("web");

let current: HomeCardPrefs | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): HomeCardPrefs {
  current ??= parseHomeCards(readRaw());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORE_KEY && event.key !== null) return;
    current = parseHomeCards(readRaw());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: HomeCardPrefs): void {
  if (next === snapshot()) return;
  current = next;
  try {
    // The default arrangement is the absence of a choice: a later release's new cards then land where it puts them.
    if (isDefaultHomeCards(next)) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, serializeHomeCards(next));
  } catch {
    // Storage blocked: the arrangement still holds for this visit.
  }
  for (const listener of listeners) listener();
}

export function useHomeCards(): HomeCardPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_HOME_CARDS);
}

export function setCardHidden(id: HomeCardId, hide: boolean): void {
  write(setHomeCardHidden(snapshot(), id, hide));
}

export function moveCard(id: HomeCardId, delta: number): void {
  write(moveHomeCard(snapshot(), id, delta, WEB_CARDS));
}

export function resetHomeCards(): void {
  write(DEFAULT_HOME_CARDS);
}
