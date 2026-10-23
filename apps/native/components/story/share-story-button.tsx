import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Asset } from "expo-media-library";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LOCALE, matchLocale } from "@joyorogo/i18n";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  Switch,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale, useEnter } from "@/components/motion";
import { Button, Chip, Segmented, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { InstagramGlyph } from "@/components/story/instagram-glyph";
import { ensureStickerFonts } from "@/components/sticker/fonts";
import { fetchPrivatePhoto } from "@/components/sticker/private-photo";
import { downscalePhoto } from "@/components/sticker/photo";
import {
  DEFAULT_STICKER_PREFS,
  loadStickerPrefs,
  saveStickerPrefs,
  type StickerPrefsState,
} from "@/components/sticker/prefs";
import { designToDp, SceneView, type ImageStatus } from "@/components/sticker/scene-view";
import type { StorySpec } from "@/components/story/types";
import {
  getPhotoAccess,
  instagramFbAppId,
  instagramInstalled,
  isShareCancel,
  requestPhotoAccess,
  shareImagesSystem,
  shareImageSystem,
  shareToInstagram,
  type PhotoAccessLevel,
} from "@/components/story/share";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import {
  availableTemplates,
  renderSlides,
  rogoNativeFonts,
  selectTemplates,
  templateShowsName,
  type CanvasKind,
  type Scene,
  type StickerPrefs,
} from "@joyorogo/sticker";

type ShareStoryButtonProps = {
  story: StorySpec;
  label?: string;
  /** Compact 44px round icon (share-outline); `label` becomes the accessibility label. */
  iconOnly?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "lg" | "sm";
  disabled?: boolean;
  style?: object;
  /** Open on this kind (e.g. "streak") instead of the first one. */
  initialKind?: string;
  /** Offer only these kinds (e.g. the weight screen offers just "weight"). */
  kinds?: string[];
};

type Canvas = CanvasKind;

type Target = "instagram" | "copy" | "save" | "more";

/** Why the photo-library pre-prompt is showing, and which of its two forms. */
type Prompt = {
  mode: "ask" | "blocked";
  level: PhotoAccessLevel;
  purpose: "save" | "instagram";
};

/** granted: go ahead; declined: user chose "Not now"; denied: the system said no. */
type PromptResult = "granted" | "declined" | "denied";

type ActionFailure = { title: string; text: string; retry: () => void };

/** Raised when view-shot cannot produce the PNG; surfaces the "image isn't ready" message. */
class CaptureError extends Error {}

/** Resolves after the next frame, so a just-loaded image has been drawn once. */
function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

const EXPORT_WIDTH = 1080;

/**
 * Checkerboard: a transparent sticker needs a stage that shows the transparency in both themes.
 * Explicit pixel size: react-native-svg keeps a percentage size from its first layout, so a
 * "100%" backdrop stayed the size of the previous sticker when the style changed.
 */
function StickerBackdrop({ light, width, height }: { light: boolean; width: number; height: number }) {
  const a = light ? "#d9d6cf" : "#1a1d1b";
  const b = light ? "#eceae4" : "#262a28";
  return (
    <Svg width={width} height={height} style={styles.backdrop}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill={a} />
          <Rect width={10} height={10} fill={b} />
          <Rect x={10} y={10} width={10} height={10} fill={b} />
        </Pattern>
      </Defs>
      <Rect width={width} height={height} fill="url(#checker)" />
    </Svg>
  );
}

/** One big round-cornered share target: icon over label, spinner while its action runs. */
function TargetTile({
  label,
  busy,
  disabled,
  onPress,
  children,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ComponentProps<typeof View>["children"];
}) {
  const { theme } = useUnistyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.95}
      style={[styles.tile, disabled && !busy && styles.tileDisabled]}
    >
      <View style={styles.tileIcon}>
        {busy ? <ActivityIndicator color={theme.colors.foreground} /> : children}
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * The carousel preview: every slide as its own scaled 1080x1350 frame in a swipeable row that snaps
 * page by page, with a live "2 / 6" count. The frames are the real mounted scenes, so view-shot captures
 * each one through `slideRefs`; they are never unmounted while the pager is open (and the scroll view
 * keeps offscreen children, `removeClippedSubviews` off) so every slide stays capturable.
 */
function CarouselPager({
  scenes,
  sceneW,
  sceneH,
  scale,
  frameW,
  frameH,
  stageH,
  slideRefs,
  onImages,
  loading,
  hint,
}: {
  scenes: Scene[];
  sceneW: number;
  sceneH: number;
  scale: number;
  frameW: number;
  frameH: number;
  stageH: number;
  slideRefs: { current: Array<View | null> };
  onImages: Array<(uri: string, status: ImageStatus) => void>;
  /** One entry per slide: the spinner shows over a slide whose fonts or images are still loading. */
  loading: boolean[];
  hint: string;
}) {
  const { theme } = useUnistyles();
  const screen = useWindowDimensions();
  const [stageW, setStageW] = useState(screen.width - theme.spacing.lg * 2);
  const [page, setPage] = useState(0);
  const gap = theme.spacing.md;
  const step = frameW + gap;
  // Side padding that centres the current frame; the neighbours peek in to show there is more to swipe.
  const inset = Math.max((stageW - frameW) / 2, gap);
  return (
    <View style={styles.pager}>
      <View
        style={[styles.pagerStage, { height: stageH }]}
        onLayout={(event) => setStageW(event.nativeEvent.layout.width)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          snapToInterval={step}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={(event) =>
            setPage(Math.min(Math.max(Math.round(event.nativeEvent.contentOffset.x / step), 0), scenes.length - 1))
          }
          style={styles.pagerScroll}
          contentContainerStyle={[styles.pagerContent, { paddingHorizontal: inset, gap }]}
        >
          {scenes.map((slide, index) => (
            // The pager remounts (keyed by the scene key) whenever the slides change, so the index is a stable key.
            <View key={`slide-${index}`} style={[styles.frame, { width: frameW, height: frameH }]}>
              <View
                pointerEvents="none"
                style={[styles.scaler, { width: sceneW, height: sceneH, transform: [{ scale }] }]}
              >
                <View
                  ref={(node) => {
                    slideRefs.current[index] = node;
                  }}
                  collapsable={false}
                  style={{ width: sceneW, height: sceneH }}
                >
                  <SceneView scene={slide} onImage={onImages[index]} />
                </View>
              </View>
              {loading[index] ? (
                <View style={styles.frameOverlay}>
                  <ActivityIndicator size="large" color="#ffffff" />
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
      <View style={styles.pagerMeta}>
        <Text style={styles.pagerCount}>{`${page + 1} / ${scenes.length}`}</Text>
        <Text style={styles.pagerHint}>{hint}</Text>
      </View>
    </View>
  );
}

function OptionRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.optionRow}>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        {hint ? <Text style={styles.optionHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

/**
 * The share sheet. Screens hand over a `StorySpec`; the sticker engine
 * (packages/sticker) turns it into a Scene for each template that fits the data, and
 * one painter (react-native-svg) draws it. The preview is the real 1080 px scene,
 * mounted live and scaled down inside a frame, and view-shot captures that same view at
 * a fixed 1080 px width only when a target is tapped, after fonts and images are ready.
 * Only the selected template is mounted, so memory stays flat however many styles exist.
 *
 * - Canvas switch (Story 9:16, Kotak 1:1, Stiker transparan), then a row of styles.
 * - Options: hide weight numbers (default on), show my name (default off), the
 *   JoyoRogo mark (removable with Pro), light or dark ink.
 * - Instagram: Story composer with the transparent sticker as an overlay and cards as
 *   background when a Facebook App ID is configured; otherwise the PNG goes to
 *   Instagram's own target (see share.ts). Hidden when Instagram is not installed.
 * - Copy, Save (behind the styled "Lanjut" pre-prompt) and More (system share sheet).
 * - A carousel template (the day of food) renders several scenes: the preview is a swipeable pager, Save
 *   and More send every slide in order, and Instagram and Copy (one image only) are hidden.
 *
 * The sheet is a Modal, which covers the toast layer: successful copy/save close it
 * first and then toast, failures stay inline in the sheet.
 */
export function StoryShareSheet({
  story,
  open,
  onClose,
  initialKind,
  kinds: onlyKinds,
}: {
  story: StorySpec;
  open: boolean;
  onClose: () => void;
  /** The kind (day, streak, weight, ...) to open on, when the entry point is specific. */
  initialKind?: string;
  /** Offer only these kinds. */
  kinds?: string[];
}) {
  const { t, i18n } = useTranslation(["makan", "common", "sticker"]);
  const cardRef = useRef<View>(null);
  // The carousel's own slide views, by slide index (cardRef serves the one-scene stage).
  const slideRefs = useRef<Array<View | null>>([]);
  const promptDecision = useRef<PromiseWithResolvers<boolean> | null>(null);
  const [pickedPhoto, setPickedPhoto] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(initialKind ?? null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  // The private original photo of a meal, fetched with the session; "failed" just drops the photo styles.
  const [original, setOriginal] = useState<string | "failed" | null>(null);
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [actionFailure, setActionFailure] = useState<ActionFailure | null>(null);
  const [igInstalled, setIgInstalled] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [prefs, setPrefs] = useState<StickerPrefsState>(DEFAULT_STICKER_PREFS);
  // The period card's own switch: not remembered between shares, the deficit shows unless this share hides it.
  const [hideDeficit, setHideDeficit] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [fontsFailed, setFontsFailed] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const toast = useToast();
  const { theme, rt } = useUnistyles();
  const screen = useWindowDimensions();
  const enter = useEnter();
  const [ink, setInk] = useState<"dark" | "light" | null>(null);
  const mode = ink ?? (rt.themeName === "light" ? "light" : "dark");
  // Bumped by the retry button after an image failure; remounts the scene so images reload.
  const [attempt, setAttempt] = useState(0);
  const [imageStatus, setImageStatus] = useState<Record<string, ImageStatus>>({});

  const { data: session } = authClient.useSession();
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: open });
  const isPro = profile.data?.tier === "founder";
  const firstName = session?.user.name?.trim().split(/\s+/)[0] || null;
  const locale = matchLocale(i18n.language) ?? DEFAULT_LOCALE;

  // Pro removes the mark; a free user always gets it, whatever was saved.
  const effective: StickerPrefsState = { ...prefs, watermark: isPro ? prefs.watermark : true };

  const stickerPrefs: StickerPrefs = useMemo(
    () => ({
      userName: effective.showName ? firstName : null,
      photo: pickedPhoto ? { uri: pickedPhoto } : original && original !== "failed" ? { uri: original } : null,
      options: {
        hideNumbers: effective.hideNumbers,
        showName: effective.showName && firstName !== null,
        watermark: effective.watermark,
      },
    }),
    [effective.hideNumbers, effective.showName, effective.watermark, firstName, pickedPhoto, original],
  );

  const card = useMemo<StorySpec>(
    () => (story.kind === "period" ? { ...story, hideDeficit } : story),
    [story, hideDeficit],
  );
  const templates = useMemo(
    () => (open ? availableTemplates(card, stickerPrefs) : []),
    [open, card, stickerPrefs],
  );
  // Kind first (Hari ini, Beruntun, ...), then the format it comes in, then its styles; see selectTemplates.
  const selection = useMemo(
    () => selectTemplates(templates, { kind, canvas, templateId }, onlyKinds),
    [templates, kind, canvas, templateId, onlyKinds],
  );
  const { kinds, activeKind, canvases, activeCanvas, styles: inCanvas } = selection;
  const activeTemplate = selection.active;

  const scenes = useMemo(
    () =>
      activeTemplate
        ? renderSlides({
            template: activeTemplate,
            spec: card,
            prefs: stickerPrefs,
            locale,
            mode,
            fonts: rogoNativeFonts,
          })
        : [],
    [activeTemplate, card, stickerPrefs, locale, mode],
  );
  const scene = scenes[0] ?? null;
  // A carousel exports one image per slide; every other template exports exactly one.
  const multi = scenes.length > 1;

  const sceneKey =
    activeTemplate && scene
      ? `${activeTemplate.id}|${attempt}|${mode}|${scenes.map((s) => s.needsImages.join(",")).join(";")}`
      : "";
  const imageKey = (index: number, uri: string) => `${sceneKey}|${index}|${uri}`;
  const imageState = (index: number, uri: string): ImageStatus | "loading" =>
    imageStatus[imageKey(index, uri)] ?? "loading";
  const slideLoading = (index: number) =>
    scenes[index]?.needsImages.some((uri) => imageState(index, uri) === "loading") ?? false;
  const imagesLoading = scenes.some((_, index) => slideLoading(index));
  const imagesFailed = scenes.some((s, index) => s.needsImages.some((uri) => imageState(index, uri) === "error"));
  const ready = scene !== null && fontsReady && !imagesLoading && !imagesFailed && !shrinking;
  const targetsDisabled = !ready || busyTarget != null;

  const slideCount = scenes.length;
  const onImages = useMemo(
    () =>
      Array.from({ length: slideCount }, (_, index) => (uri: string, status: ImageStatus) =>
        setImageStatus((prev) => {
          const key = `${sceneKey}|${index}|${uri}`;
          return prev[key] === "error" ? prev : { ...prev, [key]: status };
        }),
      ),
    [slideCount, sceneKey],
  );

  // A load that never reports (a hung connection) must not leave the sheet spinning forever.
  const imageKeys = scenes.flatMap((s, index) => s.needsImages.map((uri) => imageKey(index, uri))).join("\n");
  useEffect(() => {
    if (!open || !imageKeys) return;
    const timer = setTimeout(() => {
      setImageStatus((prev) => {
        const next = { ...prev };
        for (const key of imageKeys.split("\n")) next[key] ??= "error";
        return next;
      });
    }, 20_000);
    return () => clearTimeout(timer);
  }, [open, imageKeys]);

  // The meal's private original photo: fetched with the session, then handed to the renderer as a file.
  const photoId = story.kind === "meal" ? (story.photoId ?? null) : null;
  useEffect(() => {
    if (!open || photoId === null || original !== null) return;
    let current = true;
    fetchPrivatePhoto(photoId)
      .then(async (uri) => (await downscalePhoto(uri)).uri)
      .then(
        (uri) => current && setOriginal(uri),
        () => current && setOriginal("failed"),
      );
    return () => {
      current = false;
    };
  }, [open, photoId, original]);

  // Fixed 9:16-or-whatever frame sized from the window; the scene keeps its real
  // 1080/PixelRatio dp layout and is shrunk visually by `frameScale`.
  const sceneW = designToDp(EXPORT_WIDTH);
  const sceneH = scene ? designToDp(scene.height) : designToDp(1920);
  const maxFrameH = Math.min(Math.max(screen.height * 0.36, 220), 400);
  const stagePad = theme.spacing.md;
  const maxFrameW = screen.width - theme.spacing.lg * 4;
  const frameScale = Math.min(maxFrameH / sceneH, maxFrameW / sceneW);
  const frameW = Math.round(sceneW * frameScale);
  const frameH = Math.round(sceneH * frameScale);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void instagramInstalled().then((installed) => {
      if (current) setIgInstalled(installed);
    });
    void loadStickerPrefs().then((saved) => {
      if (current) setPrefs(saved);
    });
    ensureStickerFonts().then(
      () => current && setFontsReady(true),
      () => {
        if (!current) return;
        setFontsFailed(true);
        // The system font is a worse sticker than none: let the user retry instead of capturing it.
      },
    );
    return () => {
      current = false;
    };
  }, [open, attempt]);

  const updatePrefs = (patch: Partial<StickerPrefsState>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void saveStickerPrefs(next);
    setActionFailure(null);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const uri = result.canceled ? undefined : result.assets[0]?.uri;
    if (!uri) return;
    setShrinking(true);
    try {
      const small = await downscalePhoto(uri);
      setPickedPhoto(small.uri);
      setActionFailure(null);
      setCanvas("story");
      setTemplateId(null);
      setKind(null);
    } finally {
      setShrinking(false);
    }
  };

  /**
   * Captures every mounted slide (one for a card) at a fixed 1080 px width, one after the other:
   * PNG file URIs, or raw base64 for the clipboard (a single card only). Throws CaptureError when a
   * view is gone or view-shot fails on any slide.
   */
  const captureCards = async (result: "tmpfile" | "base64"): Promise<string[]> => {
    try {
      // Targets are gated on fonts and image loads; two more frames let Android draw the
      // decoded bitmaps before view.draw().
      await nextFrame();
      await nextFrame();
      const captured: string[] = [];
      for (const [index, slide] of scenes.entries()) {
        const view = multi ? slideRefs.current[index] : cardRef.current;
        if (!view) throw new Error("sticker is not mounted");
        captured.push(
          await captureRef(view, {
            format: "png",
            result,
            quality: 1,
            width: EXPORT_WIDTH,
            height: slide.height,
          }),
        );
      }
      if (captured.length === 0) throw new Error("sticker is not mounted");
      return captured;
    } catch (error) {
      console.warn("sticker capture failed", error);
      throw new CaptureError("capture failed", { cause: error });
    }
  };

  const settlePrompt = (granted: boolean) => {
    setPrompt(null);
    setPromptBusy(false);
    promptDecision.current?.resolve(granted);
    promptDecision.current = null;
  };

  /**
   * Photo-library access behind a styled pre-prompt: the system dialog only
   * follows "Continue". An Instagram share that cannot get access is not an
   * error (the caller falls back to the system sheet), so it skips the
   * "blocked" explanation; Save explains and points to Settings.
   */
  const ensurePhotoAccess = async (
    level: PhotoAccessLevel,
    purpose: Prompt["purpose"],
  ): Promise<PromptResult> => {
    const access = await getPhotoAccess(level);
    if (access === "granted") return "granted";
    if (access === "blocked" && purpose === "instagram") return "denied";
    promptDecision.current?.resolve(false);
    const decision = Promise.withResolvers<boolean>();
    promptDecision.current = decision;
    setPrompt({ mode: access, level, purpose });
    return (await decision.promise) ? "granted" : "declined";
  };

  const continuePrompt = async () => {
    if (!prompt) return;
    setPromptBusy(true);
    const granted = await requestPhotoAccess(prompt.level).catch(() => false);
    settlePrompt(granted);
  };

  const closePrompt = () => settlePrompt(false);

  const openSettings = async () => {
    await Linking.openSettings();
    settlePrompt(false);
  };

  const runTarget = async (target: Target) => {
    if (!scene || busyTarget) return;
    // Instagram's composer and the clipboard take one image; a carousel offers neither.
    if (multi && (target === "copy" || target === "instagram")) return;
    const transparent = scene.transparent;
    setBusyTarget(target);
    setActionFailure(null);
    try {
      if (target === "copy") {
        const [base64] = await captureCards("base64");
        await Clipboard.setImageAsync(base64 ?? "");
        onClose();
        toast.success(t("story.share.copied"));
        return;
      }
      const fileUris = await captureCards("tmpfile");
      const fileUri = fileUris[0] ?? "";
      if (target === "more") {
        if (multi) await shareImagesSystem(fileUris, story);
        else await shareImageSystem(fileUri, story);
        onClose();
      } else if (target === "instagram") {
        const appId = instagramFbAppId();
        // iOS's plain Instagram target saves to the library and opens it by asset id,
        // so it needs read/write access first; a refusal there is not an error.
        const access =
          Platform.OS === "ios" && !appId
            ? await ensurePhotoAccess("full", "instagram")
            : "granted";
        if (access === "declined") return;
        if (access === "denied") await shareImageSystem(fileUri, story);
        else await shareToInstagram(fileUri, transparent, appId, story);
        onClose();
      } else {
        // One pre-prompt for the whole batch.
        if ((await ensurePhotoAccess("add", "save")) !== "granted") return;
        for (const savedUri of fileUris) await Asset.create(savedUri);
        onClose();
        toast.success(
          multi ? t("story.share.savedMany", { count: fileUris.length }) : t("story.share.saved"),
          t("story.share.savedNativeBody"),
        );
      }
    } catch (error) {
      if (isShareCancel(error)) return;
      const failedText: Record<Target, string> = {
        instagram: t("story.share.shareFailedTitle"),
        more: t("story.share.shareFailedTitle"),
        copy: t("story.share.copyFailed"),
        save: t("story.share.saveFailed"),
      };
      if (!(error instanceof CaptureError)) console.warn("story share failed", target, error);
      setActionFailure(
        error instanceof CaptureError
          ? {
              title: t("story.share.captureFailedTitle"),
              text: t("story.share.captureFailedBody"),
              retry: () => void runTarget(target),
            }
          : {
              title: failedText[target],
              text: t("story.share.shareFailedBody"),
              retry: () => void runTarget(target),
            },
      );
    } finally {
      setBusyTarget(null);
    }
  };

  const failure: ActionFailure | null = imagesFailed
    ? {
        title: t("story.share.photoFailedTitle"),
        text: t("story.share.photoFailedBody"),
        retry: () => {
          setImageStatus({});
          setAttempt((count) => count + 1);
        },
      }
    : fontsFailed
      ? {
          title: t("story.share.captureFailedTitle"),
          text: t("story.share.captureFailedBody"),
          retry: () => {
            setFontsFailed(false);
            setAttempt((count) => count + 1);
          },
        }
      : actionFailure;

  const promptTitle = prompt
    ? prompt.mode === "blocked"
      ? t("story.share.photosBlockedTitle")
      : prompt.purpose === "instagram"
        ? t("story.share.instagramAskTitle")
        : t("story.share.saveAskTitle")
    : t("story.share.shareToStory");
  const promptBody = prompt
    ? prompt.mode === "blocked"
      ? t("story.share.photosBlockedBody")
      : prompt.purpose === "instagram"
        ? t("story.share.instagramAskBody")
        : t("story.share.saveAskBody")
    : "";

  // Every opening starts from the entry point's kind with nothing remembered from the last one.
  useEffect(() => {
    if (!open) return;
    setKind(initialKind ?? null);
    setCanvas(null);
    setTemplateId(null);
    setOriginal(null);
    setActionFailure(null);
    setFontsReady(false);
    setImageStatus({});
    setHideDeficit(false);
  }, [open, initialKind]);

  const showsName = activeTemplate !== null && templateShowsName(activeTemplate);
  const hasWeight = story.kind === "progress" && !story.maternal && story.weightGoalProgress != null;
  const periodHasWeight = story.kind === "period" && story.weight != null;
  const periodHasEnergy = story.kind === "period" && (story.energy?.countedDays ?? 0) > 0;

  return (
    <>
      <Sheet
        visible={open}
        onClose={() => (prompt ? closePrompt() : onClose())}
        title={promptTitle}
        footer={
          prompt ? (
            <View style={styles.promptFooter}>
              <Button
                variant="secondary"
                label={t("story.share.notNow")}
                onPress={closePrompt}
                style={styles.promptButton}
              />
              {prompt.mode === "blocked" ? (
                <Button
                  label={t("story.share.openSettings")}
                  onPress={() => void openSettings()}
                  style={styles.promptButton}
                />
              ) : (
                <Button
                  label={t("story.share.continue")}
                  loading={promptBusy}
                  onPress={() => void continuePrompt()}
                  style={styles.promptButton}
                />
              )}
            </View>
          ) : undefined
        }
      >
        {prompt ? <Text style={styles.promptBody}>{promptBody}</Text> : null}

        {/* Hidden, not unmounted, while the pre-prompt shows: the scene keeps its loaded photo. */}
        <Animated.View
          entering={enter}
          style={[styles.content, prompt ? styles.contentHidden : null]}
        >
          {kinds.length > 1 ? (
            <ScrollView
              key={`kinds|${kinds.join(",")}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.styleRow}
              accessibilityLabel={t("sticker:sheet.kind")}
            >
              {kinds.map((k) => (
                <Chip
                  key={k}
                  label={t(`sticker:kind.${k}`, { defaultValue: k })}
                  selected={k === activeKind}
                  onPress={() => {
                    setKind(k);
                    setTemplateId(null);
                    setActionFailure(null);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}

          {canvases.length > 0 ? (
            <Segmented
              options={canvases.map((c) => ({ value: c, label: t(`sticker:canvas.${c}`) }))}
              value={activeCanvas}
              onChange={(next) => {
                setCanvas(next);
                setTemplateId(null);
                setActionFailure(null);
              }}
            />
          ) : null}

          {multi ? (
            <CarouselPager
              key={sceneKey}
              scenes={scenes}
              sceneW={sceneW}
              sceneH={sceneH}
              scale={frameScale}
              frameW={frameW}
              frameH={frameH}
              stageH={maxFrameH + stagePad * 2}
              slideRefs={slideRefs}
              onImages={onImages}
              loading={scenes.map((_, index) => !fontsReady || slideLoading(index) || shrinking)}
              hint={t("sticker:sheet.carouselHint", { count: scenes.length })}
            />
          ) : (
            <View style={[styles.stage, { height: maxFrameH + stagePad * 2 }]}>
              <View style={[styles.frame, { width: frameW, height: frameH }]}>
                {scene?.transparent ? (
                  <StickerBackdrop key={`${frameW}x${frameH}`} light={mode === "light"} width={frameW} height={frameH} />
                ) : null}
                {scene ? (
                  <View pointerEvents="none" style={[styles.scaler, { width: sceneW, height: sceneH, transform: [{ scale: frameScale }] }]}>
                    <View
                      key={sceneKey}
                      ref={cardRef}
                      collapsable={false}
                      style={{ width: sceneW, height: sceneH }}
                    >
                      <SceneView scene={scene} onImage={onImages[0]} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.frameOverlay}>
                    <Text style={styles.hint}>{t("sticker:sheet.empty")}</Text>
                  </View>
                )}
                {scene && (!fontsReady || imagesLoading || shrinking) ? (
                  <View style={styles.frameOverlay}>
                    <ActivityIndicator size="large" color="#ffffff" />
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {inCanvas.length > 0 ? (
            <ScrollView
              key={`styles|${activeKind}|${activeCanvas}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.styleRow}
              accessibilityLabel={t("sticker:sheet.pickTemplate")}
            >
              {inCanvas.map((tpl) => (
                <Chip
                  key={tpl.id}
                  label={t(`sticker:style.${tpl.style}`, { defaultValue: tpl.name })}
                  selected={tpl.id === activeTemplate?.id}
                  onPress={() => {
                    setTemplateId(tpl.id);
                    setActionFailure(null);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}

          {failure ? (
            <Animated.View entering={enter} style={styles.errorBox} accessibilityRole="alert">
              <View style={styles.errorIcon}>
                <Ionicons name="alert" size={18} color={theme.colors.destructiveForeground} />
              </View>
              <View style={styles.errorBody}>
                <Text style={styles.errorTitle}>{failure.title}</Text>
                <Text style={styles.errorText}>{failure.text}</Text>
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("common:actions.retry")}
                  icon="refresh"
                  onPress={failure.retry}
                  style={styles.errorRetry}
                />
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.options}>
            <Segmented
              options={[
                { value: "dark", label: t("sticker:sheet.inkDark") },
                { value: "light", label: t("sticker:sheet.inkLight") },
              ]}
              value={mode}
              onChange={setInk}
            />
            {hasWeight ? (
              <OptionRow
                label={t("sticker:sheet.hideNumbers")}
                value={prefs.hideNumbers}
                onChange={(value) => updatePrefs({ hideNumbers: value })}
              />
            ) : null}
            {periodHasWeight ? (
              <OptionRow
                label={t("sticker:sheet.hideWeight")}
                hint={t("sticker:sheet.hideWeightHint")}
                value={prefs.hideNumbers}
                onChange={(value) => updatePrefs({ hideNumbers: value })}
              />
            ) : null}
            {periodHasEnergy ? (
              <OptionRow
                label={t("sticker:sheet.hideDeficit")}
                value={hideDeficit}
                onChange={setHideDeficit}
              />
            ) : null}
            {firstName ? (
              <OptionRow
                label={t("sticker:sheet.showName")}
                hint={showsName ? undefined : t("sticker:sheet.nameUnavailable")}
                value={prefs.showName}
                disabled={!showsName}
                onChange={(value) => updatePrefs({ showName: value })}
              />
            ) : null}
            <OptionRow
              label={t("sticker:sheet.watermark")}
              hint={isPro ? undefined : t("sticker:sheet.proOnly")}
              value={effective.watermark}
              disabled={!isPro}
              onChange={(value) => updatePrefs({ watermark: value })}
            />
          </View>

          {story.kind === "dayfood" ? null : (
            <View style={styles.photoRow}>
              <Button
                variant="ghost"
                size="sm"
                label={pickedPhoto ? t("story.share.changePhoto") : t("story.share.usePhoto")}
                icon="images-outline"
                onPress={() => void pickPhoto()}
              />
            </View>
          )}

          <Text style={styles.targetsLabel}>{t("story.share.targets")}</Text>
          <View style={styles.targets}>
            {igInstalled && !multi ? (
              <TargetTile
                label={t("story.share.instagram")}
                busy={busyTarget === "instagram"}
                disabled={targetsDisabled}
                onPress={() => void runTarget("instagram")}
              >
                <InstagramGlyph size={26} color={theme.colors.foreground} />
              </TargetTile>
            ) : null}
            {multi ? null : (
              <TargetTile
                label={t("story.share.copy")}
                busy={busyTarget === "copy"}
                disabled={targetsDisabled}
                onPress={() => void runTarget("copy")}
              >
                <Ionicons name="copy-outline" size={26} color={theme.colors.foreground} />
              </TargetTile>
            )}
            <TargetTile
              label={t("story.share.save")}
              busy={busyTarget === "save"}
              disabled={targetsDisabled}
              onPress={() => void runTarget("save")}
            >
              <Ionicons name="download-outline" size={26} color={theme.colors.foreground} />
            </TargetTile>
            <TargetTile
              label={t("story.share.more")}
              busy={busyTarget === "more"}
              disabled={targetsDisabled}
              onPress={() => void runTarget("more")}
            >
              <Ionicons name="ellipsis-horizontal" size={26} color={theme.colors.foreground} />
            </TargetTile>
          </View>
        </Animated.View>
      </Sheet>
    </>
  );
}

export function ShareStoryButton({
  story,
  label: labelProp,
  iconOnly = false,
  variant = "primary",
  size,
  disabled,
  style,
  initialKind,
  kinds,
}: ShareStoryButtonProps) {
  const { t } = useTranslation(["makan"]);
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const label = labelProp ?? t("story.share.shareToStory");
  return (
    <>
      <View style={style}>
        {iconOnly ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => setOpen(true)}
            style={styles.iconButton}
            dimTo={0.75}
            scaleTo={0.94}
          >
            <Ionicons name="share-outline" size={22} color={theme.colors.foreground} />
          </PressableScale>
        ) : (
          <Button label={label} variant={variant} size={size} disabled={disabled} onPress={() => setOpen(true)} />
        )}
      </View>
      <StoryShareSheet story={story} open={open} onClose={() => setOpen(false)} initialKind={initialKind} kinds={kinds} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing.md },
  contentHidden: { display: "none" },
  stage: {
    alignItems: "center",
    borderRadius: theme.radius.tile,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
    justifyContent: "center",
  },
  frame: { borderRadius: theme.radius.input, overflow: "hidden" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // The scene keeps its real design-px layout (so a 1:1 capture is 1080 px wide) and is
  // shrunk visually from the top-left corner to exactly fill the frame.
  scaler: {
    position: "absolute",
    top: 0,
    left: 0,
    transformOrigin: "top left",
  },
  frameOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  styleRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  hint: {
    textAlign: "center",
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.sm,
    color: "#ffffff",
    paddingHorizontal: theme.spacing.md,
  },
  options: { gap: theme.spacing.sm },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  optionHint: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  photoRow: { alignItems: "center" },
  targetsLabel: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  targets: { flexDirection: "row", gap: theme.spacing.sm },
  pager: { gap: theme.spacing.sm },
  pagerStage: {
    borderRadius: theme.radius.tile,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  pagerScroll: { flex: 1 },
  pagerContent: { alignItems: "center" },
  pagerMeta: { alignItems: "center", gap: 2 },
  pagerCount: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  pagerHint: {
    textAlign: "center",
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  tileDisabled: { opacity: 0.45 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  tileIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  tileLabel: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  promptBody: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.mutedForeground,
  },
  promptFooter: { flexDirection: "row", gap: theme.spacing.md },
  promptButton: { flex: 1 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.background,
  },
  errorIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.destructive,
  },
  errorBody: { flex: 1, gap: theme.spacing.xs },
  errorTitle: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  errorText: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  errorRetry: { alignSelf: "flex-start", marginTop: theme.spacing.sm },
}));
