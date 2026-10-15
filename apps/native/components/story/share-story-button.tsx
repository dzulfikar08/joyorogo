import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, useWindowDimensions, View } from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Segmented, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
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
import { instagramFbAppId, isShareCancel, shareStoryImage } from "@/components/story/share";

type ShareStoryButtonProps = {
  story: StorySpec;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "lg" | "sm";
  disabled?: boolean;
  style?: object;
};

type PhotoState = StoryPhotoStatus | "loading";

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

/**
 * Opens a preview sheet with the three story templates (photo + stats,
 * transparent stats sticker, branded card), lets the user swap the background
 * photo from the gallery, and shares the picked render — to Instagram's story
 * composer when a Facebook App ID is configured, else via the system share
 * sheet. Pure data in — screens own their queries, the social feed can reuse
 * the same cards.
 *
 * The preview is the real 1080x1920 card, mounted live and scaled down with a
 * transform inside a 9:16 frame, so it is always visible. view-shot captures
 * that same mounted view only when the user taps Bagikan, after the photo has
 * fired onLoad and one more frame has passed.
 */
export function ShareStoryButton({
  story,
  label = "Bagikan ke Story",
  variant = "primary",
  size,
  disabled,
  style,
}: ShareStoryButtonProps) {
  const cardRefs = useRef<Partial<Record<StoryTemplate, View | null>>>({});
  const scrollRef = useRef<ScrollView>(null);
  const [open, setOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  // Bumped by "Coba lagi" after a photo failure; remounts the cards so the image reloads.
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
  const maxFrameH = Math.min(Math.max(screen.height * 0.44, 240), 460);
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

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
      setCaptureFailed(false);
      // The photo template appears at index 0; jump to it so the pick is visible.
      setActive(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  };

  /** Segmented control tap: page the preview to the template at `index`. */
  const goTo = (index: number) => {
    if (index < 0 || index === active) return;
    setActive(index);
    setCaptureFailed(false);
    scrollRef.current?.scrollTo({ x: index * pageW, animated: true });
  };

  /** Captures the mounted card as a PNG file; null when the view is gone or view-shot throws. */
  const captureCard = async (id: StoryTemplate): Promise<string | null> => {
    try {
      // The photo's onLoad already fired (Bagikan is gated on it); one more
      // frame lets Android draw the decoded bitmap before view.draw().
      await nextFrame();
      await nextFrame();
      const view = cardRefs.current[id];
      if (!view) throw new Error("story card is not mounted");
      return await captureRef(view, { format: "png", result: "tmpfile", quality: 1 });
    } catch (error) {
      console.warn("story capture failed", id, error);
      return null;
    }
  };

  const share = async () => {
    if (!activeTemplate || busy) return;
    setBusy(true);
    setCaptureFailed(false);
    try {
      const fileUri = await captureCard(activeTemplate.id);
      if (fileUri == null) {
        setCaptureFailed(true);
        return;
      }
      await shareStoryImage(fileUri, activeTemplate.id, instagramFbAppId(), story);
      setOpen(false);
    } catch (error) {
      if (!isShareCancel(error)) {
        toast.error("Gagal membagikan", "Coba lagi sebentar ya.");
      }
    } finally {
      setBusy(false);
    }
  };

  const failure = photoFailed
    ? {
        title: "Foto gagal dimuat",
        text: "Cek koneksimu atau pilih foto lain, lalu coba lagi.",
        retry: () => setAttempt((count) => count + 1),
      }
    : captureFailed
      ? {
          title: "Gambar story belum jadi",
          text: "Pratinjau aman, tapi gambarnya gagal dibuat. Coba lagi ya.",
          retry: () => void share(),
        }
      : null;

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
            setCaptureFailed(false);
            setOpen(true);
          }}
        />
      </View>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Bagikan ke Story"
        footer={
          <Button
            label={busy ? "Menyiapkan…" : "Bagikan"}
            icon="share-outline"
            loading={busy}
            disabled={!activeReady || photoFailed}
            onPress={() => void share()}
          />
        }
      >
        {activeTemplate ? (
          <Segmented
            options={templates.map((candidate) => ({
              value: candidate.id,
              label: candidate.label,
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
              if (next !== active) setCaptureFailed(false);
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
                          setPhotoStatus((prev) => ({ ...prev, [cardKey(candidate.id)]: status }))
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

        {activeTemplate ? <Text style={styles.hint}>{activeTemplate.hint}</Text> : null}

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
                label="Coba lagi"
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
            label={effectivePhoto ? "Ganti foto" : "Pakai fotoku"}
            icon="images-outline"
            onPress={() => void pickPhoto()}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
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
