// Port of `HuaweiExportJson.kt` plus the parts of Android's `org.json` (libcore `JSONTokener`, `JSONObject.opt*`) the parsers rely on.
//
// The files of a Huawei export are one big array (or one object) of records, some tens of MB, and a record can be invalid JSON. The
// file is cut into top-level `{...}` records by a string-aware brace counter (`RecordSplitter`, fed decoded text chunks, so the whole file
// is never in memory), and every record is parsed (and, if need be, repaired) on its own: one bad record costs only itself.

import { JAVA_SPACE, javaDouble, javaJson, parseJavaDouble } from "./java";

export type JObject = { [key: string]: unknown };

export function isObject(value: unknown): value is JObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A record longer than this many characters is skipped instead of held in memory. */
export const MAX_RECORD_CHARS = 48_000_000;

const OUTSIDE = /["{}[\]]/g;
const INSIDE = /["\\]/g;

/**
 * Cuts text into top-level objects. Anything outside objects (the array brackets, commas, a BOM) is ignored. `push` takes the
 * next piece of the decoded file; `finish` reports an object still open at the end (a stray quote made the counter lose track) to
 * `onUnterminated`. A record over `maxRecordChars` is counted by `onOversized` and dropped.
 */
export class RecordSplitter {
  private depth = 0;
  private inString = false;
  private escaped = false;
  /** False while skipping a record that grew past the limit. */
  private keeping = true;
  private parts: string[] = [];
  private length = 0;

  constructor(
    private readonly onRecord: (text: string) => void,
    private readonly onUnterminated: (text: string) => void,
    private readonly onOversized: () => void,
    private readonly maxRecordChars = MAX_RECORD_CHARS,
  ) {}

  private keep(text: string, from: number, to: number) {
    if (!this.keeping) return;
    this.parts.push(text.slice(from, to));
    this.length += to - from;
    if (this.length > this.maxRecordChars) {
      this.keeping = false;
      this.parts = [];
      this.length = 0;
    }
  }

  push(text: string) {
    const n = text.length;
    let i = 0;
    // Start of the part of `text` that belongs to the current record and is not kept yet.
    let from = 0;
    while (i < n) {
      if (this.depth === 0) {
        const open = text.indexOf("{", i);
        if (open < 0) return;
        this.depth = 1;
        this.inString = false;
        this.escaped = false;
        this.keeping = true;
        this.parts = [];
        this.length = 0;
        from = open;
        i = open + 1;
        continue;
      }
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
          i++;
          continue;
        }
        INSIDE.lastIndex = i;
        const m = INSIDE.exec(text);
        if (!m) {
          i = n;
          break;
        }
        if (m[0] === "\\") {
          if (m.index + 1 < n) i = m.index + 2;
          else {
            this.escaped = true;
            i = n;
          }
        } else {
          this.inString = false;
          i = m.index + 1;
        }
        continue;
      }
      OUTSIDE.lastIndex = i;
      const m = OUTSIDE.exec(text);
      if (!m) {
        i = n;
        break;
      }
      i = m.index + 1;
      const c = m[0];
      if (c === '"') this.inString = true;
      else if (c === "{" || c === "[") this.depth++;
      else {
        this.depth--;
        if (this.depth === 0) {
          this.keep(text, from, i);
          const record = this.keeping ? this.parts.join("") : null;
          this.parts = [];
          this.length = 0;
          if (record !== null) this.onRecord(record);
          else this.onOversized();
        }
      }
    }
    if (this.depth > 0) this.keep(text, from, n);
  }

  finish() {
    if (this.depth > 0) {
      if (this.keeping) this.onUnterminated(this.parts.join(""));
      else this.onOversized();
    }
    this.depth = 0;
    this.parts = [];
    this.length = 0;
  }
}

/** Huawei writes some maps with bare numeric keys: `{1.0:439.0,2.0:451.0}`. */
const UNQUOTED_NUMERIC_KEY = new RegExp(
  `([{,])${JAVA_SPACE}*(-?\\d+(?:\\.\\d+)?)${JAVA_SPACE}*:`,
  "g",
);

/**
 * Parses one record. `JSON.parse` first (it is the fast path and what nearly every record is); a record it refuses goes to the reader
 * with the rules of Android's `org.json` ({@link readLenient}), then once more with bare numeric keys quoted. Null when the record is
 * not usable JSON.
 */
export function parseObject(text: string): JObject | null {
  const direct = tryParse(text);
  if (direct) return direct;
  if (!UNQUOTED_NUMERIC_KEY.test(text)) return null;
  UNQUOTED_NUMERIC_KEY.lastIndex = 0;
  return tryParse(
    text.replace(UNQUOTED_NUMERIC_KEY, (_all, lead: string, key: string) => `${lead}"${key}":`),
  );
}

