/**
 * Minimal Mapbox Vector Tile (MVT, protobuf) decoder. No dependencies.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 *   Tile    { repeated Layer layers = 3 }
 *   Layer   { string name = 1; repeated Feature features = 2; repeated string keys = 3;
 *             repeated Value values = 4; uint32 extent = 5 (default 4096); uint32 version = 15 }
 *   Feature { uint64 id = 1; packed uint32 tags = 2; GeomType type = 3; packed uint32 geometry = 4 }
 *   Value   { string = 1; float = 2; double = 3; int64 = 4; uint64 = 5; sint64 = 6; bool = 7 }
 *
 * Geometry is a stream of command integers (id = low 3 bits, count = rest): MoveTo(1), LineTo(2),
 * ClosePath(7), with zigzag-encoded deltas. Every ring/line/point is returned as a flat Int32Array
 * `[x0, y0, x1, y1, ...]` in tile extent units. Polygon rings do NOT repeat the first point.
 */

export type MvtValue = string | number | boolean;
export type MvtGeomType = 'point' | 'line' | 'polygon';

export interface MvtFeature {
  id: number | undefined;
  type: MvtGeomType;
  props: Record<string, MvtValue>;
  /** Points: one 1-point entry per point. Lines: one per line. Polygons: one per ring (outer and holes). */
  rings: Int32Array[];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

export interface MvtTile {
  layers: Record<string, MvtLayer>;
}

export interface DecodeOptions {
  /** Only decode these layers (the rest are skipped without touching their features). */
  layers?: ReadonlySet<string>;
}

const TWO_32 = 4294967296;
const utf8 = new TextDecoder('utf-8');

class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  /** Low 32 bits of a varint, consuming all of its bytes. Fast path for lengths, tags, geometry. */
  varint32(): number {
    const { buf } = this;
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('mvt: truncated varint');
      const b = buf[this.pos++];
      if (shift < 32) result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 70) throw new Error('mvt: varint too long');
    }
    return result >>> 0;
  }

  /** Full 64-bit varint as a JS number (exact up to 2^53). `signed` reinterprets as two's complement int64. */
  varint64(signed: boolean): number {
    const { buf } = this;
    let lo = 0;
    let hi = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('mvt: truncated varint');
      const b = buf[this.pos++];
      const chunk = b & 0x7f;
      if (shift < 32) {
        lo |= chunk << shift;
        if (shift > 25) hi |= chunk >>> (32 - shift);
      } else if (shift < 64) {
        hi |= chunk << (shift - 32);
      }
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 70) throw new Error('mvt: varint too long');
    }
    lo >>>= 0;
    hi >>>= 0;
    if (signed && hi >= 0x80000000) {
      return -((~hi >>> 0) * TWO_32 + (~lo >>> 0) + 1);
    }
    return hi * TWO_32 + lo;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.varint32();
        return;
      case 1:
        this.pos += 8;
        return;
      case 2: {
        const len = this.varint32();
        this.pos += len;
        return;
      }
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`mvt: unsupported wire type ${wireType}`);
    }
  }

  /** Reads a length-delimited field body and returns a sub-reader positioned at its start. */
  sub(): Reader {
    const len = this.varint32();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('mvt: truncated message');
    return new Reader(this.buf, start, start + len);
  }

  string(): string {
    const len = this.varint32();
    const s = utf8.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  float(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return v;
  }

  double(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }
}

function decodeValue(r: Reader): MvtValue {
  let out: MvtValue = '';
  while (!r.done) {
    const tag = r.varint32();
    switch (tag) {
      case (1 << 3) | 2:
        out = r.string();
        break;
      case (2 << 3) | 5:
        out = r.float();
        break;
      case (3 << 3) | 1:
        out = r.double();
        break;
      case (4 << 3) | 0:
        out = r.varint64(true);
        break;
      case (5 << 3) | 0:
        out = r.varint64(false);
        break;
      case (6 << 3) | 0: {
        const n = r.varint64(false);
        // zigzag over a 64-bit value; exact for |v| < 2^52
        out = n % 2 === 0 ? n / 2 : -(n + 1) / 2;
        break;
      }
      case (7 << 3) | 0:
        out = r.varint32() !== 0;
        break;
      default:
        r.skip(tag & 7);
    }
  }
  return out;
}

