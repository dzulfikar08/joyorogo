import type { Condition, Expr } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, ROGO_DARK, defineTemplate, photoBackground, watermark } from "../kit";
import { INK, INK_SOFT, receiptPaper, receiptRow, receiptRule } from "../receipt";

type Hue = "data1" | "data2" | "data3";
type Macro = "protein" | "carbs" | "fat";
type Dim = number | "auto" | "fill";

const MACROS: Array<[Macro, Hue, string]> = [
  ["protein", "data1", "segProtein"],
  ["carbs", "data2", "segCarbs"],
  ["fat", "data3", "segFat"],
];

// ---------------------------------------------------------------- conditions

const HAS_SEGMENTS: Condition = { any: MACROS.map(([, , seg]) => ({ bind: `day.${seg}`, exists: true })) };
const HAS_MACROS: Condition = { any: MACROS.map(([key]) => ({ bind: `day.${key}`, exists: true })) };
const HAS_TARGET: Condition = { bind: "day.target", exists: true };
const NO_TARGET: Condition = { bind: "day.target", exists: false };
const IS_LEFT: Condition = { all: [{ bind: "day.remaining", exists: true }, { bind: "day.gain", ne: true }] };
const IS_GAIN_LEFT: Condition = { all: [{ bind: "day.remaining", exists: true }, { bind: "day.gain", eq: true }] };
const IS_OVER: Condition = { bind: "day.over", eq: true };
/** Target set but neither remaining nor over: eaten is within 5% above the target (or gain past it). */
const IS_ON_TRACK: Condition = {
  all: [HAS_TARGET, { bind: "day.remaining", exists: false }, { bind: "day.over", ne: true }],
};
/** The "eaten" framing: no target at all (pregnancy mode) or sitting on it. */
const IS_EATEN: Condition = {
  any: [NO_TARGET, IS_ON_TRACK],
};

// ------------------------------------------------------------------- pieces

/** Hue dot that doubles as the macro legend. */
const dot = (id: string, hue: Hue, size: number): LayerInput => ({
  id,
  type: "shape",
  shape: "ellipse",
  fill: `$${hue}`,
  box: { x: 0, y: 0, w: size, h: size },
});

/**
 * Remaining / over / gain / on-target as one text line. Exactly one of the four is visible;
 * place them in a stack (x/y ignored) or at the same absolute box.
 */
function statusLine(
  id: string,
  at: { x: number; y: number; w: number },
  size: number,
  o: { align?: "left" | "center" | "right"; shadow?: boolean; color?: string; good?: string; weight?: number } = {},
): LayerInput[] {
  const base = {
    type: "text" as const,
    size,
    weight: o.weight ?? 800,
    align: o.align ?? "left",
    shadow: o.shadow ?? false,
    color: o.color ?? "$fg",
    box: { x: at.x, y: at.y, w: at.w },
  };
  return [
    { ...base, id: `${id}-left`, value: { t: "sticker:day.remaining", args: { kcal: "{day.remaining|int}" } }, when: IS_LEFT },
    { ...base, id: `${id}-gain`, value: { t: "sticker:day.gainLeft", args: { kcal: "{day.remaining|int}" } }, when: IS_GAIN_LEFT },
    { ...base, id: `${id}-over`, value: { t: "sticker:day.overBy", args: { kcal: "{day.overBy|int}" } }, color: "$warn", when: IS_OVER },
    { ...base, id: `${id}-ontrack`, value: { t: "sticker:day.onTrack" }, color: o.good ?? "$accent", when: IS_ON_TRACK },
  ];
}

/** Same four states as a stat block: a small label over the value, `kcal` as the unit. */
function statusStat(
  id: string,
  at: { x: number; y: number; w: number },
  o: { size: number; label: number; shadow?: boolean; align?: "left" | "center" | "right"; gap?: number; good?: string; labelColor?: string },
): LayerInput[] {
  const base = {
    type: "stat" as const,
    unit: { t: "sticker:common.kcal" },
    valueSize: o.size,
    labelSize: o.label,
    labelPos: "above" as const,
    gap: o.gap ?? 14,
    align: o.align ?? "left",
    labelColor: o.labelColor ?? "$fgMuted",
    shadow: o.shadow ?? false,
    box: { x: at.x, y: at.y, w: at.w },
  };
  return [
    { ...base, id: `${id}-left`, value: "{day.remaining|int}", label: { t: "sticker:day.left" }, when: IS_LEFT },
    { ...base, id: `${id}-gain`, value: "{day.remaining|int}", label: { t: "sticker:day.gainShort" }, when: IS_GAIN_LEFT },
    { ...base, id: `${id}-over`, value: "{day.overBy|int}", label: { t: "sticker:day.over" }, color: "$warn", when: IS_OVER },
    {
      id: `${id}-ontrack`,
      type: "text",
      value: { t: "sticker:day.onTrack" },
      size: Math.round(o.size * 0.42),
      weight: 800,
      color: o.good ?? "$accent",
      align: o.align ?? "left",
      shadow: o.shadow ?? false,
      box: { x: at.x, y: at.y, w: at.w },
      when: IS_ON_TRACK,
    },
  ];
}

