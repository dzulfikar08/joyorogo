import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Asset } from "expo-media-library";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
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
  shareImageSystem,
  shareToInstagram,
  type PhotoAccessLevel,
} from "@/components/story/share";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import {
  availableTemplates,
  renderSticker,
  rogoNativeFonts,
  type StickerPrefs,
  type Template,
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
};

type Canvas = "story" | "square" | "sticker";

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

function canvasOf(template: Template): Canvas {
  if (template.meta?.transparent) return "sticker";
  return template.canvas.aspect === "square" ? "square" : "story";
}

/** Checkerboard: a transparent sticker needs a stage that shows the transparency in both themes. */
function StickerBackdrop({ light }: { light: boolean }) {
  const a = light ? "#d9d6cf" : "#1a1d1b";
  const b = light ? "#eceae4" : "#262a28";
  return (
    <Svg width="100%" height="100%" style={styles.backdrop}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill={a} />
          <Rect width={10} height={10} fill={b} />
          <Rect x={10} y={10} width={10} height={10} fill={b} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#checker)" />
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
 *
 * The sheet is a Modal, which covers the toast layer: successful copy/save close it
 * first and then toast, failures stay inline in the sheet.
 */
export function ShareStoryButton({
  story,
  label: labelProp,
  iconOnly = false,
  variant = "primary",
  size,
  disabled,
  style,
}: ShareStoryButtonProps) {
  const { t, i18n } = useTranslation(["makan", "common", "sticker"]);
  const label = labelProp ?? t("story.share.shareToStory");
  const cardRef = useRef<View>(null);
  const promptDecision = useRef<PromiseWithResolvers<boolean> | null>(null);
  const [open, setOpen] = useState(false);
  const [pickedPhoto, setPickedPhoto] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<Canvas>("story");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [actionFailure, setActionFailure] = useState<ActionFailure | null>(null);
  const [igInstalled, setIgInstalled] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [prefs, setPrefs] = useState<StickerPrefsState>(DEFAULT_STICKER_PREFS);
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
  const locale = i18n.language === "en" ? "en" : "id";

  // Pro removes the mark; a free user always gets it, whatever was saved.
  const effective: StickerPrefsState = { ...prefs, watermark: isPro ? prefs.watermark : true };

  const stickerPrefs: StickerPrefs = useMemo(
    () => ({
      userName: effective.showName ? firstName : null,
      photo: pickedPhoto ? { uri: pickedPhoto } : null,
      options: {
        hideNumbers: effective.hideNumbers,
        showName: effective.showName && firstName !== null,
        watermark: effective.watermark,
      },
    }),
    [effective.hideNumbers, effective.showName, effective.watermark, firstName, pickedPhoto],
  );

  const templates = useMemo(
    () => (open ? availableTemplates(story, stickerPrefs) : []),
    [open, story, stickerPrefs],
  );
  const canvases = useMemo(
    () => (["story", "square", "sticker"] as const).filter((c) => templates.some((tpl) => canvasOf(tpl) === c)),
    [templates],
  );
  const activeCanvas = canvases.includes(canvas) ? canvas : (canvases[0] ?? "story");
  const inCanvas = useMemo(
    () => templates.filter((tpl) => canvasOf(tpl) === activeCanvas),
    [templates, activeCanvas],
  );
  const activeTemplate = inCanvas.find((tpl) => tpl.id === templateId) ?? inCanvas[0] ?? null;

  const scene = useMemo(
    () =>
      activeTemplate
        ? renderSticker({
            template: activeTemplate,
            spec: story,
            prefs: stickerPrefs,
            locale,
            mode,
            fonts: rogoNativeFonts,
          })
        : null,
    [activeTemplate, story, stickerPrefs, locale, mode],
  );

  const sceneKey = scene && activeTemplate ? `${activeTemplate.id}|${attempt}|${mode}|${scene.needsImages.join(",")}` : "";
  const imageState = (uri: string): ImageStatus | "loading" => imageStatus[`${sceneKey}|${uri}`] ?? "loading";
  const imagesLoading = scene?.needsImages.some((uri) => imageState(uri) === "loading") ?? false;
  const imagesFailed = scene?.needsImages.some((uri) => imageState(uri) === "error") ?? false;
  const ready = scene !== null && fontsReady && !imagesLoading && !imagesFailed && !shrinking;
  const targetsDisabled = !ready || busyTarget != null;

  const onImage = useCallback(
    (uri: string, status: ImageStatus) =>
      setImageStatus((prev) => {
        const key = `${sceneKey}|${uri}`;
        return prev[key] === "error" ? prev : { ...prev, [key]: status };
      }),
    [sceneKey],
  );

  // react-native-svg's Image reports loads but not failures: probe each image so a bad or
  // missing file shows the retry box, and give up when it never reports a load.
  const needsImages = scene?.needsImages.join("\n") ?? "";
  useEffect(() => {
    if (!open || !needsImages) return;
    let current = true;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const uri of needsImages.split("\n")) {
      Image.getSize(
        uri,
        () => {
          timers.push(
            setTimeout(() => {
              if (current) setImageStatus((prev) => (prev[`${sceneKey}|${uri}`] ? prev : { ...prev, [`${sceneKey}|${uri}`]: "error" }));
            }, 8000),
          );
        },
        () => current && setImageStatus((prev) => ({ ...prev, [`${sceneKey}|${uri}`]: "error" })),
      );
    }
    return () => {
      current = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [open, needsImages, sceneKey]);

  // Fixed 9:16-or-whatever frame sized from the window; the scene keeps its real
  // 1080/PixelRatio dp layout and is shrunk visually by `frameScale`.
  const sceneW = designToDp(EXPORT_WIDTH);
  const sceneH = scene ? designToDp(scene.height) : designToDp(1920);
  const maxFrameH = Math.min(Math.max(screen.height * 0.36, 220), 400);
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
    } finally {
      setShrinking(false);
    }
  };

  /**
   * Captures the mounted scene at a fixed 1080 px width: a PNG file URI, or raw base64
   * for the clipboard. Throws CaptureError when the view is gone or view-shot fails.
   */
  const captureCard = async (result: "tmpfile" | "base64"): Promise<string> => {
    try {
      // Targets are gated on fonts and image loads; two more frames let Android draw the
      // decoded bitmaps before view.draw().
      await nextFrame();
      await nextFrame();
      const view = cardRef.current;
      if (!view || !scene) throw new Error("sticker is not mounted");
      return await captureRef(view, {
        format: "png",
        result,
        quality: 1,
        width: EXPORT_WIDTH,
        height: scene.height,
      });
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
    const transparent = scene.transparent;
    setBusyTarget(target);
    setActionFailure(null);
    try {
      if (target === "copy") {
        await Clipboard.setImageAsync(await captureCard("base64"));
        setOpen(false);
        toast.success(t("story.share.copied"));
        return;
      }
      const fileUri = await captureCard("tmpfile");
      if (target === "more") {
        await shareImageSystem(fileUri, story);
        setOpen(false);
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
        setOpen(false);
      } else {
        if ((await ensurePhotoAccess("add", "save")) !== "granted") return;
        await Asset.create(fileUri);
        setOpen(false);
        toast.success(t("story.share.saved"), t("story.share.savedNativeBody"));
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

  const openSheet = () => {
    setCanvas("story");
    setTemplateId(null);
    setActionFailure(null);
    setFontsReady(false);
    setImageStatus({});
    setOpen(true);
  };

  const hasWeight = story.kind === "progress" && !story.maternal && story.weightGoalProgress != null;

  return (
    <>
      <View style={style}>
        {iconOnly ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={openSheet}
            style={styles.iconButton}
            dimTo={0.75}
            scaleTo={0.94}
          >
            <Ionicons name="share-outline" size={22} color={theme.colors.foreground} />
          </PressableScale>
        ) : (
          <Button label={label} variant={variant} size={size} disabled={disabled} onPress={openSheet} />
        )}
      </View>

      <Sheet
        visible={open}
        onClose={() => (prompt ? closePrompt() : setOpen(false))}
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
          {canvases.length > 1 ? (
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

          <View style={styles.stage}>
            <View style={[styles.frame, { width: frameW, height: frameH }]}>
              {scene?.transparent ? <StickerBackdrop light={mode === "light"} /> : null}
              {scene ? (
                <View pointerEvents="none" style={[styles.scaler, { width: sceneW, height: sceneH, transform: [{ scale: frameScale }] }]}>
                  <View
                    key={sceneKey}
                    ref={cardRef}
                    collapsable={false}
                    style={{ width: sceneW, height: sceneH }}
                  >
                    <SceneView scene={scene} onImage={onImage} />
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

          {inCanvas.length > 1 ? (
            <ScrollView
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
            {firstName ? (
              <OptionRow
                label={t("sticker:sheet.showName")}
                value={prefs.showName}
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

          <View style={styles.photoRow}>
            <Button
              variant="ghost"
              size="sm"
              label={pickedPhoto ? t("story.share.changePhoto") : t("story.share.usePhoto")}
              icon="images-outline"
              onPress={() => void pickPhoto()}
            />
          </View>

          <Text style={styles.targetsLabel}>{t("story.share.targets")}</Text>
          <View style={styles.targets}>
            {igInstalled ? (
              <TargetTile
                label={t("story.share.instagram")}
                busy={busyTarget === "instagram"}
                disabled={targetsDisabled}
                onPress={() => void runTarget("instagram")}
              >
                <InstagramGlyph size={26} color={theme.colors.foreground} />
              </TargetTile>
            ) : null}
            <TargetTile
              label={t("story.share.copy")}
              busy={busyTarget === "copy"}
              disabled={targetsDisabled}
              onPress={() => void runTarget("copy")}
            >
              <Ionicons name="copy-outline" size={26} color={theme.colors.foreground} />
            </TargetTile>
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

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing.md },
  contentHidden: { display: "none" },
  stage: {
    alignItems: "center",
    borderRadius: theme.radius.tile,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
    paddingVertical: theme.spacing.md,
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
