/** The distances a km pill may stand for, in km. A route shows every pill whose km is a multiple of one of these. */
export const KM_STEPS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** At most this many km pills at once: more than that and the pills hide the line they are meant to annotate. */
export const MAX_KM_PILLS = 12;

export interface KmCandidate {
  /** Whole kilometre. */
  km: number;
  /** Screen position of the marker (centre). */
  x: number;
  y: number;
  /** Size of the pill drawn there, px. */
  w: number;
  h: number;
}

export interface FixedBox {
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which km pills to draw. Takes the pills that are on screen (the caller filters), finds the smallest step of `KM_STEPS`
 * at which at most `MAX_KM_PILLS` remain, then drops every pill that would overlap an earlier one or one of `fixed`
 * (the start and finish markers). Zoomed out over a 157 km ride that is a pill every 20 km; zoomed in on one valley the
 * same function shows every kilometre again. An out-and-back keeps the first pass's pill and drops the return's where
 * the two meet. Returns the kept `km` values in input order. Ported from JoyoFit's `pickKmPills`.
 */
export function pickKmPills(
  candidates: readonly KmCandidate[],
  fixed: readonly FixedBox[] = [],
  gap = 4,
  max = MAX_KM_PILLS,
): number[] {
  let subset: readonly KmCandidate[] = candidates;
  for (const step of KM_STEPS) {
    subset = candidates.filter((c) => c.km % step === 0);
    if (subset.length <= max) break;
  }
  const kept: KmCandidate[] = [];
  for (const c of subset) {
    const blocked = [...fixed, ...kept].some(
      (o) => Math.abs(c.x - o.x) < (c.w + o.w) / 2 + gap && Math.abs(c.y - o.y) < (c.h + o.h) / 2 + gap,
    );
    if (!blocked) kept.push(c);
  }
  return kept.map((c) => c.km);
}
