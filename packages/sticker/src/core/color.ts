import { COLOR_TOKENS, type ColorToken, type Theme } from "./schema";

/** Colors resolve to `#rrggbb` or `#rrggbbaa` (lowercase) before they reach the Scene. */

export type Mode = "dark" | "light";
export type Tokens = Record<ColorToken, string>;

const DEFAULTS: Record<Mode, Tokens> = {
  dark: {
    bg: "#111513",
    bg2: "#1b221e",
    fg: "#ffffff",
    fgSoft: "#ffffffe0",
    fgMuted: "#ffffff9e",
    accent: "#7fd89b",
    accent2: "#f6a56b",
    surface: "#ffffff14",
    surfaceStrong: "#ffffff29",
    line: "#ffffff2e",
    good: "#7fd89b",
    warn: "#f59e0b",
    bad: "#f87171",
    data1: "#7fd89b",
    data2: "#f6a56b",
    data3: "#9fa9f0",
  },
  light: {
    bg: "#f9f6f1",
    bg2: "#ffffff",
    fg: "#1d1a15",
    fgSoft: "#1d1a15d1",
    fgMuted: "#66635c",
    accent: "#137d41",
    accent2: "#de602f",
    surface: "#1d1a150d",
    surfaceStrong: "#1d1a151a",
    line: "#1d1a151f",
    good: "#137d41",
    warn: "#b45309",
    bad: "#b42318",
    data1: "#137d41",
    data2: "#de602f",
    data3: "#5c69bc",
  },
};

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

function rgbaHex(r: number, g: number, b: number, a: number): string {
  const alpha = Math.min(1, Math.max(0, a));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha >= 0.999 ? "" : hex2(alpha * 255)}`;
}

/** Parses a literal color (no tokens) to rgba, or null. */
function parseLiteral(input: string): [number, number, number, number] | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = Array.from(hex, (c) => parseInt(c + c, 16));
      return [r!, g!, b!, a === undefined ? 1 : a / 255];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ];
    }
    return null;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)(%?)\s*)?\)$/.exec(s);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
  }
  return null;
}

/** Theme tokens over defaults; a token may itself be `$other` (one level, against the defaults). */
export function buildTokens(theme: Theme, mode: Mode): Tokens {
  const base = DEFAULTS[mode];
  const tokens = { ...base };
  for (const name of COLOR_TOKENS) {
    const value = theme.colors[name];
    if (value === undefined) continue;
    const resolved = resolveWith(value, base, 1);
    if (resolved) tokens[name] = resolved;
  }
  return tokens;
}

function resolveWith(input: string, tokens: Tokens, opacity: number): string | null {
  if (input.startsWith("$")) {
    const [name, alpha] = input.slice(1).split("/");
    const baseColor = tokens[name as ColorToken];
    if (!baseColor) return null;
    const rgba = parseLiteral(baseColor);
    if (!rgba) return null;
    const a = alpha === undefined ? 1 : Number(alpha) / 100;
    return rgbaHex(rgba[0], rgba[1], rgba[2], rgba[3] * a * opacity);
  }
  const rgba = parseLiteral(input);
  return rgba ? rgbaHex(rgba[0], rgba[1], rgba[2], rgba[3] * opacity) : null;
}

/** Resolves any schema color (hex, rgba(), `$token`, `$token/60`, transparent); bad input is transparent. */
export function resolveColor(input: string, tokens: Tokens, opacity = 1): string {
  return resolveWith(input, tokens, opacity) ?? "#00000000";
}

/** Same color at a multiple of its alpha. */
export function withAlpha(color: string, factor: number): string {
  const rgba = parseLiteral(color);
  return rgba ? rgbaHex(rgba[0], rgba[1], rgba[2], rgba[3] * factor) : color;
}

/** Linear blend of two resolved colors, t in 0..1. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseLiteral(a);
  const cb = parseLiteral(b);
  if (!ca || !cb) return a;
  return rgbaHex(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
    ca[3] + (cb[3] - ca[3]) * t,
  );
}
