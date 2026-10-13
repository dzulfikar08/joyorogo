import { photoUrl, stickerUrl } from "@/components/sticker";

/**
 * Painters for the 1080x1920 story share. Three templates, Strava-style:
 *
 * - "photo": the user's photo full-bleed (the meal photo by default), minimal
 *   bold white stats overlaid in the lower safe zone, small brand mark.
 * - "sticker": the same stats on a fully transparent PNG, so Instagram (or
 *   any editor) lets the user place them over their own story.
 * - "brand": the JoyoRogo dark-leaf gradient card, self-contained.
 *
 * All content stays inside the Instagram UI safe zones (top 250 px, bottom
 * 340 px kept clear). Plain data in, PNG canvas out — the social feed can
 * reuse the same painters.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Instagram story UI safe zones: keep all content inside these bounds. */
const SAFE_TOP = 250;
const SAFE_BOTTOM = 1580;

const WHITE = "#ffffff";
const AMBER = "#f59e0b";
const ACCENT = "#7fd89b";
const ACCENT_SOFT = "#c9dccf";
const MARK_LIGHT = "#6cbf45";
const MARK_ON_DARK = "#e6f2df";
const BG_TOP = "#0d1f12";
const BG_BOTTOM = "#16402a";

const FONT = '"Plus Jakarta Sans Variable", Inter, system-ui, sans-serif';

export type StoryTemplate = "photo" | "sticker" | "brand";

export const STORY_TEMPLATES: Array<{
  id: StoryTemplate;
  label: string;
  hint: string;
  needsPhoto: boolean;
}> = [
  {
    id: "photo",
    label: "Foto + statistik",
    hint: "Foto pilihanmu jadi latar, angka di bawah.",
    needsPhoto: true,
  },
  {
    id: "sticker",
    label: "Statistik saja",
    hint: "PNG transparan, pasang sendiri di story.",
    needsPhoto: false,
  },
  {
    id: "brand",
    label: "Kartu brand",
    hint: "Kartu JoyoRogo utuh, tinggal posting.",
    needsPhoto: false,
  },
];

export type MealStory = {
  kind: "meal";
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** One-line reaction under the kcal, e.g. the scan page's "Aman, bro". */
  reaction?: string;
  /** Cutout/original photo of the meal; both keys resolve server-side. */
  scanId?: string | null;
  photoId?: string | null;
  /** Local photo (object URL / data URL) that wins over scanId/photoId. */
  photoSrc?: string | null;
  eyebrow?: string;
  date?: Date;
};

export type WorkoutPr = { exercise: string; label: string; value: string };

export type WorkoutStory = {
  kind: "workout";
  name: string;
  durationMin?: number | null;
  volumeKg?: number | null;
  setsDone?: number | null;
  prs?: WorkoutPr[];
  eyebrow?: string;
  date?: Date;
};

export type ProgressStory = {
  kind: "progress";
  eatenKcal: number;
  targetKcal: number;
  proteinG?: number | null;
  proteinTargetG?: number | null;
  streakDays?: number | null;
  weightLostKg?: number | null;
  /** Newest-last weigh-ins for the sparkline; drawn from 2 points up. */
  weekTrend?: Array<{ date: string; weightKg: number }>;
  eyebrow?: string;
  date?: Date;
};

export type StorySpec = MealStory | WorkoutStory | ProgressStory;

/** Default photo source for the story, or null when it has none. */
export function storyPhotoSrc(story: StorySpec): string | null {
  if (story.kind === "meal") {
    return (
      story.photoSrc ??
      (story.scanId ? stickerUrl(story.scanId) : null) ??
      (story.photoId ? photoUrl(story.photoId) : null)
    );
  }
  return null;
}

type IconNode = readonly [
  tag: string,
  attrs: Readonly<Record<string, string | number>>,
  children?: readonly IconNode[],
];

/** Lucide icon node trees for the few icons the card draws (ISC, lucide.dev). */
const CANVAS_ICONS = {
  flame: [
    [
      "path",
      {
        d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
      },
    ],
  ],
  "trending-down": [
    ["path", { d: "M16 17h6v-6" }],
    ["path", { d: "m22 17-8.5-8.5-5 5L2 7" }],
  ],
  drumstick: [
    ["path", { d: "M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" }],
    ["path", { d: "m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" }],
  ],
  trophy: [
    ["path", { d: "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" }],
    ["path", { d: "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" }],
    ["path", { d: "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" }],
    ["path", { d: "M4 22h16" }],
    ["path", { d: "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" }],
    ["path", { d: "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" }],
  ],
} as const satisfies Record<string, readonly IconNode[]>;

