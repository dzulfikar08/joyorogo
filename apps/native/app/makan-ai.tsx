import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import Reanimated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import ConfettiCannon from "react-native-confetti-cannon";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import {
  MEAL_LABELS,
  effectiveRamadan,
  jakartaToday,
  slotsFor,
  suggestMealForDish,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";
import { foodKind, isHeavyDish } from "@joyorogo/api/lib/food-kind";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { scalePortion } from "@joyorogo/api/lib/portion";
import { modelNumbers, swapPortionPrior, withoutPortionPrior } from "@joyorogo/api/lib/portion-chip";
import type { PortionPriorChip } from "@joyorogo/api/lib/portion-chip";
import { dominantKind } from "@joyorogo/api/lib/snack-advice";
import { cupPick } from "@joyorogo/api/lib/drink-options";
import type { CupChoice } from "@joyorogo/api/lib/drink-options";
import { fmtPercent, getActiveLocale } from "@joyorogo/i18n";
import { scanFailReason } from "@joyorogo/api/lib/scan-errors";
import type { ScanFailReason } from "@joyorogo/api/lib/scan-errors";

import {
  BootLoader,
  Button,
  Chip,
  Input,
  ListGroup,
  ListRow,
  CountNum,
  Segmented,
  Text,
} from "@/components/ui";
import { EASE_OUT, PressableScale, useEnter, usePopIn } from "@/components/motion";
import { Disclosure } from "@/components/disclosure";
import { KindCycleChip, SnackAdviceSection } from "@/components/makan/snack-advice";
import { useGain } from "@/components/gain/use-gain";
import { EatenAtField } from "@/components/plate/eaten-at-field";
import { PlateFields, plateInput } from "@/components/plate/plate-fields";
import type { PlateValues } from "@/components/plate/plate-fields";
import { MacroLine } from "@/components/macro-line";
import { MetaLine } from "@/components/meta-line";
import { ContextualTip } from "@/components/tips/contextual-tip";
import { FoodSafetyNotes } from "@/components/maternal/flag-notes";
import { CorrectBox } from "@/components/scan/correct-box";
import { CupChoices } from "@/components/scan/cup-choices";
import { PortionPriorChips } from "@/components/scan/portion-prior-chips";
import type { CorrectInput, CorrectOutcome } from "@/components/scan/correct-box";
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { MealStory } from "@/components/story/types";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtGramsLabel, parseNum } from "@/utils/format";
import { client, isPaywallError, orpc, queryClient } from "@/utils/orpc";
import { LiveRows } from "@/components/scan/live-rows";
import { analyzeStreaming } from "@joyorogo/api/lib/scan-live";
import type { LiveRow } from "@joyorogo/api/lib/scan-live";
import { StickerMini } from "@/components/sticker";

type AnalyzedItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  /** Set on a cup whose contents the photo hides: which drink and size the row stands for. */
  cup?: CupChoice;
  /** [ymin, xmin, ymax, xmax] on 0-1000 relative to the image we sent. */
  box?: number[];
  kind?: FoodKind;
  /** Set when the weight started at the user's usual portion: the model's number is one tap away. */
  portionPrior?: PortionPriorChip;
};

/** Everything per-row that a correction rewrites; "Urungkan" restores one of these. */
type CorrectSnapshot = {
  items: AnalyzedItem[];
  drafts: { kcal: string; include: boolean }[];
  kinds: Record<number, FoodKind>;
  fullPortion: { items: AnalyzedItem[]; drafts: { kcal: string; include: boolean }[] } | null;
  crops: Array<string | null>;
  stickers: Array<string | null>;
  baseline: { items: AnalyzedItem[]; origin: Array<number | null> };
};

/** How a correction touched a row; the row is highlighted until the next edit. */
type CorrectMark = "renamed" | "portion" | "added";

const ALL_MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];


const MAX_SIDE = 1024;

// Phase timings of the previous scan (this session only), reported with the
// next analyzeFood request; cleared once sent.
let sessionTiming: {
  prevRoundTripMs?: number;
  prevRenderMs?: number;
  prevCropMs?: number;
  prevFirstNameMs?: number;
  prevFirstItemMs?: number;
} = {};

/** Fun portion stat, same as the web confirm card: 600 kcal = one geprek. */
const GEPREK_KCAL = 600;

/** Opacity of a result row the user left out of the save. */
const EXCLUDED_OPACITY = 0.55;

/** Optional chips for the negative answers of "Hasilnya akurat?". */
const FEEDBACK_REASONS = ["porsi", "makanan", "kcal_tinggi", "kcal_rendah"] as const;

/**
 * A failed call. A server reason code selects the copy from the
 * `scan:fail.reason` keys; any other error keeps its (already localized)
 * message.
 */
type ScanFailure = { reason: ScanFailReason | null; message: string | null };

function failureOf(error: unknown): ScanFailure {
  const reason = scanFailReason(error);
  return { reason, message: reason ? null : errorMessage(error) };
}

function localFailure(message: string): ScanFailure {
  return { reason: null, message };
}

/**
 * Cuts one item crop on device from the image we sent. Boxes are on a
 * 0-1000 grid, so they map straight onto the sent image's pixel size.
 * Returns null when the box is missing or collapses to nothing usable.
 */
