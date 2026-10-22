// Where a cutout PNG actually has pixels. The Images binding hands back the
// segmented photo at full frame, transparent everywhere the model dropped, and
// has no "trim to content": the plate sticker needs the tight box, so the alpha
// channel is read here (inflate through the runtime's DecompressionStream, then
// undo the scanline filters). Anything this does not handle returns null and
// the caller keeps the untrimmed image.

/** `right`/`bottom` are exclusive; `width`/`height` are the PNG's own size. */
export type PixelBounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Alpha at or below this counts as background (soft mask edges and noise). */
const ALPHA_MIN = 32;

type Header = { width: number; height: number; channels: number; alphaAt: number };

function readHeader(view: DataView, bytes: Uint8Array): { header: Header; idat: Uint8Array[] } | null {
  if (bytes.length < 33 || SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  let header: Header | null = null;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const start = offset + 8;
    if (start + length > bytes.length) return null;
    if (type === "IHDR") {
      const depth = bytes[start + 8];
      const colorType = bytes[start + 9];
      const interlace = bytes[start + 12];
      // 8-bit grey+alpha or RGBA, no interlacing: what the Images binding emits.
      if (depth !== 8 || interlace !== 0) return null;
      if (colorType === 6) header = { width: view.getUint32(start), height: view.getUint32(start + 4), channels: 4, alphaAt: 3 };
      else if (colorType === 4) header = { width: view.getUint32(start), height: view.getUint32(start + 4), channels: 2, alphaAt: 1 };
      else return null;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }
  return header && idat.length > 0 ? { header, idat } : null;
}

async function inflate(parts: Uint8Array[]): Promise<Uint8Array> {
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Tight pixel box of everything with alpha above the noise floor. A row or column needs a few opaque pixels
 * to count, so a stray speck does not stretch the box. Null when the PNG is
 * not a format this reads, is truncated, or has no opaque pixels.
 */
export async function opaqueBounds(png: ArrayBuffer): Promise<PixelBounds | null> {
  try {
    const bytes = new Uint8Array(png);
    const parsed = readHeader(new DataView(png), bytes);
    if (!parsed) return null;
    const { width, height, channels, alphaAt } = parsed.header;
    const stride = width * channels;
    const raw = await inflate(parsed.idat);
    if (width < 1 || height < 1 || raw.length < (stride + 1) * height) return null;

    const rows = new Uint32Array(height);
    const cols = new Uint32Array(width);
    let previous = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const base = y * (stride + 1);
      const filter = raw[base]!;
      if (filter > 4) return null;
      for (let i = 0; i < stride; i++) {
        const value = raw[base + 1 + i]!;
        const left = i >= channels ? line[i - channels]! : 0;
        const up = previous[i]!;
        const upLeft = i >= channels ? previous[i - channels]! : 0;
        // Uint8Array wraps the sums modulo 256, which is exactly what PNG filtering wants.
        line[i] =
          filter === 0 ? value
          : filter === 1 ? value + left
          : filter === 2 ? value + up
          : filter === 3 ? value + ((left + up) >> 1)
          : value + paeth(left, up, upLeft);
      }
      for (let x = 0; x < width; x++) {
        if (line[x * channels + alphaAt]! > ALPHA_MIN) {
          rows[y]!++;
          cols[x]!++;
        }
      }
      [previous, line] = [line, previous];
    }

    const minRow = Math.max(3, Math.round(width * 0.004));
    const minCol = Math.max(3, Math.round(height * 0.004));
    const first = (counts: Uint32Array, min: number) => counts.findIndex((n) => n >= min);
    const last = (counts: Uint32Array, min: number) => counts.findLastIndex((n) => n >= min);
    const top = first(rows, minRow);
    const bottom = last(rows, minRow);
    const left = first(cols, minCol);
    const right = last(cols, minCol);
    if (top < 0 || left < 0) return null;
    return { left, top, right: right + 1, bottom: bottom + 1, width, height };
  } catch {
    return null;
  }
}
