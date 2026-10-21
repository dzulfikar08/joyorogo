/**
 * The Sogan header decoration: the batik kawung, drawn from plain geometry. Ported from the JoyoFit app (watch-fit
 * `src/theme/decorations.ts`, kawung only) so the web draws the same motif.
 *
 * A lattice of circles that overlap in pairs (spacing `d`, radius `d / sqrt(2)`). Each overlap is a lens (outlined), each of the
 * four-arc gaps between them a seed (filled, with a dot), the whole lattice turned 45 degrees. A traditional public-domain motif,
 * in two tones: `a` the seeds, `b` the lens outlines and dots. Every piece fades with its distance from the top-right corner, so
 * the motif dissolves into the canvas instead of ending at an edge.
 */

/** The box of the decoration, in px: anchored to the top-right corner of the page. */
export const KAWUNG_WIDTH = 232;
export const KAWUNG_HEIGHT = 168;

export interface KawungPath {
  d: string;
  tone: "a" | "b";
  kind: "fill" | "stroke";
  /** Stroke width in px (0 for a fill). */
  strokeWidth: number;
  opacity: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Pieces within 0.02 of opacity share a path, so the motif is a few dozen paths, not hundreds. */
const OPACITY_STEP = 0.02;

/** 1 at the top-right corner, 0 on the left edge and the bottom edge of the box, eased in between. */
function fade(x: number, y: number, width: number, height: number): number {
  const t = Math.hypot((width - x) / width, y / height);
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k * (3 - 2 * k);
}

function circle(cx: number, cy: number, r: number): string {
  return `M${round(cx - r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx + r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx - r)} ${round(cy)}Z`;
}

export function kawungPaths(width = KAWUNG_WIDTH, height = KAWUNG_HEIGHT): KawungPath[] {
  const paths = new Map<string, KawungPath>();
  const add = (tone: "a" | "b", kind: "fill" | "stroke", strokeWidth: number, opacity: number, d: string) => {
    const step = Math.round(opacity / OPACITY_STEP);
    if (step < 1) return;
    const w = kind === "stroke" ? round(strokeWidth) : 0;
    const key = `${tone}|${kind}|${w}|${step}`;
    const known = paths.get(key);
    if (known) known.d += d;
    else paths.set(key, { d, tone, kind, strokeWidth: w, opacity: step * OPACITY_STEP });
  };

  const d = 22;
  const r = d / Math.SQRT2;
  const h = d / 2;
  const cos = Math.SQRT1_2;
  const sin = Math.SQRT1_2;
  // The lattice origin sits half a cell off the corner so that no seed is centered on the page edge.
  const ox = width - 0.3 * d;
  const oy = 0.2 * d;
  const at = (x: number, y: number): [number, number] => [ox + x * cos - y * sin, oy + x * sin + y * cos];
  const p = (x: number, y: number) => {
    const [px, py] = at(x, y);
    return `${round(px)} ${round(py)}`;
  };
  const arc = (sweep: 0 | 1) => `A${round(r)} ${round(r)} 0 0 ${sweep} `;
  const reach = Math.ceil(Math.hypot(width, height) / d) + 1;
  const dot = 0.09 * d;
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const x = i * d;
      const y = j * d;
      // A seed: the concave diamond around a lattice point, its corners on the four neighboring cell centers.
      const [cx, cy] = at(x, y);
      const f = fade(cx, cy, width, height);
      if (f > 0.02) {
        const seed =
          `M${p(x - h, y - h)}${arc(0)}${p(x + h, y - h)}${arc(0)}${p(x + h, y + h)}` +
          `${arc(0)}${p(x - h, y + h)}${arc(0)}${p(x - h, y - h)}Z`;
        add("a", "fill", 0, 0.26 * f, seed);
        add("b", "fill", 0, 0.75 * f, circle(cx, cy, dot));
      }
      // The two lenses at this point's right and lower edges: the overlap of this circle with its right and lower neighbor.
      const [hx, hy] = at(x + h, y);
      const fh = fade(hx, hy, width, height);
      if (fh > 0.02) {
        const lens = `M${p(x + h, y - h)}${arc(1)}${p(x + h, y + h)}${arc(1)}${p(x + h, y - h)}Z`;
        add("b", "fill", 0, 0.12 * fh, lens);
        add("b", "stroke", 1.1, 0.5 * fh, lens);
      }
      const [vx, vy] = at(x, y + h);
      const fv = fade(vx, vy, width, height);
      if (fv > 0.02) {
        const lens = `M${p(x - h, y + h)}${arc(1)}${p(x + h, y + h)}${arc(1)}${p(x - h, y + h)}Z`;
        add("b", "fill", 0, 0.12 * fv, lens);
        add("b", "stroke", 1.1, 0.5 * fv, lens);
      }
    }
  }
  return [...paths.values()];
}