async function cropFromBox(
  uri: string,
  width: number,
  height: number,
  box: number[],
): Promise<string | null> {
  const [ymin, xmin, ymax, xmax] = box;
  const left = Math.min(width - 1, Math.max(0, Math.round((xmin / 1000) * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round((ymin / 1000) * height)));
  const cropWidth = Math.min(width - left, Math.round(((xmax - xmin) / 1000) * width));
  const cropHeight = Math.min(height - top, Math.round(((ymax - ymin) / 1000) * height));
  if (cropWidth < 8 || cropHeight < 8) return null;
  const rendered = await ImageManipulator.manipulate(uri)
    .crop({ originX: left, originY: top, width: cropWidth, height: cropHeight })
    .renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return saved.uri;
}

/** Which line of the signature reaction fits this total (same thresholds as the web app). */
function reactionKey(totalKcal: number): "high" | "mid" | "low" {
  if (totalKcal > 1100) return "high";
  if (totalKcal > 550) return "mid";
  return "low";
}

type Phase = "camera" | "confirm" | "done";

// Server answers in ~8-12 s since thinking is disabled; the copy advances on
// this rhythm so nothing promises "up to a minute".
const ANALYZE_STAGES = ["sending", "recognizing", "counting", "almost"] as const;
const STAGE_MS = 2500;

/**
 * Result tile: pulsing placeholder, then the plain rectangular crop, then the
 * real outlined sticker (the shared StickerMini look) fading in over it. A
 * refined sticker that replaces the quick one fades in over it, so the tile
 * never flashes back to the crop.
 */
function CropSlot({
  uri,
  stickerId,
  size,
  style,
  label,
}: {
  uri: string | null | undefined;
  /** Scan id of the real background-removed cutout, once it exists. */
  stickerId?: string;
  size: number;
  style: StyleProp<ViewStyle>;
  label: string;
}) {
  const pulse = useRef(new Animated.Value(0.08)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Fades the newest sticker in; reset to 0 for each new id.
  const stickerFade = useRef(new Animated.Value(0)).current;
  // Crop -> sticker, once: stays 1 so a refined swap never shows the crop again.
  const coverFade = useRef(new Animated.Value(0)).current;
  // Crop opacity = its own fade-in x (1 - cover fade-in).
  const cropOpacity = useRef(Animated.multiply(fade, Animated.subtract(1, coverFade))).current;
  // `shown` is the id that finished loading; `under` is the one it replaces.
  const [shown, setShown] = useState<string | undefined>();
  const [under, setUnder] = useState<string | undefined>();
  const shownRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    stickerFade.setValue(0);
    if (!stickerId) {
      shownRef.current = undefined;
      coverFade.setValue(0);
      setShown(undefined);
      setUnder(undefined);
    } else if (shownRef.current && shownRef.current !== stickerId) {
      setUnder(shownRef.current);
    }
  }, [stickerId, stickerFade, coverFade]);
  useEffect(() => {
    if (uri || stickerId) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.22, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.08, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [uri, stickerId, pulse]);
  return (
    // The tile's muted backdrop goes once the sticker shows: the cutout sits
    // on the card like everywhere else, outline and shadow included.
    <View style={[style, styles.cropSlot, shown !== undefined && styles.cropSlotSticker]}>
      {uri ? (
        <Animated.Image
          source={{ uri }}
          style={[styles.cropFill, { opacity: cropOpacity }]}
          accessibilityLabel={label}
          onLoad={() =>
            Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start()
          }
        />
      ) : stickerId ? null : (
        <Animated.View style={[styles.cropFill, styles.cropShimmer, { opacity: pulse }]} />
      )}
      {under ? (
        <View style={styles.cropFill}>
          <StickerMini scanId={under} size={size} />
        </View>
      ) : null}
      {stickerId ? (
        <Animated.View style={[styles.cropFill, { opacity: stickerFade }]}>
          <StickerMini
            scanId={stickerId}
            size={size}
            name={uri ? "" : label}
            onLoad={() => {
              shownRef.current = stickerId;
              setShown(stickerId);
              Animated.timing(coverFade, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }).start();
              Animated.timing(stickerFade, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }).start(() => setUnder(undefined));
            }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function sameBox(a: number[] | undefined, b: number[] | undefined) {
  return !!a && !!b && a.length === b.length && a.every((value, i) => value === b[i]);
}

/** White flash over the viewfinder each time `tick` increments; skipped under reduced motion. */
function ShutterFlash({ tick }: { tick: number }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (tick === 0 || reduced) return;
    opacity.value = withSequence(
      withTiming(0.5, { duration: 50, easing: EASE_OUT }),
      withTiming(0, { duration: 110, easing: EASE_OUT }),
    );
  }, [tick, reduced, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Reanimated.View pointerEvents="none" style={[styles.shutterFlash, style]} />;
}

/** Big kcal total of the result panel: enters with the panel and counts to every new total. */
function TotalBlock({
  totalKcal,
  reactionText,
}: {
  totalKcal: number;
  reactionText: string | null;
}) {
  const { t } = useTranslation("scan");
  const enter = useEnter();
  return (
    <Reanimated.View entering={enter} style={styles.totalBlock}>
      <Text style={styles.totalLabel}>{t("result.total")}</Text>
      <View style={styles.totalRow}>
        <CountNum
          value={totalKcal}
          style={styles.totalValue}
          adjustsFontSizeToFit
          numberOfLines={1}
        />
        <Text style={styles.totalUnit}>kcal</Text>
      </View>
      {reactionText ? <Text style={styles.totalReaction}>{reactionText}</Text> : null}
      {totalKcal > 0 ? (
        <Text style={styles.totalGeprek}>
          {t("result.geprek", { count: Math.round(totalKcal / GEPREK_KCAL) })}
        </Text>
      ) : null}
    </Reanimated.View>
  );
}

/** One result row: staggered enter (capped by the kit) and a soft dim while excluded. */
function ItemCard({
  index,
  include,
  corrected,
  children,
}: {
  index: number;
  include: boolean;
  corrected: boolean;
  children: React.ReactNode;
}) {
  const enter = useEnter(index + 1);
  const dim = useSharedValue(include ? 1 : EXCLUDED_OPACITY);
  useEffect(() => {
    dim.value = withTiming(include ? 1 : EXCLUDED_OPACITY, { duration: 160, easing: EASE_OUT });
  }, [include, dim]);
  const style = useAnimatedStyle(() => ({ opacity: dim.value }));
  return (
    <Reanimated.View entering={enter}>
      <Reanimated.View style={[corrected && styles.correctedRow, style]}>
        {children}
      </Reanimated.View>
    </Reanimated.View>
  );
}

function DoneMark() {
  const { theme } = useUnistyles();
  const pop = usePopIn();
  return (
    <Reanimated.View
      entering={pop}
      style={[styles.doneIcon, { backgroundColor: theme.colors.makanSoft }]}
    >
      <Ionicons name="checkmark" size={34} color={theme.colors.makanText} />
    </Reanimated.View>
  );
}

function DoneLine({
  index,
  style,
  children,
}: {
  index: number;
  style: StyleProp<TextStyle>;
  children: React.ReactNode;
}) {
  const enter = useEnter(index);
  return (
    <Reanimated.View entering={enter}>
      <Text style={style}>{children}</Text>
    </Reanimated.View>
  );
}

function DoneActions({ children }: { children: React.ReactNode }) {
  const enter = useEnter(3);
  return (
    <Reanimated.View entering={enter} style={styles.doneActions}>
      {children}
    </Reanimated.View>
  );
}

function AnalyzingOverlay({
  previewUri,
  rows,
  onCancel,
}: {
  previewUri: string;
  rows: LiveRow[];
  onCancel: () => void;
}) {
  const { t } = useTranslation("scan");
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setStage((s) => Math.min(s + 1, ANALYZE_STAGES.length - 1)),
      STAGE_MS,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <Reanimated.View
      entering={FadeIn.duration(200).easing(EASE_OUT)}
      style={styles.analyzingOverlay}
    >
      <Image source={{ uri: previewUri }} style={styles.analyzingPreview} resizeMode="cover" />
      <View style={styles.analyzingShade}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.analyzingText}>{t(`analyzing.stage.${ANALYZE_STAGES[stage]}`)}</Text>
        <LiveRows rows={rows} />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("analyzing.cancelLabel")}
          onPress={onCancel}
          scaleTo={0.96}
          dimTo={0.7}
          style={styles.analyzingCancel}
        >
          <Text style={styles.analyzingCancelText}>{t("analyzing.cancel")}</Text>
        </PressableScale>
      </View>
    </Reanimated.View>
  );
}

export default function MakanAi() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["scan", "makan", "common"]);
  // Naikin BB: no "too much" jokes or sweet/fried warnings, the plan asks for more food.
  const { gain } = useGain();
  const gate = useSessionGate();
  // Day forwarded from the makan screen when its DaySwitcher sits on a past
  // day: the scan then saves to that day instead of hari ini.
  const rawDate = useLocalSearchParams<{ date?: string | string[] }>().date;
  const scanDate = typeof rawDate === "string" ? rawDate : undefined;
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  // This scan used the last free scan of today → paywall after the save.
  const [quotaReached, setQuotaReached] = useState(false);
  const [items, setItems] = useState<AnalyzedItem[]>([]);
  const [drafts, setDrafts] = useState<{ kcal: string; include: boolean }[]>([]);
  // Exact bytes we sent to the model: reused for the one-shot save.
  const [sentImage, setSentImage] = useState<{
    base64: string;
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  // Per-item crops cut on device from the sent image, parallel to items.
  const [crops, setCrops] = useState<Array<string | null>>([]);
  // Ids of the real cutouts (ai.scanSticker), parallel to items; null until ready.
  const [stickers, setStickers] = useState<Array<string | null>>([]);
  const stickerRunRef = useRef(0);
  // Tiles shimmer while the post-render crop pass is still running.
  const [cropping, setCropping] = useState(false);
  const cropRunRef = useRef(0);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // The scan request: running flag, what the model has found so far, and the
  // handle that lets "Batal" drop the answer (and the stream) of an old run.
  const [analyzing, setAnalyzing] = useState(false);
  const [flashTick, setFlashTick] = useState(0);
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const scanRunRef = useRef(0);
  const scanAbortRef = useRef<AbortController | null>(null);
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEAL_KEYS = ALL_MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));
  const [meal, setMeal] = useState<Meal>(() => suggestMealNow(new Date(), ramadan));
  // Once the user picks a slot, a rescan must not overwrite it.
  const mealPickedRef = useRef(false);
  const suggestSlotFor = (scanned: Array<{ name: string }>) => {
    if (scanned.length === 0 || mealPickedRef.current) return;
    setMeal(
      suggestMealForDish(new Date(), ramadan, scanned.some((item) => isHeavyDish(item.name))),
    );
  };
  const [flowError, setFlowError] = useState<ScanFailure | null>(null);
  // The photo held more food than fit: the result keeps the most prominent
  // items and shows guidance until the user keeps them or reshoots.
  const [tooMany, setTooMany] = useState(false);

  const retry = useMutation(orpc.ai.analyzeFoodRetry.mutationOptions());
  const saveFeedback = useMutation(orpc.ai.saveScanFeedback.mutationOptions());
  const addScan = useMutation(orpc.food.addScan.mutationOptions());
  const logCorrections = useMutation(orpc.ai.logCorrections.mutationOptions());
  // Plate price autofill: one lookup per parse, prefill name/place/price.
  const lastPrice = useMutation(orpc.plate.lastPrice.mutationOptions());
  // Hitung ulang: the server keeps the photo, a retry sends only the id and
  // spends no daily scan. Previous items stay visible when a retry fails.
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [retriesLeft, setRetriesLeft] = useState(0);
  const [retryHint, setRetryHint] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  // "Hasilnya akurat?" — the server decides when to ask (every scan for the
  // first 3, then once per WIB day). Answering or dismissing hides the card.
  const [model, setModel] = useState<string | null>(null);
  const [askFeedback, setAskFeedback] = useState(false);
  const [feedbackAnswered, setFeedbackAnswered] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<"kurang_akurat" | "salah" | null>(null);
  const [feedbackReasons, setFeedbackReasons] = useState<
    Array<(typeof FEEDBACK_REASONS)[number]>
  >([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackKeepPhoto, setFeedbackKeepPhoto] = useState(false);
  // Item kind: the AI's call, or what the user tapped on the row. Advice only.
  const [kinds, setKinds] = useState<Record<number, FoodKind>>({});
  // Items and kcal drafts as they were before "Setengah porsi", so one tap restores them.
  const [fullPortion, setFullPortion] = useState<{
    items: AnalyzedItem[];
    drafts: { kcal: string; include: boolean }[];
  } | null>(null);
  // What the AI said, for the stored breakdown and the miss log: the original
  // analyzeFood / retry answer, never rewritten by a correction. `origin[i]`
  // is the baseline row that current row i descends from (null = added by a
  // correction, no AI estimate to compare with).
  const [baseline, setBaseline] = useState<{
    items: AnalyzedItem[];
    origin: Array<number | null>;
  }>({ items: [], origin: [] });
  const aiItems = baseline.items;
  // Optional "Jam makan" (unix ms); null = now, nothing is sent.
  const [eatenAt, setEatenAt] = useState<number | null>(null);
  const [plateValues, setPlateValues] = useState<PlateValues>({
    name: "",
    place: "",
    price: "",
  });
  // "Ada yang kurang pas?": previous states for Urungkan, and the rows the
  // last correction touched. The marks only count while the drafts and kinds
  // arrays they were made with are still current, so any edit clears them.
  const [undoStack, setUndoStack] = useState<CorrectSnapshot[]>([]);
  const [flagged, setFlagged] = useState<{
    marks: Map<number, CorrectMark>;
    drafts: { kcal: string; include: boolean }[];
    kinds: Record<number, FoodKind>;
  } | null>(null);
  const correct = useMutation(orpc.ai.correctScan.mutationOptions());
  const correctRunRef = useRef(0);
  // A correction answers seconds later: read the latest rows then, not the render it started in.
  const live = useRef({ items, drafts, kinds, fullPortion, crops, stickers, baseline });
  live.current = { items, drafts, kinds, fullPortion, crops, stickers, baseline };

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    // Return to the camera after signing in (the home-screen widget opens this route cold).
    return (
      <Redirect
        href={{
          pathname: "/login",
          params: { next: scanDate ? `/makan-ai?date=${encodeURIComponent(scanDate)}` : "/makan-ai" },
        }}
      />
    );
  }
  if (permission === null) {
    return <BootLoader />;
  }

  const resetToCamera = () => {
    setFlowError(null);
    setTooMany(false);
    setQuotaReached(false);
    setItems([]);
    setDrafts([]);
    setKinds({});
    setFullPortion(null);
    setSentImage(null);
    cropRunRef.current += 1;
    setCrops([]);
    stickerRunRef.current += 1;
    setStickers([]);
    setCropping(false);
    setPreviewUri(null);
    setPlateValues({ name: "", place: "", price: "" });
    setEatenAt(null);
    setPhotoId(null);
    setRetriesLeft(0);
    setRetryHint("");
    setRetryCount(0);
    setAskFeedback(false);
    setFeedbackAnswered(false);
    setFeedbackRating(null);
    setFeedbackReasons([]);
    setFeedbackNote("");
    setFeedbackKeepPhoto(false);
    correctRunRef.current += 1;
    setUndoStack([]);
    setFlagged(null);
    setBaseline({ items: [], origin: [] });
    correct.reset();
    scanRunRef.current += 1;
    scanAbortRef.current?.abort();
    setAnalyzing(false);
    setLiveRows([]);
    retry.reset();
    setPhase("camera");
  };

  /** Cuts per-item tiles after the first render; each fills in as it lands. */
  const cutCrops = (
    uri: string,
    width: number,
    height: number,
    list: AnalyzedItem[],
    onDone?: () => void,
    // Crops that are already cut and stay as they are (after a correction).
    seed?: Array<string | null>,
  ) => {
    const run = ++cropRunRef.current;
    setCrops(seed ?? list.map(() => null));
    setCropping(true);
    void Promise.all(
      list.map(async (item, index) => {
        if (seed?.[index]) return;
        const cut = item.box
          ? await cropFromBox(uri, width, height, item.box).catch(() => null)
          : null;
        if (cropRunRef.current !== run) return;
        setCrops((prev) => prev.map((current, i) => (i === index ? cut : current)));
      }),
    ).then(() => {
      if (cropRunRef.current !== run) return;
      setCropping(false);
      onDone?.();
    });
  };

  /**
   * Real cutouts (ai.scanSticker): one call per boxed item without a sticker
   * yet. The server answers with a quick sticker (a crop of the whole-photo
   * cutout) almost at once; a second call then waits for the refined per-box
   * cutout, which fades in over it. `reuse` carries the ids that are still
   * valid (same box after Hitung ulang).
   */
  const cutStickers = (
    forPhotoId: string | null,
    list: AnalyzedItem[],
    reuse: Array<string | null>,
  ) => {
    const run = ++stickerRunRef.current;
    setStickers(reuse);
    if (!forPhotoId) return;
    const apply = (index: number, scanId: string) => {
      if (stickerRunRef.current !== run) return;
      setStickers((prev) => prev.map((current, i) => (i === index ? scanId : current)));
    };
    list.forEach((item, index) => {
      if (!item.box || reuse[index]) return;
      client.ai
        .scanSticker({ photoId: forPhotoId, box: item.box })
        .then(async ({ scanId, final }) => {
          if (scanId) apply(index, scanId);
          if (final || !scanId) return;
          const refined = await client.ai.scanSticker({
            photoId: forPhotoId,
            box: item.box!,
            refine: true,
          });
          if (refined.scanId && refined.scanId !== scanId) apply(index, refined.scanId);
        })
        .catch(() => {});
    });
  };

  /** Resize to MAX_SIDE, analyze, then enter confirm with drafts and crops. */
  const processImage = async (
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    captureMs: number | undefined,
  ) => {
    setFlowError(null);
    let previewSet = false;
    try {
      // Show the shot immediately while the upload + AI run (~10 s total).
      setPreviewUri(photoUri);
      previewSet = true;
      // One resize + one JPEG encode: longest side to 1024 px, base64 once.
      let context = ImageManipulator.manipulate(photoUri);
      if (Math.max(photoWidth, photoHeight) > MAX_SIDE) {
        context =
          photoHeight >= photoWidth
            ? context.resize({ height: MAX_SIDE })
            : context.resize({ width: MAX_SIDE });
      }
      const processStartedAt = performance.now();
      const rendered = await context.renderAsync();
      const resizeMs = Math.round(performance.now() - processStartedAt);
      const saved = await rendered.saveAsync({
        compress: 0.75,
        format: SaveFormat.JPEG,
        base64: true,
      });
      const encodeMs = Math.round(performance.now() - processStartedAt) - resizeMs;
      if (!saved.base64) {
        setFlowError(localFailure(t("flow.processFailed")));
        if (previewSet) setPreviewUri(null);
        return;
      }
      // Prev* come from the previous scan of this session: its render and
      // crop finished after its own request had already been logged.
      const { prevRoundTripMs, prevRenderMs, prevCropMs, prevFirstNameMs, prevFirstItemMs } =
        sessionTiming;
      sessionTiming = {};
      const run = ++scanRunRef.current;
      const abort = new AbortController();
      scanAbortRef.current = abort;
      setLiveRows([]);
      setAnalyzing(true);
      const requestAt = performance.now();
      const request = {
        imageBase64: saved.base64,
        mimeType: "image/jpeg" as const,
        crops: true,
        clientTiming: {
          ...(captureMs !== undefined ? { captureMs } : {}),
          resizeMs,
          encodeMs,
          payloadKb: Math.round((saved.base64.length * 3) / 4 / 1024),
          prevRoundTripMs,
          prevRenderMs,
          prevCropMs,
          prevFirstNameMs,
          prevFirstItemMs,
        },
      };
      let scan;
      try {
        // Names and items show as the model writes them; the plain call
        // covers builds or networks that cannot read the event stream.
        scan = await analyzeStreaming({
          open: () => client.ai.analyzeFoodStream(request, { signal: abort.signal }),
          fallback: () => client.ai.analyzeFood(request, { signal: abort.signal }),
          onRows: (rows) => {
            if (scanRunRef.current === run) setLiveRows(rows);
          },
        });
      } finally {
        if (scanRunRef.current === run) setAnalyzing(false);
      }
      // Batal while the model was working: drop the answer.
      if (scanRunRef.current !== run) return;
      const result = scan.result;
      sessionTiming.prevRoundTripMs = Math.round(performance.now() - requestAt);
      sessionTiming.prevFirstNameMs = scan.timing.firstNameMs;
      sessionTiming.prevFirstItemMs = scan.timing.firstItemMs;
      if (__DEV__) {
        console.log("[scan] timing", {
          captureMs,
          resizeMs,
          encodeMs,
          payloadKb: request.clientTiming.payloadKb,
          streamed: scan.streamed,
          ...scan.timing,
        });
      }
      setQuotaReached(result.quotaReached);
      setPhotoId(result.photoId ?? null);
      setRetriesLeft(result.retriesLeft ?? 0);
      setRetryHint("");
      setRetryCount(0);
      setModel(result.model ?? null);
      setTooMany(result.tooMany);
      setAskFeedback(result.askFeedback ?? false);
      setFeedbackAnswered(false);
      setFeedbackRating(null);
      setFeedbackReasons([]);
      setFeedbackNote("");
      setFeedbackKeepPhoto(false);
      setItems(result.items);
      setBaseline({ items: result.items, origin: result.items.map((_, i) => i) });
      correctRunRef.current += 1;
      setUndoStack([]);
      setFlagged(null);
      suggestSlotFor(result.items);
      // Plate fields: default name = first item, then autofill the last price.
      const firstName = result.items[0]?.name;
      setPlateValues({ name: firstName ?? "", place: "", price: "" });
      if (firstName) {
        void lastPrice
          .mutateAsync({ name: firstName })
          .then((found) => {
            if (!found) return;
            setPlateValues((prev) => ({
              name: found.name || prev.name,
              place: found.place ?? prev.place,
              price: found.priceIdr > 0 ? String(found.priceIdr) : prev.price,
            }));
          })
          .catch(() => {});
      }
      // Keep exactly what we sent so the save reuses the same bytes.
      setSentImage({
        base64: saved.base64,
        uri: saved.uri,
        width: rendered.width,
        height: rendered.height,
      });
      setDrafts(
        result.items.map((item) => ({ kcal: String(Math.round(item.kcal)), include: true })),
      );
      setKinds({});
      setFullPortion(null);
      setPhase("confirm");
      // The state commit is on screen after two frames; record how long that
      // took, then cut the per-item tiles in the background.
      const respondedAt = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          sessionTiming.prevRenderMs = Math.round(performance.now() - respondedAt);
        }),
      );
      // Slots shimmer until each crop lands.
      const cropStartedAt = performance.now();
      cutCrops(saved.uri, rendered.width, rendered.height, result.items, () => {
        sessionTiming.prevCropMs = Math.round(performance.now() - cropStartedAt);
      });
      cutStickers(
        result.photoId ?? null,
        result.items,
        result.items.map(() => null),
      );
    } catch (e) {
      // Batal aborts the request on purpose; the screen is already back on the camera.
      if (e instanceof Error && e.name === "AbortError") return;
      // Out of free scans: paywall now, not just an error line.
      if (isPaywallError(e)) {
        router.replace({ pathname: "/founder", params: { from: "quota" } });
        return;
      }
      if (previewSet) setPreviewUri(null);
      setFlowError(failureOf(e));
    }
  };

  const capture = async () => {
    setFlashTick((n) => n + 1);
    try {
      // skipProcessing stays off: it returns the sensor's raw orientation and
      // the preview/crops/model would see rotated photos on some devices.
      // exif/base64 are off by default; spelled out so nobody turns them on.
      const captureStartedAt = performance.now();
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 1,
        exif: false,
        base64: false,
      });
      const captureMs = Math.round(performance.now() - captureStartedAt);
      if (!photo?.uri) {
        setFlowError(localFailure(t("flow.captureFailed")));
        return;
      }
      await processImage(photo.uri, photo.width, photo.height, captureMs);
    } catch (e) {
      setFlowError(failureOf(e));
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      await processImage(asset.uri, asset.width, asset.height, undefined);
    } catch (e) {
      setFlowError(failureOf(e));
    }
  };

  // Fire-and-forget: feedback failures must never block the scan flow.
  const sendFeedback = (
    rating: "akurat" | "kurang_akurat" | "salah" | "dilewati",
    reasons?: Array<(typeof FEEDBACK_REASONS)[number]>,
    note?: string,
    keepPhoto?: boolean,
  ) => {
    if (!photoId) return;
    saveFeedback
      .mutateAsync({
        photoId,
        rating,
        source: "native",
        ...(reasons?.length ? { reasons } : {}),
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(model ? { model } : {}),
        afterRetry: retryCount > 0,
        ...(keepPhoto && (rating === "kurang_akurat" || rating === "salah")
          ? { keepPhoto: true }
          : {}),
      })
      .catch(() => {});
  };

  /** Hitung ulang: same photo, one more model pass; only the id travels. */
  const retryAnalysis = async () => {
    if (!photoId || retry.isPending || correct.isPending || retriesLeft <= 0) return;
    setFlowError(null);
    try {
      const result = await retry.mutateAsync({
        photoId,
        ...(retryHint.trim() ? { hint: retryHint.trim() } : {}),
      });
      correctRunRef.current += 1;
      setUndoStack([]);
      setFlagged(null);
      setBaseline({ items: result.items, origin: result.items.map((_, i) => i) });
      setItems(result.items);
      suggestSlotFor(result.items);
      setDrafts(
        result.items.map((item) => ({ kcal: String(Math.round(item.kcal)), include: true })),
      );
      setKinds({});
      setFullPortion(null);
      setRetriesLeft(result.retriesLeft);
      setRetryHint("");
      setModel(result.model ?? model);
      setRetryCount((count) => count + 1);
      setTooMany(result.tooMany);
      // Re-cut the per-item tiles from the same sent image, in the background.
      if (sentImage) {
        cutCrops(sentImage.uri, sentImage.width, sentImage.height, result.items);
      }
      // Only items whose box moved get a fresh cutout; same box, same sticker.
      cutStickers(
        photoId,
        result.items,
        result.items.map((next) => {
          const prevIndex = items.findIndex((prev) => sameBox(prev.box, next.box));
          return prevIndex === -1 ? null : (stickers[prevIndex] ?? null);
        }),
      );
    } catch (e) {
      // The previous result stays on screen; only the message changes.
      setFlowError(failureOf(e));
    }
  };

  const saveIncluded = async () => {
    setFlowError(null);
    const plate = plateInput(plateValues, items[0]?.name);
    const chosen = items
      .map((item, index) => ({ item, draft: drafts[index], index }))
      .filter((entry) => entry.draft?.include);
    if (chosen.length === 0) {
      setFlowError(localFailure(t("flow.pickOne")));
      return;
    }
    const invalid = chosen.find((entry) => (parseNum(entry.draft.kcal) ?? -1) < 0);
    if (invalid) {
      setFlowError(localFailure(t("flow.kcalInvalid", { name: invalid.item.name })));
      return;
    }
    try {
      if (!sentImage) {
        setFlowError(localFailure(t("flow.photoLost")));
        return;
      }
      await addScan.mutateAsync({
        ...(scanDate ? { date: scanDate } : {}),
        meal,
        imageBase64: sentImage.base64,
        mimeType: "image/jpeg",
        items: chosen.map(({ item, draft, index }) => ({
          name: item.name,
          kcal: parseNum(draft.kcal) ?? 0,
          grams: item.grams,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          box: item.box,
          // Already-cut stickers are promoted on save; unfinished ones are
          // cut by the server in the background.
          ...(stickers[index] ? { scanId: stickers[index] } : {}),
        })),
        ...(photoId ? { scanPhotoId: photoId } : {}),
        itemsJson: JSON.stringify(withoutPortionPrior(aiItems)),
        ...(plate ? { plate } : {}),
        ...(eatenAt !== null
          ? { eatenAt: eatenAtFromClock(scanDate ?? jakartaToday(), eatenAtClock(eatenAt)) ?? undefined }
          : {}),
      });
      // Miss log: AI estimate vs what the user kept. Never blocks the save.
      void logCorrections
        .mutateAsync({
          source: "native",
          items: chosen.map(({ item, draft, index }) => {
            const origin = baseline.origin[index];
            const base = origin === null || origin === undefined ? undefined : aiItems[origin];
            const ai = base ? modelNumbers(base) : undefined;
            return {
              meal,
              dishName: item.name,
              aiKcal: Math.round(ai?.kcal ?? item.kcal),
              savedKcal: parseNum(draft.kcal) ?? 0,
              aiGrams: ai?.grams ?? item.grams ?? null,
              aiConfidence: item.confidence ?? null,
            };
          }),
        })
        .catch(() => {});
      queryClient.invalidateQueries();
      // The saved result stays in the diary; the paywall picks up from the
      // list ("Nanti saja" → /makan) when this was the last free scan.
      if (quotaReached) {
        router.replace({ pathname: "/founder", params: { from: "quota", next: "/makan" } });
      } else {
        setPhase("done");
      }
    } catch (e) {
      setFlowError(failureOf(e));
    }
  };

  /** "Setengah porsi": every item (kcal, grams, macros) halves; the full portion is kept for undo. */
  const halve = () => {
    const scaled = items.map((item, index) => {
      const half = scalePortion(
        {
          kcal: parseNum(drafts[index]?.kcal ?? "") ?? item.kcal,
          grams: item.grams ?? null,
          protein: item.protein ?? null,
          carbs: item.carbs ?? null,
          fat: item.fat ?? null,
          fiber: item.fiber ?? null,
        },
        0.5,
      );
      return {
        ...item,
        portionPrior: undefined,
        kcal: half.kcal,
        grams: half.grams ?? undefined,
        protein: half.protein ?? undefined,
        carbs: half.carbs ?? undefined,
        fat: half.fat ?? undefined,
        fiber: half.fiber ?? undefined,
      };
    });
    setFullPortion({ items, drafts });
    setItems(scaled);
    setDrafts(drafts.map((draft, index) => ({ ...draft, kcal: String(scaled[index]!.kcal) })));
  };

  /**
   * "Porsi kebiasaanmu": one tap puts the model's number or the user's usual portion on the row.
   * The stored AI breakdown follows, so a row that is saved as shown is never read as an edit.
   */
  const swapPrior = (index: number) => {
    const item = items[index];
    if (!item) return;
    const swapped = swapPortionPrior(item);
    const origin = baseline.origin[index];
    setItems((prev) => prev.map((it, i) => (i === index ? swapped : it)));
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, kcal: String(swapped.kcal) } : draft)),
    );
    if (origin !== null && origin !== undefined) {
      setBaseline((prev) => ({
        ...prev,
        items: prev.items.map((it, i) => (i === origin ? swapPortionPrior(it) : it)),
      }));
    }
  };

  /** A cup whose contents the photo hides: the user's drink / size pick replaces the row's numbers. */
  const pickCup = (index: number, next: CupChoice) => {
    const picked = cupPick(next, getActiveLocale());
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...picked } : item)),
    );
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, kcal: String(picked.kcal) } : draft)),
    );
  };

  const undoHalf = () => {
    if (!fullPortion) return;
    setItems(fullPortion.items);
    setDrafts(fullPortion.drafts);
    setFullPortion(null);
  };

  /** Re-cuts only what a restored or corrected list is missing (crops and cutouts). */
  const refreshTiles = (
    list: AnalyzedItem[],
    cropSeed: Array<string | null>,
    stickerSeed: Array<string | null>,
  ) => {
    if (sentImage) {
      cutCrops(sentImage.uri, sentImage.width, sentImage.height, list, undefined, cropSeed);
    } else {
      cropRunRef.current += 1;
      setCrops(cropSeed);
    }
    cutStickers(photoId, list, stickerSeed);
  };

  /**
   * "Ada yang kurang pas?": sends the list as it stands (with the user's kcal)
   * and weaves the answer into every per-row state through `origins`: kept rows
   * keep their draft, kind, crop and cutout; renamed / re-portioned rows take
   * the new kcal but keep their include flag and, with the same box, their
   * tiles; added rows start fresh. The AI baseline is never replaced, only
   * re-pointed. Resolves null when a reset or retry made the answer stale.
   */
  const submitCorrection = async (input: CorrectInput): Promise<CorrectOutcome | null> => {
    const run = ++correctRunRef.current;
    const result = await correct.mutateAsync({
      ...(photoId ? { photoId } : {}),
      items: items.map((item, index) => ({
        name: item.name,
        portion: item.portion,
        grams: item.grams,
        kcal: Math.max(0, parseNum(drafts[index]?.kcal ?? "") ?? item.kcal),
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        fiber: item.fiber,
        confidence: item.confidence,
        kind: kinds[index] ?? item.kind,
        box: item.box,
      })),
      ...input,
    });
    if (correctRunRef.current !== run) return null;
    // Rows may have been edited while the answer was on its way: merge into the latest.
    const cur = live.current;
    const marks = new Map<number, CorrectMark>(result.changes.map((c) => [c.index, c.kind]));
    const origins = result.items.map((_, i) => {
      const origin = result.origins[i];
      return typeof origin === "number" && cur.items[origin] ? origin : null;
    });
    const nextItems = result.items.map((item, i) => {
      const origin = origins[i];
      return origin !== null && origin !== undefined && !marks.has(i) ? cur.items[origin]! : item;
    });
    const nextDrafts = result.items.map((item, i) => {
      const origin = origins[i];
      const old = origin === null || origin === undefined ? undefined : cur.drafts[origin];
      if (old && !marks.has(i)) return old;
      return { kcal: String(Math.round(item.kcal)), include: old?.include ?? true };
    });
    const nextKinds: Record<number, FoodKind> = {};
    origins.forEach((origin, i) => {
      const kind = origin !== null && !marks.has(i) ? cur.kinds[origin] : undefined;
      if (kind) nextKinds[i] = kind;
    });
    // Tiles stay while the box does; a moved box (or an added row) gets a fresh cut.
    const tileOrigins = result.items.map((item, i) => {
      const origin = origins[i];
      if (origin === null || origin === undefined) return null;
      return !marks.has(i) || sameBox(cur.items[origin]!.box, item.box) ? origin : null;
    });
    const full = cur.fullPortion;
    const nextFull = full
      ? {
          items: nextItems.map((item, i) => {
            const origin = origins[i];
            return origin !== null && origin !== undefined && !marks.has(i)
              ? (full.items[origin] ?? item)
              : item;
          }),
          drafts: nextDrafts.map((draft, i) => {
            const origin = origins[i];
            return origin !== null && origin !== undefined && !marks.has(i)
              ? (full.drafts[origin] ?? draft)
              : draft;
          }),
        }
      : null;
    setUndoStack((prev) => [...prev.slice(-9), cur]);
    setItems(nextItems);
    setDrafts(nextDrafts);
    setKinds(nextKinds);
    setFullPortion(nextFull);
    setBaseline({
      items: cur.baseline.items,
      origin: origins.map((origin) => (origin === null ? null : (cur.baseline.origin[origin] ?? null))),
    });
    setFlagged({ marks, drafts: nextDrafts, kinds: nextKinds });
    refreshTiles(
      nextItems,
      tileOrigins.map((origin) => (origin === null ? null : (cur.crops[origin] ?? null))),
      tileOrigins.map((origin) => (origin === null ? null : (cur.stickers[origin] ?? null))),
    );
    return {
      count: result.changes.length + result.removed.length,
      removed: result.removed,
      transcript: result.transcript,
      correctionsLeft: result.correctionsLeft,
    };
  };

  const undoCorrection = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap) return;
    correctRunRef.current += 1;
    setUndoStack(undoStack.slice(0, -1));
    setItems(snap.items);
    setDrafts(snap.drafts);
    setKinds(snap.kinds);
    setFullPortion(snap.fullPortion);
    setBaseline(snap.baseline);
    setFlagged(null);
    refreshTiles(snap.items, snap.crops, snap.stickers);
  };

  const flowErrorTitle = flowError?.reason ? t(`fail.reason.${flowError.reason}.title`) : null;
  const flowErrorMessage = flowError?.reason
    ? t(`fail.reason.${flowError.reason}.message`)
    : (flowError?.message ?? null);

  // ---- Camera phase (full-bleed, no card layout) ----
  if (phase === "camera") {
    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.permissionSafe}>
          <View style={styles.permissionBody}>
            <View style={[styles.permissionIcon, { backgroundColor: theme.colors.muted }]}>
              <Ionicons name="camera-outline" size={26} color={theme.colors.mutedForeground} />
            </View>
            <Text style={styles.permissionTitle}>{t("camera.permissionTitle")}</Text>
            <Text style={styles.permissionText}>{t("camera.permissionBody")}</Text>
            <Text style={styles.permissionText}>
              {profile.data?.profile?.keepPhotos ? t("privacy.kept") : t("privacy.notKept")}
            </Text>
            <View style={styles.permissionAction}>
              <Button label={t("camera.grant")} onPress={() => void requestPermission()} />
              <Button
                variant="secondary"
                label={t("idle.gallery")}
                icon="images-outline"
                onPress={() => void pickFromGallery()}
              />
            </View>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        {/* 4:3 portrait, the sensor's native shape: what you frame is what gets sent. */}
        <CameraView ref={cameraRef} style={styles.camera} facing="back" ratio="4:3" />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("camera.close")}
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </PressableScale>
        {analyzing && previewUri ? (
          <AnalyzingOverlay previewUri={previewUri} rows={liveRows} onCancel={resetToCamera} />
        ) : (
          <>
            <View style={styles.shutterRow}>
              <Text style={styles.shutterHint}>{t("camera.hint")}</Text>
              <Text style={styles.shutterTip}>{t("idle.tip")}</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("camera.barcode")}
                onPress={() =>
                  router.replace(
                    scanDate
                      ? { pathname: "/makan-barcode", params: { date: scanDate } }
                      : "/makan-barcode",
                  )
                }
                dimTo={0.7}
                style={styles.barcodeLink}
              >
                <Ionicons name="barcode-outline" size={18} color="#FFFFFF" />
                <Text style={styles.barcodeLinkText}>{t("camera.barcode")}</Text>
              </PressableScale>
              <View style={styles.shutterActions}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("idle.gallery")}
                  disabled={analyzing}
                  onPress={() => void pickFromGallery()}
                  scaleTo={0.94}
                  dimTo={0.7}
                  style={[styles.galleryButton, analyzing && styles.disabled]}
                >
                  <Ionicons name="images-outline" size={26} color="#FFFFFF" />
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("camera.shutter")}
                  disabled={analyzing}
                  onPress={() => void capture()}
                  scaleTo={0.94}
                  style={styles.shutterOuter}
                >
                  <View style={styles.shutter}>
                    <View style={styles.shutterInner} />
                  </View>
                </PressableScale>
              </View>
            </View>
            {flowErrorMessage ? (
              <View style={styles.cameraError}>
                {flowErrorTitle ? (
                  <Text style={styles.cameraErrorTitle}>{flowErrorTitle}</Text>
                ) : null}
                <Text style={styles.cameraErrorText}>{flowErrorMessage}</Text>
                <View style={styles.cameraErrorActions}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={t("common:actions.retry")}
                    onPress={() => void capture()}
                    dimTo={0.7}
                    style={styles.cameraRetry}
                  >
                    <Text style={styles.cameraRetryText}>{t("common:actions.retry")}</Text>
                  </PressableScale>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.dismissError")}
                    onPress={() => setFlowError(null)}
                    hitSlop={8}
                  >
                    <Text style={styles.cameraErrorDismiss}>{t("common:actions.close")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        )}
        <ShutterFlash tick={flashTick} />
      </View>
    );
  }

  // ---- Confirm phase: result as a bottom panel ----
  if (phase === "confirm") {
    const includedCount = drafts.filter((draft) => draft.include).length;
    // Live total of INCLUDED items — drives the big number + reaction.
    const totalKcal = drafts.reduce(
      (sum, draft) => (draft.include ? sum + (parseNum(draft.kcal) ?? 0) : sum),
      0,
    );
    const includedItems = items.filter((_, index) => drafts[index]?.include);
    const marks = flagged && flagged.drafts === drafts && flagged.kinds === kinds ? flagged.marks : null;
    const adviceKind = dominantKind(
      items.flatMap((item, index) =>
        drafts[index]?.include ? [kinds[index] ?? item.kind ?? foodKind(item.name)] : [],
      ),
    );
    const adviceName =
      includedItems.length > 1
        ? t("result.names.andMore", {
            first: includedItems[0]!.name,
            count: includedItems.length - 1,
          })
        : includedItems[0]?.name;
    const reactionText = totalKcal > 0 && !gain ? t(`reaction.${reactionKey(totalKcal)}`) : null;
    return (
      <>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.confirmContent}
          keyboardShouldPersistTaps="handled"
        >
          <TotalBlock totalKcal={totalKcal} reactionText={reactionText} />

          {tooMany ? (
            <View style={styles.feedbackCard}>
              <View>
                <Text style={styles.feedbackTitle}>{t("fail.reason.too_many.title")}</Text>
                <Text style={styles.feedbackSubtitle}>{t("fail.tooManyPartial")}</Text>
              </View>
              <View style={styles.feedbackRow}>
                <Button
                  size="sm"
                  label={t("result.keep", { count: items.length })}
                  onPress={() => setTooMany(false)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("result.retake")}
                  onPress={resetToCamera}
                />
              </View>
            </View>
          ) : null}

          {/* Penilaian hasil: selalu bisa dilewati, tidak pernah blokir simpan */}
          {askFeedback && !feedbackAnswered && photoId ? (
            <View style={styles.feedbackCard}>
              <View style={styles.feedbackHead}>
                <Text style={styles.feedbackHeadTitle}>{t("feedback.title")}</Text>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("feedback.skip")}
                  hitSlop={8}
                  onPress={() => {
                    sendFeedback("dilewati");
                    setFeedbackAnswered(true);
                  }}
                  scaleTo={1}
                  dimTo={0.35}
                  style={styles.feedbackClose}
                >
                  <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
                </PressableScale>
              </View>
              {feedbackRating === null ? (
                <View style={styles.feedbackRow}>
                  <Button
                    variant="secondary"
                    size="sm"
                    label={t("feedback.accurate")}
                    onPress={() => {
                      sendFeedback("akurat");
                      setFeedbackAnswered(true);
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    label={t("feedback.lessAccurate")}
                    onPress={() => setFeedbackRating("kurang_akurat")}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    label={t("feedback.wrong")}
                    onPress={() => setFeedbackRating("salah")}
                  />
                </View>
              ) : null}
              {feedbackRating !== null ? (
                <View style={styles.feedbackDetail}>
                  <View style={styles.feedbackRow}>
                    {FEEDBACK_REASONS.map((key) => (
                      <Chip
                        key={key}
                        label={t(`feedback.reason.${key}`)}
                        selected={feedbackReasons.includes(key)}
                        onPress={() =>
                          setFeedbackReasons((current) =>
                            current.includes(key)
                              ? current.filter((reason) => reason !== key)
                              : [...current, key],
                          )
                        }
                      />
                    ))}
                  </View>
                  <Input
                    value={feedbackNote}
                    onChangeText={setFeedbackNote}
                    placeholder={t("feedback.notePlaceholder")}
                    accessibilityLabel={t("feedback.noteAria")}
                    maxLength={300}
                  />
                  <PressableScale
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: feedbackKeepPhoto }}
                    accessibilityLabel={t("feedback.keepPhoto.label")}
                    onPress={() => setFeedbackKeepPhoto((current) => !current)}
                    scaleTo={1}
                    dimTo={0.35}
                    style={styles.keepPhotoRow}
                  >
                    <View style={[styles.keepPhotoBox, feedbackKeepPhoto && styles.keepPhotoBoxOn]}>
                      {feedbackKeepPhoto ? (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={theme.colors.primaryForeground}
                        />
                      ) : null}
                    </View>
                    <View style={styles.keepPhotoText}>
                      <Text style={styles.keepPhotoLabel}>{t("feedback.keepPhoto.label")}</Text>
                      <Text style={styles.keepPhotoHint}>{t("feedback.keepPhoto.hint")}</Text>
                    </View>
                  </PressableScale>
                  <View style={styles.feedbackRow}>
                    <Button
                      size="sm"
                      label={t("feedback.send")}
                      onPress={() => {
                        sendFeedback(
                          feedbackRating,
                          feedbackReasons,
                          feedbackNote,
                          feedbackKeepPhoto,
                        );
                        setFeedbackAnswered(true);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      label={t("common:actions.back")}
                      onPress={() => setFeedbackRating(null)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Editable item rows */}
          <ListGroup>
            {items.map((item, index) => {
              const draft = drafts[index];
              if (!draft) return null;
              const hasMacros =
                item.protein !== undefined ||
                item.carbs !== undefined ||
                item.fat !== undefined ||
                item.fiber !== undefined;
              const mark = marks?.get(index);
              return (
                <ItemCard key={`${item.name}-${index}`} index={index} include={draft.include} corrected={!!mark}>
                <ListRow
                  icon={draft.include ? "checkmark-circle" : "ellipse-outline"}
                  iconTint={draft.include ? "makan" : "muted"}
                  thumb={
                    crops[index] || stickers[index] || (cropping && item.box) ? (
                      <CropSlot
                        uri={crops[index]}
                        stickerId={stickers[index] ?? undefined}
                        size={40}
                        style={styles.cropThumb}
                        label={t("result.cropLabel", { name: item.name })}
                      />
                    ) : undefined
                  }
                  title={item.name}
                  subtitle={
                    <View style={styles.itemMeta}>
                      {mark ? (
                        <View style={styles.correctBadge}>
                          <Text style={styles.correctBadgeText}>{t(`correct.badge.${mark}`)}</Text>
                        </View>
                      ) : null}
                      <MetaLine
                        items={[
                          item.portion,
                          item.grams !== undefined ? `± ${fmtGramsLabel(item.grams)}` : null,
                          item.confidence !== undefined
                            ? t("result.items.confidenceShort", {
                                percent: fmtPercent(Math.round(item.confidence * 100)),
                              })
                            : t("result.items.estimate"),
                        ]}
                      />
                      {item.cup ? (
                        <CupChoices choice={item.cup} onPick={(next) => pickCup(index, next)} />
                      ) : null}
                      {item.portionPrior ? (
                        <PortionPriorChips name={item.name} item={item} onSwap={() => swapPrior(index)} />
                      ) : null}
                      <View style={styles.itemChips}>
                        {hasMacros ? (
                          <MacroLine
                            compact
                            protein={item.protein ?? null}
                            carbs={item.carbs ?? null}
                            fat={item.fat ?? null}
                            fiber={item.fiber ?? null}
                          />
                        ) : null}
                        <KindCycleChip
                          value={kinds[index] ?? item.kind ?? foodKind(item.name)}
                          onChange={(next) => setKinds((prev) => ({ ...prev, [index]: next }))}
                        />
                      </View>
                    </View>
                  }
                  right={
                    <View style={styles.kcalEdit}>
                      <Input
                        value={draft.kcal}
                        keyboardType="number-pad"
                        accessibilityLabel={t("result.items.kcalAria", { name: item.name })}
                        onChangeText={(text) =>
                          setDrafts((prev) =>
                            prev.map((d, i) => (i === index ? { ...d, kcal: text } : d)),
                          )
                        }
                        style={styles.kcalInput}
                      />
                      <Text style={styles.kcalUnit}>kcal</Text>
                    </View>
                  }
                  onPress={() =>
                    setDrafts((prev) =>
                      prev.map((d, i) => (i === index ? { ...d, include: !d.include } : d)),
                    )
                  }
                />
                </ItemCard>
              );
            })}
          </ListGroup>

          {/* Saran tips kalau ada minuman manis atau saus/gorengan */}
          {gain ? null : <ContextualTip names={items.map((item) => item.name)} />}

          {/* Hamil / Menyusui: catatan keamanan makanan, tidak pernah memblokir simpan */}
          <FoodSafetyNotes
            names={items.filter((_, i) => drafts[i]?.include ?? true).map((item) => item.name)}
            addToDay
          />

          {/* Koreksi lewat ketikan atau suara; tersembunyi saat hitung ulang / simpan berjalan */}
          {!retry.isPending && !addScan.isPending ? (
            <CorrectBox
              busy={correct.isPending}
              canUndo={undoStack.length > 0}
              onSubmit={submitCorrection}
              onUndo={undoCorrection}
            />
          ) : null}

          {/* Hitung ulang: foto yang sama, tanpa foto ulang, tanpa kuota harian */}
          {photoId ? (
            <View style={styles.retryBlock}>
              <View style={styles.retryHead}>
                <Text style={styles.feedbackTitle}>{t("retry.title")}</Text>
                <Text style={styles.retryMeta}>
                  {retriesLeft > 0
                    ? t("retry.left", { count: retriesLeft })
                    : t("retry.exhausted")}
                </Text>
              </View>
              {retriesLeft > 0 ? (
                <View style={styles.retryRow}>
                  <Input
                    value={retryHint}
                    onChangeText={setRetryHint}
                    placeholder={t("retry.hintPlaceholder")}
                    accessibilityLabel={t("retry.hintLabel")}
                    maxLength={200}
                    style={styles.retryInput}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    label={retry.isPending ? t("retry.running") : t("retry.action")}
                    icon="refresh"
                    loading={retry.isPending}
                    disabled={retry.isPending || correct.isPending}
                    onPress={() => void retryAnalysis()}
                  />
                </View>
              ) : (
                <Text style={styles.feedbackSubtitle}>{t("retry.exhaustedHint")}</Text>
              )}
              {retry.isPending ? (
                <Text style={styles.feedbackSubtitle}>{t("retry.keepPrevious")}</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.mealBlock}>
            <Text style={styles.mealLabel}>{t("result.meal.title")}</Text>
            <Segmented
              options={MEAL_KEYS.map((key) => ({
                value: key,
                label: t(`makan:diary.mealShort.${key}`),
              }))}
              value={meal}
              onChange={(value) => {
                mealPickedRef.current = true;
                setMeal(value);
              }}
            />
          </View>

          <SnackAdviceSection
            date={scanDate}
            kcal={totalKcal}
            kind={adviceKind}
            slot={meal}
            name={adviceName}
            onHalf={halve}
            halfApplied={fullPortion !== null}
            onUndoHalf={undoHalf}
          />

          <PlateFields compact values={plateValues} onChange={setPlateValues} />

          <EatenAtField
            date={scanDate ?? jakartaToday()}
            meal={meal}
            value={eatenAt}
            onChange={setEatenAt}
          />

          {/* Original photo and per-item crops, plus how the result is made */}
          {previewUri ? (
            <Disclosure title={t("result.photoToggle")}>
              <View style={styles.reviewPhotoBlock}>
                <Image
                  source={{ uri: previewUri }}
                  style={styles.reviewPhoto}
                  resizeMode="cover"
                  accessibilityLabel={t("result.photoAlt")}
                />
                {cropping || crops.some(Boolean) || stickers.some(Boolean) ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.cropRow}>
                      {items.map((item, index) =>
                        crops[index] || stickers[index] || (cropping && item.box) ? (
                          <View key={`crop-${item.name}-${index}`} style={styles.cropTile}>
                            <CropSlot
                              uri={crops[index]}
                              stickerId={stickers[index] ?? undefined}
                              size={96}
                              style={styles.cropImage}
                              label={t("result.cropLabel", { name: item.name })}
                            />
                            <Text style={styles.cropLabel} numberOfLines={1}>
                              {item.name}
                            </Text>
                          </View>
                        ) : null,
                      )}
                    </View>
                  </ScrollView>
                ) : null}
              </View>
            </Disclosure>
          ) : null}
          {photoId ? (
            <Disclosure title={t("result.info.title")}>
              <Text style={styles.infoText}>{t("result.info.retry")}</Text>
              {askFeedback && !feedbackAnswered ? (
                <Text style={styles.infoText}>{t("result.info.feedback")}</Text>
              ) : null}
            </Disclosure>
          ) : null}

          {flowErrorMessage ? <Text style={styles.errorText}>{flowErrorMessage}</Text> : null}
          <View style={styles.actionRow}>
            <Button
              variant="secondary"
              label={t("result.retake")}
              onPress={resetToCamera}
              style={styles.actionSecondary}
            />
            <Button
              label={
                includedCount > 0
                  ? t("result.save.items", { count: includedCount })
                  : t("result.save.pickOne")
              }
              disabled={includedCount === 0 || retry.isPending || correct.isPending}
              onPress={() => void saveIncluded()}
              loading={addScan.isPending}
              style={styles.actionPrimary}
            />
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
      {totalKcal > 0 && (
        <View pointerEvents="none" style={styles.confettiLayer}>
          <ConfettiCannon
            count={totalKcal > 1100 ? 160 : totalKcal > 550 ? 100 : 50}
            origin={{ x: -10, y: 0 }}
            autoStart
            fadeOut
          />
        </View>
      )}
      </>
    );
  }

  // ---- Done phase ----
  const included = items
    .map((item, index) => ({ item, kcal: parseNum(drafts[index]?.kcal) ?? 0 }))
    .filter((_, index) => drafts[index]?.include);
  const savedKcal = included.reduce((sum, entry) => sum + entry.kcal, 0);
  const mealStory: MealStory | null =
    included.length > 0
      ? {
          kind: "meal",
          name:
            included.length > 1
              ? t("result.names.more", {
                  first: included[0]!.item.name,
                  count: included.length - 1,
                })
              : included[0]!.item.name,
          kcal: savedKcal,
          protein: included.reduce((sum, entry) => sum + (entry.item.protein ?? 0), 0),
          carbs: included.reduce((sum, entry) => sum + (entry.item.carbs ?? 0), 0),
          fat: included.reduce((sum, entry) => sum + (entry.item.fat ?? 0), 0),
          reaction: savedKcal > 0 && !gain ? t(`reaction.${reactionKey(savedKcal)}`) : undefined,
          photoUri: previewUri,
        }
      : null;
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.doneBody}>
        <DoneMark />
        <DoneLine index={1} style={styles.doneTitle}>
          {t("done.title")}
        </DoneLine>
        <DoneLine index={2} style={styles.doneText}>
          {t("done.text")}
        </DoneLine>
        <DoneActions>
          <Button label={t("done.list")} onPress={() => router.replace("/makan")} />
          {mealStory ? <ShareStoryButton story={mealStory} variant="secondary" /> : null}
          <Button variant="secondary" label={t("done.again")} onPress={resetToCamera} />
        </DoneActions>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  permissionSafe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  permissionBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  permissionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  permissionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 21,
  },
  permissionAction: {
    minWidth: 220,
    marginTop: theme.spacing.sm,
  },

  cameraWrap: {
    flex: 1,
    backgroundColor: "#000000",
  },
  camera: {
    width: "100%",
    aspectRatio: 3 / 4,
    marginTop: 108,
    borderRadius: 24,
    overflow: "hidden",
  },
  closeButton: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRow: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 14,
  },
  shutterHint: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  shutterTip: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
    marginTop: -6,
  },
  barcodeLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  barcodeLinkText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.primary,
  },
  shutterFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
  },
  disabled: {
    opacity: 0.35,
  },
  shutterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  galleryButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  analyzingCancel: {
    minHeight: 44,
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  analyzingCancelText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  analyzingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  analyzingPreview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  analyzingShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
  },
  analyzingText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  cameraError: {
    position: "absolute",
    bottom: 160,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cameraErrorTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    marginBottom: 4,
  },
  cameraErrorText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  cameraErrorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing.lg,
  },
  cameraRetry: {
    minHeight: 44,
    justifyContent: "center",
  },
  cameraRetryText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  cameraErrorDismiss: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textAlign: "right",
  },

  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  confirmContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  totalBlock: {
    alignItems: "center",
    gap: 2,
    paddingVertical: theme.spacing.xs,
  },
  totalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totalValue: {
    fontSize: theme.fontSize.display,
    fontWeight: "800",
    letterSpacing: -2,
    color: theme.colors.foreground,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  totalUnit: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
  },
  totalReaction: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.makanText,
    marginTop: 2,
    textAlign: "center",
  },
  totalGeprek: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: 2,
  },
  reviewPhotoBlock: {
    gap: theme.spacing.sm,
  },
  reviewPhoto: {
    width: "100%",
    height: 200,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  cropRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  cropTile: {
    width: 96,
    gap: 4,
  },
  cropImage: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  cropSlot: {
    overflow: "hidden",
  },
  cropSlotSticker: {
    backgroundColor: "transparent",
  },
  cropFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cropShimmer: {
    backgroundColor: theme.colors.mutedForeground,
  },
  cropLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  cropThumb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.muted,
  },
  itemMeta: {
    gap: 2,
  },
  itemChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.sm,
    rowGap: 2,
  },
  kcalEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kcalInput: {
    width: 76,
    minHeight: 40,
    paddingHorizontal: 12,
    textAlign: "right",
  },
  kcalUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  mealBlock: {
    gap: theme.spacing.xs,
  },
  mealLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  retryBlock: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  retryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  retryMeta: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  retryInput: {
    flex: 1,
  },
  correctedRow: {
    backgroundColor: theme.colors.makanSoft,
  },
  correctBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.makan,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  correctBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.primaryForeground,
  },
  infoText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  actionSecondary: {
    flexShrink: 0,
  },
  actionPrimary: {
    flex: 1,
  },
  feedbackCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  feedbackHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  feedbackHeadTitle: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  feedbackClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  feedbackRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  feedbackDetail: {
    gap: theme.spacing.md,
  },
  keepPhotoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  keepPhotoBox: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  keepPhotoBoxOn: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  keepPhotoText: {
    flex: 1,
    gap: 2,
  },
  keepPhotoLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  keepPhotoHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  feedbackTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  feedbackSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: 2,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  doneBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  doneText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
  doneActions: {
    alignSelf: "stretch",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
}));
