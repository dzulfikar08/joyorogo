import type { Condition, Expr } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";

/**
 * "Progres": one period of a diet on one card. The weight change leads, then two small labelled charts (the weight
 * trend, and what was eaten each day against the target) and two figures (days logged, estimated deficit). Every block
 * hides itself when its data is missing, so a period without weigh-ins or without a burn estimate still reads whole.
 */

const has = (bind: string): Condition => ({ bind, exists: true });
const lacks = (bind: string): Condition => ({ bind, exists: false });
const direction = (value: "down" | "up" | "steady"): Condition => ({ bind: "period.direction", eq: value });

const HAS_CHANGE = has("period.changeKg");
const HAS_ENERGY: Condition = { any: [has("period.deficitKcal"), has("period.surplusKcal")] };

type TextOpts = {
  id: string;
  value: Expr;
  size: number;
  w: number | "fill";
  weight?: 600 | 700 | 800;
  color?: string;
  align?: "left" | "center" | "right";
  when?: Condition;
  /** Wrap onto this many lines instead of shrinking. */
  lines?: number;
};

function text(o: TextOpts): LayerInput {
  return {
    id: o.id,
    type: "text",
    value: o.value,
    size: o.size,
    weight: o.weight ?? 600,
    color: o.color ?? "$fgMuted",
    align: o.align ?? "left",
    when: o.when,
    ...(o.lines ? { fit: { mode: "wrap", maxLines: o.lines } } : {}),
    box: { x: 0, y: 0, w: o.w },
  } as LayerInput;
}

/** "Progres" and the period's dates; `compact` puts them on one row (the square card), without the user's name. */
function header(w: number, compact = false): LayerInput {
  const range = (id: string, align: "left" | "right") =>
    text({
      id,
      value: { t: "sticker:period.range", args: { from: "{period.from|date:short}", to: "{period.to|date:medium}", days: "{period.days}" } },
      size: 32,
      w: compact ? "fill" : w,
      align,
    });
  const eyebrow: LayerInput = { id: "eyebrow", type: "text", value: { t: "sticker:period.eyebrow" }, size: 38, weight: 800, color: "$accent", box: { x: 0, y: 0, w: "auto" } };
  if (compact) {
    return {
      id: "head",
      type: "group",
      box: { x: 0, y: 0, w, h: "auto" },
      layout: { kind: "stack", dir: "row", gap: 24, align: "center" },
      children: [eyebrow, range("range", "right")],
    };
  }
  return {
    id: "head",
    type: "group",
    box: { x: 0, y: 0, w, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 10, align: "start" },
    children: [
      {
        id: "head-top",
        type: "group",
        box: { x: 0, y: 0, w, h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 24, align: "center" },
        children: [
          eyebrow,
          { id: "user", type: "text", value: "{user.name}", size: 34, weight: 700, color: "$fgSoft", align: "right", fit: { mode: "shrink", minSize: 24 }, box: { x: 0, y: 0, w: "fill" } },
        ],
      },
      range("range", "left"),
    ],
  };
}

