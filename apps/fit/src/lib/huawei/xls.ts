// Port of `HuaweiXlsReader.kt`: a minimal reader for the old Excel format (`.xls`, an OLE2 compound file holding a BIFF8 workbook
// stream), enough for `SportsHealth-Data.xls` of a Huawei export, which is plain text and number cells. It follows the published layouts
// (MS-CFB for the container, MS-XLS for the records) and reads only what it needs: the sheet list, the shared string table with its
// CONTINUE records, and LABELSST / LABEL / NUMBER / RK / MULRK cells. Formulas, formats, styles and charts are skipped.
//
// A damaged file throws `XlsError`; the caller decides what that costs (the importer counts the file as unreadable).

import { javaDouble } from "./java";

export class XlsError extends Error {}

/** Cells by row then column; numbers that are whole are written without a decimal point (`20201114`, not `2.0201114E7`). */
export interface Sheet {
  name: string;
  rows: Map<number, string>[];
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = -2;

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;

/** Largest worksheet the reader builds in memory: cells, not bytes. */
const MAX_CELLS = 2_000_000;

function u8(b: Uint8Array, at: number): number {
  if (at < 0 || at >= b.length) throw new XlsError(`read at ${at} outside the data`);
  return b[at] as number;
}

function u16(b: Uint8Array, at: number): number {
  return u8(b, at) | (u8(b, at + 1) << 8);
}

function u32(b: Uint8Array, at: number): number {
  return u16(b, at) + u16(b, at + 2) * 0x10000;
}

function i32(b: Uint8Array, at: number): number {
  return u32(b, at) | 0;
}

function latin1(b: Uint8Array, at: number, length: number): string {
  if (length < 0 || at < 0 || at + length > b.length) throw new XlsError("text outside the data");
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(b[at + i] as number);
  return out;
}

function utf16le(b: Uint8Array, at: number, length: number): string {
  if (length < 0 || at < 0 || at + length > b.length) throw new XlsError("text outside the data");
  let out = "";
  for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(u16(b, at + i));
  return out;
}

/** The sheets of `file` whose name `wanted` accepts. */
export function readSheets(file: Uint8Array, wanted: (name: string) => boolean): Sheet[] {
  try {
    return readWorkbook(file, wanted);
  } catch (e) {
    if (e instanceof XlsError) throw e;
    throw new XlsError(`damaged workbook: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function readWorkbook(file: Uint8Array, wanted: (name: string) => boolean): Sheet[] {
  const book = workbookStream(file);
  const strings: string[] = [];
  const sheets: [name: string, offset: number][] = [];
  let pos = 0;
  let depth = 0;
  let sst: Uint8Array[] = [];
  let inSst = false;
  while (pos + 4 <= book.length) {
    const id = u16(book, pos);
    const len = u16(book, pos + 2);
    const bodyStart = pos + 4;
    if (bodyStart + len > book.length) break;
    if (inSst && id !== CONTINUE) {
      parseSst(sst, strings);
      sst = [];
      inSst = false;
    }
    if (id === BOF) depth++;
    else if (id === EOF) {
      depth--;
      if (depth <= 0) break;
    } else if (id === BOUNDSHEET && depth === 1) {
      const offset = u32(book, bodyStart);
      const nameLength = u8(book, bodyStart + 6);
      const wide = (u8(book, bodyStart + 7) & 1) !== 0;
      const name = wide
        ? utf16le(book, bodyStart + 8, nameLength * 2)
        : latin1(book, bodyStart + 8, nameLength);
      sheets.push([name, offset]);
    } else if (id === SST) {
      inSst = true;
      sst = [slice(book, bodyStart + 8, bodyStart + len)];
    } else if (id === CONTINUE && inSst) {
      sst.push(slice(book, bodyStart, bodyStart + len));
    }
    pos = bodyStart + len;
  }
  if (inSst) parseSst(sst, strings);
  return sheets
    .filter(([name]) => wanted(name))
    .map(([name, offset]) => ({ name, rows: readSheet(book, offset, strings) }));
}

function slice(b: Uint8Array, from: number, to: number): Uint8Array {
  if (from < 0 || to < from || to > b.length) throw new XlsError("record outside the data");
  return b.subarray(from, to);
}

// --- the compound file ---------------------------------------------------------------------------------------

function workbookStream(file: Uint8Array): Uint8Array {
  if (file.length < 512 || SIGNATURE.some((byte, i) => file[i] !== byte))
    throw new XlsError("not an OLE2 file");
  const sectorSize = 2 ** u16(file, 0x1e);
  const miniSectorSize = 2 ** u16(file, 0x20);
  if (sectorSize < 512 || sectorSize > 65_536 || miniSectorSize < 32 || miniSectorSize > 4096)
    throw new XlsError("bad sector size");
  const dirStart = i32(file, 0x30);
  const miniCutoff = i32(file, 0x38);
  const miniFatStart = i32(file, 0x3c);
  let difatStart = i32(file, 0x44);
  const difatCount = i32(file, 0x48);

  const sectorOffset = (index: number): number => {
    const offset = (index + 1) * sectorSize;
    if (index < 0 || offset + sectorSize > file.length)
      throw new XlsError(`sector ${index} outside the file`);
    return offset;
  };

  // The FAT sectors: 109 ids in the header, the rest in the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = i32(file, 0x4c + i * 4);
    if (id >= 0) fatSectors.push(id);
  }
  let difat = 0;
  while (difatStart >= 0 && difat < difatCount) {
    const at = sectorOffset(difatStart);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const id = i32(file, at + i * 4);
      if (id >= 0) fatSectors.push(id);
    }
    difatStart = i32(file, at + sectorSize - 4);
    difat++;
  }
  const perSector = sectorSize / 4;
  const fat = new Int32Array(fatSectors.length * perSector);
  fatSectors.forEach((sector, n) => {
    const at = sectorOffset(sector);
    for (let i = 0; i < perSector; i++) fat[n * perSector + i] = i32(file, at + i * 4);
  });

  const chain = (start: number, table: Int32Array): number[] => {
    const out: number[] = [];
    let s = start;
    while (s >= 0) {
      if (s >= table.length || out.length > table.length) throw new XlsError("broken sector chain");
      out.push(s);
      s = table[s] as number;
    }
    return out;
  };

  const readChain = (start: number, size: number | null): Uint8Array => {
    const sectors = chain(start, fat);
    const total = sectors.length * sectorSize;
    const out = new Uint8Array(Math.min(size ?? total, total));
    let written = 0;
    for (const sector of sectors) {
      if (written >= out.length) break;
      const n = Math.min(sectorSize, out.length - written);
      const from = sectorOffset(sector);
      out.set(file.subarray(from, from + n), written);
      written += n;
    }
    return out;
  };

  const directory = readChain(dirStart, null);
  let workbook: [start: number, size: number] | null = null;
  let rootStart = ENDOFCHAIN;
  for (let at = 0; at < Math.floor(directory.length / 128); at++) {
    const entry = at * 128;
    const nameLength = u16(directory, entry + 0x40);
    if (nameLength < 2 || nameLength > 64) continue;
    const name = utf16le(directory, entry, nameLength - 2);
    const type = u8(directory, entry + 0x42);
    const start = i32(directory, entry + 0x74);
    const size = u32(directory, entry + 0x78);
    if (type === 5) rootStart = start;
    if (type === 2 && (name === "Workbook" || name === "Book")) workbook = [start, size];
  }
  if (!workbook) throw new XlsError("no Workbook stream");
  const [start, size] = workbook;
  if (size >= miniCutoff) return readChain(start, size);

  // A small stream lives in the mini stream: 64-byte sectors inside the root entry's stream, chained by the mini FAT.
  const mini = readChain(rootStart, null);
  const miniFatBytes = readChain(miniFatStart, null);
  const miniFat = new Int32Array(Math.floor(miniFatBytes.length / 4));
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = i32(miniFatBytes, i * 4);
  const out = new Uint8Array(size);
  let written = 0;
  for (const sector of chain(start, miniFat)) {
    if (written >= out.length) break;
    const at = sector * miniSectorSize;
    if (at + miniSectorSize > mini.length)
      throw new XlsError(`mini sector ${sector} outside the mini stream`);
    const n = Math.min(miniSectorSize, out.length - written);
    out.set(mini.subarray(at, at + n), written);
    written += n;
  }
  return out;
}

// --- the shared string table ---------------------------------------------------------------------------------

/** Walks the chunks (the SST record body, then each CONTINUE body) as one stream whose string characters may restart with a flag byte. */
class Chunks {
  chunk = 0;
  pos = 0;
  constructor(readonly chunks: Uint8Array[]) {}

  hasMore(): boolean {
    while (
      this.chunk < this.chunks.length &&
      this.pos >= (this.chunks[this.chunk] as Uint8Array).length
    ) {
      this.chunk++;
      this.pos = 0;
    }
    return this.chunk < this.chunks.length;
  }

  byte(): number {
    if (!this.hasMore()) throw new XlsError("string table ends early");
    return (this.chunks[this.chunk] as Uint8Array)[this.pos++] as number;
  }

  u16(): number {
    const lo = this.byte();
    return lo | (this.byte() << 8);
  }

  u32(): number {
    const lo = this.u16();
    return (lo + this.u16() * 0x10000) | 0;
  }

  skip(n: number) {
    let left = n;
    while (left > 0) {
      if (!this.hasMore()) throw new XlsError("string table ends early");
      const take = Math.min(left, (this.chunks[this.chunk] as Uint8Array).length - this.pos);
      this.pos += take;
      left -= take;
    }
  }

  /** True when the next byte starts a new CONTINUE chunk (a string's characters carry a fresh flag byte there). */
  atChunkStart(): boolean {
    return this.pos === 0 && this.chunk > 0;
  }
}

function parseSst(chunks: Uint8Array[], out: string[]) {
  const reader = new Chunks(chunks);
  while (reader.hasMore()) {
    const length = reader.u16();
    const flags = reader.byte();
    let wide = (flags & 1) !== 0;
    const rich = (flags & 8) !== 0;
    const phonetic = (flags & 4) !== 0;
    const runs = rich ? reader.u16() : 0;
    const phoneticBytes = phonetic ? reader.u32() : 0;
    let text = "";
    let remaining = length;
    while (remaining > 0) {
      if (!reader.hasMore()) throw new XlsError("string table ends early");
      // A string that continues in the next record starts that record with a flag byte of its own.
      if (remaining < length && reader.atChunkStart()) wide = (reader.byte() & 1) !== 0;
      const width = wide ? 2 : 1;
      const inChunk = Math.floor(
        ((reader.chunks[reader.chunk] as Uint8Array).length - reader.pos) / width,
      );
      const take = Math.min(remaining, Math.max(inChunk, 1));
      for (let i = 0; i < take; i++)
        text += String.fromCharCode(wide ? reader.u16() : reader.byte());
      remaining -= take;
    }
    reader.skip(runs * 4 + phoneticBytes);
    out.push(text);
  }
}

// --- worksheets ----------------------------------------------------------------------------------------------

function readSheet(book: Uint8Array, offset: number, strings: string[]): Map<number, string>[] {
  const rows: Map<number, string>[] = [];
  let cells = 0;
  const put = (row: number, col: number, value: string) => {
    if (++cells > MAX_CELLS) throw new XlsError("worksheet too large");
    while (rows.length <= row) rows.push(new Map());
    (rows[row] as Map<number, string>).set(col, value);
  };
  let pos = offset;
  let depth = 0;
  while (pos + 4 <= book.length) {
    const id = u16(book, pos);
    const len = u16(book, pos + 2);
    const at = pos + 4;
    if (at + len > book.length) break;
    if (id === BOF) depth++;
    else if (id === EOF) {
      depth--;
      if (depth <= 0) return rows;
    } else if (depth === 1) {
      switch (id) {
        case LABELSST: {
          const text = strings[u32(book, at + 6)];
          if (text !== undefined) put(u16(book, at), u16(book, at + 2), text);
          break;
        }
        case NUMBER: {
          const view = new DataView(book.buffer, book.byteOffset + at + 6, 8);
          put(u16(book, at), u16(book, at + 2), numberText(view.getFloat64(0, true)));
          break;
        }
        case RK:
          put(u16(book, at), u16(book, at + 2), numberText(rk(u32(book, at + 6))));
          break;
        case MULRK: {
          const row = u16(book, at);
          const first = u16(book, at + 2);
          const count = Math.trunc((len - 6) / 6);
          for (let i = 0; i < count; i++)
            put(row, first + i, numberText(rk(u32(book, at + 4 + i * 6 + 2))));
          break;
        }
        case LABEL: {
          const cch = u16(book, at + 6);
          const wide = (u8(book, at + 8) & 1) !== 0;
          const bytes = Math.min(wide ? cch * 2 : cch, len - 9);
          if (bytes >= 0)
            put(
              u16(book, at),
              u16(book, at + 2),
              wide ? utf16le(book, at + 9, bytes) : latin1(book, at + 9, bytes),
            );
          break;
        }
      }
    }
    pos = at + len;
  }
  return rows;
}

/** An RK value: a 30-bit number, either an IEEE double's high bits or an integer, optionally divided by 100. */
function rk(bits: number): number {
  let value: number;
  if ((bits & 2) !== 0) {
    value = (bits | 0) >> 2;
  } else {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(0, 0, true);
    view.setUint32(4, (bits & 0xfffffffc) >>> 0, true);
    value = view.getFloat64(0, true);
  }
  if ((bits & 1) !== 0) value /= 100;
  return value;
}

function numberText(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1e15
    ? String(Math.trunc(value))
    : javaDouble(value);
}
