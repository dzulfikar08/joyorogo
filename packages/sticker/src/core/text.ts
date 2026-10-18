import type { FontRole } from "./scene";

/**
 * Text: sanitize, measure with font advance tables (never the platform text engine),
 * fit. Tables are generated per app from the real font files; the engine only sees the
 * `FontMetrics` interface.
 */

/** Advance widths in 1/1000 em for code points `start..start+w.length-1`, plus extras. */
export type FontTable = {
  asc: number;
  desc: number;
  cap: number;
  xh: number;
  avg: number;
  start: number;
  w: number[];
  extra: Record<number, number>;
};

export type FontMetrics = {
  /** em */
  asc: number;
  desc: number;
  cap: number;
  xh: number;
  /** em advance of one code point */
  advance(cp: number): number;
};

export function createTableMetrics(table: FontTable): FontMetrics {
  return {
    asc: table.asc,
    desc: table.desc,
    cap: table.cap,
    xh: table.xh,
    advance(cp) {
      const i = cp - table.start;
      const direct = i >= 0 && i < table.w.length ? table.w[i] : undefined;
      if (direct != null) return direct / 1000;
      const extra = table.extra[cp];
      return (extra ?? table.avg) / 1000;
    },
  };
}

/** Monospace face: every glyph advances `em`. */
export function createMonoMetrics(
  em: number,
  vertical: Pick<FontMetrics, "asc" | "desc" | "cap" | "xh">,
): FontMetrics {
  return { ...vertical, advance: () => em };
}

export type FontPaint = { family: string; weight?: number };

export type FontMap = {
  metrics(role: FontRole, weight: number): FontMetrics;
  /** What painters set as font-family / font-weight. `weight` undefined = family already encodes it. */
  paint(role: FontRole, weight: number): FontPaint;
};

/** Nearest available weight from a table keyed by weight. */
export function nearestWeight<T>(tables: Record<number, T>, weight: number): T {
  let best: T | undefined;
  let bestDelta = Infinity;
  for (const key of Object.keys(tables)) {
    const delta = Math.abs(Number(key) - weight);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = tables[Number(key)];
    }
  }
  if (best === undefined) throw new Error("font table is empty");
  return best;
}

const SAFETY = 1.015;

// What the fonts can draw: Basic Latin, Latin-1 and Latin Extended-A/B, general punctuation
// (without the emoji-capable "!!" and "!?"), currency symbols and the four arrows. Everything else,
// emoji, joiners, variation selectors, controls and foreign scripts, is dropped instead of drawn as
// tofu. Written as plain ranges: Hermes does not implement Unicode property escapes reliably.
const UNSUPPORTED =
  /[^\u0020-\u007E\u00A1-\u00AC\u00AE-\u024F\u2010-\u2027\u2030-\u203B\u203D-\u2048\u204A-\u205E\u20A0-\u20BF\u2190-\u2193\u2212\u00D7]/gu;

/**
 * User text is stripped of emoji and anything the fonts cannot draw (rather than
 * painting tofu), whitespace collapsed, then cut to `maxChars` with an ellipsis.
 */
export function sanitizeText(input: string, maxChars = 140): string {
  let text = input.normalize("NFC").replace(/\s+/g, " ").replace(UNSUPPORTED, "").replace(/ +/g, " ").trim();
  const cps = Array.from(text);
  if (cps.length > maxChars) text = `${cps.slice(0, maxChars - 1).join("").trimEnd()}\u2026`;
  return text;
}

export function measureText(
  text: string,
  metrics: FontMetrics,
  size: number,
  letterSpacing = 0,
): number {
  let em = 0;
  let count = 0;
  for (const ch of text) {
    em += metrics.advance(ch.codePointAt(0) ?? 32);
    count++;
  }
  return em * size * SAFETY + letterSpacing * Math.max(0, count - 1);
}

export function ellipsize(
  text: string,
  metrics: FontMetrics,
  size: number,
  maxWidth: number,
  letterSpacing = 0,
): string {
  if (measureText(text, metrics, size, letterSpacing) <= maxWidth) return text;
  const chars = Array.from(text);
  let end = chars.length;
  while (end > 0) {
    const candidate = `${chars.slice(0, end).join("").trimEnd()}\u2026`;
    if (measureText(candidate, metrics, size, letterSpacing) <= maxWidth) return candidate;
    end--;
  }
  return "\u2026";
}

export type FitMode = "shrink" | "ellipsis" | "wrap";

export type FitResult = { lines: string[]; size: number; width: number };

/**
 * Fits `text` into `maxWidth`. shrink: reduce size 1 px at a time to `minSize`, then
 * ellipsize. ellipsis: cut at the given size. wrap: break on spaces up to `maxLines`,
 * last line ellipsized. `maxWidth` of Infinity never changes anything.
 */
export function fitText(
  text: string,
  metrics: FontMetrics,
  opts: {
    size: number;
    minSize: number;
    maxWidth: number;
    mode: FitMode;
    maxLines: number;
    letterSpacing?: number;
  },
): FitResult {
  const ls = opts.letterSpacing ?? 0;
  const { maxWidth } = opts;
  if (opts.mode === "wrap") return wrap(text, metrics, opts.size, maxWidth, opts.maxLines, ls);
  let size = opts.size;
  if (opts.mode === "shrink") {
    const floor = Math.min(opts.size, opts.minSize);
    while (size > floor && measureText(text, metrics, size, ls) > maxWidth) size--;
  }
  const line = ellipsize(text, metrics, size, maxWidth, ls);
  return { lines: [line], size, width: measureText(line, metrics, size, ls) };
}

function wrap(
  text: string,
  metrics: FontMetrics,
  size: number,
  maxWidth: number,
  maxLines: number,
  ls: number,
): FitResult {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const next = current ? `${current} ${word}` : word;
    if (measureText(next, metrics, size, ls) <= maxWidth || !current) {
      current = next;
      continue;
    }
    if (lines.length === maxLines - 1) break;
    lines.push(current);
    current = word;
  }
  if (i < words.length) current = [current, ...words.slice(i + 1)].join(" ");
  lines.push(ellipsize(current, metrics, size, maxWidth, ls));
  const width = Math.max(...lines.map((l) => measureText(l, metrics, size, ls)));
  return { lines, size, width };
}
