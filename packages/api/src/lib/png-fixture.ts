// Test-only: builds small 8-bit RGBA / grey+alpha PNGs with a chosen alpha and scanline filter.
import { deflateSync } from "node:zlib";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The reader does not verify CRCs.
  return out;
}

export type Filter = 0 | 1 | 2 | 3 | 4;

/** An 8-bit RGBA (or grey+alpha) PNG whose alpha is `alphaAt(x, y)`, every row stored with `filter`. */
export function makePng(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
  options: { filter?: Filter; channels?: 2 | 4; interlace?: number } = {},
): ArrayBuffer {
  const channels = options.channels ?? 4;
  const filter = options.filter ?? 0;
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = y * stride + x * channels;
      for (let c = 0; c < channels - 1; c++) pixels[base + c] = (x * 7 + y * 13 + c * 29) & 0xff;
      pixels[base + channels - 1] = alphaAt(x, y);
    }
  }
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const value = pixels[y * stride + i]!;
      const left = i >= channels ? pixels[y * stride + i - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw[y * (stride + 1) + 1 + i] = (value - predicted) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 4;
  ihdr[12] = options.interlace ?? 0;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}