function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  nodes: readonly IconNode[],
  x: number,
  top: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const walk = (list: readonly IconNode[]) => {
    for (const [, attrs, children] of list) {
      ctx.beginPath();
      if (typeof attrs.d === "string") {
        ctx.stroke(new Path2D(attrs.d));
      }
      if (children) walk(children);
    }
  };
  walk(nodes);
  ctx.restore();
}

function iconText(
  ctx: CanvasRenderingContext2D,
  iconName: keyof typeof CANVAS_ICONS,
  text: string,
  x: number,
  baselineY: number,
  color: string,
  size = 56,
  font = `700 ${size}px ${FONT}`,
) {
  drawLucideIcon(ctx, CANVAS_ICONS[iconName], x, baselineY - size * 0.78, size, color);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(text, x + size + 24, baselineY);
}

// Same geometry as components/logo-mark.tsx / public/brand/logo-mark.svg:
// J and R (Plus Jakarta Sans ExtraBold, outlined) sharing one stem, a leaf
// sprouting from the J. Ported to Path2D so the canvas needs no network.
const MARK_R =
  "M62.92 102.27L48.66 102.27L48.66 33.73L74.88 33.73Q81.96 33.73 87.44 36.21Q92.91 38.70 96.04 43.57Q99.17 48.45 99.17 55.63Q99.17 62.62 95.95 67.54Q92.73 72.46 87.30 74.95L102.94 102.27L86.93 102.27L70 72L79.20 77.43L62.92 77.43L62.92 102.27M62.92 46.15L62.92 65.01L74.97 65.01Q78.01 65.01 80.22 63.81Q82.42 62.62 83.67 60.50Q84.91 58.39 84.91 55.63Q84.91 52.77 83.67 50.66Q82.42 48.54 80.22 47.35Q78.01 46.15 74.97 46.15";
const MARK_J =
  "M29.20 102.27L25.06 102.27L25.06 89.39L29.20 89.39Q33.34 89.39 35.87 87.04Q38.40 84.70 38.40 80.83L38.40 33.73L52.66 33.73L52.66 80.19Q52.66 86.81 49.81 91.78Q46.96 96.75 41.67 99.51Q36.38 102.27 29.20 102.27";

/** Draws the JoyoRogo logo mark with height `height`; returns its width. */
function drawLogoMark(ctx: CanvasRenderingContext2D, x: number, top: number, height: number) {
  const scale = height / 98;
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(scale, scale);
  ctx.fillStyle = MARK_LIGHT;
  ctx.fill(new Path2D(MARK_R));
  ctx.fillStyle = MARK_ON_DARK;
  ctx.fill(new Path2D(MARK_J));
  ctx.translate(49.66, 31.73);
  ctx.rotate((-10 * Math.PI) / 180);
  ctx.scale(0.55, 0.55);
  ctx.fillStyle = MARK_LIGHT;
  ctx.fill(new Path2D("M0 0 C6 -14 22 -22 38 -20 C36 -4 22 8 0 0 Z"));
  ctx.strokeStyle = "#1a2e1f";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M2 -1 C12 -7 22 -12 32 -17"));
  ctx.restore();
  return 88 * scale;
}

/** Small brand mark + wordmark for the photo/sticker overlays. Returns bottom y. */
function drawBrandTag(ctx: CanvasRenderingContext2D, x: number, top: number): number {
  const markH = 56;
  const markW = drawLogoMark(ctx, x, top, markH);
  ctx.fillStyle = WHITE;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText("JoyoRogo", x + markW + 20, top + markH * 0.8);
  return top + markH;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const path = new Path2D();
  path.roundRect(x, y, w, h, r);
  return path;
}

