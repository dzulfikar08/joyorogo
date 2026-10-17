import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Asset } from "expo-media-library";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Segmented, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { InstagramGlyph } from "@/components/story/instagram-glyph";
import {
  CARD_H,
  CARD_W,
  STORY_TEMPLATES,
  StoryCard,
  storyPhotoUri,
  storyShowsPhoto,
  type StoryPhotoStatus,
  type StorySpec,
  type StoryTemplate,
} from "@/components/story/story-card";
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

type ShareStoryButtonProps = {
  story: StorySpec;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "lg" | "sm";
  disabled?: boolean;
  style?: object;
};

type PhotoState = StoryPhotoStatus | "loading";

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

/** Dark checkerboard: the sticker is white text on transparent, so it needs a dark stage in both themes. */
function StickerBackdrop() {
  return (
    <Svg width="100%" height="100%" style={styles.backdrop}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill="#1a1d1b" />
          <Rect width={10} height={10} fill="#262a28" />
          <Rect x={10} y={10} width={10} height={10} fill="#262a28" />
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        disabled && !busy && styles.tileDisabled,
        pressed && styles.tilePressed,
      ]}
    >
      <View style={styles.tileIcon}>
        {busy ? <ActivityIndicator color={theme.colors.foreground} /> : children}
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Strava-style share sheet: a preview of the story card, a template switcher
 * (photo + stats, transparent stats sticker, branded card), a photo swap, and
 * four big targets: Instagram, Copy, Save and More.
 *
 * - Instagram: direct to the Story composer when a Facebook App ID is
 *   configured, otherwise the PNG goes to Instagram's own share target (see
 *   share.ts). Hidden when the Instagram app is not installed.
 * - Copy puts the PNG on the clipboard, Save adds it to the gallery behind a
 *   styled pre-prompt ("Continue", then the system dialog), More opens the
 *   system share sheet.
 *
 * Pure data in: screens own their queries, the social feed can reuse the same
 * cards. The preview is the real 1080x1920 card, mounted live and scaled down
 * with a transform inside a 9:16 frame, so it is always visible. view-shot
 * captures that same mounted view only when a target is tapped, after the photo
 * has fired onLoad and one more frame has passed.
 *
 * The sheet is a Modal, which covers the toast layer: successful copy/save
 * close it first and then toast, failures stay inline in the sheet.
 */
