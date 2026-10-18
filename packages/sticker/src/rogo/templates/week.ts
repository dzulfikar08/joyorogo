import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";
import { INK, INK_SOFT, receiptPaper, receiptRow, receiptRule } from "../receipt";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Big accent count of on-target days with the "of N logged" explanation beside it. */
function onTargetRow(id: string, box: { x: number; y: number; w: number }, size: number, shadow = false): LayerInput {
  const numW = Math.round(size * 0.62);
  return {
    id,
    type: "group",
    box: { x: box.x, y: box.y, w: box.w, h: "auto" },
    layout: { kind: "stack", dir: "row", gap: 28, align: "center" },
    children: [
      {
        id: `${id}-n`,
        type: "stat",
        value: "{week.daysOnTarget}",
        labelPos: "none",
        valueSize: size,
        valueWeight: 800,
        color: "$accent",
        align: "left",
        box: { x: 0, y: 0, w: numW },
      },
      {
        id: `${id}-txt`,
        type: "group",
        box: { x: 0, y: 0, w: "auto", h: "auto" },
        layout: { kind: "stack", dir: "column", gap: 8, align: "start" },
        children: [
          {
            id: `${id}-t1`,
            type: "text",
            value: { t: "sticker:week.onTarget" },
            size: Math.round(size * 0.3),
            weight: 800,
            shadow,
            box: { x: 0, y: 0, w: "auto" },
          },
          {
            id: `${id}-t2`,
            type: "text",
            value: { t: "sticker:week.ofLogged", args: { count: "{week.loggedDays}" } },
            size: Math.max(26, Math.round(size * 0.26)),
            weight: 600,
            color: "$fgMuted",
            shadow,
            box: { x: 0, y: 0, w: "auto" },
          },
        ],
      },
    ],
  };
}

/** Seven weekday labels centred under the bars of a chart `w` wide starting at `x` (engine bar gap = max(4, min(24, w/7*0.28))). */
function dayLabels(id: string, x: number, y: number, w: number, size: number, shadow = false): LayerInput[] {
  const gap = Math.max(4, Math.min(24, (w / 7) * 0.28));
  const bar = (w - gap * 6) / 7;
  return DAYS.map((i) => ({
    id: `${id}-${i}`,
    type: "text" as const,
    value: `{week.dayDates.${i}|date:weekdayShort}`,
    size,
    weight: 700,
    color: "$fgMuted",
    align: "center" as const,
    shadow,
    box: { x: Math.round(x + i * (bar + gap) - 10), y, w: Math.round(bar + 20) },
  }));
}

