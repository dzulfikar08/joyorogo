// Route map of a workout post (feed card and post detail): the privacy trim, the simplified polyline that
// leaves the server, and the little pure helpers every renderer shares. No I/O and no dependencies, so the
// server, web and native import this one file. JoyoFit keeps a verbatim copy at
// `src/features/social/feedRoute.ts`; change both together.
//
// What other people receive is `buildFeedMapLine`'s output and nothing else: the author's route with the first and
// last 200 m cut off (the same trim as the stickers), reduced to at most MAP_MAX_POINTS points and encoded as a
// Google polyline at 5 decimals (about 1 m). The full track stays in `post_workout_detail` for its author only.

export type LatLon = [lat: number, lon: number];

/** Cut from each end of the route, as the sticker engine's route privacy. */
export const MAP_TRIM_M = 200;
/** Points a shared line keeps; at most about 700 characters once encoded. */
export const MAP_MAX_POINTS = 100;
/** What must be left after the trim for a map to be shown at all (the stickers' 50 m floor). */
export const MAP_MIN_LEFT_M = 50;

const EARTH_R = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function validLatLon(p: readonly number[] | null | undefined): p is LatLon {
  return (
    !!p &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[0]!) <= 90 &&
    Math.abs(p[1]!) <= 180
  );
}

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeLengthM(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Removes `startM` from the beginning and `endM` from the end, measured along the route. Null when what is left is
 * shorter than `minLeftM` or has fewer than two points. The cut ends are interpolated, so the new first and last point
 * lie exactly `startM` / `endM` along the route.
 */
export function trimRoute(
  points: readonly LatLon[],
  startM: number,
  endM: number,
  minLeftM = MAP_MIN_LEFT_M,
): LatLon[] | null {
  if (points.length < 2) return null;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  const total = cum[cum.length - 1]!;
  const from = Math.max(0, startM);
  const to = total - Math.max(0, endM);
  if (to - from < minLeftM) return null;
  const at = (dist: number): { point: LatLon; index: number } => {
    for (let i = 1; i < cum.length; i++) {
      if (cum[i]! >= dist) {
        const span = cum[i]! - cum[i - 1]!;
        const t = span === 0 ? 0 : (dist - cum[i - 1]!) / span;
        const a = points[i - 1]!;
        const b = points[i]!;
        return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i };
      }
    }
    return { point: points[points.length - 1]!, index: points.length };
  };
  const first = at(from);
  const last = at(to);
  const out: LatLon[] = [first.point, ...points.slice(first.index, last.index), last.point];
  return out.length >= 2 ? out : null;
}

type XY = [number, number];

/** Metres east/north of the first point (equirectangular: fine at the scale of one workout). */
function toLocalMetres(points: readonly LatLon[]): XY[] {
  const lat0 = points[0]![0];
  const kx = Math.cos(rad(lat0)) * rad(1) * EARTH_R;
  const ky = rad(1) * EARTH_R;
  return points.map((p): XY => [(p[1] - points[0]![1]) * kx, (p[0] - lat0) * ky]);
}

function rdp(points: readonly XY[], epsilon: number): boolean[] {
  const keep = Array.from({ length: points.length }, () => false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const [ax, ay] = points[lo]!;
    const [bx, by] = points[hi]!;
    const len = Math.hypot(bx - ax, by - ay);
    let worst = 0;
    let index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i]!;
      const dist = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (dist > worst) {
        worst = dist;
        index = i;
      }
    }
    if (index !== -1 && worst > epsilon) {
      keep[index] = true;
      stack.push([lo, index], [index, hi]);
    }
  }
  return keep;
}

/**
 * Douglas-Peucker with a tolerance that grows (3 m, then x1.5 each round) until at most `maxPoints` remain. The first
 * and last point always stay, so the shape never loses its ends.
 */
export function simplifyRoute(points: readonly LatLon[], maxPoints = MAP_MAX_POINTS): LatLon[] {
  if (points.length <= 2) return [...points];
  const xy = toLocalMetres(points);
  let epsilon = 3;
  for (let round = 0; round < 40; round++) {
    const keep = rdp(xy, epsilon);
    const out = points.filter((_, i) => keep[i]);
    if (out.length <= maxPoints) return out;
    epsilon *= 1.5;
  }
  // Unreachable in practice (the tolerance outgrows any workout); keep the contract anyway.
  return [points[0]!, points[points.length - 1]!];
}

