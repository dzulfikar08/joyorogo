import { Image, PixelRatio, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { LogoMark } from "@/components/logo-mark";
import { lightTheme as brandTheme } from "@/theme";

/**
 * 1080x1920 story cards rendered as plain views, captured offscreen by
 * react-native-view-shot and handed to the share sheet — the native twin of
 * apps/web/src/components/story/story-card.ts. Same brand style: dark leaf
 * gradient, Plus Jakarta Sans, white numbers, soft-green accents. Fixed
 * colors on purpose: the card is a share asset that must look identical in
 * the light and dark app themes.
 *
 * The view is laid out at 1080/PixelRatio dp so a 1:1 capture yields exactly
 * 1080x1920 px on every device.
 */

const BG_TOP = "#0d1f12";
const BG_BOTTOM = "#16402a";
const ACCENT = "#7fd89b";
const ACCENT_SOFT = "#c9dccf";
const WHITE = "#ffffff";
const AMBER = "#f59e0b";
const CHIP_BG = "rgba(255, 255, 255, 0.08)";
const TRACK_BG = "rgba(255, 255, 255, 0.12)";

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
};

export type WorkoutPr = { exercise: string; label: string; value: string };

export type WorkoutStory = {
  kind: "workout";
  name: string;
  durationMin?: number | null;
  volumeKg?: number | null;
  setsDone?: number | null;
  prs?: WorkoutPr[];
};

export type ProgressStory = {
  kind: "progress";
  eatenKcal: number;
  targetKcal: number;
  proteinG?: number | null;
  proteinTargetG?: number | null;
  streakDays?: number | null;
  weightLostKg?: number | null;
};

export type StorySpec = MealStory | WorkoutStory | ProgressStory;

const EYEBROWS = {
  meal: "MAKAN HARI INI",
  workout: "SESI LATIHAN",
  progress: "PROGRES HARI INI",
} as const;

const idFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Design pixels -> density-independent pixels of the offscreen view.
const scale = 1 / PixelRatio.get();
const px = (value: number) => Math.round(value * scale * 100) / 100;
export const CARD_W = px(1080);
export const CARD_H = px(1920);

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    overflow: "hidden",
    backgroundColor: BG_BOTTOM,
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(127, 216, 155, 0.08)",
  },
  content: {
    flex: 1,
    paddingHorizontal: px(90),
    paddingTop: px(88),
    paddingBottom: px(68),
  },
  headerRow: { flexDirection: "row", alignItems: "center" },
  wordmark: {
    fontFamily: brandTheme.fonts.heavy,
    fontSize: px(52),
    color: "#e6f2df",
    marginLeft: px(24),
  },
  eyebrow: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(34),
    letterSpacing: px(8),
    color: ACCENT,
    marginTop: px(72),
  },
  date: {
    fontFamily: brandTheme.fonts.regular,
    fontSize: px(34),
    color: ACCENT_SOFT,
    marginTop: px(16),
  },
  footerWrap: { flex: 1, justifyContent: "flex-end" },
  footer: {
    fontFamily: brandTheme.fonts.medium,
    fontSize: px(32),
    color: ACCENT,
    textAlign: "center",
  },
  mealPhoto: {
    width: px(760),
    height: px(760),
    borderRadius: px(48),
    alignSelf: "center",
    marginTop: px(58),
  },
  title: {
    fontFamily: brandTheme.fonts.heavy,
    color: WHITE,
    marginTop: px(56),
  },
  kcalRow: { flexDirection: "row", alignItems: "flex-end", gap: px(28), marginTop: px(24) },
  kcal: { fontFamily: brandTheme.fonts.heavy, color: WHITE },
  kcalUnit: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(44),
    color: ACCENT_SOFT,
    paddingBottom: px(26),
  },
  reaction: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(46),
    color: ACCENT,
    marginTop: px(20),
  },
  chipRow: { flexDirection: "row", gap: px(24), marginTop: px(36) },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(14),
    backgroundColor: CHIP_BG,
    borderRadius: 999,
    paddingHorizontal: px(36),
    height: px(84),
  },
  chipLabel: { fontFamily: brandTheme.fonts.bold, fontSize: px(40), color: ACCENT },
  chipValue: { fontFamily: brandTheme.fonts.bold, fontSize: px(40), color: WHITE },
  statRow: { flexDirection: "row", marginTop: px(64) },
  statValue: { fontFamily: brandTheme.fonts.heavy, fontSize: px(96), color: WHITE },
  statLabel: {
    fontFamily: brandTheme.fonts.regular,
    fontSize: px(38),
    color: ACCENT_SOFT,
    marginTop: px(6),
  },
  prHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(24),
    marginTop: px(88),
  },
  prHeaderText: { fontFamily: brandTheme.fonts.heavy, fontSize: px(56), color: AMBER },
  prRow: { flexDirection: "row", alignItems: "center", gap: px(20), marginTop: px(36) },
  prExercise: { fontFamily: brandTheme.fonts.bold, fontSize: px(42), color: WHITE },
  prValue: { fontFamily: brandTheme.fonts.regular, fontSize: px(42), color: ACCENT_SOFT, flex: 1 },
  bigKcal: { fontFamily: brandTheme.fonts.heavy, fontSize: px(170), color: WHITE },
  kcalTarget: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(44),
    color: ACCENT_SOFT,
    paddingBottom: px(40),
  },
  track: { height: px(28), borderRadius: px(14), backgroundColor: TRACK_BG, marginTop: px(28) },
  fill: { height: px(28), borderRadius: px(14), backgroundColor: ACCENT },
  proteinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(24),
    marginTop: px(64),
  },
  proteinText: { fontFamily: brandTheme.fonts.bold, fontSize: px(48), color: WHITE },
  streakRow: { flexDirection: "row", alignItems: "center", gap: px(24), marginTop: px(72) },
  streakText: { fontFamily: brandTheme.fonts.heavy, fontSize: px(56), color: AMBER },
});