/**
 * Macro-segmented ring (fractions of the target, one hue per macro). Without any macro it falls back to a
 * plain progress ring on `day.ratio`; a second lap means over, and Naikin never goes warn.
 */
function ringLayers(id: string, at: { x: number; y: number; size: number }, thickness: number, track: string): LayerInput[] {
  const box = { x: at.x, y: at.y, w: at.size, h: at.size };
  return [
    {
      id: `${id}-seg`,
      type: "ring",
      segments: MACROS.map(([, hue, seg]) => ({ value: { bind: `day.${seg}` }, color: `$${hue}` })),
      thickness,
      track,
      cap: "butt",
      when: HAS_SEGMENTS,
      box,
    },
    {
      id: `${id}-prog`,
      type: "ring",
      progress: { bind: "day.ratio" },
      thickness,
      track,
      color: "$accent",
      overColor: "$warn",
      when: { all: [{ not: HAS_SEGMENTS }, { bind: "day.gain", ne: true }] },
      box,
    },
    {
      id: `${id}-prog-gain`,
      type: "ring",
      progress: { bind: "day.ratio" },
      thickness,
      track,
      color: "$accent",
      overColor: "$accent2",
      when: { all: [{ not: HAS_SEGMENTS }, { bind: "day.gain", eq: true }] },
      box,
    },
  ];
}

/** Centered kcal figure that sits inside a ring; `at` is the free inner square. */
function ringFigure(
  id: string,
  at: { x: number; y: number; size: number },
  o: { valueSize: number; label: Expr; labelSize: number; shadow?: boolean },
): LayerInput {
  return {
    id,
    type: "group",
    box: { x: at.x, y: at.y, w: at.size, h: at.size },
    layout: { kind: "stack", dir: "column", justify: "center", align: "center", gap: 0 },
    children: [
      {
        id: `${id}-kcal`,
        type: "stat",
        value: "{day.kcal|int}",
        label: o.label,
        labelPos: "below",
        valueSize: o.valueSize,
        labelSize: o.labelSize,
        gap: 14,
        align: "center",
        shadow: o.shadow ?? false,
        box: { x: 0, y: 0, w: "auto" },
      },
    ],
  };
}

/** Dot + label above, grams below; hides with its macro so rows reflow. */
function macroTile(
  id: string,
  key: Macro,
  hue: Hue,
  o: { valueSize: number; labelSize: number; align: "start" | "center"; w?: Dim; shadow?: boolean },
): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: o.w ?? "auto", h: "auto" },
    when: { bind: `day.${key}`, exists: true },
    layout: { kind: "stack", dir: "column", gap: 12, align: o.align },
    children: [
      {
        id: `${id}-head`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 12, align: "center" },
        children: [
          dot(`${id}-dot`, hue, 22),
          {
            id: `${id}-label`,
            type: "text",
            value: { t: `sticker:common.${key}` },
            size: o.labelSize,
            weight: 700,
            color: "$fgMuted",
            shadow: o.shadow ?? false,
            box: { x: 0, y: 0, w: "auto" },
          },
        ],
      },
      {
        id: `${id}-stat`,
        type: "stat",
        value: `{day.${key}|int}`,
        unit: "g",
        labelPos: "none",
        valueSize: o.valueSize,
        unitSize: Math.round(o.valueSize * 0.42),
        shadow: o.shadow ?? false,
        box: { x: 0, y: 0, w: "auto" },
      },
    ],
  };
}

