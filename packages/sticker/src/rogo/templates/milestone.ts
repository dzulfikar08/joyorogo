import type { Condition } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";

type Kind = "streak" | "pr" | "week" | "podium";
const KINDS: readonly Kind[] = ["streak", "pr", "week", "podium"];

const kindIs = (kind: Kind): Condition => ({ bind: "milestone.kind", eq: kind });
const DETAIL: Condition = { bind: "milestone.detail", exists: true };

const ICON: Record<Kind, string> = { streak: "flame", pr: "trophy", week: "checkmark-circle", podium: "podium" };
const COUNT = { count: "{milestone.value}" };

/** Badge accent per kind: orange flame, lavender record, leaf week, gold podium. */
const BADGE_ACCENT: Record<Kind, string> = { streak: "$accent2", pr: "$data3", week: "$accent", podium: "#e0a92a" };

/** One layer per kind, each shown only for its kind. */
function perKind(id: string, build: (kind: Kind) => Partial<LayerInput> & { type: LayerInput["type"] }): LayerInput[] {
  return KINDS.map((kind) => ({ ...build(kind), id: `${id}-${kind}`, when: kindIs(kind) }) as LayerInput);
}

/** Caption under the numeral: unit key per kind (podium has no count). */
const unitValue = (kind: Kind) => ({ t: `sticker:milestone.${kind}.unit`, ...(kind === "podium" ? {} : { args: COUNT }) });

/** Sub line per kind; the PR kind shows the exercise name when there is one. */
function subLayers(id: string, base: Partial<LayerInput> & { type: "text" }): LayerInput[] {
  return KINDS.flatMap((kind) => {
    const common = { ...base, box: base.box };
    if (kind === "pr") {
      return [
        { ...common, id: `${id}-pr`, value: { t: "sticker:milestone.pr.sub" }, when: { all: [kindIs("pr"), { not: DETAIL }] } },
        { ...common, id: `${id}-pr-detail`, value: "{milestone.detail}", when: { all: [kindIs("pr"), DETAIL] } },
      ] as LayerInput[];
    }
    return [{ ...common, id: `${id}-${kind}`, value: { t: `sticker:milestone.${kind}.sub` }, when: kindIs(kind) }] as LayerInput[];
  });
}

const valueText = (kind: Kind) => (kind === "podium" ? "#{milestone.value}" : "{milestone.value}");

/** Disc badge in the Apple Fitness spirit: rimmed disc, kind icon, numeral, caption. Opaque disc so it reads on any photo. */
const milestoneBadgeSticker = defineTemplate({
  id: "milestone.badge.sticker",
  kind: "milestone",
  style: "badge",
  canvas: { sticker: 860 },
  requires: ["milestone.kind"],
  layers: [
    {
      id: "disc",
      type: "shape",
      shape: "ellipse",
      fill: { gradient: { angle: 160, stops: [{ at: 0, color: "$bg2" }, { at: 1, color: "$bg" }] } },
      box: { x: 160, y: 50, w: 760, h: 760 },
    },
    ...perKind("rim", (kind) => ({
      type: "ring",
      progress: 1,
      thickness: 26,
      color: BADGE_ACCENT[kind],
      box: { x: 160, y: 50, w: 760, h: 760 },
    })),
    {
      id: "inner",
      type: "ring",
      progress: 1,
      thickness: 4,
      color: "$line",
      box: { x: 226, y: 116, w: 628, h: 628 },
    },
    ...perKind("icon", (kind) => ({
      type: "icon",
      name: ICON[kind],
      color: BADGE_ACCENT[kind],
      box: { x: 480, y: 168, w: 120, h: 120 },
    })),
    ...perKind("value", (kind) => ({
      type: "stat",
      value: valueText(kind),
      labelPos: "none",
      valueSize: 250,
      align: "center",
      fit: { mode: "shrink", minSize: 120 },
      box: { x: 270, y: 330, w: 540 },
    })),
    ...perKind("unit", (kind) => ({
      type: "text",
      value: unitValue(kind),
      size: 46,
      weight: 800,
      align: "center",
      color: BADGE_ACCENT[kind],
      fit: { mode: "shrink", minSize: 28 },
      box: { x: 270, y: 580, w: 540 },
    })),
    ...subLayers("sub", {
      type: "text",
      size: 30,
      weight: 600,
      color: "$fgMuted",
      align: "center",
      fit: { mode: "ellipsis" },
      box: { x: 290, y: 650, w: 500 },
    }),
  ],
});

/** Poster: full-bleed solid color, a numeral that fills the width, ink in one dark green. */
const POSTER_BG: Record<Kind, string> = { streak: "#f6a56b", pr: "#f2c14e", week: "#7fd89b", podium: "#f6f1e4" };
const POSTER_INK = "#0d1f12";
const POSTER_INK_SOFT = "#0d1f12b3";

