import type { Condition, Expr } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { DAYFOOD_SLIDE_ITEMS, DAYFOOD_STICKERS, DAYFOOD_STORY_MEALS } from "../dayfood";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";
import { CAROUSEL_TAG, SLIDE_TAG } from "../selection";

/**
 * "Makan sehari": the whole diary day as one 9:16 story, or as a 4:5 carousel (cover, one page per meal, closing
 * totals). Pride framing is in the layout itself: a target that was reached gets a check and a chip, a target that was
 * passed gets nothing at all (no warn colour, no "over" wording), and a bar that is full is just full.
 */

type Macro = "protein" | "carbs" | "fat" | "fiber";
type Dim = number | "auto" | "fill";

const MACROS: Macro[] = ["protein", "carbs", "fat", "fiber"];
/** Protein and fibre are things to reach; carbs and fat are budgets, so only these two can be "reached". */
const REACHABLE: Macro[] = ["protein", "fiber"];
const HUE: Record<Macro, string> = { protein: "$data1", carbs: "$data2", fat: "$data3", fiber: "$fgSoft/60" };
const LETTER: Record<"protein" | "carbs" | "fat", string> = {
  protein: "sticker:dayfood.mini.protein",
  carbs: "sticker:dayfood.mini.carbs",
  fat: "sticker:dayfood.mini.fat",
};
const MINI_MACROS = ["protein", "carbs", "fat"] as const;

const has = (bind: string): Condition => ({ bind, exists: true });
const lacks = (bind: string): Condition => ({ bind, exists: false });

const DATE_LINE = "{date|date:weekday}, {date|date:medium}";

// ------------------------------------------------------------------- pieces

type TextOpts = {
  id: string;
  value: Expr;
  size: number;
  x?: number;
  y?: number;
  w?: Dim;
  h?: number;
  weight?: 500 | 600 | 700 | 800;
  color?: string;
  align?: "left" | "center" | "right";
  when?: Condition;
  /** Shrink to this size, or cut with an ellipsis, when the text is wider than its box. */
  fit?: { mode: "shrink" | "ellipsis"; min?: number };
  /** Shown instead of hiding the layer when a binding is missing. */
  keep?: string;
  letterSpacing?: number;
};

function text(o: TextOpts): LayerInput {
  return {
    id: o.id,
    type: "text",
    value: o.value,
    size: o.size,
    weight: o.weight ?? 600,
    color: o.color ?? "$fg",
    align: o.align ?? "left",
    when: o.when,
    ...(o.letterSpacing ? { letterSpacing: o.letterSpacing } : {}),
    ...(o.fit ? { fit: { mode: o.fit.mode, ...(o.fit.min ? { minSize: o.fit.min } : {}) } } : {}),
    ...(o.keep ? { onMissing: "keep", fallback: o.keep } : {}),
    ...(o.h ? { valign: "middle" } : {}),
    box: { x: o.x ?? 0, y: o.y ?? 0, w: o.w ?? "auto", ...(o.h ? { h: o.h } : {}) },
  } as LayerInput;
}

/** "1.760" with "/ 1.850 kkal" on its baseline; without a target just "kkal". */
function kcalHero(id: string, w: number, valueSize: number, unitSize: number, kcal = "dayfood.kcal"): LayerInput[] {
  const base = { type: "stat" as const, value: `{${kcal}|int}`, valueSize, unitSize, labelPos: "none" as const };
  return [
    {
      ...base,
      id: `${id}-of`,
      unit: { t: "sticker:dayfood.ofTarget", args: { target: "{dayfood.target|int}" } },
      when: has("dayfood.target"),
      box: { x: 0, y: 0, w },
    },
    {
      ...base,
      id: `${id}-plain`,
      unit: { t: "sticker:common.kcal" },
      when: lacks("dayfood.target"),
      box: { x: 0, y: 0, w },
    },
  ];
}

