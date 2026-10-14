import { Image, PixelRatio, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";

import { LogoMark } from "@/components/logo-mark";
import { lightTheme as brandTheme } from "@/theme";

/**
 * 1080x1920 story cards rendered as plain views. The share sheet mounts them
 * live, scaled down inside a 9:16 frame, and react-native-view-shot captures
 * the same mounted view on share — the native twin of
 * apps/web/src/components/story/story-card.ts. Three Strava-style templates:
 *
 * - "photo": user photo full-bleed, minimal bold white stats in the lower
 *   Instagram safe zone, small brand mark on top.
 * - "sticker": the same stats on a fully transparent view, captured as a
 *   transparent PNG the user can place over their own story.
 * - "brand": the JoyoRogo dark-leaf gradient card, self-contained.
 *
 * Fixed colors on purpose: the card is a share asset that must look identical
 * in the light and dark app themes. The view is laid out at 1080/PixelRatio dp
 * so a 1:1 capture yields exactly 1080x1920 px on every device.
 */

const BG_TOP = "#0d1f12";
const BG_BOTTOM = "#16402a";
const ACCENT = "#7fd89b";
const ACCENT_SOFT = "#c9dccf";
const WHITE = "#ffffff";
const AMBER = "#f59e0b";
const CHIP_BG = "rgba(255, 255, 255, 0.08)";
const TRACK_BG = "rgba(255, 255, 255, 0.12)";
const TEXT_SHADOW = {
  textShadowColor: "rgba(0, 0, 0, 0.55)",
  textShadowRadius: 14,
  textShadowOffset: { width: 0, height: 4 },
};

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

/** Default photo for the story; null when the story carries no photo. */
export function storyPhotoUri(story: StorySpec): string | null {
  return story.kind === "meal" ? (story.photoUri ?? null) : null;
}

export type StoryPhotoStatus = "ready" | "error";

/**
 * Whether `template` actually draws `photoUri`. The share sheet waits for the
 * photo's load event before capturing only when this is true.
 */
export function storyShowsPhoto(story: StorySpec, template: StoryTemplate, photoUri: string | null): boolean {
  if (photoUri == null) return false;
  if (template === "photo") return true;
  return template === "brand" && story.kind === "meal";
}

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

// Design pixels -> density-independent pixels of the card view.
const scale = 1 / PixelRatio.get();
const px = (value: number) => Math.round(value * scale * 100) / 100;
export const CARD_W = px(1080);
export const CARD_H = px(1920);
// Instagram story UI safe zones (design px).
const SAFE_TOP = px(250);
const SAFE_BOTTOM = px(1580);

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    overflow: "hidden",
  },
  cardOpaque: { backgroundColor: BG_BOTTOM },
  photoBg: { position: "absolute", width: CARD_W, height: CARD_H },
  scrimBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: CARD_H * 0.55,
  },
  scrimTop: { position: "absolute", left: 0, right: 0, top: 0, height: CARD_H * 0.22 },
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    top: SAFE_TOP,
    height: SAFE_BOTTOM - SAFE_TOP,
    paddingHorizontal: px(84),
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(127, 216, 155, 0.08)",
  },
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: px(88),
  },
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
  brandDate: {
    fontFamily: brandTheme.fonts.regular,
    fontSize: px(34),
    color: ACCENT_SOFT,
    marginTop: px(16),
  },
  brandBody: { paddingHorizontal: px(6) },
  footerWrap: { flex: 1, justifyContent: "flex-end", paddingBottom: px(56) },
  footer: {
    fontFamily: brandTheme.fonts.medium,
    fontSize: px(32),
    color: ACCENT,
    textAlign: "center",
  },
  statsBlock: { position: "absolute", left: px(84), right: px(84), bottom: 0 },
  topTag: { position: "absolute", left: px(84), top: 0 },
  contentCentered: { alignItems: "flex-start", justifyContent: "center" },
  stickerStack: { gap: px(48) },
  brandTagRow: { flexDirection: "row", alignItems: "center" },
  brandTagText: { fontFamily: brandTheme.fonts.heavy, fontSize: px(40), color: WHITE, marginLeft: px(20) },
  title: { fontFamily: brandTheme.fonts.heavy, fontSize: px(76), color: WHITE, ...TEXT_SHADOW },
  kcalRow: { flexDirection: "row", alignItems: "flex-end", marginTop: px(8), gap: px(24) },
  kcal: { fontFamily: brandTheme.fonts.heavy, fontSize: px(168), color: WHITE, ...TEXT_SHADOW },
  kcalUnit: {
    fontFamily: brandTheme.fonts.medium,
    fontSize: px(44),
    color: "rgba(255, 255, 255, 0.85)",
    paddingBottom: px(30),
    ...TEXT_SHADOW,
  },
  macros: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(46),
    color: "rgba(255, 255, 255, 0.92)",
    marginTop: px(24),
    ...TEXT_SHADOW,
  },
  reaction: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(46),
    color: ACCENT,
    marginTop: px(16),
    ...TEXT_SHADOW,
  },
  statRow: { flexDirection: "row", marginTop: px(30) },
  statValue: {
    fontFamily: brandTheme.fonts.heavy,
    fontSize: px(76),
    color: WHITE,
    ...TEXT_SHADOW,
  },
  statLabel: {
    fontFamily: brandTheme.fonts.medium,
    fontSize: px(30),
    letterSpacing: px(4),
    color: "rgba(255, 255, 255, 0.78)",
    marginTop: px(6),
    ...TEXT_SHADOW,
  },
  prRow: { flexDirection: "row", alignItems: "center", gap: px(20), marginTop: px(26) },
  prText: { fontFamily: brandTheme.fonts.heavy, fontSize: px(46), color: AMBER, ...TEXT_SHADOW },
  proteinRow: { flexDirection: "row", alignItems: "center", gap: px(20), marginTop: px(22) },
  proteinText: { fontFamily: brandTheme.fonts.bold, fontSize: px(46), color: WHITE, ...TEXT_SHADOW },
  streakRow: { flexDirection: "row", alignItems: "center", gap: px(20), marginTop: px(18) },
  streakText: { fontFamily: brandTheme.fonts.bold, fontSize: px(46), color: WHITE, ...TEXT_SHADOW },
  lostRow: { flexDirection: "row", alignItems: "center", marginTop: px(18) },
  lostText: {
    fontFamily: brandTheme.fonts.medium,
    fontSize: px(46),
    color: WHITE,
    ...TEXT_SHADOW,
  },
  ring: { position: "absolute", top: px(90), right: 0 },
  mealPhoto: {
    width: px(760),
    height: px(760),
    borderRadius: px(48),
    alignSelf: "center",
    marginTop: px(58),
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
  brandTitle: { fontFamily: brandTheme.fonts.heavy, color: WHITE, marginTop: px(56) },
  brandKcalRow: { flexDirection: "row", alignItems: "flex-end", gap: px(28), marginTop: px(24) },
  brandKcal: { fontFamily: brandTheme.fonts.heavy, color: WHITE },
  brandKcalUnit: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(44),
    color: ACCENT_SOFT,
    paddingBottom: px(26),
  },
  brandStatRow: { flexDirection: "row", marginTop: px(64) },
  brandStatValue: { fontFamily: brandTheme.fonts.heavy, fontSize: px(96), color: WHITE },
  brandStatLabel: {
    fontFamily: brandTheme.fonts.regular,
    fontSize: px(38),
    color: ACCENT_SOFT,
    marginTop: px(6),
  },
  brandPrHeader: { flexDirection: "row", alignItems: "center", gap: px(24), marginTop: px(88) },
  brandPrHeaderText: { fontFamily: brandTheme.fonts.heavy, fontSize: px(56), color: AMBER },
  brandPrRow: { flexDirection: "row", alignItems: "center", gap: px(20), marginTop: px(36) },
  brandPrExercise: { fontFamily: brandTheme.fonts.bold, fontSize: px(42), color: WHITE },
  brandPrValue: { fontFamily: brandTheme.fonts.regular, fontSize: px(42), color: ACCENT_SOFT, flex: 1 },
  bigKcal: { fontFamily: brandTheme.fonts.heavy, fontSize: px(170), color: WHITE },
  kcalTarget: {
    fontFamily: brandTheme.fonts.bold,
    fontSize: px(44),
    color: ACCENT_SOFT,
    paddingBottom: px(40),
  },
  track: { height: px(28), borderRadius: px(14), backgroundColor: TRACK_BG, marginTop: px(28) },
  fill: { height: px(28), borderRadius: px(14), backgroundColor: ACCENT },
});

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

