import { useSyncExternalStore } from "react";

import {
  isNoticeExpanded,
  parseExpandedNotices,
  withNoticeExpanded,
} from "@joyorogo/api/lib/notice-state";
import type { ExpandedNotices } from "@joyorogo/api/lib/notice-state";

// Which Beranda notices are open. Everything starts collapsed; opening one is remembered per notice id on this device.
const STORE_KEY = "joyorogo.notices.expanded";
const COLLAPSED: ExpandedNotices = [];

let current: ExpandedNotices | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): ExpandedNotices {
  current ??= parseExpandedNotices(readRaw());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORE_KEY && event.key !== null) return;
    current = parseExpandedNotices(readRaw());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setNoticeExpanded(id: string, open: boolean): void {
  const next = withNoticeExpanded(snapshot(), id, open);
  if (next === snapshot()) return;
  current = next;
  try {
    if (next.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the notice still opens for this visit.
  }
  for (const listener of listeners) listener();
}

export function useNoticeExpanded(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isNoticeExpanded(snapshot(), id),
    () => isNoticeExpanded(COLLAPSED, id),
  );
}
