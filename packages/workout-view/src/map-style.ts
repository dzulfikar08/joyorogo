/**
 * Map look shared by the React Native tile renderer (`renderTile` + `TileMap`) and MapLibre GL on the web.
 *
 * - `lightPalette` / `darkPalette`: muted basemaps (a Strava-like light map, a dark-matter-like dark
 *   map) so a bright route line stands out. `paletteFor(theme)` picks one.
 * - `STROKE_WIDTHS`: screen-pixel widths per road/line layer as zoom stops. `strokeWidthAt()` evaluates
 *   them for RN (exponential interpolation, base 1.4); `maplibreStyle()` emits the same stops as a
 *   MapLibre `interpolate` expression.
 * - `ROAD_GROUPS`, `LANDUSE_CLASSES`, ... are the class tables used both by `renderTile` and by the
 *   MapLibre filters, so both renderers draw the same features.
 * - `maplibreStyle(theme)`: MapLibre GL style JSON (version 8), OpenFreeMap vector source
 *   (`https://tiles.openfreemap.org/planet` TileJSON), no glyphs or labels. Usage on web:
 *   `new maplibregl.Map({ container, style: maplibreStyle('light') })`.
 *
 * Attribution required by OpenFreeMap: "OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap".
 */

export type MapTheme = 'light' | 'dark';

export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const ATTRIBUTION_TEXT = '© OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
export const ATTRIBUTION_URL = 'https://openfreemap.org';

export type RoadGroup =
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'minor'
  | 'service'
  | 'path';

/** `transportation.class` values per drawn road group. Everything else (ferry, transit, ...) is not drawn. */
export const ROAD_GROUPS: Record<RoadGroup, readonly string[]> = {
  motorway: ['motorway', 'trunk'],
  primary: ['primary'],
  secondary: ['secondary'],
  tertiary: ['tertiary'],
  minor: ['minor', 'raceway'],
  service: ['service', 'track'],
  path: ['path', 'pedestrian'],
};

/** Road groups with a casing, bottom to top. */
export const CASED_GROUPS: readonly RoadGroup[] = [
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'motorway',
];
/** Road fill order, bottom to top. */
export const FILL_ORDER: readonly RoadGroup[] = [
  'service',
  'path',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'motorway',
];

export const WOOD_CLASSES: readonly string[] = ['wood'];
export const GRASS_CLASSES: readonly string[] = ['grass', 'farmland', 'wetland'];
/** `landuse.class` drawn green like parks. */
export const GREEN_LANDUSE_CLASSES: readonly string[] = [
  'garden',
  'playground',
  'pitch',
  'recreation_ground',
  'cemetery',
  'zoo',
  'golf_course',
  'track',
];
/** `landuse.class` drawn as a quiet built-up tint. */
export const BUILT_LANDUSE_CLASSES: readonly string[] = [
  'residential',
  'suburb',
  'neighbourhood',
  'quarter',
  'commercial',
  'industrial',
  'retail',
  'hospital',
  'school',
  'university',
  'college',
  'military',
];
export const AEROWAY_LINE_CLASSES: readonly string[] = ['runway', 'taxiway'];
/** `waterway.class` too small to draw below zoom 12. */
export const MINOR_WATERWAY_CLASSES: readonly string[] = ['stream', 'ditch', 'drain'];
export const BUILDING_MIN_ZOOM = 15;
export const BOUNDARY_MAX_ADMIN_LEVEL = 4;

export interface MapPalette {
  background: string;
  wood: string;
  grass: string;
  park: string;
  landuse: string;
  water: string;
  waterway: string;
  building: string;
  aeroway: string;
  roads: Record<RoadGroup, string>;
  /** Casing colour per cased road group. */
  casing: string;
  rail: string;
  boundary: string;
}

export const lightPalette: MapPalette = {
  background: '#f3f1ec',
  wood: '#d9e5cd',
  grass: '#e6eddb',
  park: '#dde9d1',
  landuse: '#ebe8e0',
  water: '#c5d9e8',
  waterway: '#b9d0e2',
  building: '#e4e0d7',
  aeroway: '#e0dcd2',
  roads: {
    motorway: '#f6dfae',
    primary: '#fbebc9',
    secondary: '#ffffff',
    tertiary: '#ffffff',
    minor: '#ffffff',
    service: '#fbfaf7',
    path: '#d9d3c6',
  },
  casing: '#cfc9bb',
  rail: '#c9c5bb',
  boundary: '#b9b3c4',
};

export const darkPalette: MapPalette = {
  background: '#1c1e22',
  wood: '#212a23',
  grass: '#232b25',
  park: '#222c25',
  landuse: '#212327',
  water: '#12161c',
  waterway: '#161b22',
  building: '#292b30',
  aeroway: '#2a2c31',
  roads: {
    motorway: '#4a4538',
    primary: '#434248',
    secondary: '#3b3d43',
    tertiary: '#35373c',
    minor: '#303237',
    service: '#2a2c30',
    path: '#3a3d43',
  },
  casing: '#16181b',
  rail: '#3a3d43',
  boundary: '#5c6270',
};

