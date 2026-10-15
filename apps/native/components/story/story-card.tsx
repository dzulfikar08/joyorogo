import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Image, PixelRatio, StyleSheet, Text, View, type TextStyle } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { LogoMark } from "@/components/logo-mark";
import { lightTheme as brandTheme } from "@/theme";
import { MACRO_META } from "@/utils/macro-icons";
import { ON_TARGET_TOLERANCE, type RecapShare } from "@joyorogo/api/lib/recap";

/**
 * 1080x1920 story cards rendered as plain views. The share sheet mounts them
 * live, scaled down inside a 9:16 frame, and react-native-view-shot captures
 * the same mounted view on share — the native twin of
 * apps/web/src/components/story/story-card.ts. Keep every number below in
 * sync with it; both are written in 1080x1920 design pixels. Three templates:
 *
 * - "photo": user photo full-bleed (a cutout sits on the brand gradient), the
 *   stats block anchored to the bottom of the Instagram safe area.
 * - "sticker": the same block on a fully transparent view, centered, captured
 *   as a transparent PNG the user can place over their own story.
 * - "brand": the JoyoRogo dark-leaf gradient card, self-contained.
 *
 * The stats block is shared by all three: eyebrow, title, one big primary
 * metric, a 3-column secondary grid with icons, date + brand footer.
 *
 * Fixed colors on purpose: the card is a share asset that must look identical
 * in the light and dark app themes. The view is laid out at 1080/PixelRatio dp
 * so a 1:1 capture yields exactly 1080x1920 px on every device.
 *
 * Text follows the web canvas model: every Text gets lineHeight = 1.3 x size
 * (taller than Plus Jakarta Sans' 1.26 em natural height, so the baseline sits
 * 0.41 em under the box middle) and single lines are trimmed to their visual
 * height with negative vertical margins.
 */

const BG_TOP = "#0d1f12";
const BG_BOTTOM = "#16402a";
const ACCENT = "#7fd89b";
const WHITE = "#ffffff";
const WHITE_SOFT = "rgba(255, 255, 255, 0.82)";
const MUTED = "rgba(255, 255, 255, 0.72)";
/** Text over photos and the sticker is brighter than on the card, and mint is lifted since ACCENT washes out. */
const OVERLAY_SOFT = "rgba(255, 255, 255, 0.95)";
const OVERLAY_MUTED = "rgba(255, 255, 255, 0.86)";
const RULE = "rgba(255, 255, 255, 0.28)";
const OVERLAY_RULE = "rgba(255, 255, 255, 0.6)";
const TRACK = "rgba(255, 255, 255, 0.24)";
const AMBER = "#f59e0b";
const OVER = "#f87171";
const PILL_BG = "rgba(0, 0, 0, 0.36)";
const PANEL_BG = "rgba(255, 255, 255, 0.06)";
const MARK_ON_DARK = "#e6f2df";
const SHADOW = "rgba(0, 0, 0, 0.8)";

export type StoryTemplate = "photo" | "sticker" | "brand";

