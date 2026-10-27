/**
 * "Mungkin juga": up to two other dishes the scan thinks an item could be (nasi kuning → nasi uduk, nasi
 * liwet), offered under the row as one-tap chips. The model writes them in the scan answer (`alt`, see
 * vision.ts); this module is the one place that turns whatever it wrote into a clean list, and the one
 * place that moves the list along when a correction changes the rows.
 */

/** Chips per row; the prompt asks for the same number. */
export const MAX_ALTERNATES = 2;
/**
 * A row under this share of the plate's kcal gets no chips: a garnish, a cracker or a spoon of sambal cannot move the
 * total (the model offered alternates on 83-95% of items, mostly such rows, and the chips that mattered were on rows
 * holding 24% or more of the plate: eval 2026-10-27).
 */
export const ALT_MIN_KCAL_SHARE = 0.15;
/** Same cut as the item names in the ledger (scan-outcome.ts compactItems). */
const MAX_ALTERNATE_CHARS = 80;

/** `Nasi  Uduk.` and `nasi uduk` are one dish: letters and digits only, lower-cased. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** "nasi" for "nasi putih", "martabak" for "martabak telur": a broader name for the same item is no other dish. */
function broaderThan(alt: string, own: string): boolean {
  const ownWords = new Set(words(own));
  const altWords = words(alt);
  return altWords.length > 0 && altWords.every((word) => ownWords.has(word));
}

/**
 * The usable alternates of one item, or undefined. `raw` is what the model wrote under `alt`: an array of
 * names (a lone string counts as one name, `a | b` or `a, b` as two). Names are trimmed and cut, a name that
 * is the item's own, only words of it ("nasi" for "nasi putih"), empty or not text is dropped, repeats collapse,
 * and at most MAX_ALTERNATES stay.
 * Nothing here may throw or reject an item: a garbled `alt` only means no chips.
 */
export function normalizeAlternates(raw: unknown, ...own: string[]): string[] | undefined {
  const entries = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s*[|,;]\s*/) : [];
  const seen = new Set(own.map(key));
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const name = entry.replace(/\s+/g, " ").trim().slice(0, MAX_ALTERNATE_CHARS).trim();
    const k = key(name);
    if (k === "" || seen.has(k) || own.some((o) => broaderThan(name, o))) continue;
    seen.add(k);
    out.push(name);
    if (out.length === MAX_ALTERNATES) break;
  }
  return out.length > 0 ? out : undefined;
}

/** The final list of a scan with `alt` kept only on the rows that carry ALT_MIN_KCAL_SHARE of its kcal. */
export function withMaterialAlternates<T extends { kcal: number; alt?: string[] }>(items: T[]): T[] {
  const total = items.reduce((sum, item) => sum + item.kcal, 0);
  return items.map((item) => {
    if (item.alt === undefined || item.kcal >= ALT_MIN_KCAL_SHARE * total) return item;
    const { alt: _alt, ...rest } = item;
    return rest as T;
  });
}

type Named = { name: string; alt?: string[] };

/** The slice of an ai.correctScan answer that carries the alternates along. */
type Corrected = {
  items: Named[];
  origins: Array<number | null>;
  changes: Array<{ index: number; kind: string }>;
};

/**
 * The correction answer with the alternates put back. ai.correctScan echoes no `alt`, so rows the correction
 * left alone (`origins` points at the sent row, no change) keep theirs. A row the user just renamed by tapping
 * `tap.name` (an alternate of the row at `tap.index`) offers the other alternate and the name it replaced,
 * so one tap goes back; a row renamed any other way, or added, has none. Rows that already carry `alt`
 * are left as they are.
 */
export function carryAlternates<R extends Corrected>(
  result: R,
  sent: readonly Named[],
  tap?: { index: number; name: string },
): R {
  const changed = new Set(result.changes.map((change) => change.index));
  const items = result.items.map((item, index) => {
    if (item.alt !== undefined) return item;
    const origin = result.origins[index];
    const before = origin == null ? undefined : sent[origin];
    if (!before) return item;
    if (!changed.has(index)) return before.alt ? { ...item, alt: before.alt } : item;
    if (tap && origin === tap.index) {
      const alt = normalizeAlternates([before.name, ...(before.alt ?? [])], item.name);
      return alt ? { ...item, alt } : item;
    }
    return item;
  });
  return { ...result, items };
}