const eyebrowText = (id: string, at: { x: number; y: number; w: number }, o: { align?: "left" | "center" | "right"; size?: number; color?: string } = {}): LayerInput => ({
  id,
  type: "text",
  value: { t: "sticker:day.eyebrow" },
  size: o.size ?? 36,
  weight: 800,
  case: "upper",
  letterSpacing: 6,
  color: o.color ?? "$accent",
  align: o.align ?? "left",
  box: { x: at.x, y: at.y, w: at.w },
});

const dateText = (id: string, at: { x: number; y: number; w: number }, o: { align?: "left" | "center" | "right"; size?: number; color?: string; shadow?: boolean } = {}): LayerInput => ({
  id,
  type: "text",
  value: "{date|date:medium}",
  size: o.size ?? 34,
  weight: 600,
  color: o.color ?? "$fgMuted",
  align: o.align ?? "right",
  shadow: o.shadow ?? false,
  box: { x: at.x, y: at.y, w: at.w },
});

/** The streak line, hidden without a streak. */
const streakRow = (id: string, o: { icon: number; size: number; color?: string; iconColor?: string; shadow?: boolean }): LayerInput => ({
  id,
  type: "group",
  box: { x: 0, y: 0, w: "auto", h: "auto" },
  when: { bind: "day.streak", exists: true },
  layout: { kind: "stack", dir: "row", gap: 16, align: "center" },
  children: [
    { id: `${id}-icon`, type: "icon", name: "flame", color: o.iconColor ?? "$accent2", box: { x: 0, y: 0, w: o.icon, h: o.icon } },
    {
      id: `${id}-text`,
      type: "text",
      value: { t: "sticker:day.streak", args: { count: "{day.streak}" } },
      size: o.size,
      weight: 700,
      color: o.color ?? "$fgSoft",
      shadow: o.shadow ?? false,
      box: { x: 0, y: 0, w: "auto" },
    },
  ],
});

// ---------------------------------------------------------------------- bold

/** One macro column: a hue rule that doubles as the legend, then label above and grams. */
function boldMacro(key: Macro, hue: Hue): LayerInput {
  return {
    id: `m-${key}`,
    type: "group",
    box: { x: 0, y: 0, w: 300, h: "auto" },
    when: { bind: `day.${key}`, exists: true },
    layout: { kind: "stack", dir: "column", gap: 18, align: "start" },
    children: [
      { id: `m-${key}-rule`, type: "shape", shape: "rect", radius: 4, fill: `$${hue}`, box: { x: 0, y: 0, w: 84, h: 8 } },
      {
        id: `m-${key}-stat`,
        type: "stat",
        value: `{day.${key}|int}`,
        unit: "g",
        label: { t: `sticker:common.${key}` },
        labelPos: "above",
        valueSize: 104,
        unitSize: 40,
        labelSize: 34,
        gap: 14,
        box: { x: 0, y: 0, w: 300 },
      },
    ],
  };
}

/**
 * Bold numbers: the kcal figure is the poster, a thick bar and three macros carry the rest. The
 * content is one spread column so a day without a bar (no target) or macros still fills the card.
 */