interface RawFeature {
  id: number | undefined;
  type: number;
  tags: number[];
  geomStart: number;
  geomEnd: number;
}

function decodeRawFeature(r: Reader): RawFeature {
  const f: RawFeature = { id: undefined, type: 0, tags: [], geomStart: 0, geomEnd: 0 };
  while (!r.done) {
    const tag = r.varint32();
    switch (tag) {
      case (1 << 3) | 0:
        f.id = r.varint64(false);
        break;
      case (2 << 3) | 2: {
        const t = r.sub();
        while (!t.done) f.tags.push(t.varint32());
        break;
      }
      case (3 << 3) | 0:
        f.type = r.varint32();
        break;
      case (4 << 3) | 2: {
        const len = r.varint32();
        f.geomStart = r.pos;
        f.geomEnd = r.pos + len;
        r.pos += len;
        break;
      }
      default:
        r.skip(tag & 7);
    }
  }
  return f;
}

function decodeGeometry(buf: Uint8Array, start: number, end: number, type: number): Int32Array[] {
  const r = new Reader(buf, start, end);
  const out: Int32Array[] = [];
  let cur: number[] = [];
  let x = 0;
  let y = 0;
  const flush = () => {
    if (cur.length > 0) out.push(Int32Array.from(cur));
    cur = [];
  };
  while (!r.done) {
    const cmdInt = r.varint32();
    const cmd = cmdInt & 7;
    const count = cmdInt >>> 3;
    if (cmd === 1 || cmd === 2) {
      for (let i = 0; i < count; i++) {
        const dx = r.varint32();
        const dy = r.varint32();
        x += (dx >>> 1) ^ -(dx & 1);
        y += (dy >>> 1) ^ -(dy & 1);
        // Each MoveTo begins a new geometry: a point (multipoint), a line or a polygon ring.
        if (cmd === 1) flush();
        cur.push(x, y);
        if (cmd === 1 && type === 1) flush();
      }
    } else if (cmd === 7) {
      flush();
    } else {
      throw new Error(`mvt: bad geometry command ${cmd}`);
    }
  }
  flush();
  return out;
}

function decodeLayer(r: Reader, wanted: ReadonlySet<string> | undefined): MvtLayer | null {
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: MvtValue[] = [];
  const raws: RawFeature[] = [];
  while (!r.done) {
    const tag = r.varint32();
    switch (tag) {
      case (1 << 3) | 2:
        name = r.string();
        break;
      case (2 << 3) | 2:
        // Feature bodies are only parsed (cheaply) when the layer is wanted; name usually comes first.
        if (wanted && name && !wanted.has(name)) return null;
        raws.push(decodeRawFeature(r.sub()));
        break;
      case (3 << 3) | 2:
        keys.push(r.string());
        break;
      case (4 << 3) | 2:
        values.push(decodeValue(r.sub()));
        break;
      case (5 << 3) | 0:
        extent = r.varint32();
        break;
      default:
        r.skip(tag & 7);
    }
  }
  if (wanted && !wanted.has(name)) return null;

  const features: MvtFeature[] = [];
  for (const raw of raws) {
    const type: MvtGeomType | null =
      raw.type === 1 ? 'point' : raw.type === 2 ? 'line' : raw.type === 3 ? 'polygon' : null;
    if (!type) continue;
    const props: Record<string, MvtValue> = {};
    for (let i = 0; i + 1 < raw.tags.length; i += 2) {
      const k = keys[raw.tags[i]];
      const v = values[raw.tags[i + 1]];
      if (k !== undefined && v !== undefined) props[k] = v;
    }
    features.push({
      id: raw.id,
      type,
      props,
      rings: decodeGeometry(r.buf, raw.geomStart, raw.geomEnd, raw.type),
    });
  }
  return { name, extent, features };
}

/** Decodes a (gunzipped) MVT tile. Throws on malformed input. */
export function decodeTile(data: Uint8Array | ArrayBuffer, opts: DecodeOptions = {}): MvtTile {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(buf);
  const layers: Record<string, MvtLayer> = {};
  while (!r.done) {
    const tag = r.varint32();
    if (tag === ((3 << 3) | 2)) {
      const layer = decodeLayer(r.sub(), opts.layers);
      if (layer) layers[layer.name] = layer;
    } else {
      r.skip(tag & 7);
    }
  }
  return { layers };
}
