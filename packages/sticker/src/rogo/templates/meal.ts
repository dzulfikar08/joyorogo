import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, ROGO_DARK, defineTemplate, photoBackground, watermark } from "../kit";
import { INK, INK_SOFT, receiptPaper, receiptRow, receiptRule } from "../receipt";

type Macro = "protein" | "carbs" | "fat";
const MACROS: [Macro, "data1" | "data2" | "data3"][] = [
  ["protein", "data1"],
  ["carbs", "data2"],
  ["fat", "data3"],
];

/** Photo cards always sit on a dark scrim, so light mode keeps the dark palette and only the fallback gradient stays brand. */
const PHOTO_LIGHT = { ...ROGO_DARK };

/** Photo background plus a flat darkening so white type holds on bright plates. */
function darkPhoto(scrim: number, tint: number): TemplateInput["background"] {
  const base = photoBackground(scrim);
  return base.kind === "photo" ? { ...base, tint: { color: "#000000", opacity: tint } } : base;
}

/** Pill: hue dot, grams, label. Hidden with its macro so the row reflows. */
function macroPill(key: Macro, hue: "data1" | "data2" | "data3"): LayerInput {
  return {
    id: `pill-${key}`,
    type: "group",
    box: { x: 0, y: 0, w: "auto", h: 72 },
    when: { bind: `meal.${key}`, exists: true },
    fill: "#00000073",
    stroke: { color: "#ffffff2e", width: 2 },
    radius: 36,
    layout: { kind: "stack", dir: "row", gap: 14, align: "center", padding: 26 },
    children: [
      { id: `pill-${key}-dot`, type: "shape", shape: "ellipse", fill: `$${hue}`, box: { x: 0, y: 0, w: 20, h: 20 } },
      {
        id: `pill-${key}-v`,
        type: "text",
        value: `{meal.${key}|int} g`,
        size: 36,
        weight: 800,
        color: "$fg",
        box: { x: 0, y: 0, w: "auto" },
      },
      {
        id: `pill-${key}-l`,
        type: "text",
        value: { t: `sticker:common.${key}` },
        size: 30,
        weight: 600,
        color: "$fgMuted",
        box: { x: 0, y: 0, w: "auto" },
      },
    ],
  };
}

const reactionRow = (id: string, color: string): LayerInput => ({
  id,
  type: "group",
  box: { x: 0, y: 0, w: 936, h: "auto" },
  when: { bind: "meal.reaction", exists: true },
  layout: { kind: "stack", dir: "row", gap: 20, align: "center" },
  children: [
    { id: `${id}-rule`, type: "shape", shape: "rect", radius: 3, fill: color, box: { x: 0, y: 0, w: 6, h: 48 } },
    {
      id: `${id}-text`,
      type: "text",
      value: "{meal.reaction}",
      size: 44,
      weight: 700,
      color: "$fg",
      shadow: true,
      fit: { mode: "shrink", minSize: 28 },
      box: { x: 0, y: 0, w: "fill" },
    },
  ],
});

/** Footer row: the watermark on the left, the viewer's first name quietly on the right (hidden when absent). */
function footRow(id: string, box: { x: number; y: number; w: number }, color: string): LayerInput {
  return {
    id,
    type: "group",
    box: { x: box.x, y: box.y, w: box.w, h: 56 },
    layout: { kind: "stack", dir: "row", gap: 20, align: "center" },
    children: [
      watermark("wm", { x: 0, y: 0, w: 560 }, "start"),
      {
        id: `${id}-user`,
        type: "text",
        value: "{user.name}",
        size: 34,
        weight: 700,
        color,
        align: "right",
        fit: { mode: "shrink", minSize: 24 },
        box: { x: 0, y: 0, w: "fill" },
      },
    ],
  };
}

