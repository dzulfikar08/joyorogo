import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { File, Paths } from "expo-file-system";

import { Avatar, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import {
  KIND_META,
  postPhotoUrl,
  postStickerUrl,
  type FeedItem,
} from "@/src/lib/social";
import { timeAgoId } from "@/src/lib/group";
import { fmtKcal, fmtKg } from "@/utils/format";

/**
 * Feed post photo. Served through /post-photo/{postId}, whose visibility the
 * server checks per post — on native that means the session cookie, same as
 * the authed /photo loads elsewhere in the app.
 */
export function PostPhoto({ postId, style }: { postId: string; style?: object }) {
  const { theme } = useUnistyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    if (Platform.OS === "web") {
      setUri(postPhotoUrl(postId));
      return;
    }
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        const cookie = await authClient.getCookie();
        if (cookie) headers.Cookie = cookie;
        const file = await File.downloadFileAsync(
          postPhotoUrl(postId),
          new File(Paths.cache, `joyorogo-post-${postId}.jpg`),
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
  }, [postId]);

  if (failed) {
    return (
      <View style={[styles.photoFallback, style]}>
        <Ionicons name="image-outline" size={22} color={theme.colors.mutedForeground} />
      </View>
    );
  }
  if (uri === null) {
    return (
      <View style={[styles.photoFallback, style]}>
        <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
      </View>
    );
  }
  return <Image source={{ uri }} style={[styles.photo, style]} accessibilityLabel="Foto makanan" />;
}

/** Opens any author's profile by handle; no-op when the handle is null. */
export function openAuthor(handle: string | null | undefined) {
  if (!handle) return;
  router.push(`/u/${handle}`);
}

