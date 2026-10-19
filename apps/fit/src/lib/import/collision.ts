import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

/** Over this share of the file's own time span, a stored workout is the same activity (watch-fit importFit.ts OVERLAP_SHARE). */
export const OVERLAP_SHARE = 0.5;

export type Collision = { kind: "duplicate" | "overlap"; with: FitWebWorkout } | null;

/**
 * Whether a workout the account already has is this file's activity. The cloud keys a workout by its start second, so
 * the same start would REPLACE it (a watch workout with its richer analysis could be overwritten by a thinner import):
 * that is a duplicate. A stored workout that covers most of the file's span is an overlap (the same effort recorded by two
 * devices, or the watch's copy of it). Either way the file is not uploaded.
 */
export function findCollision(
  file: { start: number; end: number },
  existing: readonly FitWebWorkout[],
): Collision {
  const same = existing.find((w) => w.start === file.start);
  if (same) return { kind: "duplicate", with: same };
  const span = file.end - file.start;
  if (span <= 0) return null;
  let best: { w: FitWebWorkout; share: number } | null = null;
  for (const w of existing) {
    const overlap = Math.min(file.end, w.start + w.elapsedSec) - Math.max(file.start, w.start);
    const share = overlap / span;
    if (share > OVERLAP_SHARE && (!best || share > best.share)) best = { w, share };
  }
  return best ? { kind: "overlap", with: best.w } : null;
}
