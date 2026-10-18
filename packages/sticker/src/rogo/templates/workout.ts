import type { Condition } from "../../core/expr";
import type { LayerInput, TemplateInput } from "../../core/schema";
import { BRAND_GRADIENT, defineTemplate, photoBackground, ROGO_DARK, watermark } from "../kit";
import { INK, INK_SOFT, receiptPaper, receiptRow, receiptRule } from "../receipt";

const has = (bind: string): Condition => ({ bind, exists: true });
const PRS = ["pr0", "pr1", "pr2"] as const;

const VOLUME = has("workout.volumeKg");
const DURATION = has("workout.durationMin");
const SETS = has("workout.sets");
const RECORDS = has("workout.prCount");

const ANY_STAT: Condition = { any: [VOLUME, DURATION, SETS] };
const MINUTES = { t: "sticker:workout.minutesValue", args: { min: "{workout.durationMin|int}" } };

/** Hero numeral: volume, else duration, else sets. Exactly one of the three is visible. */
function heroStats(id: string, box: { x: number; y: number; w: number }, size: number, extra: Partial<LayerInput> = {}): LayerInput[] {
  const common = { labelSize: Math.round(size * 0.16), gap: Math.round(size * 0.12), box, ...extra };
  return [
    {
      id: `${id}-volume`,
      type: "stat",
      value: "{workout.volumeKg|int}",
      unit: { t: "sticker:common.kg" },
      unitSize: Math.round(size * 0.3),
      label: { t: "sticker:workout.volume" },
      valueSize: size,
      when: VOLUME,
      ...common,
    },
    {
      id: `${id}-duration`,
      type: "stat",
      value: "{workout.durationMin|int}",
      unit: { t: "sticker:common.minutes" },
      unitSize: Math.round(size * 0.3),
      label: { t: "sticker:workout.duration" },
      valueSize: size,
      when: { all: [DURATION, { not: VOLUME }] },
      ...common,
    },
    {
      id: `${id}-sets`,
      type: "stat",
      value: "{workout.sets|int}",
      label: { t: "sticker:workout.sets" },
      valueSize: size,
      when: { all: [SETS, { not: VOLUME }, { not: DURATION }] },
      ...common,
    },
  ] as LayerInput[];
}

/** Secondary stat (the hero already shows the one it replaces). */
function miniStat(
  id: string,
  when: Condition,
  value: string,
  unit: LayerInput extends never ? never : unknown,
  labelKey: string,
  w: number,
  size: number,
  color: string,
  labelColor: string,
  extra: Partial<LayerInput> = {},
): LayerInput {
  return {
    id,
    type: "stat",
    value,
    ...(unit ? { unit } : {}),
    label: { t: labelKey },
    labelPos: "above",
    valueSize: size,
    unitSize: Math.round(size * 0.4),
    labelSize: 30,
    gap: 12,
    color,
    labelColor,
    when,
    box: { x: 0, y: 0, w },
    ...extra,
  } as LayerInput;
}

const dateText = (id: string, box: { x: number; y: number; w: number | "auto" }, extra: Partial<LayerInput> = {}): LayerInput =>
  ({ id, type: "text", value: "{date|date:medium}", size: 34, weight: 600, color: "$fgMuted", box, ...extra }) as LayerInput;

/** PR cards: trophy, exercise, record value. Each hides alone when its PR is absent. */
function prCards(prefix: string, w: number, opts: { fill: string; glass?: boolean; size: number; pad: number }): LayerInput[] {
  return PRS.map(
    (key) =>
      ({
        id: `${prefix}-${key}`,
        type: "group",
        when: has(`workout.${key}.exercise`),
        box: { x: 0, y: 0, w, h: "auto" },
        fill: opts.fill,
        glass: opts.glass,
        radius: 32,
        layout: { kind: "stack", dir: "row", gap: 22, align: "center", padding: opts.pad },
        children: [
          { id: `${prefix}-${key}-icon`, type: "icon", name: "trophy", color: "$accent2", box: { x: 0, y: 0, w: 56, h: 56 } },
          {
            id: `${prefix}-${key}-name`,
            type: "text",
            value: `{workout.${key}.exercise}`,
            size: opts.size,
            weight: 700,
            color: "$fg",
            fit: { mode: "ellipsis" },
            box: { x: 0, y: 0, w: "fill" },
          },
          {
            id: `${prefix}-${key}-value`,
            type: "text",
            value: `{workout.${key}.value}`,
            size: opts.size - 4,
            weight: 800,
            color: "$accent2",
            align: "right",
            box: { x: 0, y: 0, w: "auto" },
          },
        ],
      }) as LayerInput,
  );
}