/** The weight change as the headline; without weigh-ins the headline is the days logged. */
function hero(w: number, size: number, subSize = 34): LayerInput {
  const big = (id: string, value: Expr, when: Condition, color = "$fg") =>
    text({ id, value, size, w, weight: 800, color, when });
  const kg = { kg: "{period.changeKg|num:1}" };
  const sub = (id: string, key: string, args: Record<string, string> | undefined, when: Condition) =>
    text({ id, value: { t: key, args }, size: subSize, w, weight: 600, when, lines: 2 });
  return {
    id: "hero",
    type: "group",
    box: { x: 0, y: 0, w, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
    children: [
      big("h-down", { t: "sticker:period.lost", args: kg }, { all: [HAS_CHANGE, direction("down")] }),
      big("h-up", { t: "sticker:period.gained", args: kg }, { all: [HAS_CHANGE, direction("up")] }),
      big("h-steady", { t: "sticker:period.steady" }, { all: [HAS_CHANGE, direction("steady")] }),
      big("h-logged", { t: "sticker:period.loggedHero", args: { logged: "{period.logged}", judged: "{period.judged}" } }, lacks("period.changeKg")),
      sub(
        "h-sub",
        "sticker:period.trendLine",
        { start: "{period.startKg|num:1}", end: "{period.endKg|num:1}", pct: "{period.changePct|num:1}" },
        { all: [HAS_CHANGE, has("period.startKg")] },
      ),
      sub("h-sub-hidden", "sticker:period.trendLineHidden", undefined, { all: [HAS_CHANGE, lacks("period.startKg")] }),
      sub("h-rate", "sticker:period.rate", { kg: "{period.rateKg|num:1}" }, { all: [has("period.rateKg"), direction("down")] }),
      sub("h-rate-up", "sticker:period.rateUp", { kg: "{period.rateKg|num:1}" }, { all: [has("period.rateKg"), direction("up")] }),
      sub("h-note-up", "sticker:period.upNote", undefined, { all: [direction("up"), { bind: "period.gain", ne: true }] }),
    ],
  };
}

const AXIS_TOP = 52;
const AXIS_FOOT = 38;

/**
 * A chart with a label above, a left gutter holding the value axis, and the date axis below. All children are placed in
 * block coordinates: the chart plot starts at `gutter`, `top` below the block's top, and ends `foot` above its bottom.
 */
function axisBlock(o: {
  id: string;
  w: number;
  h: number;
  gutter: number;
  when: Condition;
  labels: LayerInput[];
  chart: Omit<Extract<LayerInput, { type: "chart" }>, "id" | "type" | "box">;
  yTop: LayerInput;
  yBottom: LayerInput;
  xStart: Expr;
  xEnd: Expr;
}): LayerInput {
  const top = AXIS_TOP;
  const foot = AXIS_FOOT;
  const plotH = o.h - top - foot;
  const plotW = o.w - o.gutter;
  const axis = (id: string, value: Expr, x: number, align: "left" | "right"): LayerInput => ({
    id,
    type: "text",
    value,
    size: 26,
    weight: 600,
    color: "$fgMuted",
    align,
    box: { x, y: top + plotH + 8, w: Math.round(plotW / 2) },
  });
  return {
    id: o.id,
    type: "group",
    when: o.when,
    box: { x: 0, y: 0, w: o.w, h: o.h },
    children: [
      ...o.labels,
      { id: `${o.id}-plot`, type: "chart", ...o.chart, box: { x: o.gutter, y: top, w: plotW, h: plotH } } as LayerInput,
      o.yTop,
      o.yBottom,
      axis(`${o.id}-x0`, o.xStart, o.gutter, "left"),
      axis(`${o.id}-x1`, o.xEnd, o.gutter + Math.round(plotW / 2), "right"),
    ],
  };
}

const yLabel = (id: string, value: Expr, y: number, gutter: number, when?: Condition): LayerInput => ({
  id,
  type: "text",
  value,
  size: 26,
  weight: 600,
  color: "$fgMuted",
  align: "right",
  when,
  box: { x: 0, y, w: gutter - 16 },
});

/** The weight trend: the line is drawn on its own min..max, so the axis labels are the line's two extremes. */
function weightChart(w: number, h: number, gutter: number): LayerInput {
  const plotH = h - AXIS_TOP - AXIS_FOOT;
  // The line chart keeps one stroke width of padding inside its box, so the extremes sit that far in.
  const pad = 10;
  return axisBlock({
    id: "wchart",
    w,
    h,
    gutter,
    when: has("period.trend"),
    labels: [
      text({ id: "wchart-label", value: { t: "sticker:period.weightChart" }, size: 30, w, weight: 700, when: has("period.kgTop") }),
      text({ id: "wchart-label-hidden", value: { t: "sticker:period.weightChartHidden" }, size: 30, w, weight: 700, when: lacks("period.kgTop") }),
    ],
    chart: { kind: "area", series: { bind: "period.trend" }, color: "$accent", strokeWidth: pad, min: 0, max: 1, highlight: "last" } as never,
    yTop: yLabel("wchart-top", "{period.kgTop|num:1}", AXIS_TOP + pad - 14, gutter, has("period.kgTop")),
    yBottom: yLabel("wchart-bottom", "{period.kgBottom|num:1}", AXIS_TOP + plotH - pad - 14, gutter, has("period.kgBottom")),
    xStart: "{period.trendFrom|date:short}",
    xEnd: "{period.trendTo|date:short}",
  });
}

/** Calories eaten per day (per week on long periods) against the target; the axis runs 0..barsTop. */
function intakeChart(w: number, h: number, gutter: number): LayerInput {
  const plotH = h - AXIS_TOP - AXIS_FOOT;
  return axisBlock({
    id: "ichart",
    w,
    h,
    gutter,
    when: has("period.bars"),
    labels: [
      text({ id: "ichart-label-d", value: { t: "sticker:period.intakeDaily" }, size: 30, w, weight: 700, when: { bind: "period.barsWeekly", ne: true } }),
      text({ id: "ichart-label-w", value: { t: "sticker:period.intakeWeekly" }, size: 30, w, weight: 700, when: { bind: "period.barsWeekly", eq: true } }),
    ],
    chart: {
      kind: "bars",
      series: { bind: "period.bars" },
      baseline: { bind: "period.barsTarget" },
      color: "$accent",
      barRadius: 8,
      min: 0,
      max: 1,
    } as never,
    yTop: yLabel("ichart-top", "{period.barsTop|int}", AXIS_TOP - 14, gutter),
    yBottom: yLabel("ichart-bottom", "0", AXIS_TOP + plotH - 26, gutter),
    xStart: "{period.barsFrom|date:short}",
    xEnd: "{period.barsTo|date:short}",
  });
}

/** What the dashed line and the short bars mean, in one line under the charts. */
function intakeLegend(w: number): LayerInput {
  return {
    id: "ilegend",
    type: "group",
    when: has("period.bars"),
    box: { x: 0, y: 0, w, h: "auto" },
    children: [
      text({ id: "ilegend-target", value: { t: "sticker:period.legend", args: { kcal: "{period.targetKcal|int}" } }, size: 24, w, when: has("period.targetKcal") }),
      text({ id: "ilegend-plain", value: { t: "sticker:period.legendNoTarget" }, size: 24, w, when: lacks("period.targetKcal") }),
    ],
  };
}

type CellOpts = { id: string; w: number | "fill"; pad: number; when: Condition; children: LayerInput[] };

function cell(o: CellOpts): LayerInput {
  return {
    id: o.id,
    type: "group",
    when: o.when,
    box: { x: 0, y: 0, w: o.w, h: "auto" },
    fill: "$surface",
    radius: 28,
    layout: { kind: "stack", dir: "column", gap: 10, align: "start", padding: o.pad },
    children: o.children,
  };
}

function figure(id: string, o: { value: string; unit: Expr; label: Expr; w: number; size: number; gap?: number }): LayerInput {
  return {
    id,
    type: "stat",
    value: o.value,
    unit: o.unit,
    label: o.label,
    labelPos: "above",
    valueSize: o.size,
    unitSize: 32,
    labelSize: 28,
    valueWeight: 800,
    gap: o.gap ?? 14,
    color: "$fg",
    labelColor: "$fgMuted",
    box: { x: 0, y: 0, w: o.w },
  };
}

/** Days logged (with the streak) beside the estimated deficit; the logged days take the full row without a deficit, and are left to the headline when there is no weight either. */
function figures(w: number, size: number, pad: number): LayerInput {
  const inner = (cellW: number) => cellW - pad * 2;
  const half = Math.round((w - 24) / 2);
  const days = (cellW: number, id: string): LayerInput[] => [
    figure(`${id}-fig`, {
      value: "{period.logged}",
      unit: { t: "sticker:period.ofDays", args: { count: "{period.judged}" } },
      label: { t: "sticker:period.logged" },
      w: inner(cellW),
      size,
    }),
    text({ id: `${id}-streak`, value: { t: "sticker:period.streak", args: { count: "{period.streak}" } }, size: 28, w: inner(cellW), weight: 700, color: "$accent", when: has("period.streak") }),
  ];
  const energy = (cellW: number): LayerInput[] => [
    figure("energy-fig-d", {
      value: "{period.deficitKcal|int}",
      unit: { t: "sticker:common.kcal" },
      label: { t: "sticker:period.deficit" },
      w: inner(cellW),
      size,
    }),
    figure("energy-fig-s", {
      value: "{period.surplusKcal|int}",
      unit: { t: "sticker:common.kcal" },
      label: { t: "sticker:period.surplus" },
      w: inner(cellW),
      size,
    }),
    text({ id: "energy-fat", value: { t: "sticker:period.fat", args: { kg: "{period.fatKg|num:1}" } }, size: 28, w: inner(cellW), weight: 700, color: "$fgSoft", when: has("period.fatKg"), lines: 3 }),
  ];
  return {
    id: "figures",
    type: "group",
    box: { x: 0, y: 0, w, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 18, align: "start" },
    children: [
      {
        id: "figures-pair",
        type: "group",
        box: { x: 0, y: 0, w, h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 24, align: "stretch" },
        children: [
          cell({ id: "cell-days-pair", w: half, pad, when: HAS_ENERGY, children: days(half, "days-pair") }),
          cell({ id: "cell-energy", w: half, pad, when: HAS_ENERGY, children: energy(half) }),
          cell({ id: "cell-days-solo", w, pad, when: { all: [{ not: HAS_ENERGY }, HAS_CHANGE] }, children: days(w, "days-solo") }),
        ],
      },
      text({ id: "estimate-note", value: { t: "sticker:period.estimateNote", args: { count: "{period.countedDays}" } }, size: 24, w, when: HAS_ENERGY, lines: 2 }),
    ],
  };
}

/** Story: weight and intake charts stacked, then the two figures. */
const periodProgressStory = defineTemplate({
  id: "period.progress.story",
  kind: "period",
  style: "progress",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["period.judged"],
  layers: [
    {
      id: "root",
      type: "group",
      box: { x: 72, y: 250, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 24, align: "start" },
      children: [header(936), hero(936, 96), weightChart(936, 232, 150), intakeChart(936, 212, 150), intakeLegend(936), figures(936, 72, 28)],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

/** Square: the two charts side by side under the headline, the figures along the bottom. */
const periodProgressSquare = defineTemplate({
  id: "period.progress.square",
  kind: "period",
  style: "progress",
  canvas: "square",
  background: BRAND_GRADIENT,
  requires: ["period.judged"],
  layers: [
    {
      id: "root",
      type: "group",
      box: { x: 72, y: 72, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 18, align: "start" },
      children: [
        header(936, true),
        hero(936, 84, 30),
        {
          id: "charts",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 32, align: "start" },
          children: [weightChart(452, 232, 108), intakeChart(452, 232, 108)],
        },
        intakeLegend(936),
        figures(936, 64, 24),
      ],
    },
    watermark("wm", { x: 72, y: 982, w: 936 }, "start"),
  ],
});

export const PERIOD_TEMPLATES: TemplateInput[] = [periodProgressStory, periodProgressSquare];