/** Photo: the meal is the picture, type is stacked at the bottom of the safe area. */
const mealPhotoStory = defineTemplate({
  id: "meal.photo.story",
  kind: "meal",
  style: "photo",
  canvas: "story",
  background: darkPhoto(0.94, 0.22),
  light: PHOTO_LIGHT,
  needsPhoto: true,
  requires: ["meal.kcal"],
  layers: [
    {
      id: "block",
      type: "group",
      box: { x: 72, y: 700, w: 936, h: 780 },
      layout: { kind: "stack", dir: "column", gap: 28, align: "start", justify: "end" },
      children: [
        {
          id: "eyebrow",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 16, align: "center" },
          children: [
            { id: "eyebrow-icon", type: "icon", name: "restaurant", color: "$accent", box: { x: 0, y: 0, w: 40, h: 40 } },
            {
              id: "eyebrow-text",
              type: "text",
              value: { t: "sticker:meal.eyebrow" },
              size: 32,
              weight: 800,
              case: "upper",
              letterSpacing: 6,
              color: "$accent",
              shadow: true,
              box: { x: 0, y: 0, w: "auto" },
            },
            {
              id: "eyebrow-user",
              type: "text",
              value: "{user.name}",
              size: 34,
              weight: 700,
              color: "$fgSoft",
              shadow: true,
              align: "right",
              fit: { mode: "shrink", minSize: 24 },
              box: { x: 0, y: 0, w: "fill" },
            },
          ],
        },
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 92,
          weight: 800,
          lineHeight: 1.04,
          color: "$fg",
          shadow: true,
          fit: { mode: "wrap", maxLines: 2 },
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: { t: "sticker:common.kcal" },
          valueSize: 250,
          unitSize: 72,
          valueWeight: 800,
          color: "$fg",
          labelPos: "none",
          shadow: true,
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "pills",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 14, align: "center" },
          children: MACROS.map(([k, h]) => macroPill(k, h)),
        },
        reactionRow("reaction", "$accent2"),
      ],
    },
    watermark("wm", { x: 72, y: 1516, w: 936 }, "start"),
  ],
});

/** Glass: photo stays clean on top, one frosted card holds the numbers. */
function glassMacro(key: Macro, hue: "data1" | "data2" | "data3"): LayerInput {
  return {
    id: `gm-${key}`,
    type: "group",
    box: { x: 0, y: 0, w: "fill", h: "auto" },
    when: { bind: `meal.${key}`, exists: true },
    layout: { kind: "stack", dir: "column", gap: 16, align: "start" },
    children: [
      { id: `gm-${key}-rule`, type: "shape", shape: "rect", radius: 5, fill: `$${hue}`, box: { x: 0, y: 0, w: "fill", h: 10 } },
      {
        id: `gm-${key}-stat`,
        type: "stat",
        value: `{meal.${key}|int}`,
        unit: "g",
        label: { t: `sticker:common.${key}` },
        labelPos: "below",
        valueSize: 84,
        unitSize: 34,
        labelSize: 30,
        gap: 16,
        color: "$fg",
        labelColor: "$fgMuted",
        box: { x: 0, y: 0, w: 230 },
      },
    ],
  };
}

const mealGlassStory = defineTemplate({
  id: "meal.glass.story",
  kind: "meal",
  style: "glass",
  canvas: "story",
  background: darkPhoto(0.6, 0.3),
  light: PHOTO_LIGHT,
  requires: ["meal.kcal"],
  layers: [
    {
      id: "card",
      type: "group",
      glass: true,
      radius: 56,
      stroke: { color: "#ffffff33", width: 2 },
      box: { x: 72, y: 870, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 24, align: "start", padding: 56 },
      children: [
        {
          id: "top",
          type: "group",
          box: { x: 0, y: 0, w: 824, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 16, align: "center" },
          children: [
            { id: "top-icon", type: "icon", name: "restaurant", color: "$accent", box: { x: 0, y: 0, w: 36, h: 36 } },
            {
              id: "top-text",
              type: "text",
              value: { t: "sticker:meal.eyebrow" },
              size: 30,
              weight: 800,
              case: "upper",
              letterSpacing: 5,
              color: "$accent",
              box: { x: 0, y: 0, w: "auto" },
            },
            {
              id: "top-user",
              type: "text",
              value: "{user.name}",
              size: 30,
              weight: 700,
              color: "$fgSoft",
              align: "right",
              fit: { mode: "shrink", minSize: 24 },
              box: { x: 0, y: 0, w: "fill" },
            },
            {
              id: "top-date",
              type: "text",
              value: "{date|date:short}",
              size: 30,
              weight: 600,
              color: "$fgMuted",
              box: { x: 0, y: 0, w: "auto" },
              when: { bind: "user.name", exists: true },
            },
            {
              id: "top-date-solo",
              type: "text",
              value: "{date|date:short}",
              size: 30,
              weight: 600,
              color: "$fgMuted",
              align: "right",
              box: { x: 0, y: 0, w: "fill" },
              when: { bind: "user.name", exists: false },
            },
          ],
        },
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 64,
          weight: 800,
          lineHeight: 1.06,
          color: "$fg",
          fit: { mode: "wrap", maxLines: 2 },
          box: { x: 0, y: 0, w: 824 },
        },
        {
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: { t: "sticker:common.kcal" },
          valueSize: 200,
          unitSize: 56,
          valueWeight: 800,
          color: "$fg",
          labelPos: "none",
          box: { x: 0, y: 0, w: 824 },
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: 824, h: "auto" },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 28, align: "start" },
          children: MACROS.map(([k, h]) => glassMacro(k, h)),
        },
        reactionRow("reaction", "$accent2"),
      ],
    },
    watermark("wm", { x: 72, y: 1516, w: 936 }, "start"),
  ],
});

