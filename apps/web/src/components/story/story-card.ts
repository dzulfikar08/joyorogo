import { MACRO_META } from "@/lib/macro-icons";
import { photoUrl, stickerUrl } from "@/components/sticker";

/**
 * Painters for the 1080x1920 story share. Three templates, Strava-style:
 *
 * - "photo": the user's photo full-bleed (a cutout sits on the brand gradient
 *   instead), the stats block anchored to the bottom of the Instagram safe
 *   area over a soft scrim.
 * - "sticker": the same stats block on a fully transparent PNG, centered, so
 *   Instagram (or any editor) lets the user place it over their own story.
 * - "brand": the JoyoRogo dark-leaf gradient card, self-contained.
 *
 * Every template shares one stats block (eyebrow, title, one big primary
 * metric, a 3-column secondary grid with icons, date + brand footer) and keeps
 * all content inside the Instagram UI safe zones (top 250 px, bottom 340 px
 * stay clear). apps/native/components/story/story-card.tsx is the view-based
 * twin: keep the numbers below in sync with it. Plain data in, PNG canvas out;
 * the social feed can reuse the same painters.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Instagram story UI safe zones: keep all content inside these bounds. */
const SAFE_TOP = 250;
const SAFE_BOTTOM = 1580;
const PAD = 72;
const CONTENT_W = STORY_W - PAD * 2;
const GRID_COL_W = CONTENT_W / 3;

const WHITE = "#ffffff";
const WHITE_SOFT = "rgba(255, 255, 255, 0.82)";
const RULE = "rgba(255, 255, 255, 0.28)";
const OVERLAY_RULE = "rgba(255, 255, 255, 0.6)";
const TRACK = "rgba(255, 255, 255, 0.24)";
const AMBER = "#f59e0b";
const OVER = "#f87171";
const ACCENT = "#7fd89b";
const MARK_LIGHT = "#6cbf45";
const MARK_ON_DARK = "#e6f2df";
const BG_TOP = "#0d1f12";
const BG_BOTTOM = "#16402a";
const PILL_BG = "rgba(0, 0, 0, 0.36)";
const MUTED = "rgba(255, 255, 255, 0.72)";
/** Text over photos and the sticker is brighter than on the card, and drops the mint accent, which washes out on light photos. */
const OVERLAY_SOFT = "rgba(255, 255, 255, 0.95)";
const OVERLAY_MUTED = "rgba(255, 255, 255, 0.86)";
const SHADOW = "rgba(0, 0, 0, 0.8)";

const FONT = '"Plus Jakarta Sans Variable", Inter, system-ui, sans-serif';
type Weight = 500 | 600 | 700 | 800;

export type StoryTemplate = "photo" | "sticker" | "brand";