/** A progress bar of `bind` (a 0..n ratio, full = full, nothing changes past it). Hidden without the ratio. */
const bar = (id: string, w: number, h: number, bind: string, color: string): LayerInput => ({
  id,
  type: "chart",
  kind: "stack",
  barRadius: h / 2,
  segments: [
    { value: { bind, clamp: [0, 1] }, color },
    { value: { bind, mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
  ],
  box: { x: 0, y: 0, w, h },
});

/** One "target reached" chip: a check and a short phrase on a faint accent pad. */
function chip(id: string, phrase: string, when: Condition, size: number): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: "auto", h: Math.round(size * 1.9) },
    when,
    fill: "$accent/16",
    radius: Math.round(size * 0.95),
    layout: { kind: "stack", dir: "row", gap: Math.round(size * 0.3), align: "center", padding: Math.round(size * 0.55) },
    children: [
      { id: `${id}-ok`, type: "icon", name: "check", color: "$accent", box: { x: 0, y: 0, w: Math.round(size * 1.05), h: Math.round(size * 1.05) } },
      text({ id: `${id}-t`, value: { t: phrase }, size, weight: 800, color: "$accent" }),
    ],
  };
}

/** What was reached today, nothing else: on target, protein, fibre. Hidden when none was. */
function hits(id: string, size: number): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: "auto", h: "auto" },
    when: has("dayfood.anyHit"),
    layout: { kind: "stack", dir: "row", gap: 14, align: "center" },
    children: [
      chip(`${id}-kcal`, "sticker:dayfood.hit.kcal", has("dayfood.onTarget"), size),
      chip(`${id}-protein`, "sticker:dayfood.hit.protein", has("dayfood.proteinHit"), size),
      chip(`${id}-fiber`, "sticker:dayfood.hit.fiber", has("dayfood.fiberHit"), size),
    ],
  };
}

type TileSize = { label: number; value: number; bar: number; gap: number };

/** A macro: label (with a check when reached), "88 / 110 g" on the right, a bar under. Unknown shows as a dash. */
function macroTile(id: string, key: Macro, w: number, s: TileSize): LayerInput {
  const v = `dayfood.${key}`;
  const target = `${v}Target`;
  const head = Math.round(s.value * 1.3);
  const valueAt = (suffix: string, value: Expr, when: Condition, color = "$fg"): LayerInput =>
    text({ id: `${id}-${suffix}`, value, size: s.value, weight: 800, color, align: "right", x: 0, w, when });
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w, h: head + s.gap + s.bar },
    children: [
      {
        id: `${id}-head`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: head },
        layout: { kind: "stack", dir: "row", gap: 10, align: "center" },
        children: [
          text({ id: `${id}-label`, value: { t: `sticker:common.${key}` }, size: s.label, weight: 700, color: "$fgMuted" }),
          ...(REACHABLE.includes(key)
            ? [
                {
                  id: `${id}-ok`,
                  type: "icon",
                  name: "check",
                  color: "$accent",
                  box: { x: 0, y: 0, w: Math.round(s.label * 1.05), h: Math.round(s.label * 1.05) },
                  when: has(`dayfood.${key}Hit`),
                } as LayerInput,
              ]
            : []),
        ],
      },
      valueAt("both", `{${v}|int} / {${target}|int} g`, { all: [has(v), has(target)] }),
      valueAt("only", `{${v}|int} g`, { all: [has(v), lacks(target)] }),
      valueAt("none", "-", lacks(v), "$fgMuted"),
      { ...bar(`${id}-bar`, w, s.bar, `dayfood.${key}Ratio`, HUE[key]), box: { x: 0, y: head + s.gap, w, h: s.bar } },
    ],
  };
}

/** A meal's three macros as "P 23" pairs, each hidden when nobody logged it. */
function miniMacros(id: string, base: string, size: number, gap: number): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: "auto", h: Math.round(size * 1.3) },
    layout: { kind: "stack", dir: "row", gap, align: "center" },
    children: MINI_MACROS.map(
      (key): LayerInput => ({
        id: `${id}-${key}`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: Math.round(size * 1.3) },
        when: has(`${base}.${key}`),
        layout: { kind: "stack", dir: "row", gap: 8, align: "center" },
        children: [
          text({ id: `${id}-${key}-l`, value: { t: LETTER[key] }, size, weight: 800, color: HUE[key] }),
          text({ id: `${id}-${key}-v`, value: `{${base}.${key}|int}`, size, weight: 700 }),
        ],
      }),
    ),
  };
}

type Slot = { x: number; y: number; w: number; h: number };

