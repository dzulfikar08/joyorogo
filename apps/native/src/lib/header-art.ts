/**
 * Header art: the faint motif behind the top-right of the main tab screens. Pure geometry (no React Native imports) so it is
 * testable under bun; `components/header-art.tsx` draws it with react-native-svg.
 *
 * It is a dot-matrix grid in the brand green that dissolves toward the left and the bottom, with three cat paw prints in the
 * mascot's crown gold walking out of the corner (Joyo is a green cat with a gold crown). Every piece's opacity falls with its
 * distance from the top-right corner, so the motif fades into the canvas instead of ending at an edge.
 */

export const HEADER_ART_WIDTH = 232;
export const HEADER_ART_HEIGHT = 168;

export type ArtTone = "grid" | "paw";

export interface ArtPath {
  d: string;
  tone: ArtTone;
  opacity: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Pieces within one step of opacity share a path, so the art is a few dozen paths rather than hundreds. */
const OPACITY_STEP = 0.02;

/** 1 in the corner, 0 at a quarter-ellipse of the box's size, smooth in between. */
function fade(x: number, y: number, width: number, height: number): number {
  const t = Math.hypot((width - x) / width, y / height);
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k * (3 - 2 * k);
}

function circle(cx: number, cy: number, r: number): string {
  return `M${round(cx - r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx + r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx - r)} ${round(cy)}Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, angle: number): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x0 = cx - rx * cos;
  const y0 = cy - rx * sin;
  const x1 = cx + rx * cos;
  const y1 = cy + rx * sin;
  return `M${round(x0)} ${round(y0)}A${round(rx)} ${round(ry)} ${round((angle * 180) / Math.PI)} 1 0 ${round(x1)} ${round(y1)}A${round(rx)} ${round(ry)} ${round((angle * 180) / Math.PI)} 1 0 ${round(x0)} ${round(y0)}Z`;
}

/** A paw print centred on (cx, cy), pointing along `angle` (radians, 0 = up): one pad and four toes. */
function paw(cx: number, cy: number, size: number, angle: number): string {
  const rotate = (x: number, y: number): [number, number] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  };
  const [padX, padY] = rotate(0, 0.28 * size);
  let d = ellipse(padX, padY, 0.34 * size, 0.27 * size, angle);
  const toes: [number, number][] = [
    [-0.46, -0.04],
    [-0.16, -0.36],
    [0.16, -0.36],
    [0.46, -0.04],
  ];
  for (const [x, y] of toes) {
    const [tx, ty] = rotate(x * size, y * size);
    d += circle(tx, ty, 0.13 * size);
  }
  return d;
}

export function headerArtPaths(width: number, height: number): ArtPath[] {
  const s = width / HEADER_ART_WIDTH;
  const merged = new Map<string, ArtPath>();
  const add = (tone: ArtTone, opacity: number, d: string) => {
    const step = Math.round(opacity / OPACITY_STEP);
    if (step < 1) return;
    const key = `${tone}|${step}`;
    const known = merged.get(key);
    if (known) known.d += d;
    else merged.set(key, { d, tone, opacity: step * OPACITY_STEP });
  };

  const pitch = 13 * s;
  const radius = 1.25 * s;
  const cols = Math.ceil(width / pitch);
  const rows = Math.ceil(height / pitch);
  for (let col = 0; col <= cols; col++) {
    for (let row = 0; row <= rows; row++) {
      const x = width - col * pitch - pitch / 2;
      const y = row * pitch + pitch / 2;
      add("grid", 0.6 * fade(x, y, width, height), circle(x, y, radius));
    }
  }

  // Prints step down and to the left of the corner, each smaller and fainter, tilted as if walking.
  const prints: [number, number, number, number][] = [
    [0.6, 0.18, 19, -0.5],
    [0.4, 0.4, 15, -0.3],
    [0.22, 0.62, 12, -0.6],
  ];
  for (const [fx, fy, size, angle] of prints) {
    const x = width * fx;
    const y = height * fy;
    add("paw", 0.6 * Math.max(fade(x, y, width, height), 0.5), paw(x, y, size * s, angle));
  }
  return [...merged.values()];
}
