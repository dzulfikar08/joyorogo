import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import { Platform } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { File, Paths } from "expo-file-system";

import { Text } from "@/components/ui";
import { MetaLine } from "@/components/meta-line";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { authClient } from "@/lib/auth-client";
// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";
import { photoUrl } from "@/components/sticker/private-photo";
import { fmtKcalLabel } from "@/utils/format";

export function stickerUrl(scanId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/sticker/${scanId}`;
}

/** Cutouts are made in the background after saving: retry briefly, then give up. */
const RETRY_DELAYS_MS = [3000, 6000, 12000];

/**
 * Cutout of a dish. `plain` (every list, grid and chip) draws it contained on a
 * soft makan tile with no outline or shadow: a small thumbnail, never the hero.
 * `diecut` (the full-screen viewer only, where the sticker is the shareable
 * object) draws it over white-tinted copies (outline) and a soft dark copy
 * (shadow); tinting the alpha mask works on iOS and Android, where view shadows
 * ignore the cutout's shape. Outline thickness and the padding that keeps it
 * from being clipped scale with `size`.
 */
function StickerImage({
  uri,
  size,
  name,
  variant = "plain",
  hidden,
  onLoad,
  onError,
}: {
  uri: string;
  size: number;
  name: string;
  variant?: "plain" | "diecut";
  hidden?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const { theme } = useUnistyles();
  const source = { uri };
  if (variant === "plain") {
    const pad = Math.round(size * 0.08);
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: Math.min(theme.radius.tile, size * 0.3),
            backgroundColor: theme.colors.makanSoft,
          },
          hidden ? styles.hidden : undefined,
        ]}
        pointerEvents="none"
      >
        <Image
          source={source}
          resizeMode="contain"
          onLoad={onLoad}
          onError={onError}
          style={[styles.stickerLayer, { left: pad, top: pad, width: size - pad * 2, height: size - pad * 2 }]}
          accessibilityLabel={name}
        />
      </View>
    );
  }
  const ring = Math.max(1.5, size * 0.03);
  const pad = Math.ceil(ring * 1.8);
  const inner = { width: size - pad * 2, height: size - pad * 2 };
  const steps = size > 80 ? 16 : 8;
  const offsets = Array.from({ length: steps }, (_, k) => {
    const angle = (k * 2 * Math.PI) / steps;
    return [Math.cos(angle) * ring, Math.sin(angle) * ring] as const;
  });
  return (
    <View
      style={[{ width: size, height: size }, hidden ? styles.hidden : undefined]}
      pointerEvents="none"
    >
      <Image
        source={source}
        resizeMode="contain"
        style={[
          styles.stickerLayer,
          inner,
          { tintColor: "#000", opacity: 0.22, left: pad, top: pad + ring * 1.6 },
        ]}
      />
      {size > 80
        ? offsets.map(([x, y]) => (
            <Image
              key={`edge:${x}:${y}`}
              source={source}
              resizeMode="contain"
              style={[
                styles.stickerLayer,
                inner,
                { tintColor: "#000", opacity: 0.1, left: pad + x * 1.35, top: pad + y * 1.35 },
              ]}
            />
          ))
        : null}
      {offsets.map(([x, y]) => (
        <Image
          key={`${x}:${y}`}
          source={source}
          resizeMode="contain"
          style={[styles.stickerLayer, inner, { tintColor: "#fff", left: pad + x, top: pad + y }]}
        />
      ))}
      <Image
        source={source}
        resizeMode="contain"
        onLoad={onLoad}
        onError={onError}
        style={[styles.stickerLayer, inner, { left: pad, top: pad }]}
        accessibilityLabel={name}
      />
    </View>
  );
}

/** Cutout without press handling, for chips and other compact spots. */
export function StickerMini({
  scanId,
  size = 32,
  name = "",
  onLoad,
  onError,
}: {
  scanId: string;
  size?: number;
  name?: string;
  onLoad?: () => void;
  onError?: () => void;
}) {
  return (
    <StickerImage
      uri={stickerUrl(scanId)}
      size={size}
      name={name}
      onLoad={onLoad}
      onError={onError}
    />
  );
}

/**
 * Leading visual for food rows: the plain cutout thumbnail (pressable, with
 * retry-while-pending) or a soft makan-tinted tile with a food icon when
 * there is no cutout or it never arrives.
 */
export function FoodSticker({
  scanId,
  fallbackScanId,
  name,
  onPress,
  size = 56,
}: {
  scanId?: string | null;
  /** Cutout to show when `scanId` never loads (a plate sticker that failed to cut), before the food icon. */
  fallbackScanId?: string | null;
  name: string;
  onPress?: () => void;
  size?: number;
}) {
  const { t } = useTranslation("feed");
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

  if (failed && fallbackScanId) {
    return <FoodSticker scanId={fallbackScanId} name={name} onPress={onPress} size={size} />;
  }
  if (!scanId || failed) return tile;

  return (
    <Pressable
      accessibilityRole={onPress ? "imagebutton" : "image"}
      accessibilityLabel={onPress ? t("sticker.view", { name }) : name}
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

/**
 * Cutout tile at the top of a detail sheet. Renders nothing without
 * a scan id so sheets without a cutout keep their layout.
 */
export function StickerHero({
  scanId,
  name,
  size = 128,
}: {
  scanId?: string | null;
  name: string;
  size?: number;
}) {
  if (!scanId) return null;
  return (
    <View style={styles.hero}>
      <FoodSticker scanId={scanId} name={name} size={size} />
    </View>
  );
}

export type StickerViewerTarget = {
  uri: string;
  /** Shown instead when `uri` fails to load (a plate sticker that is not ready or failed to cut). */
  fallbackUri?: string;
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
  const { t } = useTranslation("feed");
  const [showPhoto, setShowPhoto] = useState(false);
  const [mainFailed, setMainFailed] = useState(false);
  useEffect(() => {
    setShowPhoto(false);
    setMainFailed(false);
  }, [viewer]);
  const uri = mainFailed && viewer?.fallbackUri ? viewer.fallbackUri : (viewer?.uri ?? "");

  const { width } = useWindowDimensions();
  const { theme } = useUnistyles();

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
            <StickerImage
              uri={uri}
              size={Math.min(width - theme.spacing.xl * 2, 360)}
              name={viewer?.name ?? ""}
              variant="diecut"
              onError={() => setMainFailed(true)}
            />
          )}
          <View style={styles.viewerCaptionRow}>
            <MetaLine
              items={[viewer?.name ?? null, fmtKcalLabel(viewer?.kcal ?? 0)]}
              itemStyle={styles.viewerCaption}
            />
            {viewer?.photoId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPhoto ? t("sticker.toSticker") : t("sticker.toPhoto")}
                onPress={() => setShowPhoto((value) => !value)}
                style={({ pressed }) => [styles.photoToggle, pressed && styles.pressed]}
              >
                <Text style={styles.photoToggleText}>
                  {showPhoto ? t("sticker.toSticker") : t("sticker.toPhoto")}
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
                cutoutUri: uri,
                photoId: viewer.photoId,
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
  const { t } = useTranslation("feed");
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
    return <Text style={styles.viewerCaption}>{t("sticker.photoFailed")}</Text>;
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
      accessibilityLabel={t("sticker.photo", { name })}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  hero: {
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
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
    borderRadius: theme.radius.tile,
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
