import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, watermark } from "../kit";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Seven arc segments around a disc, oldest first from 12 o'clock; logged days are lit, the rest stay a quiet track. */
function weekRing(cx: number, cy: number, diameter: number, thickness: number): LayerInput[] {
  const step = 360 / 7;
  const gap = 9;
  const box = { x: cx - diameter / 2, y: cy - diameter / 2, w: diameter, h: diameter };
  return DAYS.flatMap((i): LayerInput[] => {
    const arc = { type: "ring", progress: 1, thickness, cap: "butt", sweep: step - gap, startAngle: -90 + i * step + gap / 2, box } as const;
    return [
      { ...arc, id: `seg-${i}-off`, color: "$fg/18", when: { bind: `streak.week.${i}`, eq: 0 } },
      { ...arc, id: `seg-${i}-on`, color: "$accent", when: { bind: `streak.week.${i}`, eq: 1 } },
    ];
  });
}

/** Round badge sticker: one solid disc so it reads on any photo, seven-day ring, flame, giant count. */
const streakBadgeSticker = defineTemplate({
  id: "streak.badge.sticker",
  kind: "streak",
  style: "badge",
  canvas: { sticker: 900 },
  requires: ["streak.days"],
  layers: [
    { id: "disc", type: "shape", shape: "ellipse", fill: "$bg", box: { x: 180, y: 30, w: 720, h: 720 } },
    ...weekRing(540, 390, 660, 28),
    { id: "flame", type: "icon", name: "flame", color: "$accent2", box: { x: 496, y: 170, w: 88, h: 88 } },
    {
      id: "count",
      type: "stat",
      value: "{streak.days}",
      label: { t: "sticker:streak.days", args: { count: "{streak.days}" } },
      valueSize: 250,
      labelSize: 42,
      gap: 30,
      align: "center",
      color: "$fg",
      labelColor: "$fgSoft",
      box: { x: 270, y: 300, w: 540 },
    },
    {
      id: "foot",
      type: "group",
      box: { x: 190, y: 770, w: 700, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 14, align: "center" },
      children: [
        {
          id: "user",
          type: "text",
          value: "{user.name}",
          size: 36,
          weight: 700,
          color: "$fgSoft",
          shadow: true,
          align: "center",
          fit: { mode: "shrink", minSize: 24 },
          box: { x: 0, y: 0, w: 700 },
        },
        watermark("wm", { x: 0, y: 0, w: 700 }, "center"),
      ],
    },
  ],
});

/** One day of the last seven: lit pill with a check when logged, a hollow pill when not, weekday underneath. */
function dayCell(i: number): LayerInput[] {
  const x = 72 + i * 136;
  const box = { x, y: 980, w: 120, h: 190 };
  return [
    { id: `cell-${i}-off`, type: "shape", shape: "rect", radius: 34, fill: "$surface", stroke: { color: "$line", width: 3 }, box, when: { bind: `streak.week.${i}`, eq: 0 } },
    { id: `cell-${i}-on`, type: "shape", shape: "rect", radius: 34, fill: "$accent", box, when: { bind: `streak.week.${i}`, eq: 1 } },
    { id: `cell-${i}-check`, type: "icon", name: "checkmark", color: "$bg", box: { x: x + 24, y: 1032, w: 72, h: 72 }, when: { bind: `streak.week.${i}`, eq: 1 } },
    {
      id: `cell-${i}-day`,
      type: "text",
      value: `{streak.weekDates.${i}|date:weekdayShort}`,
      size: 30,
      weight: 700,
      align: "center",
      color: "$fgMuted",
      box: { x, y: 1196, w: 120 },
    },
  ];
}