/** Kudos meta chips: macros for meals, stats for workouts, delta for weight. */
function PostChips({ post }: { post: FeedItem }) {
  const chips: { icon: ComponentProps<typeof Ionicons>["name"]; label: string }[] = [];
  if (post.kcal !== null) chips.push({ icon: "flame-outline", label: `${fmtKcal(post.kcal)} kcal` });
  if (post.durationMin !== null)
    chips.push({ icon: "time-outline", label: `${fmtKcal(post.durationMin)} mnt` });
  if (post.macros) {
    const { protein, carbs, fat, fiber } = post.macros;
    if (protein !== null) chips.push({ icon: "nutrition-outline", label: `P ${fmtKcal(protein)}g` });
    if (carbs !== null) chips.push({ icon: "pie-chart-outline", label: `K ${fmtKcal(carbs)}g` });
    if (fat !== null) chips.push({ icon: "water-outline", label: `L ${fmtKcal(fat)}g` });
    if (fiber !== null) chips.push({ icon: "leaf-outline", label: `Serat ${fmtKcal(fiber)}g` });
  }
  if (post.stats) {
    const s = post.stats;
    if (typeof s.type === "string") chips.push({ icon: "barbell-outline", label: s.type });
    if (s.sets !== null && s.sets !== undefined)
      chips.push({ icon: "repeat-outline", label: `${String(s.sets)} set` });
    if (s.reps !== null && s.reps !== undefined)
      chips.push({ icon: "body-outline", label: `${String(s.reps)} reps` });
    if (s.volumeKg !== null && s.volumeKg !== undefined)
      chips.push({ icon: "trending-up-outline", label: `${fmtKg(Number(s.volumeKg))} kg total` });
    if (s.weightKg !== null && s.weightKg !== undefined)
      chips.push({ icon: "scale-outline", label: `${fmtKg(Number(s.weightKg))} kg` });
    if (s.deltaKg !== null && s.deltaKg !== undefined) {
      const n = Number(s.deltaKg);
      chips.push({
        icon: n <= 0 ? "trending-down-outline" : "trending-up-outline",
        label: `${n > 0 ? "+" : ""}${fmtKg(n)} kg`,
      });
    }
  }
  return (
    <View style={styles.chipRow}>
      {chips.map((chip, i) => (
        <View key={`${chip.label}-${i}`} style={styles.chip}>
          <Ionicons name={chip.icon} size={12} />
          <Text style={styles.chipText}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One feed post card: author row, photo, title, chips, caption, and the
 * Semangat kudos toggle with an optimistic count. Tapping the body opens the
 * detail screen; tapping the author opens their profile.
 */
export function PostCard({
  post,
  onPress,
  onPressAuthor,
  right,
}: {
  post: FeedItem;
  onPress?: () => void;
  onPressAuthor?: (handle: string | null) => void;
  /** Extra header action (detail screen's overflow menu). */
  right?: ReactNode;
}) {
  const { theme } = useUnistyles();
  const meta = KIND_META[post.kind];
  const [kudos, setKudos] = useState({
    byMe: post.kudosByMe ?? false,
    count: post.kudosCount,
  });

  const toggleKudos = useMutation({
    mutationFn: () => client.social.kudos({ postId: post.id }),
    onMutate: () => {
      // Optimistic: flip immediately, roll back if the server refuses.
      setKudos((prev) => ({
        byMe: !prev.byMe,
        count: prev.count + (prev.byMe ? -1 : 1),
      }));
    },
    onError: () => {
      setKudos({ byMe: post.kudosByMe ?? false, count: post.kudosCount });
    },
    onSuccess: (result) => {
      setKudos({ byMe: result.kudos, count: result.kudosCount });
    },
  });

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Profil ${post.author.name}`}
          onPress={() => onPressAuthor?.(post.author.handle)}
          style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}
        >
          <Avatar name={post.author.name} image={post.author.image} />
          <View style={styles.authorText}>
            <Text style={styles.authorName} numberOfLines={1}>
              {post.author.name}
            </Text>
            <Text style={styles.authorSub} numberOfLines={1}>
              {post.author.handle ? `@${post.author.handle} · ` : ""}
              {timeAgoId(post.createdAt)}
            </Text>
          </View>
        </Pressable>
        <View style={styles.headerRight}>
          <View
            style={[styles.kindBadge, { backgroundColor: theme.colors[`${meta.tint}Soft`] }]}
            accessibilityLabel={meta.label}
          >
            <Ionicons name={meta.icon as ComponentProps<typeof Ionicons>["name"]} size={14} color={theme.colors[`${meta.tint}Text`]} />
          </View>
          {right}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Buka post ${post.title}`}
        onPress={onPress}
        disabled={!onPress}
      >
        {post.photoId ? <PostPhoto postId={post.id} style={styles.photoSpacing} /> : null}
        {!post.photoId && post.scanId ? (
          <StickerPostImage uri={postStickerUrl(post.scanId)} />
        ) : null}
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {post.title}
          </Text>
          <PostChips post={post} />
          {post.caption ? (
            <Text style={styles.caption}>{post.caption}</Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={kudos.byMe ? "Batalkan semangat" : "Beri semangat"}
          accessibilityState={{ selected: kudos.byMe }}
          onPress={() => !toggleKudos.isPending && toggleKudos.mutate()}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons
            name={kudos.byMe ? "heart" : "heart-outline"}
            size={18}
            color={kudos.byMe ? theme.colors.bakar : theme.colors.mutedForeground}
          />
          <Text style={[styles.actionText, kudos.byMe && styles.actionTextActive]}>
            Semangat{kudos.count > 0 ? ` · ${kudos.count}` : ""}
          </Text>
        </Pressable>
        <View style={styles.actionButton}>
          <Ionicons name="chatbubble-outline" size={18} color={theme.colors.mutedForeground} />
          <Text style={styles.actionText}>
            Komentar{post.commentCount > 0 ? ` · ${post.commentCount}` : ""}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** Plain public sticker image used when a post has no food photo. */
function StickerPostImage({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri }}
      style={[styles.photo, styles.photoSpacing]}
      onError={() => setFailed(true)}
      accessibilityLabel="Stiker makanan"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  authorRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  authorText: {
    flex: 1,
    gap: 1,
  },
  authorName: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  authorSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  kindBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  photoSpacing: {
    marginTop: theme.spacing.xs,
  },
  photoFallback: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.muted,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.spacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  actionTextActive: {
    color: theme.colors.bakarText,
  },
}));
