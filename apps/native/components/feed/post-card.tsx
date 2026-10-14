import { Ionicons } from "@expo/vector-icons";
import { MacroIcon, type MacroKey } from "@/utils/macro-icons";
import { router } from "expo-router";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { File, Paths } from "expo-file-system";

import { Avatar, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";
import {
  KIND_META,
  postPhotoUrl,
  postStickerUrl,
  type FeedItem,
} from "@/src/lib/social";
import { timeAgoId } from "@/src/lib/group";
import { fmtKcal, fmtKg } from "@/utils/format";

/**
 * Feed post photo. Served through /post-photo/{postId}[/{index}], whose
 * visibility the server checks per post — on native that means the session
 * cookie, same as the authed /photo loads elsewhere in the app.
 */
export function PostPhoto({
  postId,
  index,
  style,
}: {
  postId: string;
  index?: number;
  style?: object;
}) {
  const { theme } = useUnistyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const suffix = index === undefined ? "" : `-${index}`;

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    if (Platform.OS === "web") {
      setUri(postPhotoUrl(postId, index));
      return;
    }
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        const cookie = await authClient.getCookie();
        if (cookie) headers.Cookie = cookie;
        const file = await File.downloadFileAsync(
          postPhotoUrl(postId, index),
          new File(Paths.cache, `joyorogo-post-${postId}${suffix}.jpg`),
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
  }, [postId, index, suffix]);

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

const STORY_PREVIEW_LINES = 6;

/** Teks pos cerita; lebih dari enam baris dipangkas dengan Selengkapnya. */
function StoryText({ caption }: { caption: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Text style={styles.storyText} numberOfLines={expanded ? undefined : STORY_PREVIEW_LINES}>
        {caption}
      </Text>
      {caption.length > 180 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Tutup teks" : "Baca selengkapnya"}
          onPress={() => setExpanded((prev) => !prev)}
          style={({ pressed }) => [styles.moreWrap, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>{expanded ? "Tutup" : "Selengkapnya"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Penampil layar penuh: geser antar foto, tap latar untuk menutup. */
function PhotoViewer({
  postId,
  count,
  initialIndex,
  onClose,
}: {
  postId: string;
  count: number;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} accessibilityLabel="Penampil foto">
      <Pressable
        style={styles.viewerBackdrop}
        accessibilityRole="button"
        accessibilityLabel="Tutup penampil foto"
        onPress={onClose}
      >
        <Pressable style={styles.viewerInner} onPress={() => {}}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(event) => {
              const x = event.nativeEvent.contentOffset.x;
              const width = event.nativeEvent.layoutMeasurement.width;
              const next = width > 0 ? Math.round(x / width) : 0;
              if (next !== index && next >= 0 && next < count) setIndex(next);
            }}
            scrollEventThrottle={100}
          >
            {Array.from({ length: count }, (_, i) => (
              <View key={i} style={styles.viewerPage}>
                <PostPhoto postId={postId} index={i} style={styles.viewerPhoto} />
              </View>
            ))}
          </ScrollView>
          {count > 1 ? (
            <Text style={styles.viewerCount}>
              {index + 1}/{count}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Grid foto pos 'cerita': 1 penuh, 2 berdampingan, 3-4 grid (pertama melebar). */
function PhotoGrid({ postId, count }: { postId: string; count: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = Math.min(count, 4);
  return (
    <View style={styles.gridSpacing}>
      <View style={count === 1 ? styles.gridOne : styles.gridMulti}>
        {Array.from({ length: shown }, (_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`Buka foto ${index + 1}`}
            onPress={() => setOpen(index)}
            style={({ pressed }) => [
              styles.gridCell,
              count === 1 && styles.gridCellSingle,
              count > 2 && index === 0 && styles.gridCellWide,
              pressed && styles.pressed,
            ]}
          >
            <PostPhoto postId={postId} index={index} style={styles.gridPhoto} />
          </Pressable>
        ))}
      </View>
      {open !== null ? (
        <PhotoViewer
          postId={postId}
          count={shown}
          initialIndex={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

/** Kudos meta chips: macros for meals, stats for workouts, delta for weight. */
function PostChips({ post }: { post: FeedItem }) {
  const { theme } = useUnistyles();
  const chips: {
    icon?: ComponentProps<typeof Ionicons>["name"];
    macro?: MacroKey;
    label: string;
  }[] = [];
  if (post.kcal !== null) chips.push({ macro: "kcal", label: `${fmtKcal(post.kcal)} kcal` });
  if (post.durationMin !== null)
    chips.push({ icon: "time-outline", label: `${fmtKcal(post.durationMin)} mnt` });
  if (post.macros) {
    const { protein, carbs, fat, fiber } = post.macros;
    if (protein !== null) chips.push({ macro: "protein", label: `P ${fmtKcal(protein)}g` });
    if (carbs !== null) chips.push({ macro: "carbs", label: `K ${fmtKcal(carbs)}g` });
    if (fat !== null) chips.push({ macro: "fat", label: `L ${fmtKcal(fat)}g` });
    if (fiber !== null) chips.push({ macro: "fiber", label: `Serat ${fmtKcal(fiber)}g` });
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
          {chip.macro ? (
            <MacroIcon macro={chip.macro} size={12} />
          ) : chip.icon ? (
            <Ionicons name={chip.icon} size={12} color={theme.colors.mutedForeground} />
          ) : null}
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

  const toggleKudos = useOptimisticMutation<void, { kudos: boolean; kudosCount: number }>({
    mutationFn: () => client.social.kudos({ postId: post.id }),
    patch: () => {
      // Optimistic: flip immediately, roll back if the server refuses.
      setKudos((prev) => ({
        byMe: !prev.byMe,
        count: prev.count + (prev.byMe ? -1 : 1),
      }));
    },
    onError: () => {
      setKudos({ byMe: post.kudosByMe ?? false, count: post.kudosCount });
    },
    success: (_input, result) => {
      setKudos({ byMe: result.kudos, count: result.kudosCount });
      // Only giving kudos is undoable; taking it back is a plain tap.
      if (!result.kudos) return undefined;
      return { message: "Semangat terkirim", undo: () => toggleKudos.mutate() };
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

      {post.kind === "cerita" ? (
        <View style={styles.body}>
          {post.caption ? <StoryText caption={post.caption} /> : null}
          {post.photoCount > 0 ? (
            <PhotoGrid postId={post.id} count={post.photoCount} />
          ) : null}
        </View>
      ) : (
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
      )}

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
  storyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  moreWrap: {
    alignSelf: "flex-start",
    paddingVertical: theme.spacing.xs,
  },
  moreText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  gridSpacing: {
    gap: 0,
  },
  gridOne: {
    flexDirection: "row",
  },
  gridMulti: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
  gridCell: {
    flex: 1,
    minWidth: "47%",
  },
  gridCellSingle: {
    width: "100%",
  },
  gridCellWide: {
    width: "100%",
  },
  gridPhoto: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: theme.radius.tile,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
  },
  viewerInner: {
    flex: 1,
    justifyContent: "center",
  },
  viewerPage: {
    width: "100%",
    paddingHorizontal: theme.spacing.md,
  },
  viewerPhoto: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: theme.radius.tile,
  },
  viewerCount: {
    position: "absolute",
    bottom: theme.spacing.xl,
    alignSelf: "center",
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    color: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
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