export function paletteFor(theme: MapTheme): MapPalette {
  return theme === 'dark' ? darkPalette : lightPalette;
}

export type Stops = readonly (readonly [zoom: number, width: number])[];

export type StrokeLayer = RoadGroup | 'rail' | 'waterway' | 'aeroway' | 'boundary';

/** Screen-pixel widths by zoom (MapLibre zoom: 512 px tiles). */
export const STROKE_WIDTHS: Record<StrokeLayer, Stops> = {
  motorway: [[5, 0.6], [10, 1.4], [14, 3.8], [16, 8], [18, 14]],
  primary: [[8, 0.4], [12, 1.2], [14, 3], [16, 6.5], [18, 12]],
  secondary: [[10, 0.5], [13, 1.3], [14, 2.4], [16, 5.5], [18, 10]],
  tertiary: [[11, 0.5], [13, 1], [14, 2], [16, 4.8], [18, 9]],
  minor: [[12, 0.4], [14, 1.5], [16, 3.8], [18, 7.5]],
  service: [[13, 0.3], [14, 0.9], [16, 2.4], [18, 5]],
  path: [[13, 0.5], [14, 0.8], [16, 1.3], [18, 2]],
  rail: [[10, 0.5], [14, 1], [16, 1.6], [18, 2.4]],
  waterway: [[8, 0.4], [12, 0.8], [14, 1.6], [16, 3.5], [18, 8]],
  aeroway: [[10, 1], [13, 3], [14, 6], [16, 22], [18, 60]],
  boundary: [[2, 0.5], [8, 0.9], [14, 1.4], [18, 2]],
};

const WIDTH_BASE = 1.4;

/** Exponential interpolation matching MapLibre's `["exponential", 1.4]`. */
export function interpolateStops(stops: Stops, zoom: number): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (zoom <= first[0]) return first[1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, w1] = stops[i];
    if (zoom <= z1) {
      const [z0, w0] = stops[i - 1];
      const d = z1 - z0;
      const t = (WIDTH_BASE ** (zoom - z0) - 1) / (WIDTH_BASE ** d - 1);
      return w0 + (w1 - w0) * t;
    }
  }
  return last[1];
}

export function strokeWidthAt(layer: StrokeLayer, zoom: number): number {
  return interpolateStops(STROKE_WIDTHS[layer], zoom);
}

/** Casing is the fill width plus a hairline border on each side. */
export function casingWidthFor(fillWidth: number): number {
  return fillWidth + Math.min(1.4, 0.5 + fillWidth * 0.12);
}

export function casingWidthAt(group: RoadGroup, zoom: number): number {
  return casingWidthFor(strokeWidthAt(group, zoom));
}

/** Dash pattern (in screen px multiples of stroke width) for dashed layers. */
export const PATH_DASH = [2.2, 1.6] as const;
export const BOUNDARY_DASH = [4, 2] as const;

export interface LayerPaint {
  /** Fill colour for polygon layers. */
  fill?: string;
  /** Stroke colour and screen-px width for line layers. */
  stroke?: string;
  width: number;
  /** Dash lengths in screen px. */
  dash?: readonly number[];
}

const FILL_COLOR_KEYS = ['wood', 'grass', 'landuse', 'park', 'water', 'building'] as const;

/**
 * How a `renderTile` layer (`kind` + `id`) is painted at `zoom`, in screen px. The caller divides
 * widths and dashes by the tile's scale (`2^(zoom - tile.z)`) when the tile group is scaled.
 */