/** Bold story: the day count fills the frame, the week below is a row of cells, the next milestone is a bar. */
const streakBoldStory = defineTemplate({
  id: "streak.bold.story",
  kind: "streak",
  style: "bold",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["streak.days"],
  layers: [
    {
      id: "head",
      type: "group",
      box: { x: 72, y: 280, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "row", gap: 24, align: "center" },
      children: [
        {
          id: "eyebrow",
          type: "text",
          value: { t: "sticker:streak.eyebrow" },
          size: 36,
          weight: 800,
          case: "upper",
          letterSpacing: 6,
          color: "$accent2",
          box: { x: 0, y: 0, w: "auto" },
        },
        {
          id: "user",
          type: "text",
          value: "{user.name}",
          size: 34,
          weight: 700,
          color: "$fgSoft",
          align: "right",
          fit: { mode: "shrink", minSize: 24 },
          box: { x: 0, y: 0, w: "fill" },
        },
        { id: "date", type: "text", value: "{date|date:medium}", size: 34, weight: 600, color: "$fgMuted", when: { bind: "user.name", exists: true }, box: { x: 0, y: 0, w: "auto" } },
        { id: "date-solo", type: "text", value: "{date|date:medium}", size: 34, weight: 600, color: "$fgMuted", align: "right", when: { bind: "user.name", exists: false }, box: { x: 0, y: 0, w: "fill" } },
      ],
    },
    {
      id: "count",
      type: "stat",
      value: "{streak.days}",
      label: { t: "sticker:streak.days", args: { count: "{streak.days}" } },
      valueSize: 560,
      labelSize: 68,
      gap: 44,
      color: "$fg",
      labelColor: "$accent",
      box: { x: 72, y: 380, w: 936 },
    },
    ...DAYS.flatMap(dayCell),
    {
      id: "next",
      type: "group",
      box: { x: 72, y: 1290, w: 936, h: "auto" },
      when: { bind: "streak.toNext", exists: true },
      layout: { kind: "stack", dir: "column", gap: 26, align: "start" },
      children: [
        {
          id: "next-text",
          type: "text",
          value: { t: "sticker:streak.toNext", args: { count: "{streak.toNext}", next: "{streak.next}" } },
          size: 52,
          weight: 800,
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "next-bar",
          type: "chart",
          kind: "stack",
          barRadius: 14,
          segments: [
            { value: { bind: "streak.days", div: "streak.next", clamp: [0, 1] }, color: "$accent2" },
            { value: { bind: "streak.days", div: "streak.next", mul: -1, add: 1, clamp: [0, 1] }, color: "$surfaceStrong" },
          ],
          box: { x: 0, y: 0, w: 936, h: 28 },
        },
      ],
    },
    {
      id: "total",
      type: "text",
      value: { t: "sticker:streak.tracked", args: { count: "{streak.total}" } },
      size: 40,
      weight: 600,
      color: "$fgMuted",
      box: { x: 72, y: 1432, w: 936 },
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
  ],
});

/** Typographic poster on a solid leaf-green card: the number and the two words are the whole design. */
const streakPosterSquare = defineTemplate({
  id: "streak.poster.square",
  kind: "streak",
  style: "poster",
  canvas: "square",
  background: { kind: "color", color: "$accent" },
  // data1 doubles as the ink colour on the green card; the light card is a lighter leaf so the dark ink keeps its contrast.
  dark: { data1: "#0d1f12" },
  light: { accent: "#8fdc7a", data1: "#102a18" },
  requires: ["streak.days"],
  layers: [
    {
      id: "count",
      type: "stat",
      value: "{streak.days}",
      valueSize: 580,
      labelPos: "none",
      color: "$data1",
      box: { x: 60, y: 96, w: 960 },
    },
    {
      id: "words",
      type: "text",
      value: { t: "sticker:streak.days", args: { count: "{streak.days}" } },
      size: 124,
      weight: 800,
      case: "upper",
      lineHeight: 0.98,
      color: "$data1",
      fit: { mode: "wrap", maxLines: 2 },
      box: { x: 72, y: 570, w: 760 },
    },
    {
      id: "bottom",
      type: "group",
      box: { x: 72, y: 850, w: 936, h: 64 },
      when: { bind: "streak.toNext", exists: true },
      layout: { kind: "stack", dir: "row", gap: 18, align: "center" },
      children: [
        { id: "bottom-icon", type: "icon", name: "flame", color: "$data1", box: { x: 0, y: 0, w: 52, h: 52 } },
        {
          id: "bottom-text",
          type: "text",
          value: { t: "sticker:streak.toNext", args: { count: "{streak.toNext}", next: "{streak.next}" } },
          size: 42,
          weight: 700,
          color: "$data1",
          box: { x: 0, y: 0, w: "auto" },
        },
      ],
    },
    {
      id: "foot",
      type: "group",
      box: { x: 72, y: 952, w: 936, h: 56 },
      layout: { kind: "stack", dir: "row", gap: 20, align: "center" },
      children: [
        {
          id: "wm",
          type: "group",
          role: "watermark",
          box: { x: 0, y: 0, w: 560, h: 56 },
          layout: { kind: "stack", dir: "row", gap: 22, align: "center", justify: "start" },
          children: [
            { id: "wm-logo", type: "brand", mark: "lockup", size: 52, tone: "dark", box: { x: 0, y: 0 } },
            { id: "wm-link", type: "brand", mark: "link", tone: "dark", size: 30, box: { x: 0, y: 0 } },
          ],
        },
        {
          id: "foot-user",
          type: "text",
          value: "{user.name}",
          size: 38,
          weight: 700,
          color: "$data1",
          align: "right",
          fit: { mode: "shrink", minSize: 24 },
          box: { x: 0, y: 0, w: "fill" },
        },
      ],
    },
  ],
});

export const STREAK_TEMPLATES: TemplateInput[] = [streakBadgeSticker, streakBoldStory, streakPosterSquare];