const dayBoldStory = defineTemplate({
  id: "day.bold.story",
  kind: "day",
  style: "bold",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["day.kcal"],
  layers: [
    {
      id: "spread",
      type: "group",
      box: { x: 72, y: 280, w: 936, h: 1170 },
      layout: { kind: "stack", dir: "column", gap: 90, align: "stretch" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 24, align: "center", justify: "between" },
          children: [
            { ...eyebrowText("eyebrow", { x: 0, y: 0, w: 480 }), box: { x: 0, y: 0, w: "auto" } },
            { ...dateText("date", { x: 0, y: 0, w: 500 }), box: { x: 0, y: 0, w: "auto" } },
          ],
        },
        {
          id: "hero",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 44, align: "start" },
          children: [
            {
              id: "kcal",
              type: "stat",
              value: "{day.kcal|int}",
              label: { t: "sticker:day.ofTarget", args: { target: "{day.target|int}" } },
              valueSize: 300,
              labelSize: 46,
              gap: 36,
              color: "$fg",
              labelColor: "$fgSoft",
              when: HAS_TARGET,
              box: { x: 0, y: 0, w: 936 },
            },
            {
              id: "kcal-eaten",
              type: "stat",
              value: "{day.kcal|int}",
              label: { t: "sticker:day.kcalEaten" },
              valueSize: 300,
              labelSize: 46,
              gap: 36,
              color: "$fg",
              labelColor: "$fgSoft",
              when: NO_TARGET,
              box: { x: 0, y: 0, w: 936 },
            },
            {
              id: "bar",
              type: "chart",
              kind: "stack",
              barRadius: 24,
              segments: [
                { value: { bind: "day.ratio", clamp: [0, 1] }, color: "$accent" },
                { value: { bind: "day.ratio", mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
              ],
              when: { all: [HAS_TARGET, { bind: "day.over", ne: true }] },
              box: { x: 0, y: 0, w: 936, h: 48 },
            },
            {
              id: "bar-over",
              type: "chart",
              kind: "stack",
              barRadius: 24,
              segments: [{ value: 1, color: "$warn" }],
              when: IS_OVER,
              box: { x: 0, y: 0, w: 936, h: 48 },
            },
            ...statusLine("status", { x: 0, y: 0, w: 936 }, 66),
          ],
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          when: HAS_MACROS,
          layout: { kind: "stack", dir: "row", gap: 18, align: "start" },
          children: MACROS.map(([key, hue]) => boldMacro(key, hue)),
        },
        { ...streakRow("streak", { icon: 52, size: 44 }), box: { x: 0, y: 0, w: "auto", h: 64 } },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

// ------------------------------------------------------------------- sticker

/** Compact credit for stickers: lockup and link on a faint pad so it reads on any photo. */
function stickerMark(id: string, at: { x: number; y: number; w: number }): LayerInput {
  return {
    id,
    type: "group",
    role: "watermark",
    box: { x: at.x, y: at.y, w: at.w, h: 56 },
    layout: { kind: "stack", dir: "row", gap: 0, align: "center", justify: "center" },
    children: [
      {
        id: `${id}-pad`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: 56 },
        fill: "$bg/45",
        radius: 28,
        layout: { kind: "stack", dir: "row", gap: 16, align: "center", padding: 14 },
        children: [
          { id: `${id}-logo`, type: "brand", mark: "lockup", size: 34, tone: "auto", box: { x: 0, y: 0 } },
          { id: `${id}-link`, type: "brand", mark: "link", size: 24, tone: "auto", box: { x: 0, y: 0 } },
        ],
      },
    ],
  };
}

function stickerMacroRow(key: Macro, hue: Hue): LayerInput {
  const id = `row-${key}`;
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: 420, h: "auto" },
    when: { bind: `day.${key}`, exists: true },
    layout: { kind: "stack", dir: "row", gap: 0, align: "center", justify: "between" },
    children: [
      {
        id: `${id}-key`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 14, align: "center" },
        children: [
          dot(`${id}-dot`, hue, 24),
          { id: `${id}-label`, type: "text", value: { t: `sticker:common.${key}` }, size: 32, weight: 700, color: "$fgSoft", shadow: true, box: { x: 0, y: 0, w: "auto" } },
        ],
      },
      { id: `${id}-value`, type: "text", value: `{day.${key}|int} g`, size: 40, weight: 800, shadow: true, box: { x: 0, y: 0, w: "auto" } },
    ],
  };
}

/** Transparent sticker: segmented kcal ring on the left, what is left and the macros on the right. */
const dayMinimalSticker = defineTemplate({
  id: "day.minimal.sticker",
  kind: "day",
  style: "minimal",
  canvas: { sticker: 620 },
  requires: ["day.kcal", "day.target"],
  layers: [
    { id: "disc", type: "shape", shape: "ellipse", fill: "$bg/32", box: { x: 90, y: 40, w: 440, h: 440 } },
    ...ringLayers("ring", { x: 90, y: 40, size: 440 }, 46, "$fg/20"),
    ringFigure("figure", { x: 146, y: 96, size: 328 }, { valueSize: 140, label: { t: "sticker:common.kcal" }, labelSize: 36, shadow: true }),
    {
      id: "side",
      type: "group",
      box: { x: 570, y: 40, w: 420, h: 440 },
      layout: { kind: "stack", dir: "column", gap: 34, align: "start", justify: "center" },
      children: [
        ...statusStat("status", { x: 0, y: 0, w: 420 }, { size: 124, label: 36, shadow: true, gap: 16, labelColor: "$fgSoft" }),
        {
          id: "macro-rows",
          type: "group",
          box: { x: 0, y: 0, w: 420, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 18, align: "start" },
          children: MACROS.map(([key, hue]) => stickerMacroRow(key, hue)),
        },
      ],
    },
    stickerMark("wm", { x: 90, y: 526, w: 900 }),
  ],
});