/**
 * Cutouts of one card laid out by how many there are (`countBind`): each `widthFor(n)` wide, the first at the left and
 * the rest spread to the right edge of `area` (overlapping when they do not fit side by side), a lone one centred, each over
 * a soft floor shadow. Image j reads `assetKey(j)`; the first (the plate, or the biggest food) paints last, on top.
 */
function cutouts(
  id: string,
  area: Slot,
  maxCount: number,
  countBind: string,
  assetKey: (j: number) => string,
  widthFor: (count: number) => number,
): LayerInput[] {
  const layers: LayerInput[] = [];
  for (let n = 1; n <= maxCount; n++) {
    const w = widthFor(n);
    const step = n > 1 ? (area.w - w) / (n - 1) : 0;
    const x = (j: number) => Math.round(area.x + (n > 1 ? j * step : (area.w - w) / 2));
    const when: Condition = { bind: countBind, eq: n };
    for (let j = 0; j < n; j++) {
      layers.push({
        id: `${id}-sh${n}-${j}`,
        type: "shape",
        shape: "ellipse",
        fill: "#0000003d",
        when,
        box: { x: x(j) + Math.round(w * 0.2), y: area.y + area.h - 16, w: Math.round(w * 0.6), h: 22 },
      });
    }
    for (let j = n - 1; j >= 0; j--) {
      layers.push({
        id: `${id}-img${n}-${j}`,
        type: "image",
        src: { bind: assetKey(j) },
        fit: "contain",
        when,
        box: { x: x(j), y: area.y, w, h: area.h - 10 },
      });
    }
  }
  return layers;
}

const nameText = (id: string, w: number): LayerInput =>
  text({ id, value: "{user.name}", size: 34, weight: 700, color: "$fgSoft", align: "right", w, fit: { mode: "shrink", min: 24 } });

// -------------------------------------------------------------------- story

const STORY_SPREAD_W = 936;

/** One meal of the day on the story: its cutouts, name, kcal, macros and what was eaten. */
function storyCard(i: number): LayerInput {
  const m = `dayfood.meals.${i}`;
  const n = `${m}.stickers`;
  const CARD_H = 160;
  const variant = (suffix: string, x0: number, when: Condition): LayerInput[] => {
    const w = STORY_SPREAD_W - x0 - 30;
    return [
      text({ id: `c${i}-label-${suffix}`, value: `{${m}.label}`, size: 40, weight: 800, x: x0, y: 18, w: w - 260, fit: { mode: "shrink", min: 28 }, when }),
      text({
        id: `c${i}-kcal-${suffix}`,
        value: { t: "sticker:common.kcalValue", args: { value: `{${m}.kcal|int}` } },
        size: 38,
        weight: 800,
        color: "$accent",
        align: "right",
        x: x0 + w - 250,
        y: 20,
        w: 250,
        fit: { mode: "shrink", min: 26 },
        when,
      }),
      { ...miniMacros(`c${i}-mini-${suffix}`, m, 30, 28), box: { x: x0, y: 74, w: "auto", h: 40 }, when: { all: [when, { any: MINI_MACROS.map((k) => has(`${m}.${k}`)) }] } },
      text({ id: `c${i}-names-${suffix}`, value: `{${m}.names}`, size: 28, weight: 600, color: "$fgMuted", x: x0, y: 118, w, fit: { mode: "ellipsis" }, when }),
    ];
  };
  const withStickers: Condition = has(n);
  return {
    id: `card${i}`,
    type: "group",
    box: { x: 0, y: 0, w: STORY_SPREAD_W, h: CARD_H },
    when: has(`${m}.label`),
    fill: "$surface",
    radius: 30,
    children: [
      ...cutouts(`c${i}`, { x: 14, y: 10, w: 190, h: 142 }, DAYFOOD_STICKERS, n, (j) => `m${i}s${j}`, (count) => (count === 1 ? 190 : 94)),
      ...variant("s", 226, withStickers),
      ...variant("t", 32, lacks(n)),
    ],
  };
}

