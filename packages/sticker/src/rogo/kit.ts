import type { LayerInput, TemplateInput } from "../core/schema";

/**
 * Authoring helpers for the built-in JoyoRogo templates. Output is plain template
 * JSON (schema v1); nothing here runs at render time.
 */

type ThemeColors = NonNullable<TemplateInput["themes"]["dark"]["colors"]>;

export const ROGO_DARK: ThemeColors = {
  bg: "#0d1f12",
  bg2: "#16402a",
  fg: "#ffffff",
  fgSoft: "#ffffffeb",
  fgMuted: "#ffffffb8",
  accent: "#7fd89b",
  accent2: "#f6a56b",
  surface: "#ffffff12",
  surfaceStrong: "#ffffff24",
  line: "#ffffff3d",
  good: "#7fd89b",
  warn: "#f59e0b",
  bad: "#f87171",
  data1: "#7fd89b",
  data2: "#f6a56b",
  data3: "#9fa9f0",
};

export const ROGO_LIGHT: ThemeColors = {
  bg: "#f9f6f1",
  bg2: "#e4efd9",
  fg: "#1d1a15",
  fgSoft: "#1d1a15d9",
  fgMuted: "#66635c",
  accent: "#137d41",
  accent2: "#de602f",
  surface: "#1d1a1512",
  surfaceStrong: "#1d1a1524",
  line: "#1d1a1529",
  good: "#137d41",
  warn: "#b45309",
  bad: "#b42318",
  data1: "#137d41",
  data2: "#de602f",
  data3: "#5c69bc",
};

export type CanvasSpec = "story" | "square" | "portrait" | { sticker: number };

export const STORY_SAFE = { top: 250, right: 72, bottom: 340, left: 72 } as const;
export const SQUARE_SAFE = { top: 72, right: 72, bottom: 72, left: 72 } as const;
/** Feed 4:5 (1080x1350): no app chrome over it, so the margin is the square one. */
export const PORTRAIT_SAFE = SQUARE_SAFE;

type Def = {
  id: string;
  kind: string;
  style: string;
  canvas: CanvasSpec;
  name?: string;
  background?: TemplateInput["background"];
  /** Per-mode overrides merged over the JoyoRogo palette. */
  dark?: ThemeColors;
  light?: ThemeColors;
  layers: LayerInput[];
  requires?: string[];
  needsPhoto?: boolean;
  tags?: string[];
  /** Raise the layer budget (default 60) for cards that spell out many rows. */
  maxLayers?: number;
  /** Own safe area, for a card that has to use the room under the default story bottom inset. */
  safe?: { top: number; right: number; bottom: number; left: number };
};

const TRANSPARENT = { kind: "transparent" } as const;

export function defineTemplate(def: Def): TemplateInput {
  const sticker = typeof def.canvas === "object";
  const height =
    def.canvas === "story" ? 1920 : def.canvas === "square" ? 1080 : def.canvas === "portrait" ? 1350 : def.canvas.sticker;
  const aspect =
    def.canvas === "story" ? "story" : def.canvas === "square" ? "square" : def.canvas === "portrait" ? "portrait" : "free";
  return {
    schemaVersion: 1,
    id: def.id,
    name: def.name ?? `${def.kind} ${def.style}`,
    titleKey: `sticker:style.${def.style}`,
    kind: def.kind,
    style: def.style,
    canvas: { width: 1080, height, aspect },
    safe:
      def.safe ??
      (def.canvas === "story"
        ? STORY_SAFE
        : def.canvas === "square"
          ? SQUARE_SAFE
          : def.canvas === "portrait"
            ? PORTRAIT_SAFE
            : undefined),
    background: def.background ?? (sticker ? TRANSPARENT : { kind: "color", color: "$bg" }),
    themes: {
      dark: { colors: { ...ROGO_DARK, ...def.dark } },
      light: { colors: { ...ROGO_LIGHT, ...def.light } },
    },
    layers: def.layers,
    requires: def.requires,
    ...(def.maxLayers ? { constraints: { minFontSize: 22, maxTextChars: 140, maxLayers: def.maxLayers } } : {}),
    meta: { transparent: sticker || undefined, needsPhoto: def.needsPhoto || undefined, tags: def.tags },
  };
}