// -------------------------------------------------------------------- square

/** Ring portrait: one big segmented ring owns the card, status and macros sit centered under it. */
const dayRingSquare = defineTemplate({
  id: "day.ring.square",
  kind: "day",
  style: "ring",
  canvas: "square",
  background: {
    kind: "gradient",
    angle: 200,
    stops: [
      { at: 0, color: "$bg" },
      { at: 1, color: "$bg2" },
    ],
    glows: [{ x: 540, y: 430, r: 520, color: "$accent", opacity: 0.14 }],
  },
  requires: ["day.kcal", "day.target"],
  layers: [
    {
      id: "page",
      type: "group",
      box: { x: 72, y: 72, w: 936, h: 936 },
      layout: { kind: "stack", dir: "column", gap: 0, align: "center", justify: "between" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 10, align: "center" },
          children: [
            eyebrowText("eyebrow", { x: 0, y: 0, w: 600 }, { align: "center", size: 32 }),
            dateText("date", { x: 0, y: 0, w: 600 }, { align: "center", size: 30 }),
          ],
        },
        {
          id: "dial",
          type: "group",
          box: { x: 0, y: 0, w: 480, h: 480 },
          children: [
            { id: "disc", type: "shape", shape: "ellipse", fill: "$surface", box: { x: 0, y: 0, w: 480, h: 480 } },
            ...ringLayers("ring", { x: 0, y: 0, size: 480 }, 56, "$line"),
            ringFigure("figure", { x: 70, y: 70, size: 340 }, {
              valueSize: 150,
              label: { t: "sticker:day.ofTarget", args: { target: "{day.target|int}" } },
              labelSize: 32,
            }),
          ],
        },
        {
          id: "status",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 0, align: "center" },
          children: statusLine("status-line", { x: 0, y: 0, w: 936 }, 60, { align: "center" }),
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          when: HAS_MACROS,
          layout: { kind: "stack", dir: "row", gap: 0, align: "start" },
          children: MACROS.map(([key, hue]) => macroTile(`tile-${key}`, key, hue, { valueSize: 72, labelSize: 30, align: "center", w: 312 })),
        },
        watermark("wm", { x: 0, y: 0, w: 936 }, "center"),
      ],
    },
  ],
});

// ------------------------------------------------------------------- receipt

const RECEIPT_W = 668;

/** One slip row at the standard width; `when` hides the whole row (label and leader) with its value. */
const slipRow = (id: string, label: Expr, value: Expr, when?: Condition): LayerInput => ({
  ...receiptRow(id, 0, 0, RECEIPT_W, label, value, 38),
  ...(when ? { when } : {}),
});