const milestonePosterStory = defineTemplate({
  id: "milestone.poster.story",
  kind: "milestone",
  style: "poster",
  canvas: "story",
  requires: ["milestone.kind"],
  layers: [
    ...perKind("bg", (kind) => ({
      type: "shape",
      shape: "rect",
      fill: POSTER_BG[kind],
      box: { x: 0, y: 0, w: 1080, h: 1920 },
    })),
    {
      id: "eyebrow",
      type: "text",
      value: { t: "sticker:milestone.eyebrow" },
      size: 36,
      weight: 800,
      case: "upper",
      letterSpacing: 6,
      color: POSTER_INK,
      box: { x: 72, y: 280, w: 480 },
    },
    {
      id: "date",
      type: "text",
      value: "{date|date:medium}",
      size: 34,
      weight: 700,
      color: POSTER_INK_SOFT,
      align: "right",
      box: { x: 508, y: 282, w: 500 },
    },
    ...perKind("icon", (kind) => ({
      type: "icon",
      name: ICON[kind],
      color: POSTER_INK,
      box: { x: 72, y: 380, w: 150, h: 150 },
    })),
    ...perKind("value", (kind) => ({
      type: "stat",
      value: valueText(kind),
      labelPos: "none",
      valueSize: 640,
      valueWeight: 900,
      color: POSTER_INK,
      fit: { mode: "shrink", minSize: 200 },
      box: { x: 60, y: 600, w: 960 },
    })),
    { id: "rule", type: "shape", shape: "rect", fill: POSTER_INK, box: { x: 72, y: 1130, w: 936, h: 12 } },
    ...perKind("unit", (kind) => ({
      type: "text",
      value: unitValue(kind),
      size: 100,
      weight: 800,
      color: POSTER_INK,
      fit: { mode: "shrink", minSize: 50 },
      box: { x: 72, y: 1190, w: 936 },
    })),
    ...subLayers("sub", {
      type: "text",
      size: 46,
      weight: 600,
      color: POSTER_INK_SOFT,
      fit: { mode: "ellipsis" },
      box: { x: 72, y: 1330, w: 936 },
    }),
    {
      ...watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
      children: [
        { id: "wm-logo", type: "brand", mark: "lockup", size: 52, tone: "dark", box: { x: 0, y: 0 } },
        { id: "wm-link", type: "brand", mark: "link", tone: "dark", size: 30, box: { x: 0, y: 0 } },
      ],
    } as LayerInput,
    {
      id: "name-user",
      type: "text",
      value: "{user.name}",
      size: 34,
      weight: 700,
      color: POSTER_INK_SOFT,
      align: "right",
      fit: { mode: "shrink", minSize: 24 },
      box: { x: 608, y: 1518, w: 400 },
    },
  ],
});

/** Square: the numeral sits inside a ring that carries its own meaning (week fills by days out of 7). */
const milestoneBoldSquare = defineTemplate({
  id: "milestone.bold.square",
  kind: "milestone",
  style: "bold",
  canvas: "square",
  background: BRAND_GRADIENT,
  requires: ["milestone.kind"],
  layers: [
    {
      id: "track",
      type: "ring",
      progress: 1,
      thickness: 44,
      color: "$surfaceStrong",
      cap: "butt",
      box: { x: 240, y: 72, w: 600, h: 600 },
    },
    ...perKind("ring", (kind) => ({
      type: "ring",
      progress: kind === "week" ? { bind: "milestone.value", div: 7, clamp: [0, 1] } : 1,
      thickness: 44,
      color: kind === "week" ? "$accent" : "$accent2",
      box: { x: 240, y: 72, w: 600, h: 600 },
    })),
    ...perKind("value", (kind) => ({
      type: "stat",
      value: valueText(kind),
      labelPos: "none",
      valueSize: 260,
      align: "center",
      fit: { mode: "shrink", minSize: 100 },
      box: { x: 310, y: 250, w: 460 },
    })),
    ...perKind("unit", (kind) => ({
      type: "text",
      value: unitValue(kind),
      size: 64,
      weight: 800,
      align: "center",
      fit: { mode: "shrink", minSize: 32 },
      box: { x: 72, y: 720, w: 936 },
    })),
    ...subLayers("sub", {
      type: "text",
      size: 38,
      weight: 600,
      color: "$fgMuted",
      align: "center",
      fit: { mode: "ellipsis" },
      box: { x: 72, y: 810, w: 936 },
    }),
    {
      id: "when",
      type: "group",
      box: { x: 72, y: 880, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "row", gap: 24, align: "center", justify: "center" },
      children: [
        {
          id: "name-user",
          type: "text",
          value: "{user.name}",
          size: 32,
          weight: 700,
          color: "$fgMuted",
          fit: { mode: "shrink", minSize: 24 },
          box: { x: 0, y: 0, w: "auto" },
        },
        {
          id: "date",
          type: "text",
          value: "{date|date:medium}",
          size: 32,
          weight: 700,
          color: "$accent",
          box: { x: 0, y: 0, w: "auto" },
        },
      ],
    },
    watermark("wm", { x: 72, y: 952, w: 936 }, "center"),
  ],
});

export const MILESTONE_TEMPLATES: TemplateInput[] = [milestoneBadgeSticker, milestonePosterStory, milestoneBoldSquare];