function tryParse(text: string): JObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    // fall through to the lenient reader
  }
  try {
    const value = readLenient(text);
    return isObject(value) ? value : null;
  } catch {
    // A syntax error, or nesting deeper than the stack: the record is not usable.
    return null;
  }
}

class SyntaxError_ extends Error {}

/**
 * Android's `JSONTokener.nextValue()` (libcore): what `JSONObject(String)` accepts. Unquoted names and values, single-quoted
 * strings, `=` and `=>` between name and value, `;` between members, block comments and `//` or `#` line comments, `,` or `;` in arrays with
 * missing values read as null, hex (`0x`) and octal (`017`) integers, and anything else bare is a string. Text after the first value is
 * ignored. A bare `NaN` / `Infinity` is kept as a string. Throws on a syntax error.
 */
export function readLenient(text: string): unknown {
  return new Tokener(text).nextValue();
}

/** A JSON string literal read the same way (escapes, either quote); null when `text` does not start with one. */
export function readLenientString(text: string): string | null {
  try {
    const value = readLenient(text);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

class Tokener {
  private pos = 0;
  constructor(private readonly s: string) {}

  private error(message: string): never {
    throw new SyntaxError_(`${message} at character ${this.pos}`);
  }

  private skipToEndOfLine() {
    for (; this.pos < this.s.length; this.pos++) {
      const c = this.s[this.pos];
      if (c === "\r" || c === "\n") {
        this.pos++;
        break;
      }
    }
  }

  /** The next character that is not whitespace or inside a comment; -1 at the end. */
  private nextClean(): number {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos++);
      switch (c) {
        case 9:
        case 32:
        case 10:
        case 13:
          continue;
        case 47: {
          // '/'
          if (this.pos === s.length) return c;
          const peek = s.charCodeAt(this.pos);
          if (peek === 42) {
            this.pos++;
            const end = s.indexOf("*/", this.pos);
            if (end === -1) this.error("Unterminated comment");
            this.pos = end + 2;
            continue;
          }
          if (peek === 47) {
            this.pos++;
            this.skipToEndOfLine();
            continue;
          }
          return c;
        }
        case 35: // '#'
          this.skipToEndOfLine();
          continue;
        default:
          return c;
      }
    }
    return -1;
  }

  /** Up to, not including, a character of `excluded` or a line break. */
  private nextTo(excluded: string): string {
    const s = this.s;
    const start = this.pos;
    for (; this.pos < s.length; this.pos++) {
      const c = s[this.pos] as string;
      if (c === "\r" || c === "\n" || excluded.includes(c)) return s.slice(start, this.pos);
    }
    return s.slice(start);
  }

  nextValue(): unknown {
    const c = this.nextClean();
    switch (c) {
      case -1:
        return this.error("End of input");
      case 123:
        return this.readObject();
      case 91:
        return this.readArray();
      case 39:
      case 34:
        return this.nextString(c);
      default:
        this.pos--;
        return this.readLiteral();
    }
  }

  private nextString(quote: number): string {
    const s = this.s;
    let out = "";
    let start = this.pos;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos++);
      if (c === quote) return out + s.slice(start, this.pos - 1);
      if (c === 92) {
        if (this.pos === s.length) this.error("Unterminated escape sequence");
        out += s.slice(start, this.pos - 1) + this.readEscape();
        start = this.pos;
      }
    }
    return this.error("Unterminated string");
  }

  private readEscape(): string {
    const s = this.s;
    const escaped = s[this.pos++] as string;
    switch (escaped) {
      case "u": {
        if (this.pos + 4 > s.length) this.error("Unterminated escape sequence");
        const hex = s.slice(this.pos, this.pos + 4);
        this.pos += 4;
        // Integer.parseInt(hex, 16) also takes a sign.
        if (!/^[+-]?[0-9a-fA-F]{1,4}$/.test(hex)) this.error(`Invalid escape sequence: ${hex}`);
        return String.fromCharCode(Number.parseInt(hex, 16) & 0xffff);
      }
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "f":
        return "\f";
      default:
        return escaped;
    }
  }

  private readLiteral(): unknown {
    const literal = this.nextTo("{}[]/\\:,=;# \t\f");
    if (literal.length === 0) this.error("Expected literal value");
    const lower = literal.toLowerCase();
    if (lower === "null") return null;
    if (lower === "true") return true;
    if (lower === "false") return false;
    if (!literal.includes(".")) {
      let radix = 10;
      let digits = literal;
      if (literal.startsWith("0x") || literal.startsWith("0X")) {
        digits = literal.slice(2);
        radix = 16;
      } else if (literal.startsWith("0") && literal.length > 1) {
        digits = literal.slice(1);
        radix = 8;
      }
      const integer = parseLong(digits, radix);
      if (integer !== null) return integer;
    }
    const double = parseJavaDouble(literal);
    // `JSONObject.put` refuses NaN and infinities on the phone; here the literal stays a string so the rest of the record is read.
    if (double !== null && Number.isFinite(double)) return double;
    return literal;
  }

  private readObject(): JObject {
    const result: JObject = {};
    const first = this.nextClean();
    if (first === 125) return result;
    if (first !== -1) this.pos--;
    for (;;) {
      const name = this.nextValue();
      if (typeof name !== "string") {
        this.error(
          name === null
            ? "Names cannot be null"
            : `Names must be strings, but ${String(name)} is not`,
        );
      }
      const separator = this.nextClean();
      if (separator !== 58 && separator !== 61) this.error(`Expected ':' after ${name}`);
      if (this.pos < this.s.length && this.s[this.pos] === ">") this.pos++;
      // `__proto__` stays an own property.
      Object.defineProperty(result, name as string, {
        value: this.nextValue(),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      switch (this.nextClean()) {
        case 125:
          return result;
        case 59:
        case 44:
          continue;
        default:
          this.error("Unterminated object");
      }
    }
  }

  private readArray(): unknown[] {
    const result: unknown[] = [];
    let trailing = false;
    for (;;) {
      switch (this.nextClean()) {
        case -1:
          this.error("Unterminated array");
          break;
        case 93:
          if (trailing) result.push(null);
          return result;
        case 44:
        case 59:
          result.push(null);
          trailing = true;
          continue;
        default:
          this.pos--;
      }
      result.push(this.nextValue());
      switch (this.nextClean()) {
        case 93:
          return result;
        case 44:
        case 59:
          trailing = true;
          continue;
        default:
          this.error("Unterminated array");
      }
    }
  }
}

/** `Long.parseLong(digits, radix)` narrowed to what a literal can be: the number, or null when it is not an integer of that radix or not a Long. */
function parseLong(digits: string, radix: number): number | null {
  const pattern =
    radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 8 ? /^[+-]?[0-7]+$/ : /^[+-]?[0-9]+$/;
  if (!pattern.test(digits)) return null;
  if (digits.length <= 12) return Number.parseInt(digits, radix) + 0;
  const negative = digits.startsWith("-");
  const body = digits.replace(/^[+-]/, "");
  const prefix = radix === 16 ? "0x" : radix === 8 ? "0o" : "";
  const big = BigInt(`${prefix}${body}`) * (negative ? -1n : 1n);
  if (big > 9223372036854775807n || big < -9223372036854775808n) return null;
  return Number(big);
}

// --- what the parsers read out of a parsed record ---------------------------------------------------------------------------------

/** `JSONObject.optString(name, fallback)`: a missing name gives the fallback, anything else its text (JSON null is `"null"`). */
export function optString(obj: JObject, name: string, fallback: string): string {
  const value = obj[name];
  if (value === undefined) return fallback;
  return javaText(value);
}

/** `value.toString()` of an `org.json` value. */
export function javaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : javaDouble(value);
  if (typeof value === "boolean") return String(value);
  return javaJson(value);
}