/** Truncates with an ellipsis so long food names never break the layout. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Wraps to at most two lines, ellipsizing the second; returns line texts. */
function wrapTwoLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(" ");
  let first = "";
  for (const word of words) {
    const candidate = first ? `${first} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && first) break;
    first = candidate;
  }
  const rest = text.slice(first.length).trim();
  return [first, fitText(ctx, rest, maxWidth)];
}

const idFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function letterspaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

async function loadBitmap(src: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(src, { credentials: "include" });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function loadStoryPhoto(story: StorySpec, overrideSrc?: string | null) {
  const src = overrideSrc ?? storyPhotoSrc(story);
  return src ? loadBitmap(src) : null;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  const path = new Path2D();
  path.roundRect(x, y, w, h, r);
  ctx.clip(path);
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Minimal stats overlay, shared by the photo and sticker templates.
// ---------------------------------------------------------------------------

const NAME_SIZE = 76;
const NAME_LINE = 92;
const KCAL_SIZE = 168;
const LABEL_SIZE = 46;

function macroLine(story: MealStory): string {
  return (
    (
      [
        ["P", story.protein],
        ["K", story.carbs],
        ["L", story.fat],
      ] as const
    )
      .flatMap(([label, value]) =>
        value == null ? [] : [`${label} ${idFmt.format(Math.round(value))} g`],
      )
      .join("   ·   ")
  );
}

/** Height of the stats block for the story kind, so callers can position it. */
function statsBlockHeight(ctx: CanvasRenderingContext2D, story: StorySpec): number {
  let height = 0;
  if (story.kind === "meal") {
    ctx.font = `800 ${NAME_SIZE}px ${FONT}`;
    height += wrapTwoLines(ctx, story.name, 912).length * NAME_LINE;
    height += KCAL_SIZE;
    if (macroLine(story)) height += 24 + LABEL_SIZE;
    if (story.reaction) height += 16 + LABEL_SIZE;
  } else if (story.kind === "workout") {
    ctx.font = `800 ${NAME_SIZE}px ${FONT}`;
    height += wrapTwoLines(ctx, story.name, 912).length * NAME_LINE;
    height += 30 + 128;
    if ((story.prs?.length ?? 0) > 0) height += 26 + LABEL_SIZE;
  } else {
    height += KCAL_SIZE;
    if (story.proteinG != null && story.proteinTargetG) height += 22 + LABEL_SIZE;
    if ((story.streakDays ?? 0) > 0) height += 18 + LABEL_SIZE;
    if ((story.weightLostKg ?? 0) > 0 && (story.weekTrend?.length ?? 0) === 0)
      height += 18 + LABEL_SIZE;
  }
  return height;
}

/** Draws the bold white stats block with its top edge at `top`. */
function drawStatsBlock(ctx: CanvasRenderingContext2D, story: StorySpec, x: number, top: number) {
  let cursor = top;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;

  if (story.kind === "meal" || story.kind === "workout") {
    ctx.fillStyle = WHITE;
    ctx.font = `800 ${NAME_SIZE}px ${FONT}`;
    for (const line of wrapTwoLines(ctx, story.name, 912)) {
      ctx.fillText(line, x, cursor + NAME_SIZE);
      cursor += NAME_LINE;
    }
  }

  if (story.kind === "progress") {
    ctx.fillStyle = WHITE;
    ctx.font = `800 ${KCAL_SIZE}px ${FONT}`;
    ctx.fillText(idFmt.format(story.eatenKcal), x, cursor + KCAL_SIZE * 0.9);
    const eatenW = ctx.measureText(idFmt.format(story.eatenKcal)).width;
    ctx.font = `600 44px ${FONT}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(
      `dari ${idFmt.format(story.targetKcal)} kcal`,
      x + eatenW + 24,
      cursor + KCAL_SIZE * 0.9,
    );
    cursor += KCAL_SIZE;
  } else if (story.kind === "meal") {
    ctx.fillStyle = WHITE;
    ctx.font = `800 ${KCAL_SIZE}px ${FONT}`;
    ctx.fillText(idFmt.format(Math.round(story.kcal)), x, cursor + KCAL_SIZE * 0.9);
    const kcalW = ctx.measureText(idFmt.format(Math.round(story.kcal))).width;
    ctx.font = `600 44px ${FONT}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText("kkal", x + kcalW + 24, cursor + KCAL_SIZE * 0.9);
    cursor += KCAL_SIZE;
  }

  if (story.kind === "meal") {
    const macros = macroLine(story);
    if (macros) {
      cursor += 24;
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.font = `700 ${LABEL_SIZE}px ${FONT}`;
      ctx.fillText(macros, x, cursor + LABEL_SIZE);
      cursor += LABEL_SIZE;
    }
    if (story.reaction) {
      cursor += 16;
      ctx.fillStyle = ACCENT;
      ctx.font = `700 ${LABEL_SIZE}px ${FONT}`;
      ctx.fillText(fitText(ctx, story.reaction, 912), x, cursor + LABEL_SIZE);
      cursor += LABEL_SIZE;
    }
  }

  if (story.kind === "workout") {
    cursor += 30;
    const stats = [
      { value: story.durationMin != null ? `${Math.round(story.durationMin)}` : null, label: "MENIT" },
      { value: story.volumeKg ? idFmt.format(Math.round(story.volumeKg)) : null, label: "KG VOLUME" },
      { value: story.setsDone != null ? `${Math.round(story.setsDone)}` : null, label: "SET" },
    ].filter((stat) => stat.value != null);
    const colW = 912 / Math.max(stats.length, 1);
    for (const [index, stat] of stats.entries()) {
      const cx = x + index * colW;
      ctx.font = `800 76px ${FONT}`;
      ctx.fillStyle = WHITE;
      ctx.fillText(fitText(ctx, stat.value!, colW - 32), cx, cursor + 76);
      ctx.font = `600 30px ${FONT}`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
      letterspaced(ctx, stat.label, cx, cursor + 120, 4);
    }
    cursor += 128;
    if ((story.prs?.length ?? 0) > 0) {
      cursor += 26;
      iconText(
        ctx,
        "trophy",
        `${story.prs!.length} rekor baru`,
        x,
        cursor + LABEL_SIZE,
        AMBER,
        44,
        `800 ${LABEL_SIZE}px ${FONT}`,
      );
      cursor += LABEL_SIZE;
    }
  }

  if (story.kind === "progress") {
    if (story.proteinG != null && story.proteinTargetG) {
      cursor += 22;
      iconText(
        ctx,
        "drumstick",
        `Protein ${idFmt.format(story.proteinG)} / ${idFmt.format(story.proteinTargetG)} g`,
        x,
        cursor + LABEL_SIZE,
        WHITE,
        42,
        `700 ${LABEL_SIZE}px ${FONT}`,
      );
      cursor += LABEL_SIZE;
    }
    if ((story.streakDays ?? 0) > 0) {
      cursor += 18;
      drawLucideIcon(ctx, CANVAS_ICONS.flame, x, cursor + LABEL_SIZE - 42 * 0.78, 42, AMBER);
      ctx.fillStyle = WHITE;
      ctx.font = `700 ${LABEL_SIZE}px ${FONT}`;
      ctx.fillText(`${story.streakDays} hari berturut-turut`, x + 42 + 24, cursor + LABEL_SIZE);
      cursor += LABEL_SIZE;
    }
    if ((story.weightLostKg ?? 0) > 0 && (story.weekTrend?.length ?? 0) === 0) {
      cursor += 18;
      iconText(
        ctx,
        "trending-down",
        `Turun ${idFmt.format(story.weightLostKg!)} kg dari berat awal`,
        x,
        cursor + LABEL_SIZE,
        WHITE,
        42,
        `600 ${LABEL_SIZE}px ${FONT}`,
      );
      cursor += LABEL_SIZE;
    }
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Ring showing kcal vs target, top-right of the safe area. */
function drawTargetRing(ctx: CanvasRenderingContext2D, story: ProgressStory) {
  const cx = 880;
  const cy = 460;
  const r = 118;
  const pct = story.targetKcal > 0 ? Math.min(story.eatenKcal / story.targetKcal, 1) : 0;
  ctx.lineCap = "round";
  ctx.lineWidth = 18;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = pct >= 1 ? "#ef4444" : pct >= 0.9 ? AMBER : ACCENT;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.font = `800 60px ${FONT}`;
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 16;
  ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy + 20);
  ctx.textAlign = "left";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Template painters
// ---------------------------------------------------------------------------

function drawPhotoTemplate(ctx: CanvasRenderingContext2D, story: StorySpec, photo: ImageBitmap) {
  drawCover(ctx, photo, 0, 0, STORY_W, STORY_H, 0);
  const scrim = ctx.createLinearGradient(0, STORY_H * 0.45, 0, STORY_H);
  scrim.addColorStop(0, "rgba(0, 0, 0, 0)");
  scrim.addColorStop(1, "rgba(0, 0, 0, 0.72)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, STORY_H * 0.45, STORY_W, STORY_H * 0.55);
  const topScrim = ctx.createLinearGradient(0, 0, 0, 420);
  topScrim.addColorStop(0, "rgba(0, 0, 0, 0.4)");
  topScrim.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, STORY_W, 420);

  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  drawBrandTag(ctx, 84, SAFE_TOP + 40);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const blockH = statsBlockHeight(ctx, story);
  drawStatsBlock(ctx, story, 84, SAFE_BOTTOM - blockH);
  if (story.kind === "progress") drawTargetRing(ctx, story);
}

function drawStickerTemplate(ctx: CanvasRenderingContext2D, story: StorySpec) {
  // Transparent background: only the mark and the stats block, so the PNG can
  // be dropped over any story.
  const blockH = statsBlockHeight(ctx, story);
  const tagH = 96;
  const top = SAFE_TOP + (SAFE_BOTTOM - SAFE_TOP - blockH - tagH) / 2;
  drawBrandTag(ctx, 84, top);
  drawStatsBlock(ctx, story, 84, top + tagH);
  if (story.kind === "progress") drawTargetRing(ctx, story);
}

function drawBrandChrome(ctx: CanvasRenderingContext2D, eyebrow: string, date?: Date) {
  const grad = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  for (const [cx, cy, radius] of [
    [980, 120, 420],
    [60, 1180, 380],
  ] as const) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, "rgba(127, 216, 155, 0.10)");
    glow.addColorStop(1, "rgba(127, 216, 155, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const markH = 84;
  const markW = drawLogoMark(ctx, 84, 96, markH);
  ctx.fillStyle = MARK_ON_DARK;
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText("JoyoRogo", 84 + markW + 24, 96 + markH * 0.78);

  ctx.fillStyle = ACCENT;
  ctx.font = `700 34px ${FONT}`;
  letterspaced(ctx, eyebrow.toUpperCase(), 90, 300, 8);

  if (date) {
    ctx.fillStyle = ACCENT_SOFT;
    ctx.font = `500 34px ${FONT}`;
    ctx.fillText(dateFmt.format(date), 90, 360);
  }

  ctx.fillStyle = ACCENT;
  ctx.font = `600 32px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("joyorogo.com", STORY_W / 2, 1852);
  ctx.textAlign = "left";
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string,
) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fill(roundRectPath(ctx, x, y, w, h, h / 2));
  const fillW = Math.max(h, Math.min(1, Math.max(0, ratio)) * w);
  ctx.fillStyle = color;
  ctx.fill(roundRectPath(ctx, x, y, fillW, h, h / 2));
}