export const STORY_TEMPLATES: Array<{
  id: StoryTemplate;
  label: string;
  hint: string;
  needsPhoto: boolean;
}> = [
  {
    id: "photo",
    label: "Foto",
    hint: "Fotomu jadi latar, angka di bawah.",
    needsPhoto: true,
  },
  {
    id: "sticker",
    label: "Stiker",
    hint: "PNG transparan, tempel di atas foto storymu.",
    needsPhoto: false,
  },
  {
    id: "brand",
    label: "Kartu",
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

/** A resolved story photo. A cutout has a transparent background. */
export type StoryPhoto = { src: string; cutout: boolean };

/**
 * Default photo for the story, or null when it has none. `prefer` picks the
 * original photo (full-bleed templates) or the sticker cutout (brand card)
 * when the story carries both.
 */
export function storyPhoto(
  story: StorySpec,
  prefer: "original" | "cutout" = "original",
): StoryPhoto | null {
  if (story.kind !== "meal") return null;
  const original = story.photoSrc ?? (story.photoId ? photoUrl(story.photoId) : null);
  const cutout = story.scanId ? stickerUrl(story.scanId) : null;
  if (prefer === "cutout" && cutout) return { src: cutout, cutout: true };
  if (original) return { src: original, cutout: false };
  return cutout ? { src: cutout, cutout: true } : null;
}

// ---------------------------------------------------------------------------
// Icons. Lucide path data (ISC, lucide.dev) for the macro icons in
// lib/macro-icons.ts plus the few workout/progress glyphs the card needs.
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  protein: [
    "M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3",
    "m18.5 6 1.754 3.5a6.48 6.48 0 0 1-1.854 8.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5",
    "M10 8.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0",
  ],
  carbs: [
    "M2 22 16 8",
    "M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z",
    "M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z",
    "M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z",
    "M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z",
    "M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z",
    "M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z",
    "M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z",
  ],
  fat: [
    "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  ],
  flame: [
    "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
  ],
  clock: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 6v6l4 2"],
  dumbbell: [
    "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z",
    "m2.5 21.5 1.4-1.4",
    "m20.1 3.9 1.4-1.4",
    "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z",
    "m9.6 14.4 4.8-4.8",
  ],
  trophy: [
    "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2",
    "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2",
    "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3",
    "M4 22h16",
    "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z",
    "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3",
  ],
  trendingDown: ["M16 17h6v-6", "m22 17-8.5-8.5-5 5L2 7"],
} as const satisfies Record<string, readonly string[]>;

type IconName = keyof typeof ICON_PATHS;

/** Icon + tone per macro. Icons come from MACRO_META's lucide set; the tones are its makan/bakar/tidur hues lifted for dark backgrounds. */
const MACRO_ICON: Record<"protein" | "carbs" | "fat", { icon: IconName; color: string }> = {
  protein: { icon: "protein", color: "#7fd89b" },
  carbs: { icon: "carbs", color: "#f6a56b" },
  fat: { icon: "fat", color: "#9fa9f0" },
};

function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  top: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ICON_PATHS[name]) ctx.stroke(new Path2D(d));
  ctx.restore();
}

// Same geometry as components/logo-mark.tsx / public/brand/logo-mark.svg:
// J and R (Plus Jakarta Sans ExtraBold, outlined) sharing one stem, a leaf
// sprouting from the J. Ported to Path2D so the canvas needs no network.
const MARK_R =
  "M62.92 102.27L48.66 102.27L48.66 33.73L74.88 33.73Q81.96 33.73 87.44 36.21Q92.91 38.70 96.04 43.57Q99.17 48.45 99.17 55.63Q99.17 62.62 95.95 67.54Q92.73 72.46 87.30 74.95L102.94 102.27L86.93 102.27L70 72L79.20 77.43L62.92 77.43L62.92 102.27M62.92 46.15L62.92 65.01L74.97 65.01Q78.01 65.01 80.22 63.81Q82.42 62.62 83.67 60.50Q84.91 58.39 84.91 55.63Q84.91 52.77 83.67 50.66Q82.42 48.54 80.22 47.35Q78.01 46.15 74.97 46.15";
const MARK_J =
  "M29.20 102.27L25.06 102.27L25.06 89.39L29.20 89.39Q33.34 89.39 35.87 87.04Q38.40 84.70 38.40 80.83L38.40 33.73L52.66 33.73L52.66 80.19Q52.66 86.81 49.81 91.78Q46.96 96.75 41.67 99.51Q36.38 102.27 29.20 102.27";
/** The mark's viewBox is "20 12 88 98": 88 wide for 98 high. */
const MARK_ASPECT = 88 / 98;

/** Draws the logo mark in its viewBox box (top-left at x, top) with height `height`; returns its width. */
function drawLogoMark(ctx: CanvasRenderingContext2D, x: number, top: number, height: number) {
  const scale = height / 98;
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(scale, scale);
  ctx.translate(-20, -12);
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
  return height * MARK_ASPECT;
}

// ---------------------------------------------------------------------------
// Text helpers. Line boxes follow the CSS model: Plus Jakarta Sans has ascent
// 1.04em and descent 0.22em, so a box of any height puts the baseline 0.41em
// below its middle. The native twin sets lineHeight = lineBox(size) and trims
// the surplus with negative margins, which yields the same baselines.
// ---------------------------------------------------------------------------

const setFont = (ctx: CanvasRenderingContext2D, weight: Weight, size: number) => {
  ctx.font = `${weight} ${size}px ${FONT}`;
};
const baselineIn = (top: number, lh: number, size: number) => top + lh / 2 + size * 0.41;
/** Natural line step for wrapped multi-line text. */
const lineBox = (size: number) => Math.round(size * 1.3);

const idFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const intFmt = (value: number) => idFmt.format(Math.round(value));
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Hero number size: 232 px, shrunk so the digits stay under ~740 px wide. */
function heroSize(text: string): number {
  let em = 0;
  for (const ch of text) em += /\d/.test(ch) ? 0.7 : 0.4;
  return Math.min(232, Math.floor(740 / em));
}

/** Grid value size by character count. */
function cellSize(text: string): number {
  return text.length <= 4 ? 72 : text.length <= 6 ? 60 : 48;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end).trimEnd()}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Word-wraps to `maxLines`, ellipsizing the tail of the last line. Font must be set. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines.map((line) => fitText(ctx, line, maxWidth));
  const head = lines.slice(0, maxLines - 1);
  return [...head, fitText(ctx, lines.slice(maxLines - 1).join(" "), maxWidth)];
}

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

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  const path = new Path2D();
  path.roundRect(x, y, w, h, r);
  return path;
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
  ctx.clip(roundRectPath(x, y, w, h, r));
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Fits a cutout inside the box without cropping. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  ctx.drawImage(
    bitmap,
    x + (w - bitmap.width * scale) / 2,
    y + (h - bitmap.height * scale) / 2,
    bitmap.width * scale,
    bitmap.height * scale,
  );
}

// ---------------------------------------------------------------------------
// Stats block shared by all templates.
// ---------------------------------------------------------------------------

const EYEBROWS = {
  meal: "Makan hari ini",
  workout: "Sesi latihan",
  progress: "Progres hari ini",
} as const;

type Row = { gap: number; height: number; paint: (top: number) => void };
type Cell = {
  icon: IconName;
  color: string;
  label: string;
  value: string;
  unit: string;
  sub?: string;
};

type StatsOptions = {
  /**
   * Brand card: no text shadows, footer shows the site instead of the brand
   * pill, extras (PR list, trend) are drawn. Otherwise the block is an
   * overlay on a photo or transparent sticker: shadowed text, brand pill.
   */
  card: boolean;
};

const TITLE_SIZE = 68;
const EYEBROW_LH = 38;
const FOOTER_H = 76;

type Metric = { value: string; unit: string; label?: string };

function workoutMetrics(story: WorkoutStory) {
  const volume = story.volumeKg
    ? { value: intFmt(story.volumeKg), unit: "kg", label: "Total volume" }
    : null;
  const duration =
    story.durationMin != null
      ? { value: `${Math.round(story.durationMin)}`, unit: "menit", label: "Durasi" }
      : null;
  const sets =
    story.setsDone != null
      ? { value: `${Math.round(story.setsDone)}`, unit: "set", label: "Set selesai" }
      : null;
  const hero: Metric | null = volume ?? duration ?? sets;
  const cells: Cell[] = [];
  if (duration && hero !== duration) {
    cells.push({
      icon: "clock",
      color: ACCENT,
      label: "Durasi",
      value: duration.value,
      unit: duration.unit,
    });
  }
  if (sets && hero !== sets) {
    cells.push({
      icon: "dumbbell",
      color: ACCENT,
      label: "Set",
      value: sets.value,
      unit: sets.unit,
    });
  }
  const prCount = story.prs?.length ?? 0;
  if (prCount > 0) {
    cells.push({ icon: "trophy", color: AMBER, label: "Rekor", value: `${prCount}`, unit: "baru" });
  }
  return { hero, cells };
}

function progressCells(story: ProgressStory): Cell[] {
  const cells: Cell[] = [];
  if (story.proteinG != null) {
    cells.push({
      icon: "protein",
      color: MACRO_ICON.protein.color,
      label: MACRO_META.protein.label,
      value: intFmt(story.proteinG),
      unit: "g",
      sub: story.proteinTargetG ? `dari ${intFmt(story.proteinTargetG)} g` : undefined,
    });
  }
  if ((story.streakDays ?? 0) > 0) {
    cells.push({
      icon: "flame",
      color: AMBER,
      label: "Beruntun",
      value: `${story.streakDays}`,
      unit: "hari",
    });
  }
  if ((story.weightLostKg ?? 0) > 0) {
    cells.push({
      icon: "trendingDown",
      color: ACCENT,
      label: "Turun",
      value: idFmt.format(story.weightLostKg!),
      unit: "kg",
      sub: "dari berat awal",
    });
  }
  return cells;
}

