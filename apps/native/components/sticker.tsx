import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import { Platform } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { File, Paths } from "expo-file-system";

import { Text } from "@/components/ui";
import { MetaLine } from "@/components/meta-line";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { authClient } from "@/lib/auth-client";
// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";
import { fmtKcal } from "@/utils/format";

export function stickerUrl(scanId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/sticker/${scanId}`;
}

/** Original scan photo; the server only serves it to its owner's session. */
function photoUrl(photoId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/photo/${photoId}`;
}

/** Cutouts are made in the background after saving: retry briefly, then give up. */
const RETRY_DELAYS_MS = [3000, 6000, 12000];

const OUTLINE_OFFSETS = [
  [1.5, 0],
  [-1.5, 0],
  [0, 1.5],
  [0, -1.5],
  [1.1, 1.1],
  [-1.1, 1.1],
  [1.1, -1.1],
  [-1.1, -1.1],
] as const;

/**
 * Die-cut sticker: the cutout drawn over white-tinted copies (outline) and a
 * soft dark copy (shadow). Tinting the alpha mask works on iOS and Android,
 * where view shadows ignore the cutout's shape.
 */
function StickerImage({
  uri,
  size,
  name,
  hidden,
  onLoad,
  onError,
}: {
  uri: string;
  size: number;
  name: string;
  hidden?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const source = { uri };
  const box = { width: size, height: size };
  return (
    <View style={[box, hidden ? styles.hidden : undefined]} pointerEvents="none">
      <Image
        source={source}
        resizeMode="contain"
        style={[styles.stickerLayer, box, { tintColor: "#000", opacity: 0.22, top: 2.5 }]}
      />
      {OUTLINE_OFFSETS.map(([x, y]) => (
        <Image
          key={`${x}:${y}`}
          source={source}
          resizeMode="contain"
          style={[styles.stickerLayer, box, { tintColor: "#fff", left: x, top: y }]}
        />
      ))}
      <Image
        source={source}
        resizeMode="contain"
        onLoad={onLoad}
        onError={onError}
        style={[styles.stickerLayer, box]}
        accessibilityLabel={name}
      />
    </View>
  );
}

/** Cutout without press handling, for chips and other compact spots. */
export function StickerMini({ scanId, size = 32 }: { scanId: string; size?: number }) {
  return <StickerImage uri={stickerUrl(scanId)} size={size} name="" />;
}

/**
 * Sticker-first leading visual for food rows: the cutout (pressable, with
 * retry-while-pending) or a soft makan-tinted tile with a food icon when
 * there is no cutout or it never arrives.
 */
export function FoodSticker({
  scanId,
  name,
  onPress,
  size = 56,
}: {
  scanId?: string | null;
  name: string;
  onPress?: () => void;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (failed || loaded || !scanId) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [attempt, failed, loaded, scanId]);

  const onError = () => {
    if (RETRY_DELAYS_MS[attempt] === undefined) {
      setFailed(true);
      return;
    }
    // The uri changes with the attempt, so re-rendering retriggers the load.
    setAttempt((n) => n + 1);
  };

  const tile = (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, backgroundColor: theme.colors.makanSoft },
      ]}
    >
      <Ionicons name="restaurant" size={Math.round(size * 0.42)} color={theme.colors.makanText} />
    </View>
  );

  if (!scanId || failed) return tile;

  return (
    <Pressable
      accessibilityRole={onPress ? "imagebutton" : "image"}
      accessibilityLabel={onPress ? `Lihat stiker ${name}` : name}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [{ width: size, height: size }, pressed && styles.pressed]}
    >
      {!loaded ? <View style={styles.fallbackLoading}>{tile}</View> : null}
      <StickerImage
        uri={`${stickerUrl(scanId)}${attempt > 0 ? `?r=${attempt}` : ""}`}
        size={size}
        name={name}
        hidden={!loaded}
        onLoad={() => setLoaded(true)}
        onError={onError}
      />
    </Pressable>
  );
}

export type StickerViewerTarget = {
  uri: string;
  name: string;
  kcal: number;
  photoId?: string | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

/**
 * Full-size sticker view. When the row kept the original photo, a toggle
 * swaps the cutout for the photo, downloaded with the session cookie since
 * /photo is private per user.
 */
export function StickerViewer({
  viewer,
  onClose,
}: {
  viewer: StickerViewerTarget | null;
  onClose: () => void;
}) {
  const [showPhoto, setShowPhoto] = useState(false);
  useEffect(() => {
    setShowPhoto(false);
  }, [viewer]);

  return (
    <Modal
      visible={viewer !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <View style={styles.viewerBody}>
          {viewer && showPhoto && viewer.photoId ? (
            <AuthedPhoto photoId={viewer.photoId} name={viewer.name} />
          ) : (
            <Image source={{ uri: viewer?.uri }} style={styles.viewerImage} resizeMode="contain" />
          )}
          <View style={styles.viewerCaptionRow}>
            <MetaLine
              items={[viewer?.name ?? null, `${fmtKcal(viewer?.kcal ?? 0)} kcal`]}
              itemStyle={styles.viewerCaption}
            />
            {viewer?.photoId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPhoto ? "Lihat stiker" : "Lihat foto asli"}
                onPress={() => setShowPhoto((value) => !value)}
                style={({ pressed }) => [styles.photoToggle, pressed && styles.pressed]}
              >
                <Text style={styles.photoToggleText}>
                  {showPhoto ? "Lihat stiker" : "Lihat foto asli"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {viewer ? (
            <ShareStoryButton
              story={{
                kind: "meal",
                name: viewer.name,
                kcal: viewer.kcal,
                protein: viewer.protein,
                carbs: viewer.carbs,
                fat: viewer.fat,
                photoUri: viewer.uri,
                photoCutout: true,
              }}
              variant="secondary"
              style={styles.viewerShare}
            />
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Downloads the private original photo with the session cookie, then shows it. */
function AuthedPhoto({ photoId, name }: { photoId: string; name: string }) {
  const { theme } = useUnistyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        if (Platform.OS !== "web") {
          const cookie = await authClient.getCookie();
          if (cookie) headers.Cookie = cookie;
        }
        const file = await File.downloadFileAsync(
          photoUrl(photoId),
          new File(Paths.cache, `joyorogo-photo-${photoId}.jpg`),
          { headers, idempotent: true },
        );
        if (!cancelled) setUri(file.uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  if (failed) {
    return <Text style={styles.viewerCaption}>Foto asli gagal dimuat.</Text>;
  }
  if (!uri) {
    return (
      <View style={styles.viewerLoading}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.viewerImage}
      resizeMode="contain"
      accessibilityLabel={`Foto asli ${name}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.7,
  },
  hidden: {
    opacity: 0,
  },
  stickerLayer: {
    position: "absolute",
  },
  fallback: {
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  viewerBody: {
    alignItems: "center",
    gap: theme.spacing.md,
    width: "100%",
  },
  viewerImage: {
    width: "100%",
    height: 360,
    borderRadius: theme.radius.card,
  },
  viewerLoading: {
    width: "100%",
    height: 360,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  viewerShare: { alignSelf: "stretch" },
  viewerCaption: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  photoToggle: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
  },
  photoToggleText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
}));
