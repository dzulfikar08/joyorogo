import { splitColor, type LinearPaint, type Paint, type PathNode, type RadialPaint, type Scene, type SceneNode, type Stop, type Stroke } from "./scene";
import type { FontMap } from "./text";

/** Scene -> SVG string. A 1:1 map; used by tests/goldens, the web preview and Studio. */

export type SvgOptions = {
  fonts: FontMap;
  /** Maps an image URI to what goes in `href` (e.g. a data URI for a headless render). */
  imageHref?: (uri: string) => string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (v: number) => String(Math.round(v * 100) / 100);

class Defs {
  private items: string[] = [];
  private count = 0;

  next(prefix: string): string {
    return `${prefix}${this.count++}`;
  }

  push(markup: string): void {
    this.items.push(markup);
  }

  toString(): string {
    return this.items.length ? `<defs>${this.items.join("")}</defs>` : "";
  }
}

function stopsMarkup(stops: Stop[]): string {
  return stops
    .map((s) => {
      const { rgb, a } = splitColor(s.color);
      return `<stop offset="${n(s.at)}" stop-color="${rgb}"${a < 1 ? ` stop-opacity="${a}"` : ""}/>`;
    })
    .join("");
}

function gradientRef(defs: Defs, paint: LinearPaint | RadialPaint): string {
  const id = defs.next("g");
  if ("linear" in paint) {
    const { x1, y1, x2, y2, stops } = paint.linear;
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stopsMarkup(stops)}</linearGradient>`);
  } else {
    const { cx, cy, r, stops } = paint.radial;
    defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">${stopsMarkup(stops)}</radialGradient>`);
  }
  return `url(#${id})`;
}

function fillAttrs(defs: Defs, fill: Paint | undefined): string {
  if (fill === undefined) return ' fill="none"';
  if (typeof fill === "string") {
    const { rgb, a } = splitColor(fill);
    return ` fill="${rgb}"${a < 1 ? ` fill-opacity="${a}"` : ""}`;
  }
  return ` fill="${gradientRef(defs, fill)}"`;
}

function strokeAttrs(defs: Defs, stroke: Stroke | undefined): string {
  if (!stroke) return "";
  let out: string;
  if (typeof stroke.color === "string") {
    const { rgb, a } = splitColor(stroke.color);
    out = ` stroke="${rgb}"${a < 1 ? ` stroke-opacity="${a}"` : ""}`;
  } else {
    out = ` stroke="${gradientRef(defs, stroke.color)}"`;
  }
  out += ` stroke-width="${n(stroke.width)}"`;
  if (stroke.cap) out += ` stroke-linecap="${stroke.cap}"`;
  if (stroke.join) out += ` stroke-linejoin="${stroke.join}"`;
  if (stroke.dash) out += ` stroke-dasharray="${n(stroke.dash[0])} ${n(stroke.dash[1])}"`;
  return out;
}

const opacityAttr = (o: number | undefined) => (o !== undefined && o < 1 ? ` opacity="${n(o)}"` : "");

function pathTransform(node: PathNode): string {
  const t = node.transform;
  if (!t) return "";
  return ` transform="translate(${n(t.x)} ${n(t.y)})${t.rotate ? ` rotate(${n(t.rotate)})` : ""} scale(${t.scale})"`;
}

function nodeMarkup(node: SceneNode, defs: Defs, opts: SvgOptions): string {
  switch (node.k) {
    case "rect":
      return `<rect x="${n(node.x)}" y="${n(node.y)}" width="${n(node.w)}" height="${n(node.h)}"${node.rx ? ` rx="${n(node.rx)}"` : ""}${fillAttrs(defs, node.fill)}${strokeAttrs(defs, node.stroke)}${opacityAttr(node.opacity)}/>`;
    case "ellipse":
      return `<ellipse cx="${n(node.cx)}" cy="${n(node.cy)}" rx="${n(node.rx)}" ry="${n(node.ry)}"${fillAttrs(defs, node.fill)}${strokeAttrs(defs, node.stroke)}${opacityAttr(node.opacity)}/>`;
    case "path":
      return `<path d="${esc(node.d)}"${pathTransform(node)}${fillAttrs(defs, node.fill)}${node.fillRule ? ` fill-rule="${node.fillRule}"` : ""}${strokeAttrs(defs, node.stroke)}${opacityAttr(node.opacity)}/>`;
    case "text": {
      const paint = opts.fonts.paint(node.font, node.weight);
      const { rgb, a } = splitColor(node.fill);
      return `<text x="${n(node.x)}" y="${n(node.y)}" font-family="${esc(paint.family)}"${paint.weight ? ` font-weight="${paint.weight}"` : ""} font-size="${n(node.size)}" fill="${rgb}"${a < 1 ? ` fill-opacity="${a}"` : ""} text-anchor="${node.anchor}"${node.letterSpacing ? ` letter-spacing="${n(node.letterSpacing)}"` : ""}${opacityAttr(node.opacity)}>${esc(node.text)}</text>`;
    }
    case "image": {
      const href = esc(opts.imageHref ? opts.imageHref(node.uri) : node.uri);
      const aspect = node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
      let clip = "";
      if (node.rx) {
        const id = defs.next("c");
        defs.push(`<clipPath id="${id}"><rect x="${n(node.x)}" y="${n(node.y)}" width="${n(node.w)}" height="${n(node.h)}" rx="${n(Math.min(node.rx, Math.min(node.w, node.h) / 2))}"/></clipPath>`);
        clip = ` clip-path="url(#${id})"`;
      }
      return `<image x="${n(node.x)}" y="${n(node.y)}" width="${n(node.w)}" height="${n(node.h)}" href="${href}" preserveAspectRatio="${aspect}"${clip}${opacityAttr(node.opacity)}/>`;
    }
    case "group": {
      let attrs = opacityAttr(node.opacity);
      if (node.clip) {
        const id = defs.next("c");
        const c = node.clip;
        defs.push(`<clipPath id="${id}"><rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}"${c.rx ? ` rx="${n(c.rx)}"` : ""}/></clipPath>`);
        attrs += ` clip-path="url(#${id})"`;
      }
      if (node.rotate) attrs += ` transform="rotate(${n(node.rotate.deg)} ${n(node.rotate.cx)} ${n(node.rotate.cy)})"`;
      return `<g${attrs}>${node.children.map((c) => nodeMarkup(c, defs, opts)).join("")}</g>`;
    }
  }
}

export function toSvg(scene: Scene, opts: SvgOptions): string {
  const defs = new Defs();
  const body = scene.nodes.map((node) => nodeMarkup(node, defs, opts)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" text-rendering="geometricPrecision">${defs}${body}</svg>`;
}