export function layerPaint(kind: string, id: string, zoom: number, p: MapPalette): LayerPaint | null {
  if (kind === 'fill') {
    const key = FILL_COLOR_KEYS.find((k) => k === id);
    return key ? { fill: p[key], width: 0 } : null;
  }
  if (kind === 'casing' && id in STROKE_WIDTHS) {
    return { stroke: p.casing, width: casingWidthAt(id as RoadGroup, zoom) };
  }
  if (kind === 'road' && id in ROAD_GROUPS) {
    const g = id as RoadGroup;
    const width = strokeWidthAt(g, zoom);
    return {
      stroke: p.roads[g],
      width,
      dash: g === 'path' ? PATH_DASH.map((m) => m * width) : undefined,
    };
  }
  if (kind === 'line') {
    switch (id) {
      case 'waterway':
        return { stroke: p.waterway, width: strokeWidthAt('waterway', zoom) };
      case 'aeroway':
        return { stroke: p.aeroway, width: strokeWidthAt('aeroway', zoom) };
      case 'rail':
        return { stroke: p.rail, width: strokeWidthAt('rail', zoom) };
      case 'boundary': {
        const width = strokeWidthAt('boundary', zoom);
        return { stroke: p.boundary, width, dash: BOUNDARY_DASH.map((m) => m * width) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// MapLibre GL style

type Expr = unknown;

function widthExpr(stops: Stops, map: (w: number) => number = (w) => w): Expr {
  return [
    'interpolate',
    ['exponential', WIDTH_BASE],
    ['zoom'],
    ...stops.flatMap(([z, w]) => [z, map(w)]),
  ];
}

const classIn = (classes: readonly string[]): Expr => ['in', ['get', 'class'], ['literal', classes]];
const notTunnel: Expr = ['!=', ['get', 'brunnel'], 'tunnel'];

export interface MaplibreLayer {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  filter?: Expr;
  layout?: Record<string, unknown>;
  paint: Record<string, unknown>;
}

export interface MaplibreStyle {
  version: 8;
  name: string;
  sources: Record<string, { type: 'vector'; url: string }>;
  layers: MaplibreLayer[];
}

/** MapLibre GL style JSON with the same layers and colours as the RN renderer. */
export function maplibreStyle(theme: MapTheme): MaplibreStyle {
  const p = paletteFor(theme);
  const src = 'openmaptiles';
  const layers: MaplibreLayer[] = [];

  layers.push({ id: 'background', type: 'background', paint: { 'background-color': p.background } });

  const fill = (
    id: string,
    sourceLayer: string,
    color: string,
    filter?: Expr,
    extra: Partial<MaplibreLayer> = {},
  ) =>
    layers.push({
      id,
      type: 'fill',
      source: src,
      'source-layer': sourceLayer,
      ...(filter ? { filter } : {}),
      paint: { 'fill-color': color, 'fill-antialias': true },
      ...extra,
    });

  fill('landcover-wood', 'landcover', p.wood, classIn(WOOD_CLASSES));
  fill('landcover-grass', 'landcover', p.grass, classIn(GRASS_CLASSES));
  fill('landuse', 'landuse', p.landuse, classIn(BUILT_LANDUSE_CLASSES));
  fill('landuse-green', 'landuse', p.park, classIn(GREEN_LANDUSE_CLASSES));
  fill('park', 'park', p.park);
  fill('water', 'water', p.water);

  layers.push({
    id: 'waterway',
    type: 'line',
    source: src,
    'source-layer': 'waterway',
    filter: [
      'any',
      ['!', classIn(MINOR_WATERWAY_CLASSES)],
      ['>=', ['zoom'], 12],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p.waterway, 'line-width': widthExpr(STROKE_WIDTHS.waterway) },
  });

  layers.push({
    id: 'aeroway',
    type: 'line',
    source: src,
    'source-layer': 'aeroway',
    filter: classIn(AEROWAY_LINE_CLASSES),
    paint: { 'line-color': p.aeroway, 'line-width': widthExpr(STROKE_WIDTHS.aeroway) },
  });

  fill('building', 'building', p.building, undefined, { minzoom: BUILDING_MIN_ZOOM });

  const roadFilter = (group: RoadGroup): Expr => [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    notTunnel,
    classIn(ROAD_GROUPS[group]),
  ];
  const road = (id: string, group: RoadGroup, color: string, width: Expr, dash?: readonly number[]) =>
    layers.push({
      id,
      type: 'line',
      source: src,
      'source-layer': 'transportation',
      filter: roadFilter(group),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': width,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    });

  for (const g of CASED_GROUPS) {
    road(`road-${g}-casing`, g, p.casing, widthExpr(STROKE_WIDTHS[g], casingWidthFor));
  }
  for (const g of FILL_ORDER) {
    road(
      `road-${g}`,
      g,
      p.roads[g],
      widthExpr(STROKE_WIDTHS[g]),
      g === 'path' ? PATH_DASH : undefined,
    );
  }

  layers.push({
    id: 'rail',
    type: 'line',
    source: src,
    'source-layer': 'transportation',
    filter: ['all', ['==', ['get', 'class'], 'rail'], notTunnel],
    paint: { 'line-color': p.rail, 'line-width': widthExpr(STROKE_WIDTHS.rail) },
  });

  layers.push({
    id: 'boundary',
    type: 'line',
    source: src,
    'source-layer': 'boundary',
    filter: [
      'all',
      ['<=', ['get', 'admin_level'], BOUNDARY_MAX_ADMIN_LEVEL],
      ['!=', ['get', 'maritime'], 1],
    ],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': p.boundary,
      'line-width': widthExpr(STROKE_WIDTHS.boundary),
      'line-dasharray': BOUNDARY_DASH,
    },
  });

  return {
    version: 8,
    name: `joyo-${theme}`,
    sources: { [src]: { type: 'vector', url: TILEJSON_URL } },
    layers,
  };
}
