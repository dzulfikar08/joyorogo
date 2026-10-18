import type { Expr } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";

const HAS_RANK = { bind: "challenge.rank", exists: true } as const;
const NO_RANK = { bind: "challenge.rank", exists: false } as const;
const UPCOMING = { bind: "challenge.upcoming", eq: true } as const;
const RUNNING = { bind: "challenge.upcoming", ne: true } as const;

/** The three status words, one visible at a time. */
function statusText(id: string, box: { x: number; y: number; w: number | "auto" }, size: number, align: "left" | "center" | "right", shadow = false): LayerInput[] {
  const items: Array<[string, string, string]> = [
    ["act", "sticker:challenge.active", "$accent"],
    ["end", "sticker:challenge.done", "$accent"],
  ];
  return items.map(([k, key, color]) => ({
    id: `${id}-${k}`,
    type: "text" as const,
    value: { t: key },
    size,
    weight: 800,
    case: "upper" as const,
    letterSpacing: 4,
    color,
    align,
    shadow,
    when: { bind: "challenge.status", eq: k === "act" ? "active" : "ended" },
    box,
  }));
}

function statCell(id: string, when: LayerInput["when"], value: string, label: string, color = "$fg"): LayerInput {
  return {
    id,
    type: "stat",
    when,
    value,
    label: { t: label },
    labelPos: "above",
    valueSize: 120,
    labelSize: 30,
    valueWeight: 800,
    gap: 20,
    color,
    labelColor: "$fgMuted",
    box: { x: 0, y: 0, w: 290 },
  };
}

/** Bold: the placement (or hit days when alone) is the whole poster. */
const challengeBoldStory = defineTemplate({
  id: "challenge.bold.story",
  kind: "challenge",
  style: "bold",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["challenge.title"],
  layers: [
    {
      id: "root",
      type: "group",
      box: { x: 72, y: 280, w: 936, h: 1180 },
      layout: { kind: "stack", dir: "column", gap: 56, align: "stretch", justify: "start" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 28, align: "start" },
          children: [
            {
              id: "top",
              type: "group",
              box: { x: 0, y: 0, w: 936, h: "auto" },
              layout: { kind: "stack", dir: "row", gap: 24, align: "center", justify: "between" },
              children: [
                {
                  id: "eyebrow",
                  type: "text",
                  value: { t: "sticker:challenge.eyebrow" },
                  size: 36,
                  weight: 800,
                  case: "upper",
                  letterSpacing: 6,
                  color: "$fgMuted",
                  box: { x: 0, y: 0, w: "auto" },
                },
                ...statusText("status", { x: 0, y: 0, w: "auto" }, 32, "right"),
              ],
            },
            {
              id: "title",
              type: "text",
              value: "{challenge.title}",
              size: 72,
              weight: 800,
              lineHeight: 1.08,
              fit: { mode: "wrap", maxLines: 3 },
              box: { x: 0, y: 0, w: 936 },
            },
          ],
        },
        {
          id: "rank-label",
          type: "text",
          when: { all: [HAS_RANK, RUNNING] },
          value: { t: "sticker:challenge.rank" },
          size: 40,
          weight: 800,
          case: "upper",
          letterSpacing: 6,
          color: "$fgMuted",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "hero-rank",
          type: "stat",
          when: { all: [HAS_RANK, RUNNING] },
          value: "{challenge.rank}",
          label: { t: "sticker:challenge.ofPeople", args: { count: "{challenge.participants}" } },
          valueSize: 440,
          labelSize: 46,
          gap: 40,
          color: "$accent",
          labelColor: "$fgSoft",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "hero-hits",
          type: "stat",
          when: { all: [NO_RANK, RUNNING] },
          value: "{challenge.hitDays}",
          label: { t: "sticker:challenge.ofJudged", args: { count: "{challenge.judgedDays}" } },
          valueSize: 440,
          labelSize: 46,
          gap: 40,
          color: "$accent",
          labelColor: "$fgSoft",
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "hero-up",
          type: "group",
          when: UPCOMING,
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 36, align: "start" },
          children: [
            {
              id: "hero-up-t",
              type: "text",
              value: { t: "sticker:challenge.upcoming" },
              size: 190,
              weight: 800,
              lineHeight: 0.96,
              color: "$accent2",
              fit: { mode: "wrap", maxLines: 2 },
              box: { x: 0, y: 0, w: 936 },
            },
            {
              id: "hero-up-d",
              type: "text",
              value: { t: "sticker:common.days", args: { count: "{challenge.durationDays}" } },
              size: 56,
              weight: 700,
              color: "$fgSoft",
              box: { x: 0, y: 0, w: 936 },
            },
          ],
        },
        {
          id: "bar",
          type: "chart",
          kind: "stack",
          when: { all: [RUNNING, { bind: "challenge.judgedDays", gt: 0 }] },
          barRadius: 20,
          segments: [
            { value: { bind: "challenge.hitDays", div: "challenge.judgedDays", clamp: [0, 1] }, color: "$accent" },
            { value: { bind: "challenge.hitDays", div: "challenge.judgedDays", mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
          ],
          box: { x: 0, y: 0, w: 936, h: 40 },
        },
        {
          id: "stats",
          type: "group",
          when: RUNNING,
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 33, align: "start" },
          children: [
            statCell("s-hit", { all: [HAS_RANK] }, "{challenge.hitDays}", "sticker:challenge.hitDays"),
            statCell("s-streak", { bind: "challenge.streak", exists: true }, "{challenge.streak}", "sticker:challenge.streak", "$accent2"),
            statCell("s-best", { bind: "challenge.bestStreak", exists: true }, "{challenge.bestStreak}", "sticker:challenge.bestStreak"),
          ],
        },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
    {
      id: "name",
      type: "text",
      value: "{user.name}",
      size: 34,
      weight: 700,
      color: "$fgMuted",
      align: "right",
      fit: { mode: "shrink", minSize: 24 },
      box: { x: 608, y: 1518, w: 400 },
    },
  ],
});