/** Poster: the average is the headline, the week is a bar chart against the target line. */
const weekPosterStory = defineTemplate({
  id: "week.poster.story",
  kind: "week",
  style: "poster",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["week.avgKcal"],
  layers: [
    {
      id: "root",
      type: "group",
      box: { x: 72, y: 280, w: 936, h: 1180 },
      layout: { kind: "stack", dir: "column", gap: 40, align: "stretch", justify: "between" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 24, align: "center", justify: "between" },
          children: [
            {
              id: "eyebrow",
              type: "text",
              value: { t: "sticker:week.eyebrow" },
              size: 36,
              weight: 800,
              case: "upper",
              letterSpacing: 6,
              color: "$accent",
              box: { x: 0, y: 0, w: "auto" },
            },
            { id: "range", type: "text", value: "{week.name}", size: 36, weight: 600, color: "$fgMuted", box: { x: 0, y: 0, w: "auto" } },
          ],
        },
        {
          id: "avg",
          type: "stat",
          value: "{week.avgKcal|int}",
          label: { t: "sticker:week.perDay" },
          valueSize: 300,
          labelSize: 46,
          gap: 36,
          labelColor: "$fgSoft",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "chartblock",
          type: "group",
          when: { bind: "week.kcalDays", exists: true },
          box: { x: 0, y: 0, w: 936, h: 450 },
          children: [
            {
              id: "bars",
              type: "chart",
              kind: "bars",
              series: { bind: "week.kcalDays" },
              baseline: { bind: "week.targetKcal" },
              highlight: "max",
              color: "$accent",
              color2: "$surfaceStrong",
              barRadius: 14,
              box: { x: 0, y: 0, w: 936, h: 330 },
            },
            ...dayLabels("dl", 0, 352, 936, 30),
            {
              id: "target-line",
              type: "text",
              value: { t: "sticker:week.targetLine", args: { kcal: "{week.targetKcal|int}" } },
              size: 30,
              weight: 600,
              color: "$accent2",
              box: { x: 0, y: 418, w: 936 },
            },
          ],
        },
        onTargetRow("ont", { x: 0, y: 0, w: 936 }, 150),
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

type CellOpts = {
  id: string;
  when: NonNullable<LayerInput["when"]>;
  value: string;
  unit?: string | { t: string; args?: Record<string, string> };
  label: string | { t: string; args?: Record<string, string> };
  color?: string;
};

const CELL_W = 456;

function cell(o: CellOpts): LayerInput {
  return {
    id: o.id,
    type: "group",
    when: o.when,
    box: { x: 0, y: 0, w: CELL_W, h: "auto" },
    fill: "$surface",
    radius: 28,
    layout: { kind: "stack", dir: "column", gap: 0, align: "start", padding: 32 },
    children: [
      {
        id: `${o.id}-s`,
        type: "stat",
        value: o.value,
        unit: o.unit,
        label: o.label,
        labelPos: "above",
        valueSize: 92,
        unitSize: 36,
        labelSize: 28,
        valueWeight: 800,
        gap: 22,
        color: o.color ?? "$fg",
        labelColor: "$fgMuted",
        box: { x: 0, y: 0, w: CELL_W - 64 },
      },
    ],
  };
}

function cellRow(id: string, a: LayerInput, b: LayerInput, whenAny: NonNullable<LayerInput["when"]>[]): LayerInput {
  return {
    id,
    type: "group",
    when: { any: whenAny },
    box: { x: 0, y: 0, w: 936, h: "auto" },
    layout: { kind: "stack", dir: "row", gap: 24, align: "stretch" },
    children: [a, b],
  };
}

const ex = (bind: string) => ({ bind, exists: true });

/** Bold: the hero number on top, then a 2x3 grid of stat blocks that collapses around missing data. */
const weekBoldStory = defineTemplate({
  id: "week.bold.story",
  kind: "week",
  style: "bold",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["week.avgKcal"],
  layers: [
    {
      id: "root",
      type: "group",
      box: { x: 72, y: 280, w: 936, h: 1180 },
      layout: { kind: "stack", dir: "column", gap: 110, align: "stretch", justify: "start" },
      children: [
        {
          id: "hero",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 28, align: "start" },
          children: [
            {
              id: "eyebrow",
              type: "text",
              value: { t: "sticker:week.eyebrow" },
              size: 36,
              weight: 800,
              case: "upper",
              letterSpacing: 6,
              color: "$accent",
              box: { x: 0, y: 0, w: 936 },
            },
            {
              id: "avg",
              type: "stat",
              value: "{week.avgKcal|int}",
              unit: { t: "sticker:common.kcal" },
              label: { t: "sticker:week.avgPerDay" },
              valueSize: 230,
              unitSize: 70,
              labelSize: 42,
              gap: 30,
              labelColor: "$fgSoft",
              box: { x: 0, y: 0, w: 936 },
            },
          ],
        },
        {
          id: "grid",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 24, align: "stretch" },
          children: [
            cellRow(
              "r1",
              cell({
                id: "c-ont",
                when: ex("week.daysOnTarget"),
                value: "{week.daysOnTarget}",
                unit: "/{week.loggedDays}",
                label: { t: "sticker:week.onTarget" },
                color: "$accent",
              }),
              cell({
                id: "c-prot",
                when: ex("week.proteinAvg"),
                value: "{week.proteinAvg|int}",
                unit: { t: "sticker:common.g" },
                label: { t: "sticker:week.protein" },
              }),
              [ex("week.daysOnTarget"), ex("week.proteinAvg")],
            ),
            cellRow(
              "r2",
              cell({
                id: "c-streak",
                when: ex("week.streak"),
                value: "{week.streak}",
                unit: { t: "sticker:week.daysUnit" },
                label: { t: "sticker:week.streak" },
                color: "$accent2",
              }),
              cell({
                id: "c-ex",
                when: ex("week.exerciseMin"),
                value: "{week.exerciseMin|int}",
                unit: { t: "sticker:common.minutes" },
                label: { t: "sticker:week.exercise" },
              }),
              [ex("week.streak"), ex("week.exerciseMin")],
            ),
            cellRow(
              "r3",
              cell({
                id: "c-weight",
                when: ex("week.weightChangeKg"),
                value: "{week.weightChangeKg|signed:1}",
                unit: { t: "sticker:common.kg" },
                label: { t: "sticker:week.weight" },
              }),
              cell({
                id: "c-best",
                when: ex("week.bestDayKcal"),
                value: "{week.bestDayKcal|int}",
                unit: { t: "sticker:common.kcal" },
                label: { t: "sticker:week.bestDayOf", args: { day: "{week.bestDayLabel}" } },
              }),
              [ex("week.weightChangeKg"), ex("week.bestDayKcal")],
            ),
          ],
        },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

/** Sticker: average, mini bars and the on-target count in one compact transparent block. */
const weekMinimalSticker = defineTemplate({
  id: "week.minimal.sticker",
  kind: "week",
  style: "minimal",
  canvas: { sticker: 560 },
  requires: ["week.avgKcal"],
  layers: [
    {
      id: "avg",
      type: "stat",
      value: "{week.avgKcal|int}",
      unit: { t: "sticker:common.kcal" },
      label: { t: "sticker:week.perDay" },
      valueSize: 150,
      unitSize: 44,
      labelSize: 30,
      gap: 22,
      shadow: true,
      box: { x: 90, y: 62, w: 480 },
    },
    {
      id: "bars",
      type: "chart",
      kind: "bars",
      series: { bind: "week.kcalDays" },
      baseline: { bind: "week.targetKcal" },
      highlight: "max",
      color: "$fg",
      color2: "$fg/40",
      barRadius: 8,
      box: { x: 640, y: 40, w: 350, h: 200 },
    },
    ...dayLabels("dl", 640, 252, 350, 22, true).map((l) => ({ ...l, when: { bind: "week.kcalDays", exists: true } })),
    { id: "rule", type: "shape", shape: "line", stroke: { color: "$fg/45", width: 3 }, box: { x: 90, y: 340, w: 900, h: 0 } },
    onTargetRow("ont", { x: 90, y: 384, w: 900 }, 110, true),
  ],
});

const DAY_ROW_SIZE = 34;
const PAPER_W = 760;
const INNER_W = PAPER_W - 96;

/** Receipt: one row per weekday with its kcal, then the average, the target and on-target tally. */
const weekReceiptSquare = defineTemplate({
  id: "week.receipt.square",
  kind: "week",
  style: "receipt",
  canvas: "square",
  background: BRAND_GRADIENT,
  requires: ["week.avgKcal"],
  layers: [
    ...receiptPaper(
      "paper",
      { x: 160, y: 92, w: PAPER_W, h: 780 },
      [
        {
          id: "stack",
          type: "group",
          box: { x: 48, y: 62, w: INNER_W, h: 690 },
          layout: { kind: "stack", dir: "column", gap: 14, align: "stretch" },
          children: [
            {
              id: "title",
              type: "text",
              value: { t: "sticker:week.eyebrow" },
              font: "mono",
              size: 30,
              weight: 700,
              case: "upper",
              letterSpacing: 4,
              color: INK,
              align: "center",
              box: { x: 0, y: 0, w: INNER_W },
            },
            { id: "range", type: "text", value: "{week.name}", font: "mono", size: 42, weight: 700, color: INK, align: "center", box: { x: 0, y: 0, w: INNER_W } },
            receiptRule("r1", 0, 0, INNER_W),
            {
              id: "days",
              type: "group",
              when: { bind: "week.kcalDays", exists: true },
              box: { x: 0, y: 0, w: INNER_W, h: "auto" },
              layout: { kind: "stack", dir: "column", gap: 10, align: "stretch" },
              children: DAYS.map((i) =>
                receiptRow(`d${i}`, 0, 0, INNER_W, `{week.dayDates.${i}|date:weekdayShort}`, `{week.kcalDays.${i}|int}`, DAY_ROW_SIZE),
              ),
            },
            {
              id: "rule2",
              type: "shape",
              shape: "line",
              when: { bind: "week.kcalDays", exists: true },
              stroke: { color: INK_SOFT, width: 3, dash: [3, 9] },
              box: { x: 0, y: 0, w: INNER_W, h: 0 },
            },
            receiptRow("avg", 0, 0, INNER_W, { t: "sticker:week.avgPerDay" }, "{week.avgKcal|int}", 34, 700),
            {
              ...receiptRow("tgt", 0, 0, INNER_W, { t: "sticker:week.target" }, "{week.targetKcal|int}", 34),
              when: { bind: "week.targetKcal", exists: true },
            },
            receiptRow("ont", 0, 0, INNER_W, { t: "sticker:week.onTarget" }, "{week.daysOnTarget}/{week.loggedDays}", 34, 700),
          ],
        },
      ],
      -1.5,
    ),
    watermark("wm", { x: 72, y: 940, w: 936 }, "center"),
  ],
});

export const WEEK_TEMPLATES: TemplateInput[] = [weekPosterStory, weekBoldStory, weekMinimalSticker, weekReceiptSquare];
