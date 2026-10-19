/**
 * A store-only ZIP writer (no compression, no zip64): enough to put a few dozen workout files in one download. FIT files
 * and gzip-sized documents barely shrink, and GPX/JSON would only shrink the download, so the code stays at the size of
 * "local header, data, central directory, end record". File names are written as UTF-8 (general purpose flag bit 11).
 *
 * Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local file header), 4.3.12 (central directory) and 4.3.16 (end record).
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
  /** Modification time; defaults to now. ZIP stores local time in two-second steps from 1980. */
  modified?: Date;
}

/** Without zip64, the entry count, every size and every offset must fit 16 and 32 bits. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffff_ffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the one ZIP and gzip use) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (let i = 0; i < bytes.length; i++)
    crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** DOS time and date words of a local date; years before 1980 clamp to 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  if (entries.length > ZIP_MAX_ENTRIES)
    throw new RangeError(`A ZIP without zip64 holds at most ${ZIP_MAX_ENTRIES} files`);
  const encoder = new TextEncoder();
  const names = entries.map((entry) => encoder.encode(entry.name));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) throw new Error(`Duplicate ZIP entry name: ${entry.name}`);
    seen.add(entry.name);
  }
  let size = 22;
  entries.forEach((entry, i) => {
    size += 30 + 46 + 2 * (names[i] as Uint8Array).length + entry.data.length;
  });
  if (size > ZIP_MAX_BYTES) throw new RangeError("A ZIP without zip64 is at most 4 GiB");

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  const checks: number[] = [];

  entries.forEach((entry, i) => {
    const name = names[i] as Uint8Array;
    const stamp = dosDateTime(entry.modified ?? now);
    const crc = crc32(entry.data);
    offsets.push(at);
    checks.push(crc);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // UTF-8 names
    view.setUint16(at + 8, 0, true); // method: stored
    view.setUint16(at + 10, stamp.time, true);
    view.setUint16(at + 12, stamp.date, true);
    view.setUint32(at + 14, crc, true);
    view.setUint32(at + 18, entry.data.length, true); // compressed size
    view.setUint32(at + 22, entry.data.length, true); // uncompressed size
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true); // extra length
    out.set(name, at + 30);
    out.set(entry.data, at + 30 + name.length);
    at += 30 + name.length + entry.data.length;
  });

  const directoryStart = at;
  entries.forEach((entry, i) => {
    const name = names[i] as Uint8Array;
    const stamp = dosDateTime(entry.modified ?? now);
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by (MS-DOS, 2.0)
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, checks[i] as number, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk number
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, offsets[i] as number, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directoryStart, true);
  view.setUint32(at + 16, directoryStart, true);
  view.setUint16(at + 20, 0, true); // comment length
  return out;
}
