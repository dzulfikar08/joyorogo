import { useEffect, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the visitor asked the OS for less motion. Live: follows the setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export type PresenceDiff = { added: string[]; removed: string[] };

/** Ids that appeared in / disappeared from an ordered list between two renders. */
export function diffIds(previous: readonly string[], next: readonly string[]): PresenceDiff {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: next.filter((id) => !before.has(id)),
    removed: previous.filter((id) => !after.has(id)),
  };
}

const visited = new Set<string>();

/**
 * True only the first time `key` mounts in this session. For entrances that
 * should play once (a dashboard rising in after sign-in) but not every time the
 * visitor returns to the tab; the value is frozen for the component's lifetime.
 */
export function useFirstVisit(key: string): boolean {
  const [first] = useState(() => !visited.has(key));
  useEffect(() => {
    visited.add(key);
  }, [key]);
  return first;
}

/** Largest add+remove churn that still reads as "one row came or went" rather than a list swap. */
export const MAX_ANIMATED_CHURN = 2;