/** Google encoded polyline, precision 5. */
export function encodePolyline(points: readonly LatLon[]): string {
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p[0] * 1e5);
    const lon = Math.round(p[1] * 1e5);
    put(lat - prevLat);
    put(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

/** Inverse of {@link encodePolyline}; tolerant of truncated input. */
export function decodePolyline(encoded: string): LatLon[] {
  const out: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const read = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) return null;
      const b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
      if (shift > 30) return null;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = read();
    const dLon = read();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

/**
 * The only route shape that leaves the server for other people: trimmed by {@link MAP_TRIM_M} at both ends,
 * simplified, encoded. Null when there are fewer than two valid points or the trimmed route is too short.
 */
export function buildFeedMapLine(route: readonly (readonly number[] | null | undefined)[] | null | undefined): string | null {
  const points = (route ?? []).filter(validLatLon).map((p): LatLon => [p[0], p[1]]);
  const trimmed = trimRoute(points, MAP_TRIM_M, MAP_TRIM_M);
  if (!trimmed) return null;
  const line = simplifyRoute(trimmed);
  return line.length >= 2 ? encodePolyline(line) : null;
}

/** The decoded points of a shared line, or null when the string is empty or damaged. */
export function feedMapPoints(line: string | null | undefined): LatLon[] | null {
  if (!line) return null;
  const points = decodePolyline(line).filter(validLatLon);
  return points.length >= 2 ? points : null;
}

/**
 * Whether a post shows its map to others: the post's own switch (`stats.showMap`, on unless 0) and the author's
 * account switch (`profile.shareMaps`, on unless false) must both allow it.
 */
export function mapAllowed(postShowMap: unknown, authorShareMaps: boolean | null | undefined): boolean {
  return postShowMap !== 0 && authorShareMaps !== false;
}

export type SportKind = "run" | "walk" | "ride" | "swim" | "other";

/** Best guess of a sport kind from its name (Huawei and JoyoFit names, id or en); used when there is no analysis. */
export function sportKindFromName(name: string): SportKind {
  const n = name.toLowerCase();
  if (/(cycl|bike|bicycle|ride|sepeda|gowes)/.test(n)) return "ride";
  if (/(swim|renang)/.test(n)) return "swim";
  if (/(walk|hik|trek|jalan|mendaki)/.test(n)) return "walk";
  if (/(run|jog|lari|trail)/.test(n)) return "run";
  return "other";
}

export type PaceOrSpeed = { kind: "pace"; secPerKm: number } | { kind: "speed"; kmh: number };

/** Pace for run and walk, speed for ride; null for other sports or when distance or time is unusable. */
export function paceOrSpeed(kind: string | null | undefined, distanceM: number | null | undefined, movingSec: number | null | undefined): PaceOrSpeed | null {
  if (!distanceM || !movingSec || distanceM < 100 || movingSec <= 0) return null;
  if (kind === "run" || kind === "walk") return { kind: "pace", secPerKm: movingSec / (distanceM / 1000) };
  if (kind === "ride") return { kind: "speed", kmh: distanceM / 1000 / (movingSec / 3600) };
  return null;
}

export interface ProjectedRoute {
  /** Points in a `w x h` box, y down. */
  points: [number, number][];
}

/** Equirectangular fit of the route into `w x h` with `padding`, aspect preserved, centered; null for a degenerate route. */
export function projectRoute(points: readonly LatLon[], w: number, h: number, padding: number): ProjectedRoute | null {
  if (points.length < 2) return null;
  const meanLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kx = Math.cos(rad(meanLat));
  const raw = points.map((p): XY => [p[1] * kx, -p[0]]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX === 0 && spanY === 0) return null;
  const innerW = Math.max(1, w - padding * 2);
  const innerH = Math.max(1, h - padding * 2);
  const scale = Math.min(spanX === 0 ? Infinity : innerW / spanX, spanY === 0 ? Infinity : innerH / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return { points: raw.map(([x, y]): [number, number] => [offX + (x - minX) * scale, offY + (y - minY) * scale]) };
}

/** SVG path data (`M x y L x y ...`) with one decimal. */
export function svgPathData(points: readonly (readonly [number, number])[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}
