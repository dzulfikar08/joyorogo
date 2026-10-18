/**
 * The Scene: the only thing painters see. Absolute coordinates in design px on a
 * 1080-wide canvas, colors already resolved to `#rrggbb` / `#rrggbbaa`, text already
 * measured, fitted and broken into single lines. Painters do no layout.
 */

export type Stop = { at: number; color: string };

export type LinearPaint = {
  linear: { x1: number; y1: number; x2: number; y2: number; stops: Stop[] };
};
export type RadialPaint = { radial: { cx: number; cy: number; r: number; stops: Stop[] } };
export type Paint = string | LinearPaint | RadialPaint;

export type Stroke = {
  color: string | LinearPaint;
  width: number;
  dash?: [number, number];
  cap?: "round" | "butt";
  join?: "round" | "miter";
};

export type RectNode = {
  k: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  fill?: Paint;
  stroke?: Stroke;
  opacity?: number;
};

export type EllipseNode = {
  k: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: Paint;
  stroke?: Stroke;
  opacity?: number;
};

export type PathNode = {
  k: "path";
  /** SVG path syntax, absolute coordinates unless `transform` is set. */
  d: string;
  fill?: Paint;
  stroke?: Stroke;
  fillRule?: "nonzero" | "evenodd";
  /** Translate, then rotate (deg), then uniform scale, applied to `d`. */
  transform?: { x: number; y: number; scale: number; rotate?: number };
  opacity?: number;
};

export type TextNode = {
  k: "text";
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  size: number;
  weight: number;
  font: FontRole;
  fill: string;
  anchor: "start" | "middle" | "end";
  letterSpacing?: number;
  opacity?: number;
};

export type ImageNode = {
  k: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  uri: string;
  fit: "cover" | "contain";
  /** Corner radius of the clip; a value >= min(w,h)/2 is a circle. */
  rx?: number;
  opacity?: number;
};

export type GroupNode = {
  k: "group";
  children: SceneNode[];
  clip?: { x: number; y: number; w: number; h: number; rx?: number };
  rotate?: { deg: number; cx: number; cy: number };
  opacity?: number;
};

export type SceneNode = RectNode | EllipseNode | PathNode | TextNode | ImageNode | GroupNode;

export type FontRole = "display" | "body" | "mono";

export type IssueCode =
  | "too-new"
  | "invalid-header"
  | "invalid-layer"
  | "unknown-layer"
  | "no-layers"
  | "migration-failed"
  | "missing-binding"
  | "unknown-filter"
  | "unknown-icon"
  | "outside-safe"
  | "text-too-small"
  | "duplicate-id"
  | "too-many-layers";

export type Issue = { code: IssueCode; message: string; layerId?: string };

export type Scene = {
  width: number;
  height: number;
  nodes: SceneNode[];
  /** True when nothing paints the whole canvas (a transparent PNG sticker). */
  transparent: boolean;
  /** Every image URI the nodes reference; painters wait for these before capture. */
  needsImages: string[];
  issues: Issue[];
};

/** Splits `#rrggbb` / `#rrggbbaa` into an opaque `#rrggbb` and an alpha 0..1. */
export function splitColor(color: string): { rgb: string; a: number } {
  if (color.length === 9) {
    return { rgb: color.slice(0, 7), a: Math.round((parseInt(color.slice(7, 9), 16) / 255) * 1000) / 1000 };
  }
  return { rgb: color, a: 1 };
}
