/**
 * Turns a decoded vector tile into SVG path strings, one `d` per style layer.
 *
 * Output coordinates are in 512-px tile space (`TILE_SIZE`), y down. Colours and stroke widths are
 * NOT baked in (see `palette.ts`): the caller scales the tile by `2^(viewZoom - z)` and sets widths
 * per layer, so a theme change needs no re-render. Everything of a layer or road group is merged into
 * ONE path, empty paths are dropped, so a tile has at most ~23 nodes (typically 10 to 16).
 *
 * Overzoom: vector data stops at zoom 14. A tile at z 15-17 is a virtual sub-tile of its zoom-14
 * ancestor: the ancestor is scaled up and only features whose bounding box touches the sub-tile are
 * emitted, so every rendered tile is 512 px at its own zoom and its path data stays bounded.
 *
 * Simplification: points closer than 0.25 px are dropped, lines and rings go through Douglas-Peucker
 * (0.35 px), sub-pixel polygons/segments are skipped, numbers are rounded to 0.1 px. Buildings are
 * drawn from zoom 15, small waterways from zoom 12, tunnels never.
 */
import type { MvtFeature, MvtLayer, MvtTile } from './mvt';
import {
  AEROWAY_LINE_CLASSES,
  BOUNDARY_MAX_ADMIN_LEVEL,
  BUILDING_MIN_ZOOM,
  BUILT_LANDUSE_CLASSES,
  CASED_GROUPS,
  FILL_ORDER,
  GRASS_CLASSES,
  GREEN_LANDUSE_CLASSES,
  MINOR_WATERWAY_CLASSES,
  ROAD_GROUPS,
  WOOD_CLASSES,
  type RoadGroup,
} from './palette';
import { MAX_TILE_ZOOM, TILE_SIZE } from './tileMath';

/** Layers `decodeTile` needs to keep (everything else, e.g. poi and labels, is skipped). */
export const RENDER_LAYERS: ReadonlySet<string> = new Set([
  'landcover',
  'landuse',
  'park',
  'water',
  'waterway',
  'aeroway',
  'building',
  'transportation',
  'boundary',
]);

export type RenderedKind = 'fill' | 'line' | 'casing' | 'road';

export interface RenderedLayer {
  kind: RenderedKind;
  /** fill: wood|grass|landuse|park|water|building. line: waterway|aeroway|rail|boundary. casing/road: a RoadGroup. */
  id: string;
  d: string;
}

export interface RenderedTile {
  z: number;
  /** Bottom to top. */
  layers: RenderedLayer[];
}

export interface TileId {
  /** Zoom of the rendered tile; above 14 the tile is a sub-tile of its zoom-14 ancestor. */
  z: number;
  x: number;
  y: number;
}

/** The tile that holds the data for `id` (its zoom-14 ancestor above zoom 14). */
export function sourceTileOf(id: TileId): TileId {
  const sub = 2 ** Math.max(0, id.z - MAX_TILE_ZOOM);
  return { z: Math.min(id.z, MAX_TILE_ZOOM), x: Math.floor(id.x / sub), y: Math.floor(id.y / sub) };
}

const roadGroupOf = new Map<string, RoadGroup>();
for (const [group, classes] of Object.entries(ROAD_GROUPS) as [RoadGroup, readonly string[]][]) {
  for (const c of classes) roadGroupOf.set(c, group);
}

const STACK: readonly (readonly [RenderedKind, string])[] = [
  ['fill', 'wood'],
  ['fill', 'grass'],
  ['fill', 'landuse'],
  ['fill', 'park'],
  ['fill', 'water'],
  ['line', 'waterway'],
  ['line', 'aeroway'],
  ['fill', 'building'],
  ...CASED_GROUPS.map((g) => ['casing', g] as const),
  ...FILL_ORDER.map((g) => ['road', g] as const),
  ['line', 'rail'],
  ['line', 'boundary'],
];