const dayfoodStory = defineTemplate({
  id: "dayfood.full.story",
  kind: "dayfood",
  style: "day",
  canvas: "story",
  safe: { top: 250, right: 72, bottom: 250, left: 72 },
  background: BRAND_GRADIENT,
  requires: ["dayfood.kcal"],
  maxLayers: 400,
  layers: [
    {
      id: "spread",
      type: "group",
      box: { x: 72, y: 250, w: STORY_SPREAD_W, h: 1420 },
      layout: { kind: "stack", dir: "column", gap: 0, justify: "between", align: "stretch" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: STORY_SPREAD_W, h: 52 },
          children: [
            text({ id: "date", value: DATE_LINE, size: 40, weight: 700, color: "$fgMuted", w: 640, fit: { mode: "shrink", min: 28 } }),
            { ...nameText("user", 280), box: { x: 656, y: 0, w: 280 } },
          ],
        },
        {
          id: "hero",
          type: "group",
          box: { x: 0, y: 0, w: STORY_SPREAD_W, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 24, align: "start" },
          children: [
            ...kcalHero("kcal", STORY_SPREAD_W, 184, 54),
            { ...bar("kcal-bar", STORY_SPREAD_W, 26, "dayfood.ratio", "$accent"), when: has("dayfood.ratio") },
            hits("hits", 30),
          ],
        },
        {
          id: "macros",
          type: "group",
          box: { x: 0, y: 0, w: STORY_SPREAD_W, h: "auto" },
          when: { any: MACROS.map((k) => has(`dayfood.${k}`)) },
          layout: { kind: "stack", dir: "column", gap: 30, align: "start" },
          children: [
            {
              id: "macros-1",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "row", gap: 24, align: "start" },
              children: (["protein", "carbs"] as Macro[]).map((k) => macroTile(`t-${k}`, k, 456, { label: 32, value: 34, bar: 16, gap: 12 })),
            },
            {
              id: "macros-2",
              type: "group",
              box: { x: 0, y: 0, w: "auto", h: "auto" },
              layout: { kind: "stack", dir: "row", gap: 24, align: "start" },
              children: (["fat", "fiber"] as Macro[]).map((k) => macroTile(`t-${k}`, k, 456, { label: 32, value: 34, bar: 16, gap: 12 })),
            },
          ],
        },
        {
          id: "meals",
          type: "group",
          box: { x: 0, y: 0, w: STORY_SPREAD_W, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
          children: [
            ...Array.from({ length: DAYFOOD_STORY_MEALS }, (_, i) => storyCard(i)),
            text({
              id: "more-meals",
              value: { t: "sticker:dayfood.moreMeals", args: { count: "{dayfood.moreMeals}" } },
              size: 28,
              color: "$fgMuted",
              w: STORY_SPREAD_W,
              align: "center",
              when: has("dayfood.moreMeals"),
            }),
          ],
        },
        watermark("wm", { x: 0, y: 0, w: STORY_SPREAD_W }, "start"),
      ],
    },
  ],
});

// ----------------------------------------------------------------- carousel

const PAD = 72;
const PAGE_W = 936;

/** Page title and the date under it. */
function pageHead(id: string, title: Expr, size: number): LayerInput {
  return {
    id,
    type: "group",
    box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 12, align: "start" },
    children: [
      text({ id: `${id}-title`, value: title, size, weight: 800, w: PAGE_W, fit: { mode: "shrink", min: 48 } }),
      {
        id: `${id}-sub`,
        type: "group",
        box: { x: 0, y: 0, w: PAGE_W, h: 48 },
        children: [
          text({ id: `${id}-date`, value: DATE_LINE, size: 36, weight: 600, color: "$fgMuted", w: 640, fit: { mode: "shrink", min: 26 } }),
          { ...nameText(`${id}-user`, 280), box: { x: 656, y: 0, w: 280 } },
        ],
      },
    ],
  };
}

/** Day macros as four small figures; reached ones read in the accent. */
function macroStrip(): LayerInput {
  const cell = (key: Macro): LayerInput[] => {
    const v = `dayfood.${key}`;
    const reached = REACHABLE.includes(key) ? has(`dayfood.${key}Hit`) : undefined;
    const stat = (id: string, color: string, when: Condition): LayerInput => ({
      id,
      type: "stat",
      value: `{${v}|int}`,
      unit: "g",
      label: { t: `sticker:common.${key}` },
      labelPos: "above",
      valueSize: 56,
      unitSize: 30,
      labelSize: 28,
      gap: 10,
      color,
      when,
      box: { x: 0, y: 0, w: 222 },
    });
    return reached
      ? [stat(`s-${key}-hit`, "$accent", { all: [has(v), reached] }), stat(`s-${key}`, "$fg", { all: [has(v), { not: reached }] })]
      : [stat(`s-${key}`, "$fg", has(v))];
  };
  return {
    id: "strip",
    type: "group",
    box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
    layout: { kind: "stack", dir: "row", gap: 16, align: "start" },
    children: MACROS.flatMap(cell),
  };
}

