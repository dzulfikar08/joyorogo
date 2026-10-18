import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";

type Condition = NonNullable<Extract<LayerInput, { type: "text" }>["when"]>;

const NO_KG: Condition[] = [
  { bind: "weight.lostKg", exists: false },
  { bind: "weight.gainedKg", exists: false },
];

type ReadingStyle = {
  size: number;
  w: number;
  align?: "left" | "center" | "right";
  color?: string;
  shadow?: boolean;
  weight?: 600 | 700 | 800;
};

/**
 * The one-line reading of the weigh-ins, mutually exclusive variants so a stack reflows around the survivor:
 * exact kg when the user opted in, otherwise the direction. Naikin (gain) never gets the "down" wording and
 * nothing here is coloured as a warning.
 */
function reading(prefix: string, s: ReadingStyle): LayerInput[] {
  const base = {
    type: "text",
    size: s.size,
    weight: s.weight ?? 800,
    align: s.align ?? "left",
    color: s.color ?? "$fg",
    shadow: s.shadow,
    box: { x: 0, y: 0, w: s.w },
  } as const;
  return [
    { ...base, id: `${prefix}-lost`, value: { t: "sticker:weight.lost", args: { kg: "{weight.lostKg|num:1}" } }, when: { bind: "weight.gain", ne: true } },
    { ...base, id: `${prefix}-gained`, value: { t: "sticker:weight.gained", args: { kg: "{weight.gainedKg|num:1}" } } },
    {
      ...base,
      id: `${prefix}-down`,
      value: { t: "sticker:weight.hiddenDown" },
      when: { all: [...NO_KG, { bind: "weight.direction", eq: "down" }, { bind: "weight.gain", ne: true }] },
    },
    { ...base, id: `${prefix}-up`, value: { t: "sticker:weight.hiddenUp" }, when: { all: [...NO_KG, { bind: "weight.direction", eq: "up" }] } },
    { ...base, id: `${prefix}-steady`, value: { t: "sticker:weight.hiddenSteady" }, when: { all: [...NO_KG, { bind: "weight.direction", eq: "steady" }] } },
  ];
}

/** "dari berat awal", only alongside an exact kg reading. */
function fromStart(id: string, s: { size: number; w: number; align?: "left" | "center" | "right"; color?: string; shadow?: boolean }): LayerInput {
  return {
    id,
    type: "text",
    value: { t: "sticker:weight.fromStart" },
    size: s.size,
    weight: 600,
    align: s.align ?? "left",
    color: s.color ?? "$fgMuted",
    shadow: s.shadow,
    when: { any: [{ bind: "weight.lostKg", exists: true }, { bind: "weight.gainedKg", exists: true }] },
    box: { x: 0, y: 0, w: s.w },
  };
}

/** Transparent sticker: a goal ring with the percent inside, the reading underneath. Ink follows the theme, shadowed for photos. */
const weightMinimalSticker = defineTemplate({
  id: "weight.minimal.sticker",
  kind: "weight",
  style: "minimal",
  canvas: { sticker: 640 },
  requires: ["weight.goalPct"],
  layers: [
    { id: "ring", type: "ring", progress: { bind: "weight.goalPct", clamp: [0, 1] }, thickness: 30, track: "$fg/28", color: "$accent", box: { x: 390, y: 30, w: 300, h: 300 } },
    {
      id: "pct",
      type: "stat",
      value: "{weight.goalPct|pct}",
      label: { t: "sticker:weight.towardGoal" },
      labelPos: "below",
      valueSize: 84,
      labelSize: 26,
      gap: 14,
      align: "center",
      shadow: true,
      color: "$fg",
      labelColor: "$fgSoft",
      box: { x: 430, y: 128, w: 220 },
    },
    {
      id: "read",
      type: "group",
      box: { x: 90, y: 366, w: 900, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 10, align: "center" },
      children: [...reading("r", { size: 64, w: 900, align: "center", shadow: true }), fromStart("r-from", { size: 30, w: 900, align: "center", shadow: true, color: "$fgSoft" })],
    },
    watermark("wm", { x: 90, y: 560, w: 900 }, "center"),
  ],
});

function statCell(id: string, bind: string, labelKey: string, color: string): LayerInput {
  return {
    id,
    type: "stat",
    value: `{${bind}|num:1}`,
    unit: "kg",
    label: { t: labelKey },
    labelPos: "above",
    valueSize: 86,
    unitSize: 34,
    labelSize: 30,
    gap: 12,
    color,
    box: { x: 0, y: 0, w: 290 },
  };
}

