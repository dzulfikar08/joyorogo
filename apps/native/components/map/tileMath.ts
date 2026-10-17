/**
 * Web Mercator math for the tile map, using the MapLibre convention: one tile is 512 px at the zoom
 * of the same number, so the world is `512 * 2^zoom` px wide. Vector tiles exist up to zoom 14
 * (OpenFreeMap); above that the zoom-14 tile is scaled ("overzoom"). `LatLon` is `[lat, lon]`.
 */

export type LatLon = readonly [lat: number, lon: number];

export const TILE_SIZE = 512;
/** Highest zoom OpenFreeMap serves vector tiles for. */
export const MAX_TILE_ZOOM = 14;
/** fitBounds never zooms in past this. */
export const MAX_FIT_ZOOM = 16;
/** Pinch / buttons stop here (zoom 14 tile scaled 8x). */
export const MAX_VIEW_ZOOM = 17;
export const MIN_VIEW_ZOOM = 2;

const MAX_LAT = 85.0511287798066;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface View {
  lat: number;
  lon: number;
  zoom: number;
}

export interface CoverTile {
  /** Tile zoom (floor of the view zoom). Above 14 this is a virtual sub-tile of a zoom-14 tile. */
  z: number;
  /** Wrapped x, valid for the URL. */
  x: number;
  y: number;
  /** Unwrapped x index, used for placement only. */
  ux: number;
  /** Top-left of the tile on screen, relative to the viewport's top-left. */
  left: number;
  top: number;
  /** Rendered size of the tile on screen in px (512 * 2^(viewZoom - z)). */
  size: number;
  key: string;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Normalised Mercator: x, y in [0, 1] (y grows southwards). */
export function lonLatToMerc(lat: number, lon: number): WorldPoint {
  const clat = clamp(lat, -MAX_LAT, MAX_LAT);
  const s = Math.sin((clat * Math.PI) / 180);
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
  };
}

export function mercToLonLat(x: number, y: number): LatLon {
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lat, lon];
}

/** World pixel (origin at lon -180 / lat 85.05, y down) of a coordinate at `zoom`. */
export function lonLatToWorld(lat: number, lon: number, zoom: number): WorldPoint {
  const m = lonLatToMerc(lat, lon);
  const size = TILE_SIZE * 2 ** zoom;
  return { x: m.x * size, y: m.y * size };
}

export function worldToLonLat(x: number, y: number, zoom: number): LatLon {
  const size = TILE_SIZE * 2 ** zoom;
  return mercToLonLat(x / size, y / size);
}

/** Tile containing a coordinate at tile zoom `z`. */
export function lonLatToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const m = lonLatToMerc(lat, lon);
  const n = 2 ** z;
  return {
    x: clamp(Math.floor(m.x * n), 0, n - 1),
    y: clamp(Math.floor(m.y * n), 0, n - 1),
  };
}

/** Lon/lat bounds of a tile. */
export function tileBounds(z: number, x: number, y: number): Bounds {
  const n = 2 ** z;
  const [maxLat, minLon] = mercToLonLat(x / n, y / n);
  const [minLat, maxLon] = mercToLonLat((x + 1) / n, (y + 1) / n);
  return { minLat, maxLat, minLon, maxLon };
}

export function boundsOf(segments: readonly (readonly LatLon[])[]): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const seg of segments) {
    for (const [lat, lon] of seg) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  return minLat > maxLat ? null : { minLat, maxLat, minLon, maxLon };
}

/** Zoom of the tiles laid out for a view zoom (each one is 512..1024 px on screen). */
export function tileLayoutZoom(viewZoom: number): number {
  return clamp(Math.floor(viewZoom), 0, MAX_VIEW_ZOOM);
}

/** Zoom of the network tile that backs a view zoom: vector tiles end at 14, so 15-17 are overzoomed. */
export function tileFetchZoom(viewZoom: number): number {
  return Math.min(tileLayoutZoom(viewZoom), MAX_TILE_ZOOM);
}

/**
 * View that fits `bounds` inside `width` x `height` minus `padding` on every side. A single point
 * (zero extent) gets zoom 15. The zoom is capped at `maxZoom` (default 16).
 */
export function fitBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 0,
  maxZoom = MAX_FIT_ZOOM,
): View {
  const a = lonLatToMerc(bounds.maxLat, bounds.minLon);
  const b = lonLatToMerc(bounds.minLat, bounds.maxLon);
  const dx = Math.max(b.x - a.x, 0);
  const dy = Math.max(b.y - a.y, 0);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  let zoom = 15;
  if (dx > 0 || dy > 0) {
    const zx = dx > 0 ? Math.log2(availW / (TILE_SIZE * dx)) : Infinity;
    const zy = dy > 0 ? Math.log2(availH / (TILE_SIZE * dy)) : Infinity;
    zoom = Math.min(zx, zy);
  }
  zoom = clamp(zoom, MIN_VIEW_ZOOM, Math.min(maxZoom, MAX_VIEW_ZOOM));
  const [lat, lon] = mercToLonLat((a.x + b.x) / 2, (a.y + b.y) / 2);
  return { lat, lon, zoom };
}

/**
 * Tiles needed to cover the viewport (`width` x `height` centred on `view`) extended by
 * `marginX`/`marginY` px on each side. Tile placement is relative to the viewport's top-left.
 */
export function tileCover(
  view: View,
  width: number,
  height: number,
  marginX = 0,
  marginY = marginX,
): CoverTile[] {
  const z = tileLayoutZoom(view.zoom);
  const size = TILE_SIZE * 2 ** (view.zoom - z);
  const n = 2 ** z;
  const c = lonLatToWorld(view.lat, view.lon, view.zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const x0 = Math.floor((originX - marginX) / size);
  const x1 = Math.floor((originX + width + marginX) / size);
  const y0 = Math.max(0, Math.floor((originY - marginY) / size));
  const y1 = Math.min(n - 1, Math.floor((originY + height + marginY) / size));
  const out: CoverTile[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let ux = x0; ux <= x1; ux++) {
      const x = ((ux % n) + n) % n;
      out.push({
        z,
        x,
        y: ty,
        ux,
        left: ux * size - originX,
        top: ty * size - originY,
        size,
        key: `${z}/${x}/${ty}`,
      });
    }
  }
  return out;
}