const COVER_COLLAGE: Slot = { x: 0, y: 0, w: PAGE_W, h: 300 };

const dayfoodCover = defineTemplate({
  id: "dayfood.cover.carousel",
  name: "dayfood carousel",
  kind: "dayfood",
  style: "carousel",
  canvas: "portrait",
  background: BRAND_GRADIENT,
  requires: ["dayfood.kcal"],
  tags: [CAROUSEL_TAG, "cover"],
  maxLayers: 400,
  layers: [
    {
      id: "spread",
      type: "group",
      box: { x: PAD, y: PAD, w: PAGE_W, h: 1112 },
      layout: { kind: "stack", dir: "column", gap: 0, justify: "between", align: "stretch" },
      children: [
        pageHead("head", { t: "sticker:dayfood.coverTitle" }, 84),
        {
          id: "collage",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: COVER_COLLAGE.h },
          when: has("dayfood.collage"),
          children: cutouts("cv", COVER_COLLAGE, 4, "dayfood.collage", (j) => `c${j}`, (count) => Math.min(PAGE_W / count, 300)),
        },
        {
          id: "hero",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 22, align: "start" },
          children: [
            ...kcalHero("kcal", PAGE_W, 210, 56),
            { ...bar("kcal-bar", PAGE_W, 28, "dayfood.ratio", "$accent"), when: has("dayfood.ratio") },
            hits("hits", 30),
          ],
        },
        macroStrip(),
      ],
    },
    watermark("wm", { x: PAD, y: 1222, w: PAGE_W }, "start"),
  ],
});

/** Table columns of a meal page: x, width. Name takes what is left of the row. */
const COL = {
  name: { x: 0, w: 392 },
  grams: { x: 392, w: 118 },
  kcal: { x: 510, w: 140 },
  protein: { x: 660, w: 80 },
  carbs: { x: 750, w: 80 },
  fat: { x: 840, w: 96 },
} as const;
const ROW_H = 66;
const TABLE_HEAD_H = 46;

/** One table row (a food, or the summary of the foods past the cap) at row index `r`. */
function itemRow(r: number): LayerInput {
  const it = `slide.items.${r}`;
  const y = TABLE_HEAD_H + r * ROW_H;
  const cell = (id: string, col: { x: number; w: number }, value: Expr, o: { weight?: 500 | 600 | 700 | 800; color?: string; when?: Condition; keep?: string; size?: number } = {}): LayerInput =>
    text({
      id: `r${r}-${id}`,
      value,
      size: o.size ?? 32,
      weight: o.weight ?? 600,
      color: o.color ?? "$fg",
      align: id === "name" || id === "more" ? "left" : "right",
      x: col.x,
      y: 10,
      w: col.w - (id === "name" || id === "more" ? 16 : 0),
      when: o.when,
      keep: o.keep,
      fit: { mode: "shrink", min: 24 },
    });
  const last = r === DAYFOOD_SLIDE_ITEMS - 1;
  return {
    id: `row${r}`,
    type: "group",
    box: { x: 0, y, w: PAGE_W, h: ROW_H },
    when: has(`${it}.kcal`),
    children: [
      { id: `r${r}-rule`, type: "shape", shape: "rect", fill: "$line", box: { x: 0, y: ROW_H - 2, w: PAGE_W, h: 2 } },
      cell("name", COL.name, `{${it}.name}`, { weight: 700, when: lacks(`${it}.more`) }),
      ...(last
        ? [
            cell("more", COL.name, { t: "sticker:dayfood.moreItems", args: { count: `{${it}.more}` } }, { weight: 700, color: "$fgMuted", when: has(`${it}.more`) }),
          ]
        : []),
      cell("grams", COL.grams, `{${it}.grams|int}`, { color: "$fgMuted", keep: "-" }),
      cell("kcal", COL.kcal, `{${it}.kcal|int}`, { weight: 800 }),
      cell("protein", COL.protein, `{${it}.protein|int}`, { keep: "-" }),
      cell("carbs", COL.carbs, `{${it}.carbs|int}`, { keep: "-" }),
      cell("fat", COL.fat, `{${it}.fat|int}`, { keep: "-" }),
    ],
  };
}