function mealCells(story: MealStory): Cell[] {
  const cells: Cell[] = [];
  for (const key of ["protein", "carbs", "fat"] as const) {
    const value = story[key];
    if (value == null) continue;
    cells.push({
      icon: MACRO_ICON[key].icon,
      color: MACRO_ICON[key].color,
      label: MACRO_META[key].label,
      value: intFmt(value),
      unit: "g",
    });
  }
  return cells;
}

/** Trend delta over the sorted weigh-ins, or null without 2+ points. */
function weekTrend(story: ProgressStory) {
  const trend = [...(story.weekTrend ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (trend.length < 2) return null;
  const weights = trend.map((point) => point.weightKg);
  const delta = Math.round((weights[weights.length - 1]! - weights[0]!) * 10) / 10;
  return { weights, delta };
}

/**
 * Lays the stats block out top to bottom and returns its height plus a
 * painter that draws it with its top edge at `top`.
 */
function layoutStats(
  ctx: CanvasRenderingContext2D,
  story: StorySpec,
  date: Date,
  options: StatsOptions,
): { height: number; paint: (top: number) => void } {
  const rows: Row[] = [];
  const x = PAD;
  const accent = options.card ? ACCENT : WHITE;
  const soft = options.card ? WHITE_SOFT : OVERLAY_SOFT;
  const muted = options.card ? MUTED : OVERLAY_MUTED;
  const withShadow = (draw: () => void) => {
    if (options.card) return draw();
    ctx.save();
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 3;
    draw();
    ctx.restore();
  };
  const textOnBaseline = (
    value: string,
    weight: Weight,
    size: number,
    color: string,
    left: number,
    baseline: number,
    align: CanvasTextAlign = "left",
  ) => {
    setFont(ctx, weight, size);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, left, baseline);
    ctx.textAlign = "left";
  };
  const text = (
    value: string,
    weight: Weight,
    size: number,
    color: string,
    left: number,
    top: number,
    lh: number,
    align: CanvasTextAlign = "left",
  ) => textOnBaseline(value, weight, size, color, left, baselineIn(top, lh, size), align);

  // Eyebrow
  const eyebrow = (story.eyebrow ?? EYEBROWS[story.kind]).toUpperCase();
  rows.push({
    gap: 0,
    height: EYEBROW_LH,
    paint: (top) =>
      withShadow(() => {
        setFont(ctx, 700, 32);
        ctx.fillStyle = accent;
        letterspaced(ctx, eyebrow, x, baselineIn(top, EYEBROW_LH, 32), 6);
      }),
  });

  // Title
  if (story.kind !== "progress") {
    setFont(ctx, 800, TITLE_SIZE);
    const lines = wrapLines(ctx, story.name, CONTENT_W, 2);
    const step = lineBox(TITLE_SIZE);
    rows.push({
      gap: 12,
      height: lines.length * step,
      paint: (top) =>
        withShadow(() =>
          lines.forEach((line, index) =>
            text(line, 800, TITLE_SIZE, WHITE, x, top + index * step, step),
          ),
        ),
    });
  }

  // Hero metric
  let hero: Metric | null = null;
  let cells: Cell[] = [];
  if (story.kind === "meal") {
    hero = { value: intFmt(story.kcal), unit: "kcal" };
    cells = mealCells(story);
  } else if (story.kind === "workout") {
    const metrics = workoutMetrics(story);
    hero = metrics.hero;
    cells = metrics.cells;
  } else {
    hero = { value: intFmt(story.eatenKcal), unit: "kcal" };
    cells = progressCells(story);
  }
  if (hero) {
    const size = heroSize(hero.value);
    const lh = Math.round(size * 0.9);
    const { value, unit } = hero;
    rows.push({
      gap: story.kind === "progress" ? 14 : 4,
      height: lh,
      paint: (top) =>
        withShadow(() => {
          text(value, 800, size, WHITE, x, top, lh);
          setFont(ctx, 800, size);
          const width = ctx.measureText(value).width;
          textOnBaseline(unit, 700, 52, soft, x + width + 20, baselineIn(top, lh, size));
        }),
    });
    if (hero.label && story.kind === "workout") {
      const label = hero.label;
      rows.push({
        gap: 4,
        height: 38,
        paint: (top) => withShadow(() => text(label, 600, 32, soft, x, top, 38)),
      });
    }
  }

  if (story.kind === "meal" && story.reaction) {
    const reaction = story.reaction;
    setFont(ctx, 700, 42);
    const fitted = fitText(ctx, reaction, CONTENT_W);
    rows.push({
      gap: 16,
      height: 50,
      paint: (top) => withShadow(() => text(fitted, 700, 42, accent, x, top, 50)),
    });
  }

  if (story.kind === "progress") {
    const pct = story.targetKcal > 0 ? story.eatenKcal / story.targetKcal : 0;
    const color = pct > 1 ? OVER : pct >= 0.9 ? AMBER : ACCENT;
    rows.push({
      gap: 28,
      height: 22,
      paint: (top) => {
        ctx.fillStyle = TRACK;
        ctx.fill(roundRectPath(x, top, CONTENT_W, 22, 11));
        ctx.fillStyle = color;
        ctx.fill(
          roundRectPath(x, top, Math.max(22, Math.min(1, Math.max(0, pct)) * CONTENT_W), 22, 11),
        );
      },
    });
    rows.push({
      gap: 14,
      height: 46,
      paint: (top) =>
        withShadow(() => {
          text(`dari ${intFmt(story.targetKcal)} kcal`, 600, 36, soft, x, top, 46);
          text(
            `${Math.round(pct * 100)}%`,
            800,
            36,
            color === ACCENT ? WHITE : color,
            x + CONTENT_W,
            top,
            46,
            "right",
          );
        }),
    });
  }

  // Divider + grid
  if (cells.length > 0) {
    rows.push({
      gap: 40,
      height: 2,
      paint: (top) => {
        ctx.fillStyle = options.card ? RULE : OVERLAY_RULE;
        ctx.fillRect(x, top, CONTENT_W, 2);
      },
    });
    const valueLh = (cell: Cell) => Math.round(cellSize(cell.value) * 0.95);
    const cellH = (cell: Cell) => 44 + 8 + valueLh(cell) + (cell.sub ? 4 + 38 : 0);
    rows.push({
      gap: 34,
      height: Math.max(...cells.map(cellH)),
      paint: (top) =>
        cells.forEach((cell, index) => {
          const left = x + index * GRID_COL_W;
          withShadow(() => {
            drawIcon(ctx, cell.icon, left, top, 44, cell.color);
            text(cell.label, 600, 32, soft, left + 56, top, 44);
            const size = cellSize(cell.value);
            const lh = valueLh(cell);
            const vTop = top + 52;
            text(cell.value, 800, size, WHITE, left, vTop, lh);
            setFont(ctx, 800, size);
            const width = ctx.measureText(cell.value).width;
            textOnBaseline(cell.unit, 700, 36, soft, left + width + 8, baselineIn(vTop, lh, size));
            if (cell.sub) text(cell.sub, 600, 30, muted, left, vTop + lh + 4, 38);
          });
        }),
    });
  }

  // Brand card extras: top 3 records (the cell above already shows the total).
  if (options.card && story.kind === "workout" && (story.prs?.length ?? 0) > 0) {
    rows.push({
      gap: 44,
      height: 48,
      paint: (top) => {
        drawIcon(ctx, "trophy", x, top + 2, 44, AMBER);
        text("Rekor baru", 800, 36, AMBER, x + 60, top, 48);
      },
    });
    story.prs!.slice(0, 3).forEach((pr, index) => {
      rows.push({
        gap: index === 0 ? 20 : 16,
        height: 86,
        paint: (top) => {
          setFont(ctx, 800, 40);
          const valueW = ctx.measureText(pr.value).width;
          setFont(ctx, 700, 40);
          const name = fitText(ctx, pr.exercise, CONTENT_W - valueW - 32);
          text(name, 700, 40, WHITE, x, top, 48);
          text(pr.value, 800, 40, AMBER, x + CONTENT_W, top, 48, "right");
          setFont(ctx, 600, 30);
          text(fitText(ctx, pr.label, CONTENT_W), 600, 30, muted, x, top + 48, 38);
        },
      });
    });
  }

  const trend = options.card && story.kind === "progress" ? weekTrend(story) : null;
  if (trend) {
    const { weights, delta } = trend;
    const chartH = 150;
    const label =
      delta < 0
        ? `Turun ${idFmt.format(Math.abs(delta))} kg minggu ini`
        : delta > 0
          ? `Naik ${idFmt.format(delta)} kg minggu ini`
          : "Stabil minggu ini";
    rows.push({
      gap: 52,
      height: 48,
      paint: (top) => {
        if (delta < 0) {
          drawIcon(ctx, "trendingDown", x, top + 2, 44, ACCENT);
          text(label, 700, 36, WHITE, x + 60, top, 48);
        } else {
          text(label, 700, 36, WHITE, x, top, 48);
        }
      },
    });
    rows.push({
      gap: 24,
      height: chartH,
      paint: (top) => {
        const min = Math.min(...weights);
        const max = Math.max(...weights);
        const span = Math.max(max - min, 0.4);
        const pointAt = (index: number) => ({
          x: x + 8 + (index / (weights.length - 1)) * (CONTENT_W - 16),
          y: top + chartH - 12 - ((weights[index]! - min) / span) * (chartH - 24),
        });
        ctx.beginPath();
        weights.forEach((_, index) => {
          const point = pointAt(index);
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        for (const index of [0, weights.length - 1]) {
          const point = pointAt(index);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
        }
      },
    });
  }

  // Footer: date on the left, brand pill (or site on the brand card) on the right.
  const dateText = dateFmt.format(date);
  rows.push({
    gap: 44,
    height: FOOTER_H,
    paint: (top) => {
      withShadow(() => text(dateText, 600, 32, soft, x, top, FOOTER_H));
      if (options.card) {
        text("joyorogo.com", 700, 32, ACCENT, x + CONTENT_W, top, FOOTER_H, "right");
        return;
      }
      setFont(ctx, 800, 36);
      const wordW = ctx.measureText("JoyoRogo").width;
      const markH = 48;
      const markW = markH * MARK_ASPECT;
      const pillW = 22 + markW + 14 + wordW + 30;
      const left = x + CONTENT_W - pillW;
      ctx.fillStyle = PILL_BG;
      ctx.fill(roundRectPath(left, top, pillW, FOOTER_H, FOOTER_H / 2));
      drawLogoMark(ctx, left + 22, top + (FOOTER_H - markH) / 2, markH);
      text("JoyoRogo", 800, 36, WHITE, left + 22 + markW + 14, top, FOOTER_H);
    },
  });

  const height = rows.reduce(
    (sum, row, index) => sum + (index === 0 ? 0 : row.gap) + row.height,
    0,
  );
  return {
    height,
    paint: (top) => {
      let cursor = top;
      ctx.textBaseline = "alphabetic";
      rows.forEach((row, index) => {
        if (index > 0) cursor += row.gap;
        row.paint(cursor);
        cursor += row.height;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Template painters
// ---------------------------------------------------------------------------

function paintBrandBackground(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  for (const [cx, cy, radius] of [
    [980, 120, 460],
    [60, 1300, 420],
  ] as const) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, "rgba(127, 216, 155, 0.12)");
    glow.addColorStop(1, "rgba(127, 216, 155, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
}

function paintPhotoScrims(ctx: CanvasRenderingContext2D) {
  const bottom = ctx.createLinearGradient(0, 480, 0, STORY_H);
  bottom.addColorStop(0, "rgba(0, 0, 0, 0)");
  bottom.addColorStop(0.35, "rgba(0, 0, 0, 0.4)");
  bottom.addColorStop(0.7, "rgba(0, 0, 0, 0.72)");
  bottom.addColorStop(1, "rgba(0, 0, 0, 0.86)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 480, STORY_W, STORY_H - 480);
  const top = ctx.createLinearGradient(0, 0, 0, 360);
  top.addColorStop(0, "rgba(0, 0, 0, 0.38)");
  top.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, STORY_W, 360);
}

function paintPhotoTemplate(
  ctx: CanvasRenderingContext2D,
  story: StorySpec,
  date: Date,
  photo: ImageBitmap,
  cutout: boolean,
) {
  const block = layoutStats(ctx, story, date, {
    card: false,
  });
  const blockTop = SAFE_BOTTOM - block.height;
  if (cutout) {
    paintBrandBackground(ctx);
    drawContain(ctx, photo, PAD, SAFE_TOP, CONTENT_W, blockTop - 40 - SAFE_TOP);
  } else {
    drawCover(ctx, photo, 0, 0, STORY_W, STORY_H, 0);
    paintPhotoScrims(ctx);
  }
  block.paint(blockTop);
}

function paintStickerTemplate(ctx: CanvasRenderingContext2D, story: StorySpec, date: Date) {
  // Transparent background: only the stats block, so the PNG can be dropped
  // over any story.
  const block = layoutStats(ctx, story, date, {
    card: false,
  });
  block.paint(SAFE_TOP + (SAFE_BOTTOM - SAFE_TOP - block.height) / 2);
}

const BRAND_HEADER_H = 72;
const BRAND_BODY_TOP = SAFE_TOP + BRAND_HEADER_H + 36;

function paintBrandTemplate(
  ctx: CanvasRenderingContext2D,
  story: StorySpec,
  date: Date,
  photo: ImageBitmap | null,
  cutout: boolean,
) {
  paintBrandBackground(ctx);
  const markW = drawLogoMark(ctx, PAD, SAFE_TOP, BRAND_HEADER_H);
  ctx.fillStyle = MARK_ON_DARK;
  setFont(ctx, 800, 52);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("JoyoRogo", PAD + markW + 22, baselineIn(SAFE_TOP, BRAND_HEADER_H, 52));

  const heroPhoto = story.kind === "meal" ? photo : null;
  const block = layoutStats(ctx, story, date, {
    card: true,
  });
  if (heroPhoto) {
    const blockTop = SAFE_BOTTOM - block.height;
    const photoH = Math.min(Math.max(blockTop - 48 - BRAND_BODY_TOP, 320), 760);
    const photoTop = BRAND_BODY_TOP;
    if (cutout) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fill(roundRectPath(PAD, photoTop, CONTENT_W, photoH, 56));
      drawContain(ctx, heroPhoto, PAD + 40, photoTop + 40, CONTENT_W - 80, photoH - 80);
    } else {
      drawCover(ctx, heroPhoto, PAD, photoTop, CONTENT_W, photoH, 56);
    }
    block.paint(blockTop);
    return;
  }
  // No photo: center the block in the space under the header.
  const space = SAFE_BOTTOM - BRAND_BODY_TOP;
  block.paint(BRAND_BODY_TOP + Math.max(0, (space - block.height) / 2));
}

async function ensureFonts() {
  await Promise.all(
    [500, 600, 700, 800].map((weight) =>
      document.fonts.load(`${weight} 40px "Plus Jakarta Sans Variable"`).catch(() => {}),
    ),
  );
}

/**
 * Renders `story` onto `canvas` (resized to 1080x1920) with the given
 * template and resolves when done. Defaults to the brand card.
 * `photoOverrideSrc` (a picked photo) replaces the story's own photo on the
 * photo and brand templates.
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
  const date = story.date ?? new Date();

  if (template === "sticker") {
    paintStickerTemplate(ctx, story, date);
    return;
  }

  const source: StoryPhoto | null = photoOverrideSrc
    ? { src: photoOverrideSrc, cutout: false }
    : storyPhoto(story, template === "brand" ? "cutout" : "original");
  const bitmap = source ? await loadBitmap(source.src) : null;
  if (template === "photo" && bitmap) {
    paintPhotoTemplate(ctx, story, date, bitmap, source!.cutout);
    return;
  }
  paintBrandTemplate(ctx, story, date, bitmap, source?.cutout ?? false);
}

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