export function ShareStoryButton({
  story,
  label: labelProp,
  variant = "primary",
  size,
  disabled,
  style,
}: ShareStoryButtonProps) {
  const { t } = useTranslation(["makan", "common"]);
  const label = labelProp ?? t("story.share.shareToStory");
  const cardRefs = useRef<Partial<Record<StoryTemplate, View | null>>>({});
  const scrollRef = useRef<ScrollView>(null);
  const promptDecision = useRef<PromiseWithResolvers<boolean> | null>(null);
  const [open, setOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [actionFailure, setActionFailure] = useState<ActionFailure | null>(null);
  const [igInstalled, setIgInstalled] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  // Bumped by the retry button after a photo failure; remounts the cards so the image reloads.
  const [attempt, setAttempt] = useState(0);
  const [photoStatus, setPhotoStatus] = useState<Record<string, StoryPhotoStatus>>({});
  const toast = useToast();
  const { theme } = useUnistyles();
  const screen = useWindowDimensions();

  const effectivePhoto = photoUri ?? storyPhotoUri(story);
  const templates = useMemo(
    () => STORY_TEMPLATES.filter((candidate) => !candidate.needsPhoto || effectivePhoto != null),
    [effectivePhoto],
  );

  // Fixed 9:16 frame sized from the window; the card inside keeps its real
  // 1080/PixelRatio dp layout and is shrunk visually by `scale`.
  const maxFrameH = Math.min(Math.max(screen.height * 0.36, 220), 400);
  const frameW = Math.round((maxFrameH * CARD_W) / CARD_H);
  const frameH = (frameW * CARD_H) / CARD_W;
  const scale = frameW / CARD_W;
  const [pageW, setPageW] = useState(Math.max(screen.width - theme.spacing.lg * 2, frameW));

  const cardKey = (id: StoryTemplate) => `${id}|${effectivePhoto}|${attempt}`;
  const photoState = (id: StoryTemplate): PhotoState =>
    storyShowsPhoto(story, id, effectivePhoto) ? (photoStatus[cardKey(id)] ?? "loading") : "ready";

  const activeTemplate = templates[active];
  const activeReady = activeTemplate != null && photoState(activeTemplate.id) === "ready";
  const photoFailed = templates.some((candidate) => photoState(candidate.id) === "error");
  const targetsDisabled = !activeReady || photoFailed || busyTarget != null;

  useEffect(() => {
    if (!open) return;
    let current = true;
    void instagramInstalled().then((installed) => {
      if (current) setIgInstalled(installed);
    });
    return () => {
      current = false;
    };
  }, [open]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
      setActionFailure(null);
      // The photo template appears at index 0; jump to it so the pick is visible.
      setActive(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  };

  /** Segmented control tap: page the preview to the template at `index`. */
  const goTo = (index: number) => {
    if (index < 0 || index === active) return;
    setActive(index);
    setActionFailure(null);
    scrollRef.current?.scrollTo({ x: index * pageW, animated: true });
  };

  /**
   * Captures the mounted card: a PNG file URI, or raw base64 for the clipboard.
   * Throws CaptureError when the view is gone or view-shot fails.
   */
  const captureCard = async (id: StoryTemplate, result: "tmpfile" | "base64"): Promise<string> => {
    try {
      // The photo's onLoad already fired (the targets are gated on it); one more
      // frame lets Android draw the decoded bitmap before view.draw().
      await nextFrame();
      await nextFrame();
      const view = cardRefs.current[id];
      if (!view) throw new Error("story card is not mounted");
      return await captureRef(view, { format: "png", result, quality: 1 });
    } catch (error) {
      console.warn("story capture failed", id, error);
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
    if (!activeTemplate || busyTarget) return;
    const id = activeTemplate.id;
    setBusyTarget(target);
    setActionFailure(null);
    try {
      if (target === "copy") {
        await Clipboard.setImageAsync(await captureCard(id, "base64"));
        setOpen(false);
        toast.success(t("story.share.copied"));
        return;
      }
      const fileUri = await captureCard(id, "tmpfile");
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
        else await shareToInstagram(fileUri, id, appId, story);
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

  const failure: ActionFailure | null = photoFailed
    ? {
        title: t("story.share.photoFailedTitle"),
        text: t("story.share.photoFailedBody"),
        retry: () => setAttempt((count) => count + 1),
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

  return (
    <>
      <View style={style}>
        <Button
          label={label}
          variant={variant}
          size={size}
          disabled={disabled}
          onPress={() => {
            setActive(0);
            setActionFailure(null);
            setOpen(true);
          }}
        />
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

        {/* Hidden, not unmounted, while the pre-prompt shows: the cards keep their loaded photos. */}
        <View style={[styles.content, prompt ? styles.contentHidden : null]}>
          {activeTemplate ? (
            <Segmented
              options={templates.map((candidate) => ({
                value: candidate.id,
                label: t(`story.card.template.${candidate.id}.label`),
              }))}
              value={activeTemplate.id}
              onChange={(id) => goTo(templates.findIndex((candidate) => candidate.id === id))}
            />
          ) : null}

          <View
            style={styles.stage}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              if (width > 0) setPageW(width);
            }}
          >
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              removeClippedSubviews={false}
              showsHorizontalScrollIndicator={false}
              style={{ height: frameH, flexGrow: 0 }}
              onMomentumScrollEnd={(event) => {
                const page = Math.round(event.nativeEvent.contentOffset.x / pageW);
                const next = Math.min(Math.max(page, 0), templates.length - 1);
                if (next !== active) setActionFailure(null);
                setActive(next);
              }}
            >
              {templates.map((candidate) => (
                <View
                  key={cardKey(candidate.id)}
                  style={[styles.page, { width: pageW, height: frameH }]}
                >
                  <View style={[styles.frame, { width: frameW, height: frameH }]}>
                    {candidate.id === "sticker" ? <StickerBackdrop /> : null}
                    <View pointerEvents="none" style={[styles.scaler, { transform: [{ scale }] }]}>
                      <View
                        ref={(view) => {
                          cardRefs.current[candidate.id] = view;
                        }}
                        collapsable={false}
                        style={styles.card}
                      >
                        <StoryCard
                          story={story}
                          template={candidate.id}
                          photoUri={effectivePhoto}
                          onPhotoStatus={(status) =>
                            setPhotoStatus((prev) => ({
                              ...prev,
                              [cardKey(candidate.id)]: status,
                            }))
                          }
                        />
                      </View>
                    </View>
                    {photoState(candidate.id) === "loading" ? (
                      <View style={styles.frameOverlay}>
                        <ActivityIndicator size="large" color="#ffffff" />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>

          {activeTemplate ? (
            <Text style={styles.hint}>{t(`story.card.template.${activeTemplate.id}.hint`)}</Text>
          ) : null}

          {failure ? (
            <View style={styles.errorBox} accessibilityRole="alert">
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
            </View>
          ) : null}

          <View style={styles.photoRow}>
            <Button
              variant="ghost"
              size="sm"
              label={effectivePhoto ? t("story.share.changePhoto") : t("story.share.usePhoto")}
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
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing.md },
  contentHidden: { display: "none" },
  stage: {
    borderRadius: theme.radius.tile,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
    paddingVertical: theme.spacing.md,
  },
  page: { alignItems: "center", justifyContent: "center" },
  frame: { borderRadius: theme.radius.input, overflow: "hidden" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // The card keeps its real CARD_W x CARD_H layout (so a 1:1 capture is 1080x1920 px)
  // and is shrunk visually from the top-left corner to exactly fill the frame.
  scaler: {
    position: "absolute",
    top: 0,
    left: 0,
    width: CARD_W,
    height: CARD_H,
    transformOrigin: "top left",
  },
  card: { width: CARD_W, height: CARD_H },
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
  hint: {
    textAlign: "center",
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
  tilePressed: { opacity: 0.75 },
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
