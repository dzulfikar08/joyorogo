// Dish-name agreement between a model answer and a saved (true) item list.
// Shared by the eval harness (scripts/eval-scans.ts) and the daily accuracy
// regression run in the Worker (accuracy-job), so both score the same way.
import { TKPI_DISHES } from "./tkpi";

export type MatchItem = { name: string; grams?: number; kcal: number };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// TKPI dish library: name + aliases -> canonical dish, longest key wins (as tkpi.ts matches).
const TKPI_KEYS = TKPI_DISHES.flatMap((dish) =>
  [dish.name, ...dish.aliases].map((key) => ({ key: normalize(key), canon: dish.name })),
)
  .filter((entry) => entry.key.length >= 4)
  .sort((a, b) => b.key.length - a.key.length);

/** The library dish a name stands for, or null. */
function canonOf(name: string): string | null {
  const q = ` ${normalize(name)} `;
  return TKPI_KEYS.find((entry) => q.includes(` ${entry.key} `))?.canon ?? null;
}

function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

/**
 * 0..1 name agreement. Two different library dishes never match; the same
 * library dish (alias included) always does; otherwise token overlap or
 * spelling distance decides.
 */
export function nameScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ca = canonOf(a);
  const cb = canonOf(b);
  if (ca && cb) return ca === cb ? 1 : 0;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = shared / (ta.size + tb.size - shared);
  return Math.max(jaccard, editSimilarity(na, nb));
}

export const NAME_MATCH_MIN = 0.5;

/** One-to-one greedy pairing of answer items with truth items by name score. */
export function pairItems<T extends MatchItem>(
  ai: readonly T[],
  truth: readonly T[],
): Array<{ ai: T; truth: T }> {
  const scored = ai.flatMap((a, i) =>
    truth.map((t, j) => ({ i, j, score: nameScore(a.name, t.name) })),
  );
  scored.sort((x, y) => y.score - x.score);
  const usedAi = new Set<number>();
  const usedTruth = new Set<number>();
  const pairs: Array<{ ai: T; truth: T }> = [];
  for (const { i, j, score } of scored) {
    if (score < NAME_MATCH_MIN) break;
    if (usedAi.has(i) || usedTruth.has(j)) continue;
    usedAi.add(i);
    usedTruth.add(j);
    pairs.push({ ai: ai[i]!, truth: truth[j]! });
  }
  return pairs;
}