/** Story: a big smooth trend curve under the headline reading; kg stats only when the user opted in. */
const weightTrendStory = defineTemplate({
  id: "weight.trend.story",
  kind: "weight",
  style: "trend",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["weight.trend"],
  layers: [
    { id: "eyebrow", type: "text", value: { t: "sticker:weight.eyebrow" }, size: 36, weight: 800, color: "$accent", box: { x: 72, y: 280, w: 620 } },
    { id: "date", type: "text", value: "{date|date:medium}", size: 34, weight: 600, color: "$fgMuted", align: "right", box: { x: 608, y: 282, w: 400 } },
    {
      id: "body",
      type: "group",
      box: { x: 72, y: 372, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 20, align: "start" },
      children: [
        ...reading("h", { size: 116, w: 936 }),
        fromStart("h-from", { size: 38, w: 936 }),
        {
          id: "chart-label",
          type: "text",
          value: { t: "sticker:weight.trend" },
          size: 32,
          weight: 700,
          color: "$fgMuted",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "chart",
          type: "chart",
          kind: "area",
          series: { bind: "weight.trend" },
          color: "$accent",
          strokeWidth: 12,
          min: -0.12,
          max: 1.12,
          highlight: "last",
          box: { x: 0, y: 0, w: 936, h: 470 },
        },
        {
          id: "goal",
          type: "text",
          value: { t: "sticker:weight.progressToGoal", args: { pct: "{weight.goalPct|pct}" } },
          size: 46,
          weight: 800,
          when: { bind: "weight.goalPct", exists: true },
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "goal-bar",
          type: "chart",
          kind: "stack",
          barRadius: 14,
          segments: [
            { value: { bind: "weight.goalPct", clamp: [0, 1] }, color: "$accent" },
            { value: { bind: "weight.goalPct", mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
          ],
          when: { bind: "weight.goalPct", exists: true },
          box: { x: 0, y: 0, w: 936, h: 28 },
        },
        {
          id: "kg",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          when: { all: [{ bind: "weight.startKg", exists: true }, { bind: "weight.nowKg", exists: true }] },
          layout: { kind: "stack", dir: "row", gap: 33, align: "start" },
          children: [
            statCell("kg-start", "weight.startKg", "sticker:weight.start", "$fgSoft"),
            statCell("kg-now", "weight.nowKg", "sticker:weight.now", "$fg"),
            statCell("kg-goal", "weight.goalKg", "sticker:weight.goal", "$accent"),
          ],
        },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

/** Poster: the goal percent is the picture, on a calm mid-green card; a slim bar and the reading close it out. */
const weightPosterSquare = defineTemplate({
  id: "weight.poster.square",
  kind: "weight",
  style: "poster",
  canvas: "square",
  background: { kind: "color", color: "$bg2" },
  requires: ["weight.goalPct"],
  layers: [
    { id: "eyebrow", type: "text", value: { t: "sticker:weight.eyebrow" }, size: 38, weight: 700, color: "$fgSoft", box: { x: 72, y: 96, w: 936 } },
    {
      id: "pct",
      type: "stat",
      value: "{weight.goalPct|pct}",
      label: { t: "sticker:weight.towardGoal" },
      labelPos: "below",
      valueSize: 430,
      labelSize: 62,
      gap: 44,
      color: "$fg",
      labelColor: "$accent",
      box: { x: 60, y: 200, w: 960 },
    },
    {
      id: "bar",
      type: "chart",
      kind: "stack",
      barRadius: 14,
      segments: [
        { value: { bind: "weight.goalPct", clamp: [0, 1] }, color: "$accent" },
        { value: { bind: "weight.goalPct", mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
      ],
      box: { x: 72, y: 770, w: 936, h: 28 },
    },
    {
      id: "read",
      type: "group",
      box: { x: 72, y: 836, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "row", gap: 24, align: "center" },
      children: reading("r", { size: 48, w: 936, weight: 700 }),
    },
    watermark("wm", { x: 72, y: 952, w: 936 }, "start"),
  ],
});

export const WEIGHT_TEMPLATES: TemplateInput[] = [weightMinimalSticker, weightTrendStory, weightPosterSquare];