function drawBrandMeal(ctx: CanvasRenderingContext2D, story: MealStory, photo: ImageBitmap | null) {
  const photoBox = { x: 160, y: photo ? 400 : 0, w: 760, h: photo ? 760 : 0 };
  let cursor = photo ? photoBox.y + photoBox.h + 70 : 560;

  if (photo) {
    drawCover(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h, 48);
  }

  ctx.fillStyle = WHITE;
  const nameSize = photo ? 60 : 84;
  ctx.font = `800 ${nameSize}px ${FONT}`;
  const nameLines = wrapTwoLines(ctx, story.name, 900);
  nameLines.forEach((line, index) => {
    ctx.fillText(line, 90, cursor + index * (nameSize + 14));
  });
  cursor += nameLines.length * (nameSize + 14) + (photo ? 42 : 76);

  ctx.font = `800 ${photo ? 140 : 200}px ${FONT}`;
  ctx.fillStyle = WHITE;
  ctx.fillText(idFmt.format(Math.round(story.kcal)), 90, cursor + (photo ? 120 : 170));
  const kcalX = 90 + ctx.measureText(idFmt.format(Math.round(story.kcal))).width + 28;
  ctx.fillStyle = ACCENT_SOFT;
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText("kcal", kcalX, cursor + (photo ? 120 : 170));
  cursor += photo ? 185 : 270;

  if (story.reaction) {
    ctx.fillStyle = ACCENT;
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(fitText(ctx, story.reaction, 900), 90, cursor);
    cursor += 88;
  }

  const macros = [
    ["P", story.protein],
    ["K", story.carbs],
    ["L", story.fat],
  ] as const;
  const chipH = 84;
  let chipX = 90;
  for (const [label, value] of macros) {
    if (value == null) continue;
    ctx.font = `700 40px ${FONT}`;
    const text = `${label} ${idFmt.format(Math.round(value))} g`;
    const chipW = ctx.measureText(text).width + 72;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fill(roundRectPath(ctx, chipX, cursor, chipW, chipH, chipH / 2));
    ctx.fillStyle = ACCENT;
    ctx.fillText(label, chipX + 36, cursor + chipH * 0.66);
    ctx.fillStyle = WHITE;
    ctx.fillText(
      `${idFmt.format(Math.round(value))} g`,
      chipX + 36 + ctx.measureText(`${label} `).width + 14,
      cursor + chipH * 0.66,
    );
    chipX += chipW + 24;
  }
}