export type MealStory = {
  kind: "meal";
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** One-line reaction under the kcal, e.g. the scan page's "Aman, bro". */
  reaction?: string;
  /** Local (file://) or remote photo shown as the card hero. */
  photoUri?: string | null;
  /** True when `photoUri` is a sticker cutout with a transparent background. */
  photoCutout?: boolean;
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

/** Weekly recap; numbers come from stats.weekRecap through recapShare. */
export type RecapStory = RecapShare & {
  kind: "recap";
  eyebrow?: string;
  date?: Date;
};

export type StorySpec = MealStory | WorkoutStory | ProgressStory | RecapStory;

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

/** Default photo for the story; null when the story carries no photo. */
export function storyPhotoUri(story: StorySpec): string | null {
  return story.kind === "meal" ? (story.photoUri ?? null) : null;
}

export type StoryPhotoStatus = "ready" | "error";

/**
 * Whether `template` actually draws `photoUri`. The share sheet waits for the
 * photo's load event before capturing only when this is true.
 */
export function storyShowsPhoto(
  story: StorySpec,
  template: StoryTemplate,
  photoUri: string | null,
): boolean {
  if (photoUri == null) return false;
  if (template === "photo") return true;
  return template === "brand" && story.kind === "meal";
}

const EYEBROWS = {
  meal: "Makan hari ini",
  workout: "Sesi latihan",
  recap: "Rekap minggu",
  progress: "Progres hari ini",
} as const;

const idFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const intFmt = (value: number) => idFmt.format(Math.round(value));
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Design pixels -> density-independent pixels of the card view.
const scale = 1 / PixelRatio.get();
const px = (value: number) => Math.round(value * scale * 100) / 100;
export const CARD_W = px(1080);
export const CARD_H = px(1920);
// Instagram story UI safe zones (design px).
const SAFE_TOP = 250;
const SAFE_BOTTOM = 1580;
const PAD = 72;
const CONTENT_W = 1080 - PAD * 2;
const GRID_COL_W = CONTENT_W / 3;
const BRAND_HEADER_H = 72;
const BRAND_BODY_TOP = SAFE_TOP + BRAND_HEADER_H + 36;
const FOOTER_H = 76;
const MARK_ASPECT = 88 / 98;

/** Hero number size: 232 design px, shrunk so the digits stay under ~740 px wide. */
function heroSize(text: string): number {
  let em = 0;
  for (const ch of text) em += /\d/.test(ch) ? 0.7 : 0.4;
  return Math.min(232, Math.floor(740 / em));
}

/** Grid value size by character count. */
function cellSize(text: string): number {
  return text.length <= 4 ? 72 : text.length <= 6 ? 60 : 48;
}

const lineBox = (size: number) => Math.round(size * 1.3);

const FAMILY = {
  500: brandTheme.fonts.regular,
  600: brandTheme.fonts.medium,
  700: brandTheme.fonts.bold,
  800: brandTheme.fonts.heavy,
} as const;

/**
 * Overlay blocks (photo/sticker) shadow their glyphs and use the brighter
 * palette; the brand card does not. Txt resolves "soft" | "muted" | "accent".
 */
const TONES = {
  overlay: {
    card: false,
    soft: OVERLAY_SOFT,
    muted: OVERLAY_MUTED,
    accent: WHITE,
    rule: OVERLAY_RULE,
  },
  card: { card: true, soft: WHITE_SOFT, muted: MUTED, accent: ACCENT, rule: RULE },
} as const;
const CardTone = createContext<(typeof TONES)[keyof typeof TONES]>(TONES.overlay);

function Txt({
  size,
  weight = 700,
  color = WHITE,
  lh,
  spacing,
  lines,
  style,
  children,
}: {
  size: number;
  weight?: keyof typeof FAMILY;
  color?: string;
  /** Visual line height; defaults to the full line box (multi-line text). */
  lh?: number;
  spacing?: number;
  lines?: number;
  style?: TextStyle;
  children: ReactNode;
}) {
  const tone = useContext(CardTone);
  const { card } = tone;
  const resolved =
    color === "soft" || color === "muted" || color === "accent" ? tone[color] : color;
  const box = lineBox(size);
  return (
    <Text
      numberOfLines={lines}
      style={[
        {
          fontFamily: FAMILY[weight],
          fontSize: px(size),
          lineHeight: px(box),
          color: resolved,
          includeFontPadding: false,
          marginVertical: lh == null ? 0 : -px((box - lh) / 2),
          letterSpacing: spacing ? px(spacing) : undefined,
        },
        card ? null : styles.shadow,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const MACRO_TONE = { protein: "#7fd89b", carbs: "#f6a56b", fat: "#9fa9f0" } as const;

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  const { card } = useContext(CardTone);
  return (
    <View
      style={{ width: px(size), height: px(size), alignItems: "center", justifyContent: "center" }}
    >
      <MaterialCommunityIcons
        name={name}
        size={px(size)}
        color={color}
        style={card ? undefined : styles.shadow}
      />
    </View>
  );
}

type Cell = {
  icon: IconName;
  color: string;
  label: string;
  value: string;
  unit: string;
  sub?: string;
};

type Metric = { value: string; unit: string; label?: string };

function mealCells(story: MealStory): Cell[] {
  const cells: Cell[] = [];
  for (const key of ["protein", "carbs", "fat"] as const) {
    const value = story[key];
    if (value == null) continue;
    cells.push({
      icon: MACRO_META[key].icon,
      color: MACRO_TONE[key],
      label: MACRO_META[key].label,
      value: intFmt(value),
      unit: "g",
    });
  }
  return cells;
}

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
      icon: "clock-outline",
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
      icon: MACRO_META.protein.icon,
      color: MACRO_TONE.protein,
      label: MACRO_META.protein.label,
      value: intFmt(story.proteinG),
      unit: "g",
      sub: story.proteinTargetG ? `dari ${intFmt(story.proteinTargetG)} g` : undefined,
    });
  }
  if ((story.streakDays ?? 0) > 0) {
    cells.push({
      icon: "fire",
      color: AMBER,
      label: "Beruntun",
      value: `${story.streakDays}`,
      unit: "hari",
    });
  }
  if ((story.weightLostKg ?? 0) > 0) {
    cells.push({
      icon: "trending-down",
      color: ACCENT,
      label: "Turun",
      value: idFmt.format(story.weightLostKg!),
      unit: "kg",
      sub: "dari berat awal",
    });
  }
  return cells;
}

