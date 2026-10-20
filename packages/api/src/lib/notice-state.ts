/**
 * Which explanatory notices the person has opened. A notice starts collapsed to one row; opening it is remembered per
 * notice id, so a hint that was read stays out of the way and one that was opened stays open. Pure parsing and updates,
 * shared by native and web; each app does its own storage.
 */

/** Ids of the notices that are expanded. Everything else is collapsed. */
export type ExpandedNotices = readonly string[];

/** The stored ids; damaged text, a non-array or non-string entries give an empty list (all collapsed). */
export function parseExpandedNotices(raw: string | null | undefined): ExpandedNotices {
  if (raw === null || raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

export function isNoticeExpanded(expanded: ExpandedNotices, id: string): boolean {
  return expanded.includes(id);
}

/** `expanded` with `id` opened or closed; the same array when nothing changes, so a store can skip the notification. */
export function withNoticeExpanded(expanded: ExpandedNotices, id: string, open: boolean): ExpandedNotices {
  const has = expanded.includes(id);
  if (open === has) return expanded;
  return open ? [...expanded, id] : expanded.filter((e) => e !== id);
}