/** Sticker: compact, sits on any photo. White ink with shadow in dark, dark ink in light. */
function stickerMacro(key: Macro, hue: "data1" | "data2" | "data3"): LayerInput {
  return {
    id: `sm-${key}`,
    type: "group",
    box: { x: 0, y: 0, w: "auto", h: 40 },
    when: { bind: `meal.${key}`, exists: true },
    layout: { kind: "stack", dir: "row", gap: 12, align: "center" },
    children: [
      { id: `sm-${key}-dot`, type: "shape", shape: "ellipse", fill: `$${hue}`, box: { x: 0, y: 0, w: 18, h: 18 } },
      { id: `sm-${key}-v`, type: "text", value: `{meal.${key}|int} g`, size: 34, weight: 800, color: "$fg", shadow: true, box: { x: 0, y: 0, w: "auto" } },
      { id: `sm-${key}-l`, type: "text", value: { t: `sticker:common.${key}` }, size: 28, weight: 600, color: "$fgSoft", shadow: true, box: { x: 0, y: 0, w: "auto" } },
    ],
  };
}

const mealMinimalSticker = defineTemplate({
  id: "meal.minimal.sticker",
  kind: "meal",
  style: "minimal",
  canvas: { sticker: 430 },
  requires: ["meal.kcal"],
  layers: [
    {
      id: "block",
      type: "group",
      box: { x: 60, y: 0, w: 960, h: 430 },
      layout: { kind: "stack", dir: "column", gap: 14, align: "center", justify: "center" },
      children: [
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 54,
          weight: 700,
          color: "$fgSoft",
          shadow: true,
          align: "center",
          fit: { mode: "shrink", minSize: 30 },
          box: { x: 0, y: 0, w: 860 },
        },
        {
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: { t: "sticker:common.kcal" },
          valueSize: 190,
          unitSize: 52,
          valueWeight: 800,
          color: "$fg",
          align: "center",
          labelPos: "none",
          shadow: true,
          box: { x: 0, y: 0, w: 860 },
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: 40 },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 34, align: "center" },
          children: MACROS.map(([k, h]) => stickerMacro(k, h)),
        },
      ],
    },
  ],
});

