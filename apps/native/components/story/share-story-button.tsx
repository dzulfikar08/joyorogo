import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  CARD_H,
  CARD_W,
  STORY_TEMPLATES,
  StoryCard,
  storyPhotoUri,
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

/**
 * Opens a preview sheet with the three story templates (photo + stats,
 * transparent stats sticker, branded card), lets the user swap the background
 * photo from the gallery, and shares the picked render — to Instagram's story
 * composer when a Facebook App ID is configured, else via the system share
 * sheet. Pure data in — screens own their queries, the social feed can reuse
 * the same cards.
 */
export function ShareStoryButton({
  story,
  label = "Bagikan ke Story",
  variant = "primary",
  size,
  disabled,
  style,
}: ShareStoryButtonProps) {
  const cardRefs = useRef<Array<View | null>>([]);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<string[] | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { theme } = useUnistyles();

  const defaultPhoto = storyPhotoUri(story);
  const effectivePhoto = photoUri ?? defaultPhoto;
  const templates = useMemo(
    () => STORY_TEMPLATES.filter((candidate) => !candidate.needsPhoto || effectivePhoto != null),
    [effectivePhoto],
  );

  // The offscreen cards mount in the same commit that opens the sheet, so the
  // first capture can run before Android has laid them out (or the photo has
  // decoded) and view-shot throws. Wait a few frames, retry with backoff, and
  // only fail the templates that still can't be drawn.
  const capturePreviews = useCallback(async (isCancelled: () => boolean) => {
    const uris: string[] = [];
    for (const index of templates.keys()) {
      let uri: string | null = null;
      for (let attempt = 0; attempt < 4 && uri == null; attempt++) {
        const { promise: settled, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 250 * (attempt + 1));
        await settled;
        if (isCancelled()) return;
        const view = cardRefs.current[index];
        if (!view) continue;
        try {
          uri = await captureRef(view, { format: "png", quality: 1 });
        } catch (error) {
          console.warn("story preview capture failed", templates[index]?.id, attempt, error);
        }
      }
      if (uri == null) throw new Error(`capture failed: ${templates[index]?.id}`);
      uris.push(uri);
    }
    if (!isCancelled()) setPreviews(uris);
  }, [templates]);

  useEffect(() => {
    if (!open) {
      setPreviews(null);
      return;
    }
    let cancelled = false;
    capturePreviews(() => cancelled).catch(() => {
      if (!cancelled) toast.error("Gagal menyiapkan pratinjau", "Coba lagi sebentar ya.");
    });
    return () => {
      cancelled = true;
    };
    // toast is stable per provider; capture reruns only when templates/photo change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, capturePreviews]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
      setPreviews(null);
    }
  };

  const share = async () => {
    const fileUri = previews?.[active];
    if (!fileUri || busy) return;
    setBusy(true);
    try {
      await shareStoryImage(fileUri, templates[active]!.id, instagramFbAppId());
      setOpen(false);
    } catch (error) {
      if (!isShareCancel(error)) {
        toast.error("Gagal membagikan", "Coba lagi sebentar ya.");
      }
    } finally {
      setBusy(false);
    }
  };

  const activeTemplate = templates[active];

  return (
    <>
      {/* Offscreen 1080x1920 renders; captured only while the sheet is open. */}
      {open ? (
        <View pointerEvents="none" style={styles.offscreenWrap}>
          {templates.map((candidate, index) => (
            <View
              key={candidate.id}
              ref={(view) => {
                cardRefs.current[index] = view;
              }}
              collapsable={false}
              style={styles.offscreenCard}
            >
              <StoryCard
                story={story}
                template={candidate.id}
              />
            </View>
          ))}
        </View>
      ) : null}

      <View style={style}>
        <Button
          label={label}
          variant={variant}
          size={size}
          disabled={disabled}
          onPress={() => setOpen(true)}
        />
      </View>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Bagikan ke Story"
      >
        <View style={styles.previewWrap}>
          {previews ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                setActive(
                  Math.min(
                    Math.max(Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width), 0),
                    templates.length - 1,
                  ),
                );
              }}
            >
              {previews.map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.preview} resizeMode="cover" />
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.preview, styles.previewLoading]}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.dotsRow}>
          {templates.map((candidate, index) => (
            <View
              key={candidate.id}
              style={[styles.dot, index === active ? styles.dotActive : null]}
            />
          ))}
        </View>

        {activeTemplate ? (
          <View style={styles.templateCaption}>
            <Text style={styles.templateName}>{activeTemplate.label}</Text>
            <Text style={styles.templateHint}>{activeTemplate.hint}</Text>
          </View>
        ) : null}

        <Button
          variant="secondary"
          label={effectivePhoto ? "Pilih foto lain" : "Pakai fotoku"}
          icon="images-outline"
          onPress={() => void pickPhoto()}
        />
        <View style={styles.actions}>
          <Button variant="ghost" label="Batal" onPress={() => setOpen(false)} />
          <Button
            label={busy ? "Menyiapkan…" : "Bagikan"}
            loading={busy}
            disabled={previews == null}
            onPress={() => void share()}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Fully offscreen but rendered: view-shot needs mounted, non-collapsing views.
  offscreenWrap: { position: "absolute" },
  offscreenCard: {
    position: "absolute",
    top: -CARD_H * 3,
    left: 0,
    width: CARD_W,
    height: CARD_H,
  },
  previewWrap: { borderRadius: theme.radius.tile, overflow: "hidden", backgroundColor: theme.colors.muted },
  preview: { width: "100%", aspectRatio: 9 / 16, maxHeight: 420 },
  previewLoading: { alignItems: "center", justifyContent: "center" },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: theme.spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.hairline },
  dotActive: { width: 24, backgroundColor: theme.colors.primary },
  templateCaption: { alignItems: "center", marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  templateName: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  templateHint: { fontFamily: theme.fonts.regular, fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.md },
}));