function drawBrandWorkout(ctx: CanvasRenderingContext2D, story: WorkoutStory) {
  let cursor = 500;

  ctx.fillStyle = WHITE;
  ctx.font = `800 84px ${FONT}`;
  const titleLines = wrapTwoLines(ctx, story.name, 900);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, 90, cursor + index * 98);
  });
  cursor += titleLines.length * 98 + 42;

  const stats = [
    { value: story.durationMin != null ? `${Math.round(story.durationMin)}` : null, label: "menit" },
    { value: story.volumeKg ? idFmt.format(Math.round(story.volumeKg)) : null, label: "kg volume" },
    { value: story.setsDone != null ? `${Math.round(story.setsDone)}` : null, label: "set selesai" },
  ].filter((stat) => stat.value != null);
  const colW = 900 / Math.max(stats.length, 1);
  const statSize = stats.length >= 3 ? 84 : 100;
  for (const [index, stat] of stats.entries()) {
    const x = 90 + index * colW;
    ctx.fillStyle = WHITE;
    ctx.font = `800 ${statSize}px ${FONT}`;
    ctx.fillText(fitText(ctx, stat.value!, colW - 16), x, cursor);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.font = `500 38px ${FONT}`;
    ctx.fillText(stat.label, x, cursor + 58);
  }
  if (stats.length > 0) cursor += 160;

  if (story.prs && story.prs.length > 0) {
    cursor += 80;
    iconText(ctx, "trophy", "Rekor baru", 90, cursor, AMBER, 56, `800 56px ${FONT}`);
    cursor += 96;
    for (const pr of story.prs.slice(0, 4)) {
      drawLucideIcon(ctx, CANVAS_ICONS.trophy, 94, cursor - 42 * 0.78, 34, AMBER);
      ctx.fillStyle = WHITE;
      ctx.font = `700 42px ${FONT}`;
      const nameW = ctx.measureText(pr.exercise).width;
      ctx.fillText(fitText(ctx, pr.exercise, 800), 148, cursor);
      ctx.fillStyle = ACCENT_SOFT;
      ctx.font = `500 42px ${FONT}`;
      ctx.fillText(fitText(ctx, `— ${pr.label}: ${pr.value}`, 860 - nameW), 148 + nameW + 12, cursor);
      cursor += 76;
    }
  }
}