/** Receipt: thermal strip on the brand gradient. */
const RX = 48;
const RW = 744 - RX * 2;
const mealReceiptStory = defineTemplate({
  id: "meal.receipt.story",
  kind: "meal",
  style: "receipt",
  canvas: "story",
  background: BRAND_GRADIENT,
  /** The stat unit is always painted with $fgSoft; point it at ink so it reads on paper in both modes. */
  dark: { fgSoft: INK },
  light: { fgSoft: INK },
  requires: ["meal.kcal"],
  layers: [
    ...receiptPaper("paper", { x: 168, y: 320, w: 744, h: 1180 }, [
      {
        id: "title",
        type: "text",
        value: { t: "sticker:meal.receipt.title" },
        font: "mono",
        size: 44,
        weight: 700,
        case: "upper",
        letterSpacing: 4,
        color: INK,
        align: "center",
        box: { x: RX, y: 76, w: RW },
      },
      {
        id: "meta",
        type: "group",
        box: { x: RX, y: 138, w: RW, h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 16, align: "center" },
        children: [
          {
            id: "date",
            type: "text",
            value: "{date|date:medium}",
            font: "mono",
            size: 30,
            weight: 400,
            color: INK_SOFT,
            align: "center",
            when: { bind: "user.name", exists: false },
            box: { x: 0, y: 0, w: "fill" },
          },
          {
            id: "date-l",
            type: "text",
            value: "{date|date:medium}",
            font: "mono",
            size: 30,
            weight: 400,
            color: INK_SOFT,
            when: { bind: "user.name", exists: true },
            box: { x: 0, y: 0, w: "fill" },
          },
          {
            id: "user",
            type: "text",
            value: "{user.name}",
            font: "mono",
            size: 30,
            weight: 700,
            color: INK_SOFT,
            align: "right",
            fit: { mode: "shrink", minSize: 24 },
            box: { x: 0, y: 0, w: "fill" },
          },
        ],
      },
      receiptRule("r1", RX, 214, RW),
      {
        id: "body",
        type: "group",
        box: { x: RX, y: 250, w: RW, h: 850 },
        layout: { kind: "stack", dir: "column", gap: 24, align: "start", justify: "between" },
        children: [
      {
        id: "items",
        type: "group",
        box: { x: 0, y: 0, w: RW, h: "auto" },
        layout: { kind: "stack", dir: "column", gap: 26, align: "start" },
        children: [
          {
            id: "item-head",
            type: "text",
            value: { t: "sticker:meal.receipt.item" },
            font: "mono",
            size: 26,
            weight: 500,
            case: "upper",
            letterSpacing: 3,
            color: INK_SOFT,
            box: { x: 0, y: 0, w: RW },
          },
          {
            id: "item",
            type: "group",
            box: { x: 0, y: 0, w: RW, h: "auto" },
            layout: { kind: "stack", dir: "column", gap: 10, align: "start" },
            children: [
              {
                id: "item-name",
                type: "text",
                value: "{meal.name}",
                font: "mono",
                size: 40,
                weight: 700,
                case: "upper",
                lineHeight: 1.12,
                color: INK,
                fit: { mode: "wrap", maxLines: 3 },
                box: { x: 0, y: 0, w: RW },
              },
              {
                id: "item-kcal",
                type: "text",
                value: { t: "sticker:meal.receipt.itemKcal", args: { kcal: "{meal.kcal|int}" } },
                font: "mono",
                size: 36,
                weight: 500,
                color: INK,
                align: "right",
                box: { x: 0, y: 0, w: RW },
              },
            ],
          },
          {
            id: "macro-rows",
            type: "group",
            box: { x: 0, y: 0, w: RW, h: "auto" },
            when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
            layout: { kind: "stack", dir: "column", gap: 22, align: "start" },
            children: MACROS.map(([k]) => ({
              ...receiptRow(`row-${k}`, 0, 0, RW, { t: `sticker:common.${k}` }, `{meal.${k}|int} g`, 32, 500),
              when: { bind: `meal.${k}`, exists: true },
            })),
          },
        ],
      },
      {
        id: "bottom",
        type: "group",
        box: { x: 0, y: 0, w: RW, h: "auto" },
        layout: { kind: "stack", dir: "column", gap: 24, align: "start" },
        children: [
          receiptRule("r2", 0, 0, RW),
          {
            id: "total-label",
            type: "text",
            value: { t: "sticker:meal.receipt.total" },
            font: "mono",
            size: 38,
            weight: 700,
            case: "upper",
            letterSpacing: 4,
            color: INK,
            box: { x: 0, y: 0, w: RW },
          },
          {
            id: "total",
            type: "stat",
            value: "{meal.kcal|int}",
            unit: { t: "sticker:common.kcal" },
            font: "mono",
            valueSize: 150,
            unitSize: 46,
            valueWeight: 700,
            color: INK,
            labelColor: INK,
            labelPos: "none",
            box: { x: 0, y: 0, w: RW },
          },
          receiptRule("r3", 0, 0, RW),
          {
            id: "thanks",
            type: "text",
            value: { t: "sticker:meal.receipt.thanks" },
            font: "mono",
            size: 28,
            weight: 500,
            case: "upper",
            letterSpacing: 3,
            color: INK_SOFT,
            align: "center",
            box: { x: 0, y: 0, w: RW },
          },
        ],
      },
    ],
  },
    ]),
    watermark("wm", { x: 72, y: 1516, w: 936 }, "center"),
  ],
});