function BrandTag() {
  return (
    <View style={styles.brandTagRow}>
      <LogoMark size={px(56)} onDark />
      <Text style={styles.brandTagText}>JoyoRogo</Text>
    </View>
  );
}

/** Ring showing kcal vs target; placed top-right inside the safe area. */
function TargetRing({ story }: { story: ProgressStory }) {
  const size = px(280);
  const stroke = px(18);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = story.targetKcal > 0 ? Math.min(story.eatenKcal / story.targetKcal, 1) : 0;
  return (
    <View style={styles.ring}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255, 255, 255, 0.3)"
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={pct >= 1 ? "#ef4444" : pct >= 0.9 ? AMBER : ACCENT}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ position: "absolute", width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={[styles.statValue, { fontSize: px(60) }]}>{Math.round(pct * 100)}%</Text>
      </View>
    </View>
  );
}

/** Minimal bold white stats block, anchored inside the safe area. */
function StatsBlock({ story }: { story: StorySpec }) {
  return (
    <>
      {story.kind === "meal" || story.kind === "workout" ? (
        <Text style={styles.title} numberOfLines={2}>
          {story.name}
        </Text>
      ) : null}

      {story.kind === "progress" ? (
        <>
          <View style={styles.kcalRow}>
            <Text style={styles.kcal}>{idFmt.format(story.eatenKcal)}</Text>
            <Text style={styles.kcalUnit}>dari {idFmt.format(story.targetKcal)} kcal</Text>
          </View>
          {story.proteinG != null && story.proteinTargetG ? (
            <View style={styles.proteinRow}>
              <Text style={styles.proteinText}>
                Protein {idFmt.format(story.proteinG)} / {idFmt.format(story.proteinTargetG)} g
              </Text>
            </View>
          ) : null}
          {(story.streakDays ?? 0) > 0 ? (
            <View style={styles.streakRow}>
              <Text style={[styles.streakText, { color: AMBER }]}>{story.streakDays}</Text>
              <Text style={styles.streakText}>hari berturut-turut</Text>
            </View>
          ) : null}
          {(story.weightLostKg ?? 0) > 0 ? (
            <View style={styles.lostRow}>
              <Text style={styles.lostText}>
                Turun {idFmt.format(story.weightLostKg!)} kg dari berat awal
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      {story.kind === "meal" ? (
        <>
          <View style={styles.kcalRow}>
            <Text style={styles.kcal}>{idFmt.format(Math.round(story.kcal))}</Text>
            <Text style={styles.kcalUnit}>kkal</Text>
          </View>
          {macroLine(story) ? <Text style={styles.macros}>{macroLine(story)}</Text> : null}
          {story.reaction ? (
            <Text style={styles.reaction} numberOfLines={1}>
              {story.reaction}
            </Text>
          ) : null}
        </>
      ) : null}

      {story.kind === "workout" ? (
        <>
          <View style={styles.statRow}>
            {[
              { value: story.durationMin != null ? `${Math.round(story.durationMin)}` : null, label: "MENIT" },
              {
                value: story.volumeKg ? idFmt.format(Math.round(story.volumeKg)) : null,
                label: "KG VOLUME",
              },
              { value: story.setsDone != null ? `${Math.round(story.setsDone)}` : null, label: "SET" },
            ]
              .filter((stat) => stat.value != null)
              .map((stat) => (
                <View key={stat.label} style={{ flex: 1 }}>
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                    {stat.value}
                  </Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
          </View>
          {(story.prs?.length ?? 0) > 0 ? (
            <View style={styles.prRow}>
              <Text style={styles.prText}>{story.prs!.length} rekor baru</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** The photo + minimal stats template (also the sticker when transparent). */
function OverlayStoryCard({
  story,
  template,
  photoUri: photo,
  onPhotoStatus,
}: {
  story: StorySpec;
  template: "photo" | "sticker";
  photoUri: string | null;
  onPhotoStatus?: (status: StoryPhotoStatus) => void;
}) {
  const photoUri = storyShowsPhoto(story, template, photo) ? photo : null;
  const sticker = template === "sticker";
  return (
    <View style={[styles.card, sticker ? null : styles.cardOpaque]}>
      {photoUri ? (
        <>
          <Image
            source={{ uri: photoUri }}
            style={styles.photoBg}
            resizeMode="cover"
            onLoad={() => onPhotoStatus?.("ready")}
            onError={() => onPhotoStatus?.("error")}
          />
          <LinearGradient
            colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.72)"]}
            style={styles.scrimBottom}
          />
          <LinearGradient
            colors={["rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0)"]}
            style={styles.scrimTop}
          />
        </>
      ) : null}
      <View style={[styles.content, sticker ? styles.contentCentered : null]}>
        {sticker ? (
          <View style={styles.stickerStack}>
            <BrandTag />
            {story.kind === "progress" ? <TargetRing story={story} /> : null}
            <StatsBlock story={story} />
          </View>
        ) : (
          <>
            <View style={styles.topTag}>
              <BrandTag />
            </View>
            {story.kind === "progress" ? <TargetRing story={story} /> : null}
            <View style={styles.statsBlock}>
              <StatsBlock story={story} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function BrandStoryCard({
  story,
  photoUri: photo,
  onPhotoStatus,
}: {
  story: StorySpec;
  photoUri: string | null;
  onPhotoStatus?: (status: StoryPhotoStatus) => void;
}) {
  const photoUri = storyShowsPhoto(story, "brand", photo) ? photo : null;
  return (
    <View style={[styles.card, styles.cardOpaque]}>
      <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={[styles.glow, { width: px(560), height: px(560), top: px(-120), right: px(-120) }]}
      />
      <View style={[styles.content, styles.brandBody]}>
        <View style={styles.brandHeader}>
          <LogoMark size={px(84)} onDark />
          <Text style={styles.wordmark}>JoyoRogo</Text>
        </View>
        <Text style={styles.eyebrow}>{EYEBROWS[story.kind]}</Text>
        <Text style={styles.brandDate}>{dateFmt.format(new Date())}</Text>

        {story.kind === "meal" ? (
          <>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.mealPhoto}
                resizeMode="cover"
                onLoad={() => onPhotoStatus?.("ready")}
                onError={() => onPhotoStatus?.("error")}
              />
            ) : null}
            <Text style={[styles.brandTitle, { fontSize: px(60) }]} numberOfLines={2}>
              {story.name}
            </Text>
            <View style={styles.brandKcalRow}>
              <Text style={[styles.brandKcal, { fontSize: px(140) }]}>
                {idFmt.format(Math.round(story.kcal))}
              </Text>
              <Text style={styles.brandKcalUnit}>kcal</Text>
            </View>
            {story.reaction ? (
              <Text style={styles.reaction} numberOfLines={1}>
                {story.reaction}
              </Text>
            ) : null}
            <View style={styles.chipRow}>
              {(
                [
                  ["P", story.protein],
                  ["K", story.carbs],
                  ["L", story.fat],
                ] as const
              ).map(
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
        ) : null}

        {story.kind === "workout" ? (
          <>
            <Text style={[styles.brandTitle, { fontSize: px(84) }]} numberOfLines={2}>
              {story.name}
            </Text>
            <View style={styles.brandStatRow}>
              {[
                {
                  value: story.durationMin != null ? `${Math.round(story.durationMin)}` : null,
                  label: "menit",
                },
                {
                  value: story.volumeKg ? idFmt.format(Math.round(story.volumeKg)) : null,
                  label: "kg volume",
                },
                {
                  value: story.setsDone != null ? `${Math.round(story.setsDone)}` : null,
                  label: "set selesai",
                },
              ]
                .filter((stat) => stat.value != null)
                .map((stat) => (
                  <View key={stat.label} style={{ flex: 1 }}>
                    <Text style={styles.brandStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      {stat.value}
                    </Text>
                    <Text style={styles.brandStatLabel}>{stat.label}</Text>
                  </View>
                ))}
            </View>
            {(story.prs?.length ?? 0) > 0 ? (
              <>
                <View style={styles.brandPrHeader}>
                  <Text style={styles.brandPrHeaderText}>Rekor baru</Text>
                </View>
                {story.prs!.slice(0, 4).map((pr, index) => (
                  <View key={index} style={styles.brandPrRow}>
                    <Text style={styles.brandPrExercise} numberOfLines={1}>
                      {pr.exercise}
                    </Text>
                    <Text style={styles.brandPrValue} numberOfLines={1}>
                      — {pr.label}: {pr.value}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {story.kind === "progress" ? (
          <>
            <View style={styles.brandKcalRow}>
              <Text style={styles.bigKcal}>{idFmt.format(story.eatenKcal)}</Text>
              <Text style={styles.kcalTarget}>dari {idFmt.format(story.targetKcal)} kcal</Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(
                      (story.targetKcal > 0
                        ? Math.min(story.eatenKcal / story.targetKcal, 1)
                        : 0) * 100,
                      3,
                    )}%`,
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
                <Text style={[styles.streakText, { color: AMBER }]}>
                  {story.streakDays} hari berturut-turut
                </Text>
              </View>
            ) : null}
            {(story.weightLostKg ?? 0) > 0 ? (
              <View style={styles.lostRow}>
                <Text style={styles.lostText}>
                  Turun {idFmt.format(story.weightLostKg!)} kg dari berat awal
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.footerWrap}>
          <Text style={styles.footer}>joyorogo.com</Text>
        </View>
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
  if (template === "brand") return <BrandStoryCard story={story} photoUri={photo} onPhotoStatus={onPhotoStatus} />;
  return <OverlayStoryCard story={story} template={template} photoUri={photo} onPhotoStatus={onPhotoStatus} />;
}
