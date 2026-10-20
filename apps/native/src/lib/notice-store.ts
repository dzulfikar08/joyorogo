import {
  isNoticeExpanded,
  parseExpandedNotices,
  withNoticeExpanded,
  type ExpandedNotices,
} from "@joyorogo/api/lib/notice-state";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Which explanatory notices were opened, per notice id. Local only: how a notice is shown is not part of the account sync.
const KEY = "joyorogo.notices.expanded";

let current: ExpandedNotices = [];
let loadStarted = false;
const listeners = new Set<() => void>();

const read = () => current;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: ExpandedNotices): void {
  current = next;
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const stored = parseExpandedNotices(await SecureStore.getItemAsync(KEY));
    // Ids opened while the read was pending are kept next to the stored ones.
    publish([...new Set([...stored, ...current])]);
  } catch {
    // Unreadable store: everything stays collapsed.
  }
}

function setExpanded(id: string, open: boolean): void {
  const next = withNoticeExpanded(current, id, open);
  if (next === current) return;
  publish(next);
  void SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {
    // Best-effort: the session keeps the choice either way.
  });
}

/** Whether notice `id` is open, and a setter that remembers the choice. Collapsed until opened. */
export function useNoticeExpanded(id: string): [boolean, (open: boolean) => void] {
  useEffect(() => {
    void load();
  }, []);
  const getSnapshot = useCallback(() => isNoticeExpanded(read(), id), [id]);
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const set = useCallback((value: boolean) => setExpanded(id, value), [id]);
  return [open, set];
}