/** Thermal receipt on the brand table: a slightly crooked strip, mono rows, one huge TOTAL. */
const dayReceiptStory = defineTemplate({
  id: "day.receipt.story",
  kind: "day",
  style: "receipt",
  canvas: "story",
  background: BRAND_GRADIENT,
  light: { bg: "#d9e6cc", bg2: "#b9d1a9" },
  requires: ["day.kcal"],
  layers: [
    ...receiptPaper(
      "receipt",
      { x: 150, y: 310, w: 780, h: 1090 },
      [
        {
          id: "slip",
          type: "group",
          box: { x: 56, y: 76, w: RECEIPT_W, h: 940 },
          layout: { kind: "stack", dir: "column", gap: 0, align: "stretch", justify: "between" },
          children: [
            {
              id: "head",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "column", gap: 14, align: "center" },
              children: [
                {
                  id: "title",
                  type: "text",
                  value: { t: "sticker:day.receipt.title" },
                  font: "mono",
                  size: 50,
                  weight: 700,
                  case: "upper",
                  color: INK,
                  align: "center",
                  box: { x: 0, y: 0, w: RECEIPT_W },
                },
                {
                  id: "stamp",
                  type: "text",
                  value: "{date|date:medium}",
                  font: "mono",
                  size: 30,
                  weight: 500,
                  case: "upper",
                  color: INK_SOFT,
                  align: "center",
                  box: { x: 0, y: 0, w: RECEIPT_W },
                },
                receiptRule("head-rule", 0, 0, RECEIPT_W),
              ],
            },
            {
              id: "rows",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "column", gap: 24, align: "start" },
              children: [
                slipRow("r-energy", { t: "sticker:day.receipt.energy" }, "{day.kcal|int} kcal"),
                ...MACROS.map(([key]) =>
                  slipRow(`r-${key}`, { t: `sticker:common.${key}` }, `{day.${key}|int} g`, { bind: `day.${key}`, exists: true }),
                ),
                { ...receiptRule("rule-target", 0, 0, RECEIPT_W), when: HAS_TARGET },
                slipRow("r-target", { t: "sticker:day.receipt.target" }, "{day.target|int} kcal", HAS_TARGET),
                slipRow("r-left", { t: "sticker:day.receipt.left" }, "{day.remaining|int} kcal", IS_LEFT),
                slipRow("r-gain", { t: "sticker:day.gainShort" }, "{day.remaining|int} kcal", IS_GAIN_LEFT),
                slipRow("r-over", { t: "sticker:day.over" }, "{day.overBy|int} kcal", IS_OVER),
              ],
            },
            {
              id: "total",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "column", gap: 26, align: "stretch" },
              children: [
                receiptRule("total-rule", 0, 0, RECEIPT_W),
                {
                  id: "total-row",
                  type: "group",
                  box: { x: 0, y: 0, w: "auto", h: "auto" },
                  layout: { kind: "stack", dir: "row", gap: 16, align: "end", justify: "between" },
                  children: [
                    {
                      id: "total-label",
                      type: "text",
                      value: { t: "sticker:day.receipt.total" },
                      font: "mono",
                      size: 44,
                      weight: 700,
                      case: "upper",
                      trim: "cap",
                      color: INK,
                      box: { x: 0, y: 0, w: "auto" },
                    },
                    {
                      id: "total-figure",
                      type: "group",
                      box: { x: 0, y: 0, w: "auto", h: "auto" },
                      layout: { kind: "stack", dir: "row", gap: 14, align: "end" },
                      children: [
                        {
                          id: "total-value",
                          type: "text",
                          value: "{day.kcal|int}",
                          font: "mono",
                          size: 124,
                          weight: 700,
                          trim: "cap",
                          color: INK,
                          box: { x: 0, y: 0, w: "auto" },
                        },
                        {
                          id: "total-unit",
                          type: "text",
                          value: { t: "sticker:common.kcal" },
                          font: "mono",
                          size: 44,
                          weight: 700,
                          trim: "cap",
                          color: INK,
                          box: { x: 0, y: 0, w: "auto" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              id: "foot",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "column", gap: 28, align: "stretch" },
              children: [
                slipRow(
                  "r-streak",
                  { t: "sticker:day.receipt.streak" },
                  { t: "sticker:common.days", args: { count: "{day.streak}" } },
                  { bind: "day.streak", exists: true },
                ),
                {
                  id: "thanks",
                  type: "text",
                  value: { t: "sticker:day.receipt.thanks" },
                  font: "mono",
                  size: 30,
                  weight: 500,
                  case: "upper",
                  color: INK_SOFT,
                  align: "center",
                  box: { x: 0, y: 0, w: RECEIPT_W },
                },
              ],
            },
          ],
        },
      ],
      -2.5,
    ),
    watermark("wm", { x: 72, y: 1500, w: 936 }, "center"),
  ],
});

// -------------------------------------------------------------------- poster

const POSTER_INK = "#0d1f12";
const POSTER_TOKENS = {
  fg: POSTER_INK,
  fgSoft: "#0d1f12e6",
  fgMuted: "#0d1f12b3",
  line: "#0d1f1233",
  surface: "#0d1f121a",
  surfaceStrong: "#0d1f1229",
  warn: "#8a2c0b",
  good: POSTER_INK,
};

/** Ink-on-accent credit; the auto brand tone would pick white on mint. */
function inkMark(id: string, at: { x: number; y: number; w: number }): LayerInput {
  return {
    id,
    type: "group",
    role: "watermark",
    box: { x: at.x, y: at.y, w: at.w, h: 56 },
    layout: { kind: "stack", dir: "row", gap: 22, align: "center", justify: "start" },
    children: [
      { id: `${id}-logo`, type: "brand", mark: "lockup", size: 52, tone: "dark", box: { x: 0, y: 0 } },
      { id: `${id}-link`, type: "brand", mark: "link", size: 30, tone: "dark", box: { x: 0, y: 0 } },
    ],
  };
}

/** One poster stack: word, giant numeral bleeding past the page, kcal. Exactly one variant shows. */
function posterVariant(id: string, when: Condition, word: string, number: string): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: 936, h: "auto" },
    when,
    layout: { kind: "stack", dir: "column", gap: 30, align: "start" },
    children: [
      {
        id: `${id}-word`,
        type: "text",
        value: { t: word },
        size: 210,
        weight: 800,
        case: "upper",
        trim: "cap",
        letterSpacing: -4,
        box: { x: 0, y: 0, w: 936 },
      },
      {
        id: `${id}-numwrap`,
        type: "group",
        box: { x: 0, y: 0, w: 936, h: "auto" },
        layout: { kind: "stack", dir: "column", gap: 0, align: "center" },
        children: [
          {
            id: `${id}-num`,
            type: "text",
            value: `{${number}|int}`,
            size: 600,
            weight: 800,
            trim: "cap",
            letterSpacing: -14,
            align: "center",
            fit: { mode: "shrink", minSize: 260 },
            box: { x: 0, y: 0, w: 1100 },
          },
        ],
      },
      {
        id: `${id}-unit`,
        type: "text",
        value: { t: "sticker:common.kcal" },
        size: 210,
        weight: 800,
        case: "upper",
        trim: "cap",
        letterSpacing: -4,
        align: "right",
        box: { x: 0, y: 0, w: 936 },
      },
    ],
  };
}

