/**
 * Network + cache layer: TileJSON (fetched once, tile URL template cached for the session), gzip-safe
 * tile fetch, MVT decode, and two small in-memory LRUs (decoded tiles, rendered tiles). Identical
 * in-flight requests are shared; a shared request is only aborted when every waiter aborted.
 *
 * Failure model: a failed request rejects and is not cached, so the next view change retries it; the
 * caller (`TileMap`) leaves that tile blank. HTTP 204/404 means "no tile here" and is cached as empty.
 */
import { decodeTile, type MvtTile } from './mvt';
import { TILEJSON_URL } from './palette';
import { renderTile, RENDER_LAYERS, sourceTileOf, type RenderedTile } from './renderTile';

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

interface Flight<T> {
  promise: Promise<T>;
  ctrl: AbortController;
  waiters: number;
}

/** Runs `start` once per key; every caller gets the result, each can abort independently. */
function shared<T>(
  flights: Map<string, Flight<T>>,
  key: string,
  start: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  let flight = flights.get(key);
  if (!flight) {
    const ctrl = new AbortController();
    const created: Flight<T> = { promise: start(ctrl.signal), ctrl, waiters: 0 };
    flight = created;
    flights.set(key, created);
    const done = () => {
      if (flights.get(key) === created) flights.delete(key);
    };
    created.promise.then(done, done);
  }
  const f = flight;
  f.waiters++;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      f.waiters--;
      if (f.waiters === 0) {
        f.ctrl.abort();
        if (flights.get(key) === f) flights.delete(key);
      }
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    f.promise.then(
      (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export interface TileSourceOptions {
  tileJsonUrl?: string;
  fetchImpl?: typeof fetch;
  /** Decoded tiles kept (default 16). */
  decodedCapacity?: number;
  /** Rendered tiles kept (default 48). */
  renderedCapacity?: number;
}

export interface TileSource {
  /** Resolves the tile URL template from TileJSON (cached). */
  template(signal?: AbortSignal): Promise<string>;
  /** Decoded vector tile; `null` when the server has no tile there. */
  tile(z: number, x: number, y: number, signal?: AbortSignal): Promise<MvtTile | null>;
  /**
   * Fetch + decode + render tile `z/x/y` (z up to 17: above 14 it is a sub-tile of its zoom-14
   * ancestor, which is what gets fetched). Cached per tile.
   */
  rendered(z: number, x: number, y: number, signal?: AbortSignal): Promise<RenderedTile>;
  /** Synchronous cache lookup for an already rendered tile. */
  peekRendered(z: number, x: number, y: number): RenderedTile | undefined;
  clear(): void;
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** React Native's fetch gunzips `Content-Encoding: gzip` bodies; guard the case where it did not. */
async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== GZIP_MAGIC_0 || bytes[1] !== GZIP_MAGIC_1) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('tile is gzip-compressed and the runtime cannot decompress it');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function createTileSource(opts: TileSourceOptions = {}): TileSource {
  const tileJsonUrl = opts.tileJsonUrl ?? TILEJSON_URL;
  const doFetch = (input: string, init?: RequestInit) => (opts.fetchImpl ?? fetch)(input, init);
  const decoded = new LruCache<string, MvtTile | null>(opts.decodedCapacity ?? 16);
  const renderedCache = new LruCache<string, RenderedTile>(opts.renderedCapacity ?? 48);
  const tileFlights = new Map<string, Flight<MvtTile | null>>();
  const renderFlights = new Map<string, Flight<RenderedTile>>();
  const templateFlights = new Map<string, Flight<string>>();
  let templateValue: string | null = null;

  const template = async (signal?: AbortSignal): Promise<string> => {
    if (templateValue) return templateValue;
    const url = await shared(
      templateFlights,
      'tilejson',
      async (s) => {
        const res = await doFetch(tileJsonUrl, { signal: s });
        if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`);
        const json = (await res.json()) as { tiles?: unknown };
        const t = Array.isArray(json.tiles) ? json.tiles[0] : undefined;
        if (typeof t !== 'string' || !/\{z\}.*\{x\}.*\{y\}/.test(t)) {
          throw new Error('TileJSON has no usable tile template');
        }
        return t;
      },
      signal,
    );
    templateValue = url;
    return url;
  };

  const tile = (z: number, x: number, y: number, signal?: AbortSignal) => {
    const key = `${z}/${x}/${y}`;
    const hit = decoded.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    return shared(
      tileFlights,
      key,
      async (s) => {
        const url = (await template(s))
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(y));
        const res = await doFetch(url, { signal: s });
        if (res.status === 204 || res.status === 404) {
          decoded.set(key, null);
          return null;
        }
        if (!res.ok) throw new Error(`tile ${key} HTTP ${res.status}`);
        const bytes = await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
        const mvt = decodeTile(bytes, { layers: RENDER_LAYERS });
        decoded.set(key, mvt);
        return mvt;
      },
      signal,
    );
  };

  return {
    template,
    tile,
    rendered(z, x, y, signal) {
      const key = `${z}/${x}/${y}`;
      const hit = renderedCache.get(key);
      if (hit) return Promise.resolve(hit);
      return shared(
        renderFlights,
        key,
        async (s) => {
          const src = sourceTileOf({ z, x, y });
          const mvt = await tile(src.z, src.x, src.y, s);
          const out = mvt ? renderTile(mvt, { z, x, y }) : { z, layers: [] };
          renderedCache.set(key, out);
          return out;
        },
        signal,
      );
    },
    peekRendered: (z, x, y) => renderedCache.get(`${z}/${x}/${y}`),
    clear() {
      decoded.clear();
      renderedCache.clear();
      templateValue = null;
    },
  };
}

/** Process-wide source backed by OpenFreeMap. */
export const tileSource: TileSource = createTileSource();
