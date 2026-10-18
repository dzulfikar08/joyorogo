import type { LinearPaint, Paint, RadialPaint, Scene, SceneNode, Stop, Stroke } from "./scene";
import type { FontMap } from "./text";

/**
 * Scene -> Canvas2D calls. Structural types so core needs no DOM lib; pass a real
 * CanvasRenderingContext2D, plus `Path2D` for path nodes.
 */

export type CanvasGradientLike = { addColorStop(offset: number, color: string): void };

export type Canvas2D = {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  fill(path?: unknown, rule?: string): void;
  stroke(path?: unknown): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(dash: number[]): void;
  createLinearGradient(x1: number, y1: number, x2: number, y2: number): CanvasGradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};

export type CanvasImage = { width: number; height: number };

export type CanvasOptions = {
  fonts: FontMap;
  /** Loaded, decoded image for a URI; a missing one is skipped. */
  image(uri: string): CanvasImage | undefined;
  path2D(d: string): unknown;
};

function gradient(ctx: Canvas2D, paint: LinearPaint | RadialPaint): CanvasGradientLike {
  let g: CanvasGradientLike;
  let stops: Stop[];
  if ("linear" in paint) {
    const l = paint.linear;
    g = ctx.createLinearGradient(l.x1, l.y1, l.x2, l.y2);
    stops = l.stops;
  } else {
    const r = paint.radial;
    g = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, r.r);
    stops = r.stops;
  }
  for (const s of stops) g.addColorStop(s.at, s.color);
  return g;
}

const style = (ctx: Canvas2D, paint: Paint | LinearPaint) => (typeof paint === "string" ? paint : gradient(ctx, paint));

function applyStroke(ctx: Canvas2D, stroke: Stroke): void {
  ctx.strokeStyle = style(ctx, stroke.color);
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.cap ?? "butt";
  ctx.lineJoin = stroke.join ?? "miter";
  ctx.setLineDash(stroke.dash ? [stroke.dash[0], stroke.dash[1]] : []);
}

function roundRectPath(ctx: Canvas2D, x: number, y: number, w: number, h: number, rx: number | undefined): void {
  ctx.beginPath();
  if (rx && rx > 0) ctx.roundRect(x, y, w, h, Math.min(rx, Math.min(w, h) / 2));
  else ctx.rect(x, y, w, h);
}

function drawNode(ctx: Canvas2D, node: SceneNode, opts: CanvasOptions): void {
  switch (node.k) {
    case "rect": {
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      roundRectPath(ctx, node.x, node.y, node.w, node.h, node.rx);
      if (node.fill !== undefined) {
        ctx.fillStyle = style(ctx, node.fill);
        ctx.fill();
      }
      if (node.stroke) {
        applyStroke(ctx, node.stroke);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "ellipse": {
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      ctx.beginPath();
      ctx.ellipse(node.cx, node.cy, node.rx, node.ry, 0, 0, Math.PI * 2);
      if (node.fill !== undefined) {
        ctx.fillStyle = style(ctx, node.fill);
        ctx.fill();
      }
      if (node.stroke) {
        applyStroke(ctx, node.stroke);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "path": {
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      if (node.transform) {
        ctx.translate(node.transform.x, node.transform.y);
        if (node.transform.rotate) ctx.rotate((node.transform.rotate * Math.PI) / 180);
        ctx.scale(node.transform.scale, node.transform.scale);
      }
      const path = opts.path2D(node.d);
      if (node.fill !== undefined) {
        ctx.fillStyle = style(ctx, node.fill);
        ctx.fill(path, node.fillRule ?? "nonzero");
      }
      if (node.stroke) {
        applyStroke(ctx, node.stroke);
        ctx.stroke(path);
      }
      ctx.restore();
      return;
    }
    case "text": {
      const paint = opts.fonts.paint(node.font, node.weight);
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      ctx.font = `${paint.weight ?? 400} ${node.size}px "${paint.family}"`;
      ctx.textAlign = node.anchor === "middle" ? "center" : node.anchor === "end" ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = node.fill;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${node.letterSpacing ?? 0}px`;
      ctx.fillText(node.text, node.x, node.y);
      ctx.restore();
      return;
    }
    case "image": {
      const img = opts.image(node.uri);
      if (!img || img.width === 0 || img.height === 0) return;
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      roundRectPath(ctx, node.x, node.y, node.w, node.h, node.rx);
      ctx.clip();
      const sx = node.w / img.width;
      const sy = node.h / img.height;
      const k = node.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
      const dw = img.width * k;
      const dh = img.height * k;
      ctx.drawImage(img, 0, 0, img.width, img.height, node.x + (node.w - dw) / 2, node.y + (node.h - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
    case "group": {
      ctx.save();
      if (node.opacity !== undefined) ctx.globalAlpha *= node.opacity;
      if (node.rotate) {
        ctx.translate(node.rotate.cx, node.rotate.cy);
        ctx.rotate((node.rotate.deg * Math.PI) / 180);
        ctx.translate(-node.rotate.cx, -node.rotate.cy);
      }
      if (node.clip) {
        roundRectPath(ctx, node.clip.x, node.clip.y, node.clip.w, node.clip.h, node.clip.rx);
        ctx.clip();
      }
      for (const child of node.children) drawNode(ctx, child, opts);
      ctx.restore();
      return;
    }
  }
}

/** Paints every node; the canvas must already be `scene.width x scene.height`. */
export function paintScene(ctx: Canvas2D, scene: Scene, opts: CanvasOptions): void {
  for (const node of scene.nodes) drawNode(ctx, node, opts);
}