/** Bold: the volume is the poster; stats and records stack under it and reflow when absent. */
const workoutBoldStory = defineTemplate({
  id: "workout.bold.story",
  kind: "workout",
  style: "bold",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["workout.name"],
  layers: [
    {
      id: "eyebrow",
      type: "text",
      value: { t: "sticker:workout.eyebrow" },
      size: 36,
      weight: 800,
      case: "upper",
      letterSpacing: 6,
      color: "$accent",
      box: { x: 72, y: 280, w: 480 },
    },
    dateText("date", { x: 508, y: 282, w: 500 }, { align: "right" }),
    {
      id: "body",
      type: "group",
      box: { x: 72, y: 410, w: 936, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 56, align: "start" },
      children: [
        {
          id: "name",
          type: "text",
          value: "{workout.name}",
          size: 92,
          weight: 800,
          fit: { mode: "shrink", minSize: 50 },
          when: ANY_STAT,
          box: { x: 0, y: 0, w: 936 },
        },
        {
          id: "name-solo",
          type: "text",
          value: "{workout.name}",
          size: 170,
          weight: 800,
          lineHeight: 1.02,
          fit: { mode: "wrap", maxLines: 3, minSize: 80 },
          when: { not: ANY_STAT },
          box: { x: 0, y: 0, w: 936 },
        },
        ...heroStats("hero", { x: 0, y: 0, w: 936 }, 280, { trim: "cap" }),
        {
          id: "stats",
          type: "group",
          when: { any: [{ all: [VOLUME, DURATION] }, { all: [SETS, { any: [VOLUME, DURATION] }] }, RECORDS] },
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 24, align: "start" },
          children: [
            miniStat("s-duration", { all: [VOLUME, DURATION] }, "{workout.durationMin|int}", { t: "sticker:common.minutes" }, "sticker:workout.duration", 330, 96, "$fg", "$fgMuted"),
            miniStat("s-sets", { all: [SETS, { any: [VOLUME, DURATION] }] }, "{workout.sets|int}", undefined, "sticker:workout.sets", 250, 96, "$fg", "$fgMuted"),
            miniStat("s-records", RECORDS, "{workout.prCount|int}", undefined, "sticker:workout.records", 330, 96, "$accent2", "$fgMuted"),
          ],
        },
        {
          id: "prs",
          type: "group",
          when: RECORDS,
          box: { x: 0, y: 0, w: 936, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 16, align: "start" },
          children: [
            {
              id: "prs-title",
              type: "text",
              value: { t: "sticker:workout.recordsTitle" },
              size: 32,
              weight: 800,
              case: "upper",
              letterSpacing: 5,
              color: "$accent2",
              box: { x: 0, y: 0, w: 936 },
            },
            ...prCards("pr", 936, { fill: "$surface", size: 42, pad: 26 }),
          ],
        },
      ],
    },
    watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
    {
      id: "name-user",
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

/** Receipt: thermal strip, dotted rows, REKOR BARU lines and the total at the foot. */
function receiptBody(): LayerInput {
  const W = 732;
  const mono = (id: string, value: LayerInput["value" & keyof LayerInput] | unknown, size: number, weight: number, extra: Record<string, unknown> = {}): LayerInput =>
    ({ id, type: "text", value, font: "mono", size, weight, color: INK, align: "center", box: { x: 0, y: 0, w: W }, ...extra }) as LayerInput;
  const row = (id: string, label: unknown, value: unknown, when: Condition, size = 36): LayerInput => ({
    ...receiptRow(id, 0, 0, W, label as never, value as never, size),
    when,
  });
  return {
    id: "r-body",
    type: "group",
    box: { x: 64, y: 84, w: W, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 22, align: "start" },
    children: [
      mono("r-brand", "JoyoRogo", 30, 700, { letterSpacing: 8, color: INK_SOFT, case: "upper" }),
      mono("r-title", { t: "sticker:workout.receipt.title" }, 44, 800, { case: "upper", letterSpacing: 2 }),
      mono("r-name", "{workout.name}", 52, 700, { fit: { mode: "shrink", minSize: 28 } }),
      {
        id: "r-when",
        type: "group",
        box: { x: 0, y: 0, w: W, h: "auto" },
        layout: { kind: "stack", dir: "row", gap: 24, align: "center", justify: "center" },
        children: [
          mono("r-user", "{user.name}", 30, 700, { box: { x: 0, y: 0, w: "auto" }, fit: { mode: "shrink", minSize: 24 } }),
          mono("r-date", "{date|date:medium}", 30, 500, { color: INK_SOFT, box: { x: 0, y: 0, w: "auto" } }),
        ],
      },
      receiptRule("r-rule1", 0, 0, W),
      row("r-duration", { t: "sticker:workout.duration" }, MINUTES, DURATION),
      row("r-sets", { t: "sticker:workout.sets" }, "{workout.sets|int}", SETS),
      { ...receiptRule("r-rule2", 0, 0, W), when: RECORDS },
      { ...mono("r-records", { t: "sticker:workout.prNew" }, 34, 800, { align: "left", case: "upper", letterSpacing: 4 }), when: RECORDS },
      ...PRS.map((key) => row(`r-${key}`, `{workout.${key}.exercise}`, `{workout.${key}.value}`, has(`workout.${key}.exercise`), 32)),
      { ...receiptRule("r-rule3", 0, 0, W), when: { any: [VOLUME, DURATION] } },
      row("r-total-volume", { t: "sticker:workout.volume" }, { t: "sticker:workout.volumeValue", args: { kg: "{workout.volumeKg|int}" } }, VOLUME, 50),
      row("r-total-duration", { t: "sticker:workout.duration" }, MINUTES, { all: [DURATION, { not: VOLUME }] }, 50),
    ],
  };
}

const workoutReceiptStory = defineTemplate({
  id: "workout.receipt.story",
  kind: "workout",
  style: "receipt",
  canvas: "story",
  background: BRAND_GRADIENT,
  requires: ["workout.name"],
  layers: [
    ...receiptPaper(
      "paper",
      { x: 120, y: 320, w: 840, h: 1100 },
      [
        receiptBody(),
        {
          id: "r-thanks",
          type: "text",
          value: { t: "sticker:workout.receipt.thanks" },
          font: "mono",
          size: 28,
          weight: 500,
          color: INK_SOFT,
          align: "center",
          case: "upper",
          letterSpacing: 3,
          box: { x: 64, y: 1000, w: 732 },
        },
      ],
      -1.5,
    ),
    watermark("wm", { x: 72, y: 1510, w: 936 }, "center"),
  ],
});

/** Column for sticker ink: the label is its own shadowed text since stat labels carry no shadow. */
function shadowStat(id: string, when: Condition, value: string, unit: unknown, labelKey: string, w: number, size: number): LayerInput {
  return {
    id,
    type: "group",
    when,
    box: { x: 0, y: 0, w, h: "auto" },
    layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
    children: [
      { id: `${id}-label`, type: "text", value: { t: labelKey }, size: 30, weight: 700, shadow: true, box: { x: 0, y: 0, w } },
      {
        id: `${id}-stat`,
        type: "stat",
        value,
        ...(unit ? { unit } : {}),
        labelPos: "none",
        valueSize: size,
        unitSize: Math.round(size * 0.4),
        shadow: true,
        fit: { mode: "shrink" },
        box: { x: 0, y: 0, w },
      },
    ],
  } as LayerInput;
}

/** Minimal sticker: ink straight on the photo, name over one tidy row of numbers. */
const workoutMinimalSticker = defineTemplate({
  id: "workout.minimal.sticker",
  kind: "workout",
  style: "minimal",
  canvas: { sticker: 420 },
  requires: ["workout.name"],
  layers: [
    {
      id: "body",
      type: "group",
      box: { x: 90, y: 50, w: 900, h: "auto" },
      layout: { kind: "stack", dir: "column", gap: 26, align: "start" },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: 900, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 18, align: "center" },
          children: [
            { id: "head-name", type: "text", value: "{workout.name}", size: 54, weight: 800, shadow: true, fit: { mode: "ellipsis" }, box: { x: 0, y: 0, w: "fill" } },
          ],
        },
        { id: "rule", type: "shape", shape: "line", stroke: { color: "$line", width: 3 }, when: ANY_STAT, box: { x: 0, y: 0, w: 900, h: 0 } },
        {
          id: "nums",
          type: "group",
          box: { x: 0, y: 0, w: 900, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 56, align: "end" },
          children: [
            shadowStat("n-volume", VOLUME, "{workout.volumeKg|int}", { t: "sticker:common.kg" }, "sticker:workout.volume", 430, 140),
            shadowStat("n-duration", DURATION, "{workout.durationMin|int}", { t: "sticker:common.minutes" }, "sticker:workout.duration", 250, 80),
            shadowStat("n-sets", SETS, "{workout.sets|int}", undefined, "sticker:workout.sets", 130, 80),
          ],
        },
      ],
    },
  ],
});

