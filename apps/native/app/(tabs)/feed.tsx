import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text as RNText, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  Screen,
  Segmented,
  Skeleton,
  Text,
} from "@/components/ui";
import { PostCard, openAuthor } from "@/components/feed/post-card";
import { useSessionGate } from "@/lib/use-session-gate";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";
import type { FeedItem } from "@/src/lib/social";

type Tab = "mengikuti" | "jelajah";
const PAGE_SIZE = 10;

/**
 * Feed komunitas: tab Mengikuti / Jelajah, infinite scroll by cursor
 * (createdAt ms of the last item), pull to refresh. The bell opens the
 * social notification list, separate from the group inbox.
 */
export default function Feed() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("mengikuti");

  const unread = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const unreadCount = unread.data?.count ?? 0;

  const feed = useInfiniteQuery({
    queryKey: ["social", "feed", tab],
    queryFn: ({ pageParam }) =>
      client.social.feed({
        tab,
        cursor: pageParam ?? undefined,
        limit: PAGE_SIZE,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items: FeedItem[] = useMemo(
    () => feed.data?.pages.flatMap((page) => page.items) ?? [],
    [feed.data],
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Feed" />
        <Skeleton width="100%" height={200} radius={24} />
        <Skeleton width="100%" height={200} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  return (
    <Screen>
      <PageHeader
        title="Feed"
        caption="Semangat bareng teman satu grup."
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifikasi"
            onPress={() => router.push("/feed/notifikasi")}
            style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          >
            <Ionicons
              name={unreadCount > 0 ? "notifications" : "notifications-outline"}
              size={22}
              color={theme.colors.foreground}
            />
            {unreadCount > 0 ? (
              <View style={styles.badge}>
                <RNText style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</RNText>
              </View>
            ) : null}
          </Pressable>
        }
      />

      <Segmented<Tab>
        options={[
          { value: "mengikuti", label: "Mengikuti" },
          { value: "jelajah", label: "Jelajah" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {feed.isPending ? (
        <>
          <Skeleton width="100%" height={180} radius={24} />
          <Skeleton width="100%" height={180} radius={24} />
        </>
      ) : feed.isError ? (
        <ErrorState message={errorMessage(feed.error)} onRetry={() => void feed.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={() => router.push(`/feed/${item.id}`)}
              onPressAuthor={(handle) => openAuthor(handle)}
            />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <>
                <Skeleton width="100%" height={160} radius={24} />
              </>
            ) : !feed.hasNextPage && items.length > 0 ? (
              <Text style={styles.endText}>Kamu sudah sampai ujung feed.</Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={tab === "mengikuti" ? "Feed masih sepi" : "Belum ada post publik"}
              description={
                tab === "mengikuti"
                  ? "Ikuti orang dari profilnya, atau bagikan log pertamamu lewat tombol Bagikan ke feed."
                  : "Post publik dari semua pengguna muncul di sini."
              }
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => {
                void feed.refetch();
                void queryClient.invalidateQueries({
                  queryKey: orpc.social.notificationsUnreadCount.queryOptions().queryKey,
                });
              }}
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.7,
  },
  bell: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.destructive,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  listContent: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  endText: {
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    paddingVertical: theme.spacing.lg,
  },
}));