/** Recap grid, two rows of three; a stat without data is skipped. */
function recapCells(story: RecapStory): Cell[] {
  const cells: Cell[] = [
    {
      icon: "check-circle-outline",
      color: ACCENT,
      label: "Sesuai target",
      value: `${story.daysOnTarget}`,
      unit: "hari",
      sub: `dari ${story.loggedDays} tercatat`,
    },
  ];
  if (story.proteinAvgG != null) {
    cells.push({
      icon: MACRO_META.protein.icon,
      color: MACRO_TONE.protein,
      label: MACRO_META.protein.label,
      value: intFmt(story.proteinAvgG),
      unit: "g",
      sub: story.proteinTargetG ? `target ${intFmt(story.proteinTargetG)} g` : undefined,
    });
  }
  if (story.streakDays > 0) {
    cells.push({
      icon: "fire",
      color: AMBER,
      label: "Beruntun",
      value: `${story.streakDays}`,
      unit: "hari",
    });
  }
  if (story.exerciseKcal > 0) {
    cells.push({
      icon: "dumbbell",
      color: ACCENT,
      label: "Olahraga",
      value: intFmt(story.exerciseKcal),
      unit: "kcal",
      sub: story.exerciseMin > 0 ? `${intFmt(story.exerciseMin)} menit` : undefined,
    });
  }
  if (story.weightChangeKg != null) {
    const change = story.weightChangeKg;
    cells.push({
      icon: change < 0 ? "trending-down" : change > 0 ? "trending-up" : "minus",
      color: ACCENT,
      label: "Berat",
      value: `${change > 0 ? "+" : ""}${idFmt.format(change)}`,
      unit: "kg",
      sub: "tren mingguan",
    });
  }
  if (story.bestDay) {
    cells.push({
      icon: "trophy",
      color: AMBER,
      label: "Hari terbaik",
      value: story.bestDay.label,
      unit: "",
      sub: `${intFmt(story.bestDay.kcal)} kcal`,
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

/** Value + unit sharing one baseline, the unit's line box trimmed to fit inside the value's. */
function ValueUnit({
  value,
  unit,
  size,
  lh,
  unitSize,
  unitGap,
}: {
  value: string;
  unit: string;
  size: number;
  lh: number;
  unitSize: number;
  unitGap: number;
}) {
  return (
    <View style={styles.baselineRow}>
      <Txt size={size} weight={800} lh={lh} lines={1}>
        {value}
      </Txt>
      <Txt
        size={unitSize}
        weight={700}
        color="soft"
        lh={unitSize}
        style={{ marginLeft: px(unitGap) }}
      >
        {unit}
      </Txt>
    </View>
  );
}

function GridCell({ cell }: { cell: Cell }) {
  const size = cellSize(cell.value);
  return (
    <View style={{ width: px(GRID_COL_W) }}>
      <View style={styles.cellLabelRow}>
        <Icon name={cell.icon} size={44} color={cell.color} />
        <Txt
          size={32}
          weight={600}
          color="soft"
          lh={44}
          lines={1}
          style={{ marginLeft: px(12), flexShrink: 1 }}
        >
          {cell.label}
        </Txt>
      </View>
      <View style={{ marginTop: px(8) }}>
        <ValueUnit
          value={cell.value}
          unit={cell.unit}
          size={size}
          lh={Math.round(size * 0.95)}
          unitSize={36}
          unitGap={8}
        />
      </View>
      {cell.sub ? (
        <View style={{ marginTop: px(4) }}>
          <Txt size={30} weight={600} color="muted" lh={38} lines={1}>
            {cell.sub}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function BrandPill() {
  return (
    <View style={styles.pill}>
      <View style={styles.pillMark}>
        <LogoMark size={px(48)} onDark />
      </View>
      <Txt size={36} weight={800} style={{ marginLeft: px(14) }}>
        JoyoRogo
      </Txt>
    </View>
  );
}

/** The shared stats block: eyebrow, title, hero metric, grid, footer. */
function StatsBlock({ story, date, card }: { story: StorySpec; date: Date; card: boolean }) {
  const tone = card ? TONES.card : TONES.overlay;
  let hero: Metric | null;
  let cells: Cell[];
  if (story.kind === "meal") {
    hero = { value: intFmt(story.kcal), unit: "kcal" };
    cells = mealCells(story);
  } else if (story.kind === "workout") {
    ({ hero, cells } = workoutMetrics(story));
  } else if (story.kind === "progress") {
    hero = { value: intFmt(story.eatenKcal), unit: "kcal" };
    cells = progressCells(story);
  } else {
    hero = { value: intFmt(story.avgKcal), unit: "kcal", label: "Rata-rata per hari" };
    cells = recapCells(story);
  }
  const barKcal =
    story.kind === "progress" ? story.eatenKcal : story.kind === "recap" ? story.avgKcal : 0;
  const hasBar = story.kind === "progress" || story.kind === "recap";
  const pct = hasBar && story.targetKcal > 0 ? barKcal / story.targetKcal : 0;
  // A recap average is judged like a day: within tolerance of the target is on target.
  const pctColor =
    story.kind === "recap"
      ? pct > ON_TARGET_TOLERANCE
        ? OVER
        : ACCENT
      : pct > 1
        ? OVER
        : pct >= 0.9
          ? AMBER
          : ACCENT;
  const trend = card && story.kind === "progress" ? weekTrend(story) : null;

  return (
    <CardTone.Provider value={tone}>
      <View style={styles.block}>
        <Txt size={32} weight={700} color="accent" lh={38} spacing={6} lines={1}>
          {(story.eyebrow ?? EYEBROWS[story.kind]).toUpperCase()}
        </Txt>

        {story.kind !== "progress" ? (
          <View style={{ marginTop: px(12) }}>
            <Txt size={68} weight={800} lines={2}>
              {story.name}
            </Txt>
          </View>
        ) : null}

        {hero ? (
          <View style={{ marginTop: px(story.kind === "progress" ? 14 : 4) }}>
            <ValueUnit
              value={hero.value}
              unit={hero.unit}
              size={heroSize(hero.value)}
              lh={Math.round(heroSize(hero.value) * 0.9)}
              unitSize={52}
              unitGap={20}
            />
          </View>
        ) : null}
        {(story.kind === "workout" || story.kind === "recap") && hero?.label ? (
          <View style={{ marginTop: px(4) }}>
            <Txt size={32} weight={600} color="soft" lh={38} lines={1}>
              {hero.label}
            </Txt>
          </View>
        ) : null}

        {story.kind === "meal" && story.reaction ? (
          <View style={{ marginTop: px(16) }}>
            <Txt size={42} weight={700} color="accent" lh={50} lines={1}>
              {story.reaction}
            </Txt>
          </View>
        ) : null}

        {story.kind === "progress" || story.kind === "recap" ? (
          <>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: pctColor, width: `${Math.min(1, Math.max(0, pct)) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.captionRow}>
              <Txt size={36} weight={600} color="soft" lh={46} lines={1}>
                {`dari ${intFmt(story.targetKcal)} kcal${story.kind === "recap" ? " target" : ""}`}
              </Txt>
              <Txt size={36} weight={800} color={pctColor === ACCENT ? WHITE : pctColor} lh={46}>
                {`${Math.round(pct * 100)}%`}
              </Txt>
            </View>
          </>
        ) : null}

        {cells.length > 0 ? (
          <>
            <View style={[styles.rule, { backgroundColor: tone.rule }]} />
            <View style={styles.grid}>
              {Array.from({ length: Math.ceil(cells.length / 3) }, (_, rowIndex) => (
                <View key={rowIndex} style={[styles.gridRow, rowIndex > 0 && styles.gridRowNext]}>
                  {cells.slice(rowIndex * 3, rowIndex * 3 + 3).map((cell) => (
                    <GridCell key={cell.label} cell={cell} />
                  ))}
                </View>
              ))}
            </View>
          </>
        ) : null}

        {card && story.kind === "workout" && (story.prs?.length ?? 0) > 0 ? (
          <>
            <View style={styles.prHeader}>
              <Icon name="trophy" size={44} color={AMBER} />
              <Txt size={36} weight={800} color={AMBER} lh={48} style={{ marginLeft: px(16) }}>
                Rekor baru
              </Txt>
            </View>
            {story.prs!.slice(0, 3).map((pr, index) => (
              <View
                key={`${pr.exercise}-${index}`}
                style={[styles.prItem, { marginTop: px(index === 0 ? 20 : 16) }]}
              >
                <View style={styles.prLine}>
                  <Txt size={40} weight={700} lh={48} lines={1} style={{ flex: 1 }}>
                    {pr.exercise}
                  </Txt>
                  <Txt
                    size={40}
                    weight={800}
                    color={AMBER}
                    lh={48}
                    lines={1}
                    style={{ marginLeft: px(32) }}
                  >
                    {pr.value}
                  </Txt>
                </View>
                <Txt size={30} weight={600} color="muted" lh={38} lines={1}>
                  {pr.label}
                </Txt>
              </View>
            ))}
          </>
        ) : null}

        {trend ? (
          <>
            <View style={styles.trendHeader}>
              {trend.delta < 0 ? (
                <View style={{ marginRight: px(16) }}>
                  <Icon name="trending-down" size={44} color={ACCENT} />
                </View>
              ) : null}
              <Txt size={36} weight={700} lh={48} lines={1}>
                {trend.delta < 0
                  ? `Turun ${idFmt.format(Math.abs(trend.delta))} kg minggu ini`
                  : trend.delta > 0
                    ? `Naik ${idFmt.format(trend.delta)} kg minggu ini`
                    : "Stabil minggu ini"}
              </Txt>
            </View>
            <Sparkline weights={trend.weights} />
          </>
        ) : null}

        <View style={styles.footer}>
          <Txt size={32} weight={600} color="soft" lines={1} style={{ flexShrink: 1 }}>
            {dateFmt.format(date)}
          </Txt>
          {card ? (
            <Txt size={32} weight={700} color={ACCENT}>
              joyorogo.com
            </Txt>
          ) : (
            <BrandPill />
          )}
        </View>
      </View>
    </CardTone.Provider>
  );
}

const SPARK_H = 150;

function Sparkline({ weights }: { weights: number[] }) {
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = Math.max(max - min, 0.4);
  const points = weights.map((weight, index) => ({
    x: 8 + (index / (weights.length - 1)) * (CONTENT_W - 16),
    y: SPARK_H - 12 - ((weight - min) / span) * (SPARK_H - 24),
  }));
  const ends = [points[0]!, points[points.length - 1]!];
  return (
    <View style={{ marginTop: px(24) }}>
      <Svg width={px(CONTENT_W)} height={px(SPARK_H)} viewBox={`0 0 ${CONTENT_W} ${SPARK_H}`}>
        <Polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={ACCENT}
          strokeWidth={6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {ends.map((point, index) => (
          <Circle key={index} cx={point.x} cy={point.y} r={10} fill={ACCENT} />
        ))}
      </Svg>
    </View>
  );
}

/** The brand gradient with two soft glows, same stops as the web canvas. */
function BrandBackground() {
  return (
    <Svg width={CARD_W} height={CARD_H} viewBox="0 0 1080 1920" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id="bg" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={1080} y2={1920}>
          <Stop offset="0" stopColor={BG_TOP} />
          <Stop offset="1" stopColor={BG_BOTTOM} />
        </SvgLinearGradient>
        <RadialGradient id="glowA" gradientUnits="userSpaceOnUse" cx={980} cy={120} r={460}>
          <Stop offset="0" stopColor={ACCENT} stopOpacity={0.12} />
          <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="glowB" gradientUnits="userSpaceOnUse" cx={60} cy={1300} r={420}>
          <Stop offset="0" stopColor={ACCENT} stopOpacity={0.12} />
          <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={1080} height={1920} fill="url(#bg)" />
      <Rect width={1080} height={1920} fill="url(#glowA)" />
      <Rect width={1080} height={1920} fill="url(#glowB)" />
    </Svg>
  );
}

/** Photo + stats overlay; with `cutout` the photo sits on the brand gradient instead of full-bleed. */
function PhotoStoryCard({
  story,
  date,
  photoUri,
  cutout,
  onPhotoStatus,
}: {
  story: StorySpec;
  date: Date;
  photoUri: string | null;
  cutout: boolean;
  onPhotoStatus?: (status: StoryPhotoStatus) => void;
}) {
  const showPhoto = storyShowsPhoto(story, "photo", photoUri);
  const image = showPhoto ? (
    <Image
      source={{ uri: photoUri! }}
      style={cutout ? styles.cutoutImage : styles.photoBg}
      resizeMode={cutout ? "contain" : "cover"}
      onLoad={() => onPhotoStatus?.("ready")}
      onError={() => onPhotoStatus?.("error")}
    />
  ) : null;
  return (
    <View style={[styles.card, styles.cardOpaque]}>
      {cutout ? <BrandBackground /> : null}
      {showPhoto && !cutout ? (
        <>
          {image}
          <LinearGradient
            colors={[
              "rgba(0, 0, 0, 0)",
              "rgba(0, 0, 0, 0.4)",
              "rgba(0, 0, 0, 0.72)",
              "rgba(0, 0, 0, 0.86)",
            ]}
            locations={[0, 0.35, 0.7, 1]}
            style={styles.scrimBottom}
          />
          <LinearGradient
            colors={["rgba(0, 0, 0, 0.38)", "rgba(0, 0, 0, 0)"]}
            style={styles.scrimTop}
          />
        </>
      ) : null}
      <View style={styles.safeArea}>
        {showPhoto && cutout ? (
          <View style={styles.cutoutBox}>{image}</View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <StatsBlock story={story} date={date} card={false} />
      </View>
    </View>
  );
}

function StickerStoryCard({ story, date }: { story: StorySpec; date: Date }) {
  return (
    <View style={styles.card}>
      <View style={[styles.safeArea, { justifyContent: "center" }]}>
        <StatsBlock story={story} date={date} card={false} />
      </View>
    </View>
  );
}

function BrandStoryCard({
  story,
  date,
  photoUri,
  cutout,
  onPhotoStatus,
}: {
  story: StorySpec;
  date: Date;
  photoUri: string | null;
  cutout: boolean;
  onPhotoStatus?: (status: StoryPhotoStatus) => void;
}) {
  const photo = storyShowsPhoto(story, "brand", photoUri) ? photoUri : null;
  return (
    <View style={[styles.card, styles.cardOpaque]}>
      <BrandBackground />
      <View style={styles.brandHeader}>
        <View style={styles.brandMark}>
          <LogoMark size={px(BRAND_HEADER_H)} onDark />
        </View>
        <Text
          style={{
            fontFamily: brandTheme.fonts.heavy,
            fontSize: px(52),
            lineHeight: px(lineBox(52)),
            includeFontPadding: false,
            color: MARK_ON_DARK,
            marginLeft: px(22),
          }}
        >
          JoyoRogo
        </Text>
      </View>
      <View
        style={[
          styles.brandBody,
          photo ? { justifyContent: "space-between" } : { justifyContent: "center" },
        ]}
      >
        {photo ? (
          <View style={[styles.brandPhoto, cutout ? styles.brandPhotoPanel : null]}>
            <Image
              source={{ uri: photo }}
              style={cutout ? styles.brandCutout : styles.brandPhotoFill}
              resizeMode={cutout ? "contain" : "cover"}
              onLoad={() => onPhotoStatus?.("ready")}
              onError={() => onPhotoStatus?.("error")}
            />
          </View>
        ) : null}
        <StatsBlock story={story} date={date} card />
      </View>
    </View>
  );
}

/**
 * The full 1080x1920 story card. The share sheet renders it live (scaled down
 * with a transform) and view-shot captures this same mounted view on share.
 * `photoUri` overrides the story's own photo (gallery pick); `onPhotoStatus`
 * reports when the photo finished decoding or failed so capture can wait.
 */
export function StoryCard({
  story,
  template = "brand",
  photoUri,
  onPhotoStatus,
}: {
  story: StorySpec;
  template?: StoryTemplate;
  photoUri?: string | null;
  onPhotoStatus?: (status: StoryPhotoStatus) => void;
}) {
  const photo = photoUri === undefined ? storyPhotoUri(story) : photoUri;
  const date = story.date ?? new Date();
  // Only the story's own photo can be a cutout; a gallery pick never is.
  const cutout = story.kind === "meal" && story.photoCutout === true && photo === story.photoUri;
  if (template === "sticker") return <StickerStoryCard story={story} date={date} />;
  if (template === "photo") {
    return (
      <PhotoStoryCard
        story={story}
        date={date}
        photoUri={photo}
        cutout={cutout}
        onPhotoStatus={onPhotoStatus}
      />
    );
  }
  return (
    <BrandStoryCard
      story={story}
      date={date}
      photoUri={photo}
      cutout={cutout}
      onPhotoStatus={onPhotoStatus}
    />
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, overflow: "hidden" },
  cardOpaque: { backgroundColor: BG_BOTTOM },
  shadow: {
    textShadowColor: SHADOW,
    // Android blurs with sigma ~0.58 x radius; canvas shadowBlur 20 is sigma 10.
    textShadowRadius: px(16.5),
    textShadowOffset: { width: 0, height: px(3) },
  },
  photoBg: { position: "absolute", width: CARD_W, height: CARD_H },
  scrimBottom: { position: "absolute", left: 0, right: 0, bottom: 0, top: px(480) },
  scrimTop: { position: "absolute", left: 0, right: 0, top: 0, height: px(360) },
  safeArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: px(SAFE_TOP),
    height: px(SAFE_BOTTOM - SAFE_TOP),
    paddingHorizontal: px(PAD),
  },
  cutoutBox: { flex: 1, marginBottom: px(40) },
  cutoutImage: { width: "100%", height: "100%" },
  block: { width: px(CONTENT_W), flexShrink: 0 },
  baselineRow: { flexDirection: "row", alignItems: "baseline" },
  cellLabelRow: { flexDirection: "row", alignItems: "center", height: px(44) },
  track: {
    height: px(22),
    borderRadius: px(11),
    backgroundColor: TRACK,
    marginTop: px(28),
    overflow: "hidden",
  },
  fill: { height: px(22), borderRadius: px(11), minWidth: px(22) },
  captionRow: {
    marginTop: px(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rule: { height: px(2), marginTop: px(40) },
  grid: { marginTop: px(34) },
  gridRow: { flexDirection: "row", alignItems: "flex-start" },
  gridRowNext: { marginTop: px(40) },
  prHeader: { flexDirection: "row", alignItems: "center", height: px(48), marginTop: px(44) },
  prItem: { height: px(86) },
  prLine: { flexDirection: "row", alignItems: "center" },
  trendHeader: { flexDirection: "row", alignItems: "center", height: px(48), marginTop: px(52) },
  footer: {
    marginTop: px(44),
    height: px(FOOTER_H),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pill: {
    height: px(FOOTER_H),
    flexDirection: "row",
    alignItems: "center",
    borderRadius: px(FOOTER_H / 2),
    backgroundColor: PILL_BG,
    paddingLeft: px(22),
    paddingRight: px(30),
  },
  pillMark: {
    width: px(48 * MARK_ASPECT),
    height: px(48),
    alignItems: "center",
    justifyContent: "center",
  },
  brandHeader: {
    position: "absolute",
    left: px(PAD),
    top: px(SAFE_TOP),
    height: px(BRAND_HEADER_H),
    flexDirection: "row",
    alignItems: "center",
  },
  brandMark: {
    width: px(BRAND_HEADER_H * MARK_ASPECT),
    height: px(BRAND_HEADER_H),
    alignItems: "center",
    justifyContent: "center",
  },
  brandBody: {
    position: "absolute",
    left: 0,
    right: 0,
    top: px(BRAND_BODY_TOP),
    height: px(SAFE_BOTTOM - BRAND_BODY_TOP),
    paddingHorizontal: px(PAD),
  },
  brandPhoto: {
    height: px(760),
    minHeight: px(320),
    flexShrink: 1,
    marginBottom: px(48),
    borderRadius: px(56),
    overflow: "hidden",
  },
  brandPhotoPanel: { backgroundColor: PANEL_BG, padding: px(40) },
  brandPhotoFill: { width: "100%", height: "100%" },
  brandCutout: { flex: 1 },
});
