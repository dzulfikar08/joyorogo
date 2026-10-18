import { z } from "zod";

import type { Condition } from "./expr";
import { isIconName } from "./icons";

/**
 * Template schema, version 1. Everything is plain JSON; lengths are design px on a
 * canvas that is always 1080 wide. Parsed output has every default filled in, so the
 * resolver never branches on "was this set".
 */

export const SCHEMA_VERSION = 1;
export const CANVAS_WIDTH = 1080;

export const COLOR_TOKENS = [
  "bg",
  "bg2",
  "fg",
  "fgSoft",
  "fgMuted",
  "accent",
  "accent2",
  "surface",
  "surfaceStrong",
  "line",
  "good",
  "warn",
  "bad",
  "data1",
  "data2",
  "data3",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

const COLOR_RE = /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\d{1,3}%?)\s*)?\)|transparent|\$(?:bg|bg2|fg|fgSoft|fgMuted|accent|accent2|surface|surfaceStrong|line|good|warn|bad|data1|data2|data3)(?:\/(?:100|\d{1,2}))?)$/;

export const color = z.string().regex(COLOR_RE, "invalid color");

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;
const bindPath = z.string().regex(PATH_RE, "invalid binding path");
const bindRef = z.object({ bind: bindPath });

const num = (min: number, max: number) => z.number().finite().min(min).max(max);

const expr = z.union([
  z.string().max(400),
  z.object({
    t: z.string().regex(/^[A-Za-z0-9_.:-]+$/).max(120),
    args: z.record(z.string().max(40), z.string().max(400)).optional(),
  }),
]);

const numRef = z.union([
  num(-1e9, 1e9),
  z.object({
    bind: bindPath,
    div: z.union([bindPath, num(-1e9, 1e9)]).optional(),
    mul: num(-1e9, 1e9).optional(),
    add: num(-1e9, 1e9).optional(),
    clamp: z.tuple([num(-1e9, 1e9), num(-1e9, 1e9)]).optional(),
  }),
]);

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      bind: bindPath,
      exists: z.boolean().optional(),
      eq: z.unknown().optional(),
      ne: z.unknown().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      in: z.array(z.unknown()).max(40).optional(),
    }),
    z.object({ all: z.array(condition).max(12) }),
    z.object({ any: z.array(condition).max(12) }),
    z.object({ not: condition }),
  ]),
);

const stops = z
  .array(z.object({ at: num(0, 1), color }))
  .min(2)
  .max(8);

const gradient = z.object({ angle: num(-360, 360).default(180), stops });
const paint = z.union([color, z.object({ gradient })]);

const stroke = z.object({
  color,
  width: num(0, 200),
  dash: z.tuple([num(0, 400), num(0, 400)]).optional(),
});

const dim = z.union([num(0, 6000), z.literal("auto"), z.literal("fill")]);

const box = z.object({
  x: num(-6000, 6000).default(0),
  y: num(-6000, 6000).default(0),
  w: dim.default("auto"),
  h: dim.default("auto"),
});

const fit = z
  .object({
    mode: z.enum(["shrink", "ellipsis", "wrap"]).default("shrink"),
    minSize: num(1, 600).optional(),
    maxLines: z.number().int().min(1).max(6).optional(),
  })
  .default({ mode: "shrink" });

const align = z.enum(["left", "center", "right"]);
const fontRole = z.enum(["display", "body", "mono"]);
const weight = z.number().int().min(100).max(900).multipleOf(100);

const common = {
  id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  name: z.string().max(80).optional(),
  box,
  rotation: num(-360, 360).optional(),
  opacity: num(0, 1).optional(),
  when: condition.optional(),
  onMissing: z.enum(["hide", "keep"]).default("hide"),
  fallback: z.string().max(40).optional(),
  role: z.enum(["watermark", "attribution"]).optional(),
  locked: z.boolean().optional(),
};

