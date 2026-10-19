import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, Image, Platform, View, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { attachmentFacts } from "@joyorogo/api/lib/comment-attachment-view";
import type { AttachmentFact } from "@joyorogo/api/lib/comment-attachment-view";
import { weekRangeLabel } from "@joyorogo/api/lib/recap";
import { getActiveLocale } from "@joyorogo/i18n";
import type { TFunction } from "@joyorogo/i18n";

import { RouteMapPreview } from "@/components/feed/route-map-preview";
import { fetchPrivatePhoto } from "@/components/sticker/private-photo";
import { Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { commentPhotoUrl, type CommentAttachment } from "@/src/lib/social";

type IconName = ComponentProps<typeof Ionicons>["name"];

const KIND_ICON: Record<Exclude<CommentAttachment["kind"], "image">, IconName> = {
  workout: "barbell-outline",
  food: "restaurant-outline",
  weight: "scale-outline",
  recap: "calendar-outline",
  route: "map-outline",
};

/** Where a card's photo comes from: a file on this phone, a posted comment, or the commenter's own diary. */
export type PhotoSource =
  | { type: "local"; uri: string }
  | { type: "comment"; commentId: string }
  | { type: "diary"; photoId: string };

/** file:// URI of the photo, downloaded with the session cookie where the server needs it. */
function usePhotoUri(source: PhotoSource | null): { uri: string | null; failed: boolean } {
  const [state, setState] = useState<{ uri: string | null; failed: boolean }>({ uri: null, failed: false });
  const key = source ? `${source.type}:${source.type === "local" ? source.uri : source.type === "comment" ? source.commentId : source.photoId}` : "";

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setState({ uri: null, failed: false });
      return;
    }
    if (source.type === "local") {
      setState({ uri: source.uri, failed: false });
      return;
    }
    setState({ uri: null, failed: false });
    void (async () => {
      try {
        let uri: string;
        if (source.type === "diary") {
          uri = await fetchPrivatePhoto(source.photoId);
        } else if (Platform.OS === "web") {
          uri = commentPhotoUrl(source.commentId);
        } else {
          const headers: Record<string, string> = {};
          const cookie = await authClient.getCookie();
          if (cookie) headers.Cookie = cookie;
          const file = await File.downloadFileAsync(
            commentPhotoUrl(source.commentId),
            new File(Paths.cache, `joyorogo-comment-${source.commentId}.jpg`),
            { headers, idempotent: true },
          );
          uri = file.uri;
        }
        if (!cancelled) setState({ uri, failed: false });
      } catch {
        if (!cancelled) setState({ uri: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for the source's identity; the object itself is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** One fact line ("32 mnt"); the key is built from the fact's kind, so the typed `t` cannot check it. */
function factText(t: TFunction<"feed">, fact: AttachmentFact): string {
  const translate = t as unknown as (key: string, options: Record<string, string | number>) => string;
  return translate(`comments.fact.${fact.key}`, fact.params);
}

/** Heading of an item card: its own name, or the kind's label for items that have none (weight, recap). */
export function attachmentTitle(t: TFunction<"feed">, attachment: CommentAttachment): string {
  if (attachment.kind === "weight") return t("comments.attach.title.weight");
  if (attachment.kind === "recap") {
    const weekStart = attachment.stats.weekStart;
    return t("comments.attach.title.recap", {
      range: typeof weekStart === "string" ? weekRangeLabel(weekStart) : "",
    });
  }
  return attachment.title || t(`comments.attach.kind.${attachment.kind === "image" ? "workout" : attachment.kind}`);
}

/** What a comment carries besides its text: an uploaded photo, or a card with the numbers of one of the commenter's items. */
export function CommentAttachmentCard({
  attachment,
  photo,
  style,
}: {
  attachment: CommentAttachment;
  photo?: PhotoSource | null;
  style?: ViewStyle;
}) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const loaded = usePhotoUri(photo ?? null);

  if (attachment.kind === "image") {
    return (
      <View style={[styles.image, style]}>
        {loaded.uri ? (
          <Image source={{ uri: loaded.uri }} style={styles.imageFill} accessibilityLabel={t("comments.attach.photoAlt")} />
        ) : loaded.failed || !photo ? (
          <Ionicons name="image-outline" size={24} color={theme.colors.mutedForeground} />
        ) : (
          <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
        )}
      </View>
    );
  }

  const title = attachmentTitle(t, attachment);
  const facts = attachmentFacts(attachment.kind, attachment.stats, getActiveLocale());
  const photoUri = attachment.hasPhoto && photo ? loaded.uri : null;

  return (
    <View accessible accessibilityLabel={t("comments.attach.cardLabel", { title })} style={[styles.card, style]}>
      {attachment.kind === "route" && attachment.mapLine ? (
        <RouteMapPreview line={attachment.mapLine} title={title} size="card" />
      ) : null}
      <View style={styles.row}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.iconWrap}>
            <Ionicons name={KIND_ICON[attachment.kind]} size={20} color={theme.colors.primary} />
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.kind}>{t(`comments.attach.kind.${attachment.kind}`)}</Text>
          <Text style={styles.title}>{title}</Text>
          {facts.length > 0 ? (
            <View style={styles.facts}>
              {facts.map((fact) => (
                <Text key={fact.key} style={styles.fact}>
                  {factText(t, fact)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.tile,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.background,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  kind: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
    textTransform: "uppercase",
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: 2,
    marginTop: theme.spacing.xs,
  },
  fact: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  image: {
    width: "100%",
    maxWidth: 280,
    aspectRatio: 4 / 3,
    overflow: "hidden",
    borderRadius: theme.radius.tile,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  imageFill: {
    width: "100%",
    height: "100%",
  },
}));