const RING = 640;
const RING_X = (1080 - RING) / 2;
const RING_Y = 30;
const THICK = 40;

function cap(id: string, when: LayerInput["when"], value: Expr, size: number, color: string): Extract<LayerInput, { type: "text" }> {
  return {
    id,
    type: "text",
    when,
    value,
    size,
    weight: 800,
    color,
    align: "center",
    shadow: true,
    box: { x: 0, y: 0, w: 400 },
  };
}

function core(id: string, when: LayerInput["when"], top: Expr, value: string, bottom: Expr, topColor = "$fgMuted"): LayerInput[] {
  return [
    { ...cap(`${id}-top`, when, top, 30, topColor), case: "upper", letterSpacing: 5 },
    {
      id: `${id}-n`,
      type: "stat",
      when,
      value,
      labelPos: "none",
      valueSize: 270,
      valueWeight: 800,
      align: "center",
      shadow: true,
      box: { x: 0, y: 0, w: 400 },
    },
    { ...cap(`${id}-bot`, when, bottom, 34, "$fgSoft"), weight: 700 },
  ];
}

/** Badge: a progress ring around a disc; the placement sits in the middle, the title underneath. */
const challengeBadgeSticker = defineTemplate({
  id: "challenge.badge.sticker",
  kind: "challenge",
  style: "badge",
  canvas: { sticker: 880 },
  requires: ["challenge.title"],
  layers: [
    {
      id: "disc",
      type: "shape",
      shape: "ellipse",
      fill: "$bg/78",
      box: { x: RING_X + THICK, y: RING_Y + THICK, w: RING - THICK * 2, h: RING - THICK * 2 },
    },
    {
      id: "track",
      type: "shape",
      shape: "ellipse",
      stroke: { color: "$fg/35", width: THICK },
      box: { x: RING_X + THICK / 2, y: RING_Y + THICK / 2, w: RING - THICK, h: RING - THICK },
    },
    {
      id: "ring",
      type: "ring",
      progress: { bind: "challenge.hitDays", div: "challenge.judgedDays", clamp: [0, 1] },
      thickness: THICK,
      color: "$accent",
      cap: "round",
      box: { x: RING_X, y: RING_Y, w: RING, h: RING },
    },
    {
      id: "core",
      type: "group",
      box: { x: RING_X + 120, y: RING_Y + 110, w: 400, h: 420 },
      layout: { kind: "stack", dir: "column", gap: 14, align: "center", justify: "center" },
      children: [
        ...core(
          "rk",
          { all: [HAS_RANK, RUNNING] },
          { t: "sticker:challenge.rank" },
          "{challenge.rank}",
          { t: "sticker:challenge.ofPeople", args: { count: "{challenge.participants}" } },
        ),
        ...core(
          "ht",
          { all: [NO_RANK, RUNNING] },
          { t: "sticker:challenge.hitDays" },
          "{challenge.hitDays}",
          { t: "sticker:challenge.ofJudged", args: { count: "{challenge.judgedDays}" } },
        ),
        ...core(
          "up",
          UPCOMING,
          { t: "sticker:challenge.upcoming" },
          "{challenge.durationDays}",
          { t: "sticker:challenge.daysUnit" },
          "$accent2",
        ),
      ],
    },
    {
      id: "title",
      type: "text",
      value: "{challenge.title}",
      size: 56,
      weight: 800,
      lineHeight: 1.1,
      align: "center",
      shadow: true,
      fit: { mode: "wrap", maxLines: 2 },
      box: { x: 90, y: RING_Y + RING + 44, w: 900 },
    },
  ],
});

export const CHALLENGE_TEMPLATES: TemplateInput[] = [challengeBoldStory, challengeBadgeSticker];