const textStyle = {
  size: num(1, 600).default(40),
  weight: weight.default(700),
  font: fontRole.default("body"),
  color: color.default("$fg"),
  align: align.default("left"),
  letterSpacing: num(-20, 60).default(0),
  lineHeight: num(0.8, 2).default(1.15),
  case: z.enum(["upper", "none"]).default("none"),
  trim: z.enum(["none", "cap"]).default("none"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  fit,
  shadow: z.boolean().default(false),
};

const panel = {
  fill: paint.optional(),
  stroke: stroke.optional(),
  radius: num(0, 3000).optional(),
  glass: z.boolean().optional(),
};

export const textLayer = z.object({
  ...common,
  type: z.literal("text"),
  value: expr,
  ...textStyle,
});

export const statLayer = z.object({
  ...common,
  type: z.literal("stat"),
  value: expr,
  unit: expr.optional(),
  label: expr.optional(),
  valueSize: num(1, 800).default(120),
  unitSize: num(1, 400).optional(),
  labelSize: num(1, 300).default(32),
  valueWeight: weight.default(800),
  font: fontRole.default("body"),
  color: color.default("$fg"),
  labelColor: color.default("$fgMuted"),
  align: align.default("left"),
  labelPos: z.enum(["above", "below", "none"]).default("below"),
  gap: num(0, 200).default(8),
  trim: z.enum(["none", "cap"]).default("cap"),
  fit,
  shadow: z.boolean().default(false),
});

export const ringLayer = z.object({
  ...common,
  type: z.literal("ring"),
  progress: numRef.optional(),
  segments: z.array(z.object({ value: numRef, color })).max(8).optional(),
  thickness: num(1, 400).default(36),
  startAngle: num(-360, 360).default(-90),
  sweep: num(10, 360).default(360),
  track: color.optional(),
  color: color.default("$accent"),
  overColor: color.optional(),
  cap: z.enum(["round", "butt"]).default("round"),
  max: num(0.1, 10).default(1),
});

export const chartLayer = z.object({
  ...common,
  type: z.literal("chart"),
  kind: z.enum(["bars", "line", "area", "spark", "stack"]),
  series: bindRef.optional(),
  labels: bindRef.optional(),
  colors: bindRef.optional(),
  segments: z.array(z.object({ value: numRef, color })).max(12).optional(),
  color: color.default("$accent"),
  color2: color.optional(),
  highlight: z.union([z.enum(["max", "min", "last"]), z.number().int().min(0).max(400)]).optional(),
  baseline: numRef.optional(),
  strokeWidth: num(0, 100).default(8),
  barRadius: num(0, 200).default(8),
  horizontal: z.boolean().default(false),
  showLabels: z.boolean().default(false),
  labelSize: num(1, 200).default(26),
  labelColor: color.default("$fgMuted"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});

export const routeLayer = z.object({
  ...common,
  type: z.literal("route"),
  points: bindRef,
  color: color.default("$accent"),
  color2: color.optional(),
  strokeWidth: num(1, 100).default(10),
  halo: z.boolean().default(false),
  markers: z.boolean().default(false),
  padding: num(0, 400).default(24),
  trim: z.union([z.literal("privacy"), num(0, 5000)]).default("privacy"),
  dash: z.tuple([num(0, 400), num(0, 400)]).optional(),
});

export const imageLayer = z.object({
  ...common,
  type: z.literal("image"),
  src: z.union([bindRef, z.object({ asset: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/) })]),
  fit: z.enum(["cover", "contain"]).default("cover"),
  radius: num(0, 3000).optional(),
  mask: z.enum(["circle", "rounded"]).optional(),
  border: z.object({ color, width: num(0, 100) }).optional(),
});

export const brandLayer = z.object({
  ...common,
  type: z.literal("brand"),
  mark: z.enum(["logo", "wordmark", "lockup", "link"]),
  tone: z.enum(["auto", "light", "dark", "mono"]).default("auto"),
  size: num(1, 600).optional(),
});

export const iconLayer = z.object({
  ...common,
  type: z.literal("icon"),
  name: z.string().refine(isIconName, "unknown icon"),
  color: color.default("$fg"),
});

export const shapeLayer = z.object({
  ...common,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "line", "path"]),
  d: z.string().max(4000).optional(),
  viewBox: z.tuple([num(0, 4000), num(0, 4000)]).optional(),
  ...panel,
});

/** Children are validated one by one by parse.ts so one bad child never kills the group. */
export const groupLayer = z.object({
  ...common,
  type: z.literal("group"),
  children: z.array(z.unknown()).max(80),
  layout: z
    .object({
      kind: z.literal("stack"),
      dir: z.enum(["row", "column"]).default("column"),
      gap: num(0, 1000).default(0),
      align: z.enum(["start", "center", "end", "stretch"]).default("start"),
      justify: z.enum(["start", "center", "end", "between"]).default("start"),
      padding: num(0, 1000).default(0),
    })
    .optional(),
  clip: z.boolean().optional(),
  ...panel,
});

export type TextLayer = z.output<typeof textLayer>;
export type StatLayer = z.output<typeof statLayer>;
export type RingLayer = z.output<typeof ringLayer>;
export type ChartLayer = z.output<typeof chartLayer>;
export type RouteLayer = z.output<typeof routeLayer>;
export type ImageLayer = z.output<typeof imageLayer>;
export type BrandLayer = z.output<typeof brandLayer>;
export type IconLayer = z.output<typeof iconLayer>;
export type ShapeLayer = z.output<typeof shapeLayer>;
export type GroupLayer = Omit<z.output<typeof groupLayer>, "children"> & { children: Layer[] };

