// Pixel size of a photo from its file header (JPEG, PNG, WebP), no decoding and no Images binding.
// The measure call (lib/card-plate.ts) writes boxes on a 0-1000 grid that is stretched by the photo's
// aspect ratio, so code needs the real width and height to turn grid distances into pixels.
// EXIF orientation is not applied: the apps bake it in when they resize the photo to 1024 px.

export type ImageSize = { width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, text: string) => [...text].every((ch, k) => b[i + k] === ch.charCodeAt(0));

/** Start-of-frame markers of a JPEG: baseline, extended, progressive, lossless (not DHT 0xC4, JPG 0xC8, DAC 0xCC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Markers without a length: standalone (TEM, RSTn, SOI, EOI).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    if (SOF.has(marker)) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8X")) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (ascii(b, 12, "VP8L")) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, "VP8 ")) return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  return null;
}

/** The photo's width and height in pixels, or null when the bytes are not a JPEG, PNG or WebP with a readable header. */
export function imageSize(bytes: Uint8Array | ArrayBuffer): ImageSize | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let size: ImageSize | null = null;
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    size = jpegSize(b);
  } else if (b.length > 24 && ascii(b, 1, "PNG")) {
    size = { width: ((b[16]! << 24) | (b[17]! << 16) | (b[18]! << 8) | b[19]!) >>> 0, height: ((b[20]! << 24) | (b[21]! << 16) | (b[22]! << 8) | b[23]!) >>> 0 };
  } else if (b.length > 12 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    size = webpSize(b);
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}
