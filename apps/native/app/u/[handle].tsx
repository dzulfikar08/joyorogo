import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Screen,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { PostCard, openAuthor } from "@/components/feed/post-card";
import { useSessionGate } from "@/lib/use-session-gate";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";

type ListTab = "followers" | "following";

/** Drizzle count() can surface as a plain number or a { total } row. */
function countOf(value: number | { total: number } | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.total;
}

/**
 * Profil publik /u/{handle}: statistik, tombol Ikuti, dan daftar post.
 * Kalau penulisnya non-publik, hanya nama yang tampil (kontrak server).
 */
export default function ProfilPublik() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const queryClient = useQueryClient();
  const { handle } = useLocalSearchParams<{ handle: string }>();

  const { data: session } = authClient.useSession();
  const me = session?.user.id ?? null;

  const profile = useQuery(orpc.social.publicProfile.queryOptions({ input: { handle } }));
  const followers = useQuery(orpc.social.followers.queryOptions({ input: { handle } }));
  const following = useQuery(orpc.social.following.queryOptions({ input: { handle } }));

  const [listOpen, setListOpen] = useState<ListTab | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.social.key() });

  const setFollow = useMutation({
    mutationFn: (follow: boolean) =>
      client.social.setFollow({ userId: profile.data!.userId, follow }),
    onSuccess: refresh,
  });
  const block = useMutation({
    mutationFn: () => client.social.block({ userId: profile.data!.userId }),
    onSuccess: () => {
      refresh();
      router.replace("/feed");
    },
  });

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Profil" />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (profile.isPending) {
    return (
      <Screen>
        <PageHeader title="Profil" />
        <Skeleton width="100%" height={160} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (profile.isError) {
    return (
      <Screen>
        <PageHeader title="Profil" />
        <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }

  const data = profile.data;
  const isSelf = data.isSelf;

  return (
    <Screen>
      <PageHeader
        title={data.name}
        right={
          !isSelf && data.stats !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menu lainnya"
              onPress={() => setBlockOpen(true)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.foreground} />
            </Pressable>
          ) : undefined
        }
      />

      {data.publicProfile === false ? (
        <Card>
          <View style={styles.limitedRow}>
            <Avatar name={data.name} image={null} size={44} />
            <View style={styles.limitedText}>
              <Text style={styles.name}>{data.name}</Text>
              <Text style={styles.muted}>
                Akun ini privat. Hanya rekan satu grup yang bisa melihat aktivitasnya.
              </Text>
            </View>
          </View>
        </Card>
      ) : (
        <>
          <Card style={styles.headerCard}>
            <View style={styles.headerRow}>
              <Avatar name={data.name} image={data.image} size={56} />
              <View style={styles.headerText}>
                <Text style={styles.name}>{data.name}</Text>
                {data.handle ? <Text style={styles.muted}>@{data.handle}</Text> : null}
                {data.bio ? <Text style={styles.bio}>{data.bio}</Text> : null}
              </View>
            </View>

            <View style={styles.statRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setListOpen("followers")}
                style={styles.stat}
              >
                <Text style={styles.statValue}>{countOf(data.stats?.followerCount)}</Text>
                <Text style={styles.statLabel}>Pengikut</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setListOpen("following")}
                style={styles.stat}
              >
                <Text style={styles.statValue}>{countOf(data.stats?.followingCount)}</Text>
                <Text style={styles.statLabel}>Mengikuti</Text>
              </Pressable>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{countOf(data.stats?.postCount)}</Text>
                <Text style={styles.statLabel}>Post</Text>
              </View>
            </View>

            {!isSelf && data.isFollowing !== null ? (
              <Button
                variant={data.isFollowing ? "secondary" : "primary"}
                label={data.isFollowing ? "Berhenti ikuti" : "Ikuti"}
                size="sm"
                loading={setFollow.isPending}
                onPress={() => setFollow.mutate(!data.isFollowing)}
              />
            ) : null}
            {setFollow.isError ? (
              <Text style={styles.error}>{errorMessage(setFollow.error)}</Text>
            ) : null}
          </Card>

          {data.posts.items.length === 0 ? (
            <EmptyState
              icon="newspaper-outline"
              title="Belum ada post"
              description="Post yang dibagikan akan tampil di sini."
            />
          ) : (
            <View style={styles.postList}>
              {data.posts.items.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onPress={() => router.push(`/feed/${post.id}`)}
                  onPressAuthor={(handle) => openAuthor(handle)}
                />
              ))}
              {data.posts.nextCursor !== null ? (
                <Text style={styles.endText}>Post yang lebih lama bisa dibuka dari feed.</Text>
              ) : null}
            </View>
          )}
        </>
      )}

      {/* Followers / following list */}
      <PeopleListSheet
        visible={listOpen !== null}
        tab={listOpen}
        onClose={() => setListOpen(null)}
        pending={listOpen === "followers" ? followers.isPending : following.isPending}
        people={
          listOpen === "followers"
            ? (followers.data ?? [])
            : listOpen === "following"
              ? (following.data ?? [])
              : []
        }
      />

      <ConfirmSheet
        visible={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={`Blokir ${data.name}?`}
        message="Konten kalian saling disembunyikan dan follow diputus. Bisa dibuka lewat daftar blokir di Profil."
        confirmLabel="Blokir"
        cancelLabel="Batal"
        loading={block.isPending}
        onConfirm={() => block.mutate()}
      />
      {block.isError ? <Text style={styles.error}>{errorMessage(block.error)}</Text> : null}
    </Screen>
  );
}

/** Pengikut / mengikuti list inside a sheet; each row opens that profile. */
function PeopleListSheet({
  visible,
  tab,
  onClose,
  pending,
  people,
}: {
  visible: boolean;
  tab: ListTab | null;
  onClose: () => void;
  pending: boolean;
  people: { id: string; name: string; image: string | null; handle: string | null }[];
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tab === "followers" ? "Pengikut" : "Mengikuti"}
    >
      {pending ? (
        <Skeleton width="100%" height={120} radius={24} />
      ) : people.length === 0 ? (
        <Text style={styles.muted}>
          {tab === "followers" ? "Belum ada pengikut." : "Belum mengikuti siapa pun."}
        </Text>
      ) : (
        <View style={styles.peopleList}>
          {people.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={`Profil ${person.name}`}
              onPress={() => {
                onClose();
                openAuthor(person.handle);
              }}
              style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}
            >
              <Avatar name={person.name} image={person.image} size={32} />
              <View style={styles.personText}>
                <Text style={styles.personName}>{person.name}</Text>
                {person.handle ? <Text style={styles.muted}>@{person.handle}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={15} />
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCard: {
    gap: theme.spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  bio: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingVertical: theme.spacing.md,
    gap: 2,
  },
  statValue: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  postList: {
    gap: theme.spacing.md,
  },
  limitedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  limitedText: {
    flex: 1,
    gap: 2,
  },
  peopleList: {
    gap: theme.spacing.md,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  personText: {
    flex: 1,
    gap: 1,
  },
  personName: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  endText: {
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    paddingVertical: theme.spacing.md,
  },
  error: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
}));
