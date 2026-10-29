// The number and string rules of the Kotlin/Java parsers this port mirrors (`HuaweiExportJson.kt` and friends), so a
// value rounds, truncates, wraps and prints as it does on the phone.

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** `Double.roundToInt()`: ties toward positive infinity (`Math.round`), saturating; NaN throws like Kotlin. */
export function roundToInt(x: number): number {
  if (Number.isNaN(x)) throw new RangeError("Cannot round NaN value.");
  if (x > INT_MAX) return INT_MAX;
  if (x < INT_MIN) return INT_MIN;
  return Math.round(x) + 0;
}

/** `Double.roundToLong()` / `Math.round(double)`: ties toward positive infinity. */
export function roundToLong(x: number): number {
  if (Number.isNaN(x)) throw new RangeError("Cannot round NaN value.");
  return Math.round(x) + 0;
}

/** `Double.toLong()`: truncation toward zero (`NaN` is 0). */
export function toLong(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.trunc(x) + 0;
}

/** `Double.toInt()`: truncation toward zero, saturating. */
export function doubleToInt(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x >= INT_MAX) return INT_MAX;
  if (x <= INT_MIN) return INT_MIN;
  return Math.trunc(x) + 0;
}

/** `Long.toInt()`: keeps the low 32 bits. */
export function longToInt(x: number): number {
  return x | 0;
}

export function coerceIn(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/** `Double.toString()` as Java prints it (`5.0`, `1.0E7`, `1.0E-4`). */
export function javaDouble(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (v === 0) return Object.is(v, -0) ? "-0.0" : "0.0";
  const abs = Math.abs(v);
  if (abs >= 1e-3 && abs < 1e7) {
    const s = String(v);
    return s.includes(".") ? s : `${s}.0`;
  }
  const [mantissa = "", exponent = "0"] = v.toExponential().split("e");
  const exp = exponent.startsWith("+") ? exponent.slice(1) : exponent;
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}E${exp}`;
}

const EXP = "[eE][+-]?[0-9]+";
const HEX = "[0-9a-fA-F]+";
// The grammar Kotlin's `String.toDoubleOrNull()` lets through to `java.lang.Double.parseDouble`.
const FLOAT = new RegExp(
  `^[\\x00-\\x20]*([+-]?)(NaN|Infinity|(?:(?:[0-9]+\\.?[0-9]*(?:${EXP})?|\\.[0-9]+(?:${EXP})?|(?:0[xX](${HEX})\\.?|0[xX](${HEX})?\\.(${HEX}))[pP]([+-]?[0-9]+))[fFdD]?))[\\x00-\\x20]*$`,
);

/** `String.toDoubleOrNull()` / `Double.valueOf`: decimal and hex floats, `NaN`, `Infinity`, a `f` / `d` suffix, surrounding control or space. */
export function parseJavaDouble(text: string): number | null {
  const m = FLOAT.exec(text);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const body = m[2] as string;
  if (body === "NaN") return Number.NaN;
  if (body === "Infinity") return sign * Infinity;
  if (m[5] !== undefined || m[3] !== undefined || m[4] !== undefined) {
    const whole = m[3] ?? m[4] ?? "";
    const fraction = m[5] ?? "";
    const mantissa = Number.parseInt(`${whole}${fraction}` || "0", 16) / 16 ** fraction.length;
    return sign * mantissa * 2 ** Number(m[6]);
  }
  const plain = /[fFdD]$/.test(body) ? body.slice(0, -1) : body;
  return sign * Number(plain);
}

/** `String.toIntOrNull()` for the short digit runs the parsers cut out of a zone text. */
export function toIntOrNull(text: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return n >= INT_MIN && n <= INT_MAX ? n : null;
}

/** Java's `\s` (ASCII only). */
export const JAVA_SPACE = "[ \\t\\n\\x0B\\f\\r]";

/** `JSONStringer` quoting: `"`, `\` and `/` are escaped, controls as `\uXXXX` or their short form. */
export function javaJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replaceAll("/", "\\/");
}

/** `LocalDate.of(...)`: null for a date that does not exist. */
export function epochDayOf(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || year < -999999999 || year > 999999999) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  if (day > days) return null;
  // Howard Hinnant's days_from_civil.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