export type Layer =
  | TextLayer
  | StatLayer
  | RingLayer
  | ChartLayer
  | RouteLayer
  | ImageLayer
  | BrandLayer
  | IconLayer
  | ShapeLayer
  | GroupLayer;

export type LayerType = Layer["type"];

/** Per-type schemas; parse.ts picks one by `type`, so unknown types are dropped, not thrown. */
export const LAYER_SCHEMAS = {
  text: textLayer,
  stat: statLayer,
  ring: ringLayer,
  chart: chartLayer,
  route: routeLayer,
  image: imageLayer,
  brand: brandLayer,
  icon: iconLayer,
  shape: shapeLayer,
  group: groupLayer,
} as const;

const colors = z.object(
  Object.fromEntries(COLOR_TOKENS.map((token) => [token, color.optional()])) as Record<
    ColorToken,
    z.ZodOptional<typeof color>
  >,
);

const theme = z.object({ colors: colors.default({}) });
export type Theme = z.output<typeof theme>;

const scrim = z.object({
  side: z.enum(["bottom", "top", "both", "full"]),
  color,
  opacity: num(0, 1),
  from: num(0, 1).default(0.4),
});

const flatBackground = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transparent") }),
  z.object({ kind: z.literal("color"), color }),
  z.object({
    kind: z.literal("gradient"),
    angle: num(-360, 360).default(180),
    stops,
    glows: z
      .array(z.object({ x: num(-2000, 4000), y: num(-2000, 4000), r: num(1, 6000), color, opacity: num(0, 1).default(1) }))
      .max(6)
      .optional(),
  }),
]);

const imageBackground = (defaultBind: string) => ({
  bind: bindPath.default(defaultBind),
  fit: z.enum(["cover", "contain"]).default("cover"),
  scrim: scrim.optional(),
  fallback: flatBackground,
});

export const background = z.discriminatedUnion("kind", [
  ...flatBackground.options,
  z.object({
    kind: z.literal("photo"),
    ...imageBackground("photo"),
    tint: z.object({ color, opacity: num(0, 1) }).optional(),
  }),
  z.object({ kind: z.literal("map"), ...imageBackground("mapImage"), invert: z.boolean().optional() }),
]);
export type Background = z.output<typeof background>;

export const ASPECT_HEIGHT = { story: 1920, square: 1080, portrait: 1350, wide: 608 } as const;

const templateShape = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  name: z.string().min(1).max(80),
  titleKey: z.string().max(120).optional(),
  kind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  style: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  canvas: z.object({
    width: z.literal(CANVAS_WIDTH),
    height: z.number().int().min(320).max(2400),
    aspect: z.enum(["story", "square", "portrait", "wide", "free"]),
  }),
  safe: z
    .object({
      top: num(0, 1200).default(0),
      right: num(0, 1200).default(0),
      bottom: num(0, 1200).default(0),
      left: num(0, 1200).default(0),
    })
    .optional(),
  background,
  themes: z.object({ dark: theme, light: theme }),
  constraints: z
    .object({
      minFontSize: num(1, 200).default(22),
      maxTextChars: z.number().int().min(1).max(1000).default(140),
      maxLayers: z.number().int().min(1).max(400).default(60),
    })
    .default({ minFontSize: 22, maxTextChars: 140, maxLayers: 60 }),
  requires: z.array(bindPath).max(40).optional(),
  pro: z.boolean().optional(),
  meta: z
    .object({
      tags: z.array(z.string().max(32)).max(12).optional(),
      transparent: z.boolean().optional(),
      needsPhoto: z.boolean().optional(),
      needsRoute: z.boolean().optional(),
    })
    .optional(),
};

/** Header only: layers are validated separately. */
export const templateHeader = z
  .object(templateShape)
  .refine(
    (t) => {
      const want = t.canvas.aspect === "free" ? null : ASPECT_HEIGHT[t.canvas.aspect];
      return want === null || Math.abs(want - t.canvas.height) <= 1;
    },
    { message: "canvas.height does not match canvas.aspect" },
  );

export type TemplateHeader = z.output<typeof templateHeader>;
export type Template = TemplateHeader & { layers: Layer[] };

/** A layer as authored (defaults not yet applied); group children stay loose and are checked by parseTemplate. */
export type LayerInput =
  | z.input<typeof textLayer>
  | z.input<typeof statLayer>
  | z.input<typeof ringLayer>
  | z.input<typeof chartLayer>
  | z.input<typeof routeLayer>
  | z.input<typeof imageLayer>
  | z.input<typeof brandLayer>
  | z.input<typeof iconLayer>
  | z.input<typeof shapeLayer>
  | z.input<typeof groupLayer>;

/** Template as authored (defaults not yet applied). */
export type TemplateInput = z.input<typeof templateHeader> & { layers: LayerInput[] };

export const DEFAULT_STORY_SAFE = { top: 250, right: 72, bottom: 340, left: 72 } as const;