/** Label and value on one baseline. */
const posterPair = (id: string, label: Expr, value: string, valueSize: number): LayerInput => ({
  id,
  type: "group",
  box: { x: 0, y: 0, w: "auto", h: "auto" },
  layout: { kind: "stack", dir: "row", gap: 14, align: "end" },
  children: [
    { id: `${id}-label`, type: "text", value: label, size: 30, weight: 700, color: "$fgMuted", trim: "cap", box: { x: 0, y: 0, w: "auto" } },
    { id: `${id}-value`, type: "text", value, size: valueSize, weight: 800, trim: "cap", box: { x: 0, y: 0, w: "auto" } },
  ],
});

/** Typographic poster on a solid accent page; the remaining kcal is the whole picture. */
const dayPosterStory = defineTemplate({
  id: "day.poster.story",
  kind: "day",
  style: "poster",
  canvas: "story",
  background: { kind: "color", color: "$accent" },
  dark: { ...POSTER_TOKENS },
  light: { ...POSTER_TOKENS, accent: "#a9ecbe" },
  requires: ["day.kcal"],
  layers: [
    eyebrowText("eyebrow", { x: 72, y: 280, w: 480 }, { color: "$fg" }),
    dateText("date", { x: 508, y: 282, w: 500 }, { color: "$fgSoft" }),
    {
      id: "body",
      type: "group",
      box: { x: 72, y: 400, w: 936, h: 1052 },
      layout: { kind: "stack", dir: "column", gap: 0, align: "start", justify: "between" },
      children: [
        posterVariant("v-left", IS_LEFT, "sticker:day.left", "day.remaining"),
        posterVariant("v-gain", IS_GAIN_LEFT, "sticker:day.gainShort", "day.remaining"),
        posterVariant("v-over", IS_OVER, "sticker:day.over", "day.overBy"),
        posterVariant("v-eaten", IS_EATEN, "sticker:day.posterEaten", "day.kcal"),
        {
          id: "foot",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 36, align: "stretch" },
          children: [
            { id: "foot-rule", type: "shape", shape: "line", stroke: { color: POSTER_INK, width: 5 }, box: { x: 0, y: 0, w: 936, h: 5 } },
            {
              id: "foot-energy",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              when: HAS_TARGET,
              layout: { kind: "stack", dir: "row", gap: 20, align: "end", justify: "between" },
              children: [
                { id: "foot-energy-label", type: "text", value: { t: "sticker:day.eaten" }, size: 34, weight: 700, case: "upper", letterSpacing: 4, color: "$fgSoft", trim: "cap", box: { x: 0, y: 0, w: "auto" } },
                { id: "foot-energy-value", type: "text", value: "{day.kcal|int} / {day.target|int} kcal", size: 50, weight: 800, trim: "cap", box: { x: 0, y: 0, w: "auto" } },
              ],
            },
            {
              id: "foot-macros",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              when: HAS_MACROS,
              layout: { kind: "stack", dir: "row", gap: 24, align: "end", justify: "between" },
              children: MACROS.map(([key]) => ({
                ...posterPair(`pm-${key}`, { t: `sticker:common.${key}` }, `{day.${key}|int} g`, 56),
                when: { bind: `day.${key}`, exists: true },
              })),
            },
          ],
        },
      ],
    },
    inkMark("wm", { x: 72, y: 1510, w: 936 }),
  ],
});