function tableHeader(): LayerInput {
  const head = (id: string, col: { x: number; w: number }, value: Expr, align: "left" | "right", color = "$fgMuted"): LayerInput =>
    text({ id: `h-${id}`, value, size: 26, weight: 700, color, align, x: col.x, y: 0, w: col.w - (align === "left" ? 16 : 0) });
  return {
    id: "table-head",
    type: "group",
    box: { x: 0, y: 0, w: PAGE_W, h: 36 },
    children: [
      head("name", COL.name, { t: "sticker:dayfood.col.food" }, "left"),
      head("grams", COL.grams, { t: "sticker:common.g" }, "right"),
      head("kcal", COL.kcal, { t: "sticker:common.kcal" }, "right"),
      head("protein", COL.protein, { t: LETTER.protein }, "right", HUE.protein),
      head("carbs", COL.carbs, { t: LETTER.carbs }, "right", HUE.carbs),
      head("fat", COL.fat, { t: LETTER.fat }, "right", HUE.fat),
    ],
  };
}

/** A meal page gives its cutouts the room the table does not need: the fewer foods, the taller the stage. */
const MEAL_STAGES: Array<{ id: string; h: number; when: Condition }> = [
  { id: "tall", h: 430, when: { all: [has("slide.stickers"), lacks("slide.items.4.kcal")] } },
  { id: "mid", h: 340, when: { all: [has("slide.stickers"), has("slide.items.4.kcal"), lacks("slide.items.6.kcal")] } },
  { id: "short", h: 260, when: { all: [has("slide.stickers"), has("slide.items.6.kcal")] } },
];

const dayfoodMeal = defineTemplate({
  id: "dayfood.meal.carousel",
  name: "dayfood meal page",
  kind: "dayfood",
  style: "carousel",
  canvas: "portrait",
  background: BRAND_GRADIENT,
  tags: [CAROUSEL_TAG, SLIDE_TAG],
  maxLayers: 400,
  layers: [
    {
      id: "spread",
      type: "group",
      box: { x: PAD, y: PAD, w: PAGE_W, h: 1112 },
      layout: { kind: "stack", dir: "column", gap: 0, justify: "between", align: "stretch" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: 170 },
          children: [
            text({ id: "label", value: "{slide.label}", size: 88, weight: 800, w: 560, fit: { mode: "shrink", min: 52 } }),
            {
              id: "kcal",
              type: "stat",
              value: "{slide.kcal|int}",
              unit: { t: "sticker:common.kcal" },
              valueSize: 104,
              unitSize: 38,
              labelPos: "none",
              align: "right",
              box: { x: 540, y: 20, w: 396 },
            },
            { ...miniMacros("macros", "slide", 36, 30), box: { x: 0, y: 116, w: "auto", h: 48 }, when: has("slide.stickers") },
          ],
        },
        ...MEAL_STAGES.map(
          (stage): LayerInput => ({
            id: `stage-${stage.id}`,
            type: "group",
            box: { x: 0, y: 0, w: PAGE_W, h: stage.h },
            when: stage.when,
            children: cutouts(`pl-${stage.id}`, { x: 0, y: 0, w: PAGE_W, h: stage.h }, 4, "slide.stickers", (j) => `p${j}`, (count) =>
              Math.min(PAGE_W / count, 380),
            ),
          }),
        ),
        // A meal with no cutout (typed in, a barcode without a photo) gets its macros big, where the picture would be.
        {
          id: "macro-big",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
          when: { all: [lacks("slide.stickers"), { any: MINI_MACROS.map((k) => has(`slide.${k}`)) }] },
          layout: { kind: "stack", dir: "row", gap: 24, align: "start" },
          children: MINI_MACROS.map(
            (key): LayerInput => ({
              id: `mb-${key}`,
              type: "stat",
              value: `{slide.${key}|int}`,
              unit: "g",
              label: { t: `sticker:common.${key}` },
              labelPos: "above",
              valueSize: 92,
              unitSize: 36,
              labelSize: 32,
              gap: 12,
              color: HUE[key],
              when: has(`slide.${key}`),
              box: { x: 0, y: 0, w: 296 },
            }),
          ),
        },
        {
          id: "table",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: TABLE_HEAD_H + DAYFOOD_SLIDE_ITEMS * ROW_H },
          children: [tableHeader(), ...Array.from({ length: DAYFOOD_SLIDE_ITEMS }, (_, r) => itemRow(r))],
        },
      ],
    },
    watermark("wm", { x: PAD, y: 1222, w: 640 }, "start"),
    text({ id: "pager", value: "{slide.position} / {slide.of}", size: 30, weight: 700, color: "$fgMuted", align: "right", x: PAD + PAGE_W - 200, y: 1232, w: 200 }),
  ],
});

