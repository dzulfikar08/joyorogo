// Photos attached to comments are stored and served exactly as the client compressed them, minus every metadata
// block that can carry where and when the picture was taken (EXIF GPS, XMP, IPTC, comments). Clients re-encode through
// a canvas / image manipulator, which already drops it; this is the server's own pass so a hand-made upload cannot
// keep a location. Pure byte work: no decoding, so pixels and the colour profile (ICC) are left untouched.

export type CleanImage = { kind: "jpeg" | "webp"; bytes: Uint8Array<ArrayBuffer> };

export function sniffImage(bytes: Uint8Array): "jpeg" | "webp" | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF" &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * JPEG: keep APP0 (JFIF), APP2 (ICC profile), APP14 (Adobe colour transform) and every frame/scan marker; cut everything after EOI; drop APP1
 * (EXIF, XMP), APP3-APP13 (IPTC, Photoshop, vendor blobs), APP15 and COM. Null when the markers do not parse.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (sniffImage(bytes) !== "jpeg") return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let pos = 2;
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1]!;
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    // End of image: everything after it (a payload hidden behind a valid picture) is dropped.
    if (marker === 0xd9) {
      parts.push(bytes.subarray(pos, pos + 2));
      return concat(parts);
    }
    if (pos + 4 > bytes.length) return null;
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (length < 2 || pos + 2 + length > bytes.length) return null;
    const end = pos + 2 + length;
    const droppable = marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!droppable) parts.push(bytes.subarray(pos, end));
    pos = end;
    if (marker === 0xda) {
      // Entropy-coded data: copied as is up to the next real marker (0xFF00 and RSTn belong to the data).
      const scanStart = pos;
      while (pos + 1 < bytes.length) {
        const next = bytes[pos + 1]!;
        if (bytes[pos] === 0xff && next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
        pos += 1;
      }
      parts.push(bytes.subarray(scanStart, pos));
    }
  }
  return null;
}

/**
 * WebP (RIFF): drop the EXIF and XMP chunks, clear their flags in VP8X and fix the RIFF size. Null when the chunks do
 * not parse.
 */
export function stripWebp(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (sniffImage(bytes) !== "webp") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length || riffEnd < 12) return null;
  const parts: Uint8Array[] = [];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const tag = String.fromCharCode(bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!, bytes[pos + 3]!);
    const size = view.getUint32(pos + 4, true);
    const padded = size + (size & 1);
    const end = pos + 8 + padded;
    if (end > riffEnd) return null;
    if (tag !== "EXIF" && tag !== "XMP ") {
      const chunk = bytes.slice(pos, end);
      if (tag === "VP8X" && chunk.length >= 9) chunk[8] = chunk[8]! & ~(0x08 | 0x04);
      parts.push(chunk);
    }
    pos = end;
  }
  if (pos !== riffEnd) return null;
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

/** The cleaned bytes when `bytes` really are the `declared` type, else null (wrong type, truncated or corrupt). */
export function cleanImage(bytes: Uint8Array, declared: "image/jpeg" | "image/webp"): CleanImage | null {
  const kind = sniffImage(bytes);
  if (!kind || declared !== (kind === "jpeg" ? "image/jpeg" : "image/webp")) return null;
  const out = kind === "jpeg" ? stripJpeg(bytes) : stripWebp(bytes);
  return out ? { kind, bytes: out } : null;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