/** Douglas-Peucker over flat `[x, y, ...]`; returns the kept flat coordinates (always keeps both ends). */
export function simplifyFlat(p: readonly number[], tol: number): number[] {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length > 0) {
    const hi = stack.pop()!;
    const lo = stack.pop()!;
    const ax = p[lo * 2];
    const ay = p[lo * 2 + 1];
    const dx = p[hi * 2] - ax;
    const dy = p[hi * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = p[i * 2] - ax;
      const py = p[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push(lo, idx, idx, hi);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

const ROUND = 10;
const TOLERANCE = 0.35;
const MIN_DIST2 = 0.25 * 0.25;
/** Features further than this outside a sub-tile are skipped (covers stroke widths). */
const CULL_MARGIN = 24;

interface Ctx {
  /** Source px -> tile px scale (2^(z-14) when overzoomed, else 1). */
  sub: number;
  /** Tile origin inside the scaled source tile, px. */
  ox: number;
  oy: number;
}

function num(v: number): string {
  return String(Math.round(v * ROUND) / ROUND);
}

/** Scales to tile px and drops near-duplicate points. Returns flat coordinates and bbox. */
function toPx(c: Int32Array, k: number, ctx: Ctx, closed: boolean) {
  const f = k * ctx.sub;
  const out: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let lx = 0;
  let ly = 0;
  const last = c.length - 2;
  for (let i = 0; i < c.length; i += 2) {
    const x = c[i] * f - ctx.ox;
    const y = c[i + 1] * f - ctx.oy;
    if (i > 0 && i < last) {
      const dx = x - lx;
      const dy = y - ly;
      if (dx * dx + dy * dy < MIN_DIST2) continue;
    }
    out.push(x, y);
    lx = x;
    ly = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // A ring's final point must differ from its first once the closing segment is implied.
  if (closed && out.length >= 4) {
    const n = out.length;
    const dx = out[n - 2] - out[0];
    const dy = out[n - 1] - out[1];
    if (dx * dx + dy * dy < MIN_DIST2) out.length = n - 2;
  }
  const outside =
    ctx.sub > 1 &&
    (maxX < -CULL_MARGIN ||
      minX > TILE_SIZE + CULL_MARGIN ||
      maxY < -CULL_MARGIN ||
      minY > TILE_SIZE + CULL_MARGIN);
  return { pts: out, w: maxX - minX, h: maxY - minY, outside };
}

function pathFor(pts: number[], close: boolean): string {
  let s = `M${num(pts[0])} ${num(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) {
    s += `L${num(pts[i])} ${num(pts[i + 1])}`;
  }
  return close ? `${s}Z` : s;
}

function linePath(c: Int32Array, k: number, ctx: Ctx): string | null {
  if (c.length < 4) return null;
  const { pts, w, h, outside } = toPx(c, k, ctx, false);
  if (outside || pts.length < 4 || w + h < 0.6) return null;
  const s = simplifyFlat(pts, TOLERANCE);
  return s.length < 4 ? null : pathFor(s, false);
}

function ringPath(c: Int32Array, k: number, ctx: Ctx, minSize: number): string | null {
  if (c.length < 6) return null;
  const { pts, w, h, outside } = toPx(c, k, ctx, true);
  if (outside || pts.length < 6 || Math.max(w, h) < minSize) return null;
  // Simplify as a closed polyline so the start/end seam is treated like any other vertex.
  const closed = simplifyFlat([...pts, pts[0], pts[1]], TOLERANCE);
  closed.length -= 2;
  return closed.length < 6 ? null : pathFor(closed, true);
}

/** Buildings with a bounding box smaller than this (tile px) are skipped. */
const BUILDING_MIN_SIZE = 1.5;

type Sink = Map<string, string[]>;

function put(sink: Sink, kind: RenderedKind, id: string, d: string | null) {
  if (!d) return;
  const key = `${kind}:${id}`;
  const list = sink.get(key);
  if (list) list.push(d);
  else sink.set(key, [d]);
}

function polygons(
  f: MvtFeature,
  k: number,
  ctx: Ctx,
  minSize: number,
  sink: Sink,
  kind: RenderedKind,
  id: string,
) {
  if (f.type !== 'polygon') return;
  // All rings of a feature in one subpath string so even-odd cuts holes.
  const parts: string[] = [];
  for (const ring of f.rings) {
    const d = ringPath(ring, k, ctx, minSize);
    if (d) parts.push(d);
  }
  if (parts.length > 0) put(sink, kind, id, parts.join(''));
}

function lines(
  f: MvtFeature,
  k: number,
  ctx: Ctx,
  sink: Sink,
  kind: RenderedKind,
  id: string,
  second?: [RenderedKind, string],
) {
  if (f.type !== 'line') return;
  for (const l of f.rings) {
    const d = linePath(l, k, ctx);
    put(sink, kind, id, d);
    if (second) put(sink, second[0], second[1], d);
  }
}

function eachFeature(layer: MvtLayer | undefined, fn: (f: MvtFeature, k: number) => void) {
  if (!layer) return;
  const k = TILE_SIZE / layer.extent;
  for (const f of layer.features) fn(f, k);
}

/**
 * Renders tile `id` from `tile`, the decoded tile `sourceTileOf(id)`. Coordinates come out in the
 * 512-px space of `id` itself (a sub-tile above zoom 14), so place it at `size / 512` scale.
 */
export function renderTile(tile: MvtTile, id: TileId): RenderedTile {
  const { z } = id;
  const sub = 2 ** Math.max(0, z - MAX_TILE_ZOOM);
  const ctx: Ctx = {
    sub,
    ox: (id.x % sub) * TILE_SIZE,
    oy: (id.y % sub) * TILE_SIZE,
  };
  const sink: Sink = new Map();
  const L = tile.layers;

  eachFeature(L.landcover, (f, k) => {
    const c = f.props.class;
    if (typeof c !== 'string') return;
    if (WOOD_CLASSES.includes(c)) polygons(f, k, ctx, 1, sink, 'fill', 'wood');
    else if (GRASS_CLASSES.includes(c)) polygons(f, k, ctx, 1, sink, 'fill', 'grass');
  });

  eachFeature(L.landuse, (f, k) => {
    const c = f.props.class;
    if (typeof c !== 'string') return;
    if (BUILT_LANDUSE_CLASSES.includes(c)) polygons(f, k, ctx, 1, sink, 'fill', 'landuse');
    else if (GREEN_LANDUSE_CLASSES.includes(c)) polygons(f, k, ctx, 1, sink, 'fill', 'park');
  });

  eachFeature(L.park, (f, k) => polygons(f, k, ctx, 1, sink, 'fill', 'park'));
  eachFeature(L.water, (f, k) => polygons(f, k, ctx, 1, sink, 'fill', 'water'));

  eachFeature(L.waterway, (f, k) => {
    if (f.props.brunnel === 'tunnel') return;
    const c = f.props.class;
    if (z < 12 && typeof c === 'string' && MINOR_WATERWAY_CLASSES.includes(c)) return;
    lines(f, k, ctx, sink, 'line', 'waterway');
  });

  eachFeature(L.aeroway, (f, k) => {
    const c = f.props.class;
    if (f.type === 'line' && typeof c === 'string' && AEROWAY_LINE_CLASSES.includes(c)) {
      lines(f, k, ctx, sink, 'line', 'aeroway');
    } else if (f.type === 'polygon') {
      polygons(f, k, ctx, 1, sink, 'fill', 'landuse');
    }
  });

  if (z >= BUILDING_MIN_ZOOM) {
    eachFeature(L.building, (f, k) => polygons(f, k, ctx, BUILDING_MIN_SIZE, sink, 'fill', 'building'));
  }

  eachFeature(L.transportation, (f, k) => {
    if (f.type !== 'line' || f.props.brunnel === 'tunnel') return;
    const c = f.props.class;
    if (typeof c !== 'string') return;
    if (c === 'rail') {
      if (f.props.subclass !== 'subway') lines(f, k, ctx, sink, 'line', 'rail');
      return;
    }
    const group = roadGroupOf.get(c);
    if (!group) return;
    lines(f, k, ctx, sink, 'road', group, CASED_GROUPS.includes(group) ? ['casing', group] : undefined);
  });

  eachFeature(L.boundary, (f, k) => {
    const level = f.props.admin_level;
    if (typeof level !== 'number' || level > BOUNDARY_MAX_ADMIN_LEVEL) return;
    if (f.props.maritime === 1) return;
    lines(f, k, ctx, sink, 'line', 'boundary');
  });

  const layers: RenderedLayer[] = [];
  for (const [kind, id] of STACK) {
    const parts = sink.get(`${kind}:${id}`);
    if (parts) layers.push({ kind, id, d: parts.join('') });
  }
  return { z, layers };
}