function drawBrandProgress(ctx: CanvasRenderingContext2D, story: ProgressStory) {
  let cursor = 480;

  ctx.fillStyle = WHITE;
  ctx.font = `800 170px ${FONT}`;
  ctx.fillText(idFmt.format(story.eatenKcal), 90, cursor + 130);
  const kcalX = 90 + ctx.measureText(idFmt.format(story.eatenKcal)).width + 28;
  ctx.fillStyle = ACCENT_SOFT;
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText(`dari ${idFmt.format(story.targetKcal)} kcal`, kcalX, cursor + 130);
  cursor += 220;

  const pct = story.targetKcal > 0 ? story.eatenKcal / story.targetKcal : 0;
  drawBar(ctx, 90, cursor, 900, 28, pct, pct > 1 ? "#ef4444" : pct >= 0.9 ? AMBER : ACCENT);
  cursor += 130;

  if (story.proteinG != null && story.proteinTargetG) {
    iconText(
      ctx,
      "drumstick",
      `Protein ${idFmt.format(story.proteinG)} / ${idFmt.format(story.proteinTargetG)} g`,
      90,
      cursor,
      WHITE,
      48,
      `700 48px ${FONT}`,
    );
    cursor += 74;
    drawBar(ctx, 90, cursor, 900, 16, story.proteinG / story.proteinTargetG, ACCENT);
    cursor += 120;
  }

  if ((story.streakDays ?? 0) > 0) {
    iconText(
      ctx,
      "flame",
      `${story.streakDays} hari berturut-turut`,
      90,
      cursor,
      AMBER,
      56,
      `800 56px ${FONT}`,
    );
    cursor += 140;
  }

  const trend = [...(story.weekTrend ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (trend.length >= 2) {
    const weights = trend.map((point) => point.weightKg);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const span = Math.max(max - min, 0.4);
    const chartX = 90;
    const chartY = cursor;
    const chartW = 900;
    const chartH = 200;
    const pointAt = (index: number) => ({
      x: chartX + (index / (weights.length - 1)) * chartW,
      y: chartY + chartH - ((weights[index]! - min) / span) * (chartH - 24) - 12,
    });
    ctx.beginPath();
    for (const [index] of weights.entries()) {
      const point = pointAt(index);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.stroke();
    for (const index of [0, weights.length - 1]) {
      const point = pointAt(index);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }
    const delta = Math.round((weights[weights.length - 1]! - weights[0]!) * 10) / 10;
    cursor = chartY + chartH + 96;
    if (delta < 0) {
      iconText(
        ctx,
        "trending-down",
        `Turun ${idFmt.format(Math.abs(delta))} kg minggu ini`,
        90,
        cursor,
        WHITE,
        52,
        `700 52px ${FONT}`,
      );
    } else if (delta > 0) {
      ctx.fillStyle = ACCENT_SOFT;
      ctx.font = `700 52px ${FONT}`;
      ctx.fillText(`+${idFmt.format(delta)} kg minggu ini`, 90, cursor);
    }
  } else if ((story.weightLostKg ?? 0) > 0) {
    iconText(
      ctx,
      "trending-down",
      `Turun ${idFmt.format(story.weightLostKg!)} kg dari berat awal`,
      90,
      cursor,
      WHITE,
      52,
      `700 52px ${FONT}`,
    );
  }
}

async function ensureFonts() {
  await Promise.all(
    [400, 500, 600, 700, 800].map((weight) =>
      document.fonts.load(`${weight} 40px "Plus Jakarta Sans Variable"`).catch(() => {}),
    ),
  );
}

/**
 * Renders `story` onto `canvas` (resized to 1080x1920) with the given
 * template and resolves when done. Defaults to the brand card.
 */
export async function drawStoryCard(
  canvas: HTMLCanvasElement,
  story: StorySpec,
  template: StoryTemplate = "brand",
  photoOverrideSrc?: string | null,
): Promise<void> {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas.");
  ctx.clearRect(0, 0, STORY_W, STORY_H);
  await ensureFonts();

  if (template === "sticker") {
    drawStickerTemplate(ctx, story);
    return;
  }

  const photo = await loadStoryPhoto(story, photoOverrideSrc);
  if (template === "photo" && photo) {
    drawPhotoTemplate(ctx, story, photo);
    return;
  }

  drawBrandChrome(ctx, story.eyebrow ?? EYEBROWS[story.kind], story.date ?? new Date());
  if (story.kind === "meal") {
    drawBrandMeal(ctx, story, photo);
  } else if (story.kind === "workout") {
    drawBrandWorkout(ctx, story);
  } else {
    drawBrandProgress(ctx, story);
  }
}

const EYEBROWS = {
  meal: "Makan hari ini",
  workout: "Sesi latihan",
  progress: "Progres hari ini",
} as const;

/** Default share copy per card, matching the app's casual voice. */
export function defaultShareText(story: StorySpec): string {
  if (story.kind === "meal") {
    return `${story.name}, ${idFmt.format(Math.round(story.kcal))} kcal. Tahu boleh makan apa hari ini? Cek JoyoRogo.`;
  }
  if (story.kind === "workout") {
    return `Baru selesai latihan: ${story.name}. Catat latihanmu di JoyoRogo.`;
  }
  const lost = story.weightLostKg ?? 0;
  return lost > 0
    ? `Sudah turun ${idFmt.format(lost)} kg. Turun berat pakai 3 angka aja di JoyoRogo.`
    : "Turun berat pakai 3 angka aja: makan, bakar, tidur. JoyoRogo.";
}