const WHITESPACE = new RegExp(`${JAVA_SPACE}+`, "g");

/** The offending value of a dropped reading, clipped: its text without spaces, 40 characters, null when absent or empty. */
export function sampleOf(value: unknown): string | null {
  if (value === undefined) return null;
  const clipped = javaText(value).replace(WHITESPACE, "").slice(0, 40);
  return clipped.length === 0 ? null : clipped;
}

export function optArray(obj: JObject, name: string): unknown[] | null {
  const value = obj[name];
  return Array.isArray(value) ? value : null;
}

export function optObjectAt(array: unknown[], index: number): JObject | null {
  const value = array[index];
  return isObject(value) ? value : null;
}

/** A JSON number, or a number written as a string (`"82.0"`); null for anything else. */
export function number(value: unknown): number | null {
  let n: number | null;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") n = parseJavaDouble(value.trim());
  else return null;
  return n !== null && Number.isFinite(n) ? n : null;
}

/** An object, or an object written as a JSON string (Huawei embeds `{"avgSaturation":97}` in `value`). */
export function embeddedObject(value: unknown): JObject | null {
  if (isObject(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    return text.startsWith("{") ? parseObject(text) : null;
  }
  return null;
}

const MIN_EPOCH_MS = 946_684_800_000; // 2000-01-01
const MAX_EPOCH_MS = 4_102_444_800_000; // 2100-01-01

/** A unix time in milliseconds (or, for values below 1e11, in seconds) as milliseconds; null outside 2000..2100. */
export function epochMs(value: unknown): number | null {
  const v = number(value);
  if (v === null) return null;
  const ms = Math.abs(v) < 1e11 ? v * 1000 : v;
  const rounded = Math.trunc(ms);
  return rounded >= MIN_EPOCH_MS && rounded <= MAX_EPOCH_MS ? rounded : null;
}
