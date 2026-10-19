/**
 * A small FIT (Flexible and Interoperable Data Transfer) writer: file header, message definitions, data messages and the
 * two CRCs, little-endian, no developer fields, no compressed timestamps. It knows nothing about activities; the
 * message layouts live in `fit-activity.ts`. Pure TypeScript with no imports, so it runs under `bun test`.
 *
 * Copied (apart from formatting and this paragraph) from JoyoFit's own writer, `src/features/strava/fitEncoder.ts` in
 * the JoyoFit app repo (same owner), which builds the files the app sends to Strava. Change both together.
 *
 * Format: https://developer.garmin.com/fit/protocol/ (file header, definition and data messages, CRC).
 */

/** Base types of the field types used here; the value is the FIT base type byte. */
const BASE_TYPES = {
  enum: { code: 0x00, size: 1, invalid: 0xff },
  uint8: { code: 0x02, size: 1, invalid: 0xff },
  uint16: { code: 0x84, size: 2, invalid: 0xffff },
  uint32: { code: 0x86, size: 4, invalid: 0xffff_ffff },
  sint16: { code: 0x83, size: 2, invalid: 0x7fff },
  sint32: { code: 0x85, size: 4, invalid: 0x7fff_ffff },
  /** Like uint32, but 0 is the invalid value. */
  uint32z: { code: 0x8c, size: 4, invalid: 0 },
  string: { code: 0x07, size: 1, invalid: 0 },
} as const;

export type FitFieldType = keyof typeof BASE_TYPES;

export interface FitFieldDef {
  /** The field's number in the profile. */
  num: number;
  type: FitFieldType;
  /** Bytes of a `string` field, terminator included. */
  size?: number;
}

/** A value for a field; null (or NaN) writes the type's invalid value, which readers treat as "not there". */
export type FitValue = number | string | null | undefined;

export interface FitDefinition {
  local: number;
  fields: readonly FitFieldDef[];
}

/** Seconds from the Unix epoch to the FIT epoch, 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_OFFSET = 631_065_600;

export const toFitTime = (unixSeconds: number): number =>
  Math.round(unixSeconds) - FIT_EPOCH_OFFSET;

/** Degrees to FIT semicircles (2^31 per 180 degrees). */
export const toSemicircles = (degrees: number): number => Math.round((degrees * 2 ** 31) / 180);

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

/** The FIT CRC-16 of `bytes[from, to)`, continuing from `crc`. */
export function fitCrc(bytes: Uint8Array, from = 0, to = bytes.length, crc = 0): number {
  for (let i = from; i < to; i++) {
    const byte = bytes[i] as number;
    let tmp = CRC_TABLE[crc & 0xf] as number;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ (CRC_TABLE[byte & 0xf] as number);
    tmp = CRC_TABLE[crc & 0xf] as number;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ (CRC_TABLE[(byte >> 4) & 0xf] as number);
  }
  return crc;
}

const HEADER_SIZE = 14;
/** Protocol 2.0 (major in the high nibble). */
const PROTOCOL_VERSION = 0x20;
/** Profile 21.40: major * 100 + minor. */
const PROFILE_VERSION = 2140;
/** A definition message header has bit 6 set; the low nibble is the local message type. */
const DEFINITION_FLAG = 0x40;
const MAX_LOCAL_TYPES = 16;

export class FitWriter {
  private bytes = new Uint8Array(4096);
  private length = HEADER_SIZE;
  private readonly defined = new Map<number, FitDefinition>();

  private reserve(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }

  private u8(value: number): void {
    this.bytes[this.length++] = value & 0xff;
  }

  private uint(value: number, size: number): void {
    // Not `>>`: values above 2^31 must not turn negative.
    let rest = value;
    for (let i = 0; i < size; i++) {
      this.bytes[this.length++] = rest % 256;
      rest = Math.floor(rest / 256);
    }
  }

  /** Writes the definition message of `local` for `global` (the message number in the profile). */
  define(local: number, global: number, fields: readonly FitFieldDef[]): FitDefinition {
    if (!Number.isInteger(local) || local < 0 || local >= MAX_LOCAL_TYPES)
      throw new RangeError(`FIT local message type ${local} is out of range`);
    if (fields.length > 255) throw new RangeError("A FIT message has at most 255 fields");
    this.reserve(6 + fields.length * 3);
    this.u8(DEFINITION_FLAG | local);
    this.u8(0); // reserved
    this.u8(0); // architecture: little-endian
    this.uint(global, 2);
    this.u8(fields.length);
    for (const field of fields) {
      const base = BASE_TYPES[field.type];
      const size = field.type === "string" ? (field.size ?? 0) : base.size;
      if (size < 1 || size > 255) throw new RangeError(`FIT field ${field.num} has size ${size}`);
      this.u8(field.num);
      this.u8(size);
      this.u8(base.code);
    }
    const definition: FitDefinition = { local, fields };
    this.defined.set(local, definition);
    return definition;
  }

  /** Writes a data message for `definition`; `values` line up with its fields. */
  write(definition: FitDefinition, values: readonly FitValue[]): void {
    if (this.defined.get(definition.local) !== definition)
      throw new Error(`FIT local message type ${definition.local} is not defined as given`);
    if (values.length !== definition.fields.length)
      throw new RangeError("A FIT message needs one value per field");
    let size = 1;
    for (const field of definition.fields)
      size += field.type === "string" ? (field.size ?? 0) : BASE_TYPES[field.type].size;
    this.reserve(size);
    this.u8(definition.local);
    definition.fields.forEach((field, i) => {
      const value = values[i];
      if (field.type === "string") {
        this.string(typeof value === "string" ? value : "", field.size ?? 0);
        return;
      }
      const base = BASE_TYPES[field.type];
      const signed = field.type === "sint16" || field.type === "sint32";
      const half = 256 ** base.size / 2;
      let number: number = base.invalid;
      if (typeof value === "number" && Number.isFinite(value)) {
        number = Math.min(
          signed ? half - 1 : 256 ** base.size - 1,
          Math.max(signed ? -half : 0, Math.round(value)),
        );
        // A real value must not read as the invalid marker (for the `z` types that marker is 0, and 0 stays "none").
        if (number === base.invalid && base.invalid !== 0) number = base.invalid - 1;
      }
      // Signed values go through their two's complement form.
      this.uint(number < 0 ? number + 256 ** base.size : number, base.size);
    });
  }

  /** ASCII, NUL-terminated, NUL-padded to `size`; anything else becomes `?`. */
  private string(text: string, size: number): void {
    for (let i = 0; i < size; i++) {
      const code = i < size - 1 && i < text.length ? text.charCodeAt(i) : 0;
      this.u8(code > 0x7e || (code < 0x20 && code !== 0) ? 0x3f : code);
    }
  }

  /** The finished file: header with its CRC, the messages, the file CRC. */
  finish(): Uint8Array {
    this.reserve(2);
    const dataSize = this.length - HEADER_SIZE;
    const header = this.bytes;
    header[0] = HEADER_SIZE;
    header[1] = PROTOCOL_VERSION;
    header[2] = PROFILE_VERSION & 0xff;
    header[3] = PROFILE_VERSION >> 8;
    for (let i = 0; i < 4; i++) header[4 + i] = Math.floor(dataSize / 256 ** i) % 256;
    header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    const headerCrc = fitCrc(header, 0, 12);
    header[12] = headerCrc & 0xff;
    header[13] = headerCrc >> 8;
    const crc = fitCrc(header, 0, this.length);
    this.u8(crc & 0xff);
    this.u8(crc >> 8);
    return this.bytes.slice(0, this.length);
  }
}