/** The standard brand gradient card background (dark leaf), photo-free. */
export const BRAND_GRADIENT: TemplateInput["background"] = {
  kind: "gradient",
  angle: 160,
  stops: [
    { at: 0, color: "$bg" },
    { at: 1, color: "$bg2" },
  ],
  glows: [{ x: 900, y: 260, r: 760, color: "$accent", opacity: 0.16 }],
};

/** Photo background with the brand gradient as the no-photo fallback. */
export function photoBackground(scrimOpacity = 0.78): TemplateInput["background"] {
  return {
    kind: "photo",
    bind: "photo",
    fit: "cover",
    scrim: { side: "bottom", color: "#000000", opacity: scrimOpacity, from: 0.38 },
    fallback: {
      kind: "gradient",
      angle: 160,
      stops: [
        { at: 0, color: "$bg" },
        { at: 1, color: "$bg2" },
      ],
    },
  };
}

/** App mark + link, removed when the watermark option is off. `w` is the row width, `justify` where it sits in it. */
export function watermark(
  id: string,
  box: { x: number; y: number; w: number },
  justify: "start" | "center" | "end" = "center",
): LayerInput {
  return {
    id,
    type: "group",
    role: "watermark",
    box: { x: box.x, y: box.y, w: box.w, h: 56 },
    layout: { kind: "stack", dir: "row", gap: 22, align: "center", justify },
    children: [
      { id: `${id}-logo`, type: "brand", mark: "lockup", size: 52, tone: "auto", box: { x: 0, y: 0 } },
      { id: `${id}-link`, type: "brand", mark: "link", tone: "auto", size: 30, box: { x: 0, y: 0 } },
    ],
  };
}

const hasWatermark = (layers: ReadonlyArray<unknown>): boolean =>
  layers.some((layer) => {
    if (layer === null || typeof layer !== "object") return false;
    if ("role" in layer && layer.role === "watermark") return true;
    return "children" in layer && Array.isArray(layer.children) && hasWatermark(layer.children);
  });

/** Room a transparent sticker adds below its content for the mark. */
export const STICKER_MARK_H = 120;

/**
 * A transparent sticker lands on someone's photo, so its mark is a small dark chip that
 * reads on any background; it also carries the first name when the user shows it.
 * Stickers that already carry a watermark layer are left alone; the rest get the chip
 * centered under their content, on a canvas made taller to fit it.
 */
export function withStickerMark(template: TemplateInput): TemplateInput {
  if (!template.meta?.transparent || hasWatermark(template.layers)) return template;
  const top = template.canvas.height + 16;
  const chip: LayerInput = {
    id: "wm",
    type: "group",
    role: "watermark",
    box: { x: 0, y: top, w: 1080, h: 80 },
    layout: { kind: "stack", dir: "row", gap: 0, align: "center", justify: "center" },
    children: [
      {
        id: "wm-chip",
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: 80 },
        fill: "#0000008c",
        radius: 40,
        layout: { kind: "stack", dir: "row", gap: 20, align: "center", padding: 22 },
        children: [
          {
            id: "wm-name",
            type: "text",
            value: "{user.name}",
            size: 28,
            weight: 800,
            color: "#ffffff",
            fit: { mode: "shrink", minSize: 22 },
            box: { x: 0, y: 0, w: "auto" },
          },
          { id: "wm-logo", type: "brand", mark: "lockup", size: 40, tone: "light", box: { x: 0, y: 0 } },
          { id: "wm-link", type: "brand", mark: "link", tone: "light", size: 28, box: { x: 0, y: 0 } },
        ],
      },
    ],
  };
  return {
    ...template,
    canvas: { ...template.canvas, height: top + 80 + 24 },
    layers: [...template.layers, chip],
  };
}