// --------------------------------------------------------------------- glass

/** Photo cards always sit on a dark scrim, so light mode keeps the dark palette. */
const GLASS_LIGHT = { ...ROGO_DARK };

/** Smoked glass over the photo: a frosted dark pane with a lit edge holding the whole day. */
const dayGlassStory = defineTemplate({
  id: "day.glass.story",
  kind: "day",
  style: "glass",
  canvas: "story",
  background: photoBackground(0.72),
  light: GLASS_LIGHT,
  requires: ["day.kcal"],
  layers: [
    eyebrowText("eyebrow", { x: 72, y: 280, w: 480 }, { color: "$fg" }),
    { ...dateText("date", { x: 508, y: 282, w: 500 }, { color: "$fgSoft", shadow: true }) },
    {
      id: "dock",
      type: "group",
      box: { x: 72, y: 860, w: 936, h: 600 },
      layout: { kind: "stack", dir: "column", gap: 0, align: "stretch", justify: "end" },
      children: [
        {
          id: "pane",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: "auto" },
          glass: true,
          fill: { gradient: { angle: 180, stops: [{ at: 0, color: "#16261c9e" }, { at: 1, color: "#09110cc7" }] } },
          radius: 56,
          layout: { kind: "stack", dir: "column", gap: 34, align: "stretch", padding: 48 },
          children: [
            {
              id: "top",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "row", gap: 44, align: "center" },
              children: [
                {
                  id: "dial",
                  type: "group",
                  box: { x: 0, y: 0, w: 280, h: 280 },
                  when: HAS_TARGET,
                  children: [
                    ...ringLayers("ring", { x: 0, y: 0, size: 280 }, 30, "#ffffff2e"),
                    {
                      id: "dial-fig",
                      type: "group",
                      box: { x: 44, y: 44, w: 192, h: 192 },
                      layout: { kind: "stack", dir: "column", justify: "center", align: "center", gap: 0 },
                      children: [
                        {
                          id: "dial-pct",
                          type: "stat",
                          value: "{day.ratio|pct}",
                          valueSize: 84,
                          labelPos: "none",
                          align: "center",
                          shadow: true,
                          box: { x: 0, y: 0, w: "auto" },
                        },
                      ],
                    },
                  ],
                },
                {
                  id: "figures",
                  type: "group",
                  box: { x: 0, y: 0, w: "fill", h: "auto" },
                  layout: { kind: "stack", dir: "column", gap: 24, align: "start" },
                  children: [
                    {
                      id: "kcal",
                      type: "stat",
                      value: "{day.kcal|int}",
                      unit: { t: "sticker:common.kcal" },
                      label: { t: "sticker:day.eaten" },
                      labelPos: "above",
                      valueSize: 150,
                      labelSize: 34,
                      gap: 16,
                      shadow: true,
                      box: { x: 0, y: 0, w: 516 },
                    },
                    ...statusLine("status", { x: 0, y: 0, w: 516 }, 40, { shadow: true, weight: 700 }),
                    streakRow("streak", { icon: 40, size: 34, shadow: true }),
                  ],
                },
              ],
            },
            {
              id: "hair",
              type: "shape",
              shape: "line",
              stroke: { color: "#ffffff38", width: 2 },
              when: HAS_MACROS,
              box: { x: 0, y: 0, w: 840, h: 2 },
            },
            {
              id: "macros",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              when: HAS_MACROS,
              layout: { kind: "stack", dir: "row", gap: 0, align: "start", justify: "between" },
              children: MACROS.map(([key, hue]) =>
                macroTile(`tile-${key}`, key, hue, { valueSize: 68, labelSize: 30, align: "start", w: 280, shadow: true }),
              ),
            },
          ],
        },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

export const DAY_TEMPLATES: TemplateInput[] = [
  dayBoldStory,
  dayMinimalSticker,
  dayRingSquare,
  dayReceiptStory,
  dayPosterStory,
  dayGlassStory,
];