/** Bold square: rounded photo panel on top when there is one, then a huge kcal figure. */
const mealBoldSquare = defineTemplate({
  id: "meal.bold.square",
  kind: "meal",
  style: "bold",
  canvas: "square",
  background: BRAND_GRADIENT,
  requires: ["meal.kcal"],
  layers: [
    {
      id: "col",
      type: "group",
      box: { x: 72, y: 72, w: 936, h: 936 },
      layout: { kind: "stack", dir: "column", gap: 30, align: "start", justify: "center" },
      children: [
        {
          id: "photo",
          type: "image",
          src: { bind: "photo" },
          fit: "cover",
          radius: 44,
          box: { x: 0, y: 0, w: 936, h: 390 },
        },
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 60,
          weight: 800,
          lineHeight: 1.06,
          color: "$fgSoft",
          fit: { mode: "wrap", maxLines: 2 },
          box: { x: 0, y: 0, w: 936 },
        },
        {
          when: { bind: "photo", exists: true },
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: { t: "sticker:common.kcal" },
          valueSize: 220,
          unitSize: 60,
          valueWeight: 800,
          color: "$fg",
          labelPos: "none",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          when: { bind: "photo", exists: false },
          id: "kcal-big",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: { t: "sticker:common.kcal" },
          valueSize: 400,
          unitSize: 96,
          valueWeight: 800,
          color: "$fg",
          labelPos: "none",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 28, align: "start" },
          children: MACROS.map(([k, h]) => ({
            id: `bm-${k}`,
            type: "group",
            box: { x: 0, y: 0, w: "fill", h: "auto" },
            when: { bind: `meal.${k}`, exists: true },
            layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
            children: [
              { id: `bm-${k}-rule`, type: "shape", shape: "rect", radius: 4, fill: `$${h}`, box: { x: 0, y: 0, w: "fill", h: 8 } },
              {
                id: `bm-${k}-stat`,
                type: "stat",
                value: `{meal.${k}|int}`,
                unit: "g",
                label: { t: `sticker:common.${k}` },
                labelPos: "above",
                valueSize: 72,
                unitSize: 32,
                labelSize: 28,
                gap: 8,
                color: "$fg",
                labelColor: "$fgMuted",
                box: { x: 0, y: 0, w: 280 },
              },
            ],
          })),
        },
        footRow("foot", { x: 0, y: 0, w: 936 }, "$fgMuted"),
      ],
    },
  ],
});

/** Cutout story: the food, cut out of its plate, large on the brand gradient with a soft floor shadow. */
const mealCutoutStory = defineTemplate({
  id: "meal.cutout.story",
  kind: "meal",
  style: "poster",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["meal.kcal", "cutout"],
  layers: [
    {
      id: "plate-shadow",
      type: "shape",
      shape: "ellipse",
      fill: "#00000059",
      box: { x: 200, y: 930, w: 680, h: 80 },
    },
    { id: "food", type: "image", src: { bind: "cutout" }, fit: "contain", box: { x: 90, y: 290, w: 900, h: 700 } },
    {
      id: "info",
      type: "group",
      box: { x: 72, y: 1030, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 16, align: "center" },
      children: [
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 68,
          weight: 800,
          align: "center",
          fit: { mode: "wrap", maxLines: 2, minSize: 44 },
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: "kcal",
          valueSize: 170,
          unitSize: 52,
          align: "center",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: 40 },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 34, align: "center" },
          children: MACROS.map(([k, h]) => stickerMacro(k, h)),
        },
      ],
    },
    footRow("foot", { x: 72, y: 1510, w: 936 }, "$fgMuted"),
  ],
});

/** Cutout sticker: the food, its name, kcal and macros, to drop onto your own story. */
const mealCutoutSticker = defineTemplate({
  id: "meal.cutout.sticker",
  kind: "meal",
  style: "badge",
  canvas: { sticker: 940 },
  requires: ["meal.kcal", "cutout"],
  layers: [
    { id: "food", type: "image", src: { bind: "cutout" }, fit: "contain", box: { x: 140, y: 0, w: 800, h: 600 } },
    {
      id: "info",
      type: "group",
      box: { x: 60, y: 610, w: 960, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 10, align: "center" },
      children: [
        {
          id: "name",
          type: "text",
          value: "{meal.name}",
          size: 50,
          weight: 700,
          color: "$fgSoft",
          shadow: true,
          align: "center",
          fit: { mode: "shrink", minSize: 30 },
          box: { x: 0, y: 0, w: 860 },
        },
        {
          id: "kcal",
          type: "stat",
          value: "{meal.kcal|int}",
          unit: "kcal",
          valueSize: 150,
          unitSize: 48,
          align: "center",
          shadow: true,
          box: { x: 0, y: 0, w: 860 },
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: "auto", h: 40 },
          when: { any: MACROS.map(([k]) => ({ bind: `meal.${k}`, exists: true })) },
          layout: { kind: "stack", dir: "row", gap: 34, align: "center" },
          children: MACROS.map(([k, h]) => stickerMacro(k, h)),
        },
      ],
    },
  ],
});

export const MEAL_TEMPLATES: TemplateInput[] = [
  mealPhotoStory,
  mealGlassStory,
  mealMinimalSticker,
  mealReceiptStory,
  mealBoldSquare,
  mealCutoutStory,
  mealCutoutSticker,
];
