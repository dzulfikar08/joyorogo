import type { Expr } from "../core/expr";
import type { LayerInput } from "../core/schema";

/**
 * Shared pieces of the "receipt" style: a thermal-paper strip with zigzag edges, mono
 * rows with dotted leaders. Paper and ink are literal colors on purpose: a receipt is
 * paper in both app themes.
 */

export const PAPER = "#f6f1e4";
export const INK = "#1d1a15";
export const INK_SOFT = "#1d1a15a6";

/** Zigzag-edged rectangle as path data in a `w x h` box (teeth of `tooth` px on top and bottom). */
export function paperPath(w: number, h: number, tooth = 18): string {
  const teeth = Math.max(2, Math.round(w / tooth));
  const step = w / teeth;
  let d = "M0 0";
  for (let i = 0; i < teeth; i++) d += `L${((i + 0.5) * step).toFixed(1)} ${tooth * 0.55}L${((i + 1) * step).toFixed(1)} 0`;
  d += `L${w} ${h}`;
  for (let i = teeth; i > 0; i--) d += `L${((i - 0.5) * step).toFixed(1)} ${(h - tooth * 0.55).toFixed(1)}L${((i - 1) * step).toFixed(1)} ${h}`;
  return `${d}Z`;
}

/** Drop shadow plus the paper strip, rotated `rotation` degrees as a group. Children are laid out in paper coordinates. */
export function receiptPaper(
  id: string,
  box: { x: number; y: number; w: number; h: number },
  children: LayerInput[],
  rotation = 0,
): LayerInput[] {
  return [
    {
      id: `${id}-shadow`,
      type: "shape",
      shape: "path",
      d: paperPath(box.w, box.h),
      viewBox: [box.w, box.h],
      fill: "#00000059",
      rotation,
      box: { x: box.x + 6, y: box.y + 14, w: box.w, h: box.h },
    },
    {
      id,
      type: "group",
      rotation,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      children: [
        {
          id: `${id}-paper`,
          type: "shape",
          shape: "path",
          d: paperPath(box.w, box.h),
          viewBox: [box.w, box.h],
          fill: PAPER,
          box: { x: 0, y: 0, w: box.w, h: box.h },
        },
        ...children,
      ],
    },
  ];
}

/** Dashed rule across the paper. */
export function receiptRule(id: string, x: number, y: number, w: number): LayerInput {
  return {
    id,
    type: "shape",
    shape: "line",
    stroke: { color: INK_SOFT, width: 3, dash: [3, 9] },
    box: { x, y, w, h: 0 },
  };
}

/** Label on the left, value on the right, dotted leader between (mono). */
export function receiptRow(
  id: string,
  x: number,
  y: number,
  w: number,
  label: Expr,
  value: Expr,
  size = 40,
  weight = 500,
): LayerInput {
  return {
    id,
    type: "group",
    box: { x, y, w, h: "auto" },
    layout: { kind: "stack", dir: "row", gap: 14, align: "end" },
    children: [
      { id: `${id}-label`, type: "text", value: label, font: "mono", size, weight, color: INK, case: "upper", box: { x: 0, y: 0, w: "auto" } },
      { id: `${id}-dots`, type: "shape", shape: "line", stroke: { color: INK_SOFT, width: 3, dash: [2, 9] }, box: { x: 0, y: 0, w: "fill", h: 14 } },
      { id: `${id}-value`, type: "text", value, font: "mono", size, weight: 700, color: INK, align: "right", box: { x: 0, y: 0, w: "auto" } },
    ],
  };
}
