import { useEffect, useState } from "react";

import { diffIds, MAX_ANIMATED_CHURN, useReducedMotion } from "@/lib/motion";

export type Presence = "enter" | "leave" | undefined;

type Ghost<T> = { item: T; index: number };

const NONE: ReadonlySet<string> = new Set();
const EXIT_MS = 200;
const ENTER_MS = 260;

/**
 * Lets a list animate single rows coming and going. Removed rows stay in the
 * returned `rows` for one exit beat, marked "leave"; rows that appear are
 * marked "enter". Anything bigger than a row or two (a day switch, a filter,
 * the first load) swaps silently: change `scope` for those so they never
 * animate. `isSame` pairs a removed and an added row that are one logical row
 * (an optimistic temp id swapped for the server id) so they don't flicker.
 * Nothing animates under reduced motion.
 */
export function usePresence<T extends { id: string }>(
  items: T[],
  scope: string,
  isSame?: (a: T, b: T) => boolean,
): { rows: T[]; presenceOf: (id: string) => Presence } {
  const reduced = useReducedMotion();
  const [track, setTrack] = useState({ scope, items });
  const [entering, setEntering] = useState(NONE);
  const [ghosts, setGhosts] = useState<Ghost<T>[]>([]);

  // Derived during render (not in an effect) so the first paint of a change
  // already carries the right marks.
  if (track.scope !== scope) {
    setTrack({ scope, items });
    setEntering(NONE);
    setGhosts([]);
  } else {
    const ids = items.map((item) => item.id);
    const { added, removed } = diffIds(
      track.items.map((item) => item.id),
      ids,
    );
    if (added.length > 0 || removed.length > 0) {
      setTrack({ scope, items });
      const addedRows = items.filter((item) => added.includes(item.id));
      const removedRows = track.items
        .map((item, index) => ({ item, index }))
        .filter((row) => removed.includes(row.item.id));
      const swappedIn = new Set<string>();
      const swappedOut = new Set<string>();
      if (isSame) {
        for (const out of removedRows) {
          const twin = addedRows.find((row) => !swappedIn.has(row.id) && isSame(out.item, row));
          if (twin) {
            swappedIn.add(twin.id);
            swappedOut.add(out.item.id);
          }
        }
      }
      const fresh = addedRows.filter((row) => !swappedIn.has(row.id));
      const gone = removedRows.filter((row) => !swappedOut.has(row.item.id));
      const animate =
        !reduced &&
        fresh.length + gone.length > 0 &&
        fresh.length + gone.length <= MAX_ANIMATED_CHURN;
      // A row that came back (undo) stops leaving.
      const kept = ghosts.filter((ghost) => !ids.includes(ghost.item.id));
      setGhosts(animate ? [...kept, ...gone] : kept);
      if (animate && fresh.length > 0) {
        setEntering(new Set([...entering, ...fresh.map((row) => row.id)]));
      }
    }
  }

  useEffect(() => {
    if (ghosts.length === 0) return;
    const timer = setTimeout(() => setGhosts([]), EXIT_MS);
    return () => clearTimeout(timer);
  }, [ghosts]);

  useEffect(() => {
    if (entering.size === 0) return;
    const timer = setTimeout(() => setEntering(NONE), ENTER_MS);
    return () => clearTimeout(timer);
  }, [entering]);

  const rows = [...items];
  for (const ghost of [...ghosts].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(ghost.index, rows.length), 0, ghost.item);
  }
  const leaving = new Set(ghosts.map((ghost) => ghost.item.id));
  return {
    rows,
    presenceOf: (id) => (leaving.has(id) ? "leave" : entering.has(id) ? "enter" : undefined),
  };
}