/** Glass: one frosted card low on the photo; name, numbers, record rows. */
const workoutGlassStory = defineTemplate({
  id: "workout.glass.story",
  kind: "workout",
  style: "glass",
  canvas: "story",
  background: photoBackground(0.7),
  light: ROGO_DARK,
  requires: ["workout.name"],
  layers: [
    {
      id: "card",
      type: "group",
      box: { x: 72, y: 760, w: 936, h: "auto" },
      fill: "$bg/58",
      glass: true,
      radius: 56,
      layout: { kind: "stack", dir: "column", gap: 40, align: "start", padding: 56 },
      children: [
        {
          id: "head",
          type: "group",
          box: { x: 0, y: 0, w: 824, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 16, align: "center" },
          children: [
            { id: "head-icon", type: "icon", name: "barbell", color: "$accent", box: { x: 0, y: 0, w: 44, h: 44 } },
            { id: "head-eyebrow", type: "text", value: { t: "sticker:workout.eyebrow" }, size: 30, weight: 800, case: "upper", letterSpacing: 5, color: "$accent", box: { x: 0, y: 0, w: "fill" } },
            dateText("head-date", { x: 0, y: 0, w: "auto" }, { size: 30, align: "right" }),
          ],
        },
        { id: "name", type: "text", value: "{workout.name}", size: 84, weight: 800, fit: { mode: "shrink", minSize: 48 }, box: { x: 0, y: 0, w: 824 } },
        {
          id: "stats",
          type: "group",
          when: { any: [VOLUME, DURATION, SETS] },
          box: { x: 0, y: 0, w: 824, h: "auto" },
          layout: { kind: "stack", dir: "row", gap: 40, align: "start" },
          children: [
            miniStat("g-volume", VOLUME, "{workout.volumeKg|int}", { t: "sticker:common.kg" }, "sticker:workout.volume", 380, 96, "$fg", "$fgMuted"),
            miniStat("g-duration", DURATION, "{workout.durationMin|int}", { t: "sticker:common.minutes" }, "sticker:workout.duration", 250, 96, "$fg", "$fgMuted"),
            miniStat("g-sets", SETS, "{workout.sets|int}", undefined, "sticker:workout.sets", 150, 96, "$fg", "$fgMuted"),
          ],
        },
        {
          id: "prs",
          type: "group",
          when: RECORDS,
          box: { x: 0, y: 0, w: 824, h: "auto" },
          layout: { kind: "stack", dir: "column", gap: 14, align: "start" },
          children: prCards("pr", 824, { fill: "$fg/10", size: 38, pad: 24 }),
        },
      ],
    },
    {
      ...watermark("wm", { x: 72, y: 1510, w: 936 }, "start"),
      children: [
        { id: "wm-logo", type: "brand", mark: "lockup", size: 52, tone: "light", box: { x: 0, y: 0 } },
        { id: "wm-link", type: "brand", mark: "link", tone: "light", size: 30, box: { x: 0, y: 0 } },
      ],
    } as LayerInput,
    {
      id: "name-user",
      type: "text",
      value: "{user.name}",
      size: 34,
      weight: 700,
      color: "$fgMuted",
      align: "right",
      shadow: true,
      fit: { mode: "shrink", minSize: 24 },
      box: { x: 608, y: 1518, w: 400 },
    },
  ],
});

export const WORKOUT_TEMPLATES: TemplateInput[] = [workoutBoldStory, workoutReceiptStory, workoutMinimalSticker, workoutGlassStory];