const SPLIT_COLORS = ["$accent", "$accent/72", "$accent/48", "$accent/30", "$accent/20", "$accent/12"];

/** Kcal per meal as one proportional bar, with a legend that reads the same colours. */
function mealSplit(): LayerInput {
  const legend = SPLIT_COLORS.map((color, i): LayerInput => {
    const m = `dayfood.meals.${i}`;
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      id: `lg${i}`,
      type: "group",
      box: { x: col * 480, y: 100 + row * 46, w: 456, h: 40 },
      when: has(`${m}.label`),
      children: [
        { id: `lg${i}-sw`, type: "shape", shape: "rect", radius: 6, fill: color, box: { x: 0, y: 9, w: 22, h: 22 } },
        text({ id: `lg${i}-l`, value: `{${m}.label}`, size: 30, weight: 600, color: "$fgSoft", x: 38, y: 0, w: 250, h: 40, fit: { mode: "ellipsis" } }),
        text({ id: `lg${i}-k`, value: `{${m}.kcal|int}`, size: 30, weight: 800, align: "right", x: 296, y: 0, w: 160, h: 40 }),
      ],
    };
  });
  return {
    id: "split",
    type: "group",
    box: { x: 0, y: 0, w: PAGE_W, h: 240 },
    children: [
      text({ id: "split-title", value: { t: "sticker:dayfood.split" }, size: 30, weight: 700, color: "$fgMuted", w: PAGE_W }),
      {
        id: "split-bar",
        type: "chart",
        kind: "stack",
        barRadius: 17,
        segments: SPLIT_COLORS.map((color, i) => ({ value: { bind: `dayfood.meals.${i}.share` }, color })),
        box: { x: 0, y: 46, w: PAGE_W, h: 34 },
      },
      ...legend,
    ],
  };
}

const dayfoodTotal = defineTemplate({
  id: "dayfood.total.carousel",
  name: "dayfood totals page",
  kind: "dayfood",
  style: "carousel",
  canvas: "portrait",
  background: BRAND_GRADIENT,
  tags: [CAROUSEL_TAG, SLIDE_TAG],
  maxLayers: 400,
  layers: [
    {
      id: "spread",
      type: "group",
      box: { x: PAD, y: PAD, w: PAGE_W, h: 1112 },
      layout: { kind: "stack", dir: "column", gap: 0, justify: "between", align: "stretch" },
      children: [
        pageHead("head", { t: "sticker:dayfood.totalTitle" }, 76),
        {
          id: "hero",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 22, align: "start" },
          children: [
            ...kcalHero("kcal", PAGE_W, 132, 44),
            { ...bar("kcal-bar", PAGE_W, 24, "dayfood.ratio", "$accent"), when: has("dayfood.ratio") },
            hits("hits", 26),
          ],
        },
        {
          id: "tiles",
          type: "group",
          box: { x: 0, y: 0, w: PAGE_W, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
          children: MACROS.map((k) => macroTile(`t-${k}`, k, PAGE_W, { label: 34, value: 36, bar: 18, gap: 10 })),
        },
        mealSplit(),
      ],
    },
    watermark("wm", { x: PAD, y: 1222, w: 640 }, "start"),
    text({ id: "pager", value: "{slide.position} / {slide.of}", size: 30, weight: 700, color: "$fgMuted", align: "right", x: PAD + PAGE_W - 200, y: 1232, w: 200 }),
  ],
});

export const DAYFOOD_TEMPLATES: TemplateInput[] = [dayfoodStory, dayfoodCover, dayfoodMeal, dayfoodTotal];