function StoryHeader({ eyebrow }: { eyebrow: string }) {
  return (
    <>
      <View style={styles.headerRow}>
        <LogoMark size={px(84)} onDark />
        <Text style={styles.wordmark}>JoyoRogo</Text>
      </View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.date}>{dateFmt.format(new Date())}</Text>
    </>
  );
}

function MealStoryCard({ story }: { story: MealStory }) {
  const macros = [
    ["P", story.protein],
    ["K", story.carbs],
    ["L", story.fat],
  ] as const;
  return (
    <>
      {story.photoUri ? (
        <Image source={{ uri: story.photoUri }} style={styles.mealPhoto} resizeMode="cover" />
      ) : null}
      <Text style={[styles.title, { fontSize: px(60) }]} numberOfLines={2}>
        {story.name}
      </Text>
      <View style={styles.kcalRow}>
        <Text style={[styles.kcal, { fontSize: px(140) }]}>{idFmt.format(Math.round(story.kcal))}</Text>
        <Text style={styles.kcalUnit}>kcal</Text>
      </View>
      {story.reaction ? <Text style={styles.reaction} numberOfLines={1}>{story.reaction}</Text> : null}
      <View style={styles.chipRow}>
        {macros.map(
          ([label, value]) =>
            value == null ? null : (
              <View key={label} style={styles.chip}>
                <Text style={styles.chipLabel}>{label}</Text>
                <Text style={styles.chipValue}>{idFmt.format(Math.round(value))} g</Text>
              </View>
            ),
        )}
      </View>
    </>
  );
}

function WorkoutStoryCard({ story }: { story: WorkoutStory }) {
  const stats = [
    { value: story.durationMin != null ? `${Math.round(story.durationMin)}` : null, label: "menit" },
    {
      value: story.volumeKg ? idFmt.format(Math.round(story.volumeKg)) : null,
      label: "kg volume",
    },
    { value: story.setsDone != null ? `${Math.round(story.setsDone)}` : null, label: "set selesai" },
  ].filter((stat) => stat.value != null);
  return (
    <>
      <Text style={[styles.title, { fontSize: px(84) }]} numberOfLines={2}>
        {story.name}
      </Text>
      <View style={styles.statRow}>
        {stats.map((stat) => (
          <View key={stat.label} style={{ flex: 1 }}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
      {story.prs && story.prs.length > 0 ? (
        <>
          <View style={styles.prHeader}>
            <Text style={styles.prHeaderText}>Rekor baru</Text>
          </View>
          {story.prs.slice(0, 4).map((pr, index) => (
            <View key={index} style={styles.prRow}>
              <Text style={styles.prExercise} numberOfLines={1}>
                {pr.exercise}
              </Text>
              <Text style={styles.prValue} numberOfLines={1}>
                — {pr.label}: {pr.value}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

function ProgressStoryCard({ story }: { story: ProgressStory }) {
  const pct = story.targetKcal > 0 ? Math.min(story.eatenKcal / story.targetKcal, 1) : 0;
  return (
    <>
      <View style={styles.kcalRow}>
        <Text style={styles.bigKcal}>{idFmt.format(story.eatenKcal)}</Text>
        <Text style={styles.kcalUnit}>dari {idFmt.format(story.targetKcal)} kcal</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.max(pct * 100, 3)}%`,
              backgroundColor:
                story.eatenKcal > story.targetKcal
                  ? "#ef4444"
                  : pct >= 0.9
                    ? AMBER
                    : ACCENT,
            },
          ]}
        />
      </View>
      {story.proteinG != null && story.proteinTargetG ? (
        <>
          <View style={styles.proteinRow}>
            <Text style={styles.proteinText}>
              Protein {idFmt.format(story.proteinG)} / {idFmt.format(story.proteinTargetG)} g
            </Text>
          </View>
          <View style={[styles.track, { height: px(16), borderRadius: px(8), marginTop: px(24) }]}>
            <View
              style={[
                styles.fill,
                {
                  height: px(16),
                  borderRadius: px(8),
                  marginTop: 0,
                  width: `${Math.min((story.proteinG / story.proteinTargetG) * 100, 100)}%`,
                },
              ]}
            />
          </View>
        </>
      ) : null}
      {(story.streakDays ?? 0) > 0 ? (
        <View style={styles.streakRow}>
          <Text style={styles.streakText}>{story.streakDays} hari berturut-turut</Text>
        </View>
      ) : null}
      {(story.weightLostKg ?? 0) > 0 ? (
        <View style={styles.streakRow}>
          <Text style={[styles.proteinText, { color: WHITE }]}>
            Turun {idFmt.format(story.weightLostKg!)} kg dari berat awal
          </Text>
        </View>
      ) : null}
    </>
  );
}

/** The full 1080x1920 story card; render offscreen and capture with view-shot. */
export function StoryCard({ story }: { story: StorySpec }) {
  return (
    <View style={styles.card}>
      <LinearGradient
        colors={[BG_TOP, BG_BOTTOM]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[styles.glow, { width: px(560), height: px(560), top: px(-120), right: px(-120) }]}
      />
      <View style={styles.content}>
        <StoryHeader eyebrow={EYEBROWS[story.kind]} />
        {story.kind === "meal" ? (
          <MealStoryCard story={story} />
        ) : story.kind === "workout" ? (
          <WorkoutStoryCard story={story} />
        ) : (
          <ProgressStoryCard story={story} />
        )}
        <View style={styles.footerWrap}>
          <Text style={styles.footer}>joyorogo.com</Text>
        </View>
      </View>
    </View>
  );
}
