import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import {
  Avatar,
  Button,
  Card,
  Chip,
  Field,
  Input,
  ListGroup,
  ListRow,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { useToast } from "@/components/toast";
import { openAuthor } from "@/components/feed/post-card";
import { HANDLE_REGEX, type Visibility } from "@/src/lib/social";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";
import { useOptimisticMutation } from "@/lib/optimistic";

/**
 * Pengaturan feed komunitas di Profil: handle, bio, toggle profil publik,
 * visibility default, dan daftar blokir dengan buka blokir.
 */
export function FeedSettingsCard() {
  const { t } = useTranslation(["settings", "common"]);
  const toast = useToast();
  const queryClient = useQueryClient();

  const profile = useQuery(orpc.social.myProfile.queryOptions());
  const blockList = useQuery(orpc.social.blockList.queryOptions());

  const [editOpen, setEditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.social.key() });

  const update = useOptimisticMutation<
    Parameters<typeof client.social.updateProfile>[0],
    unknown,
    Parameters<typeof client.social.updateProfile>[0] | null
  >({
    mutationFn: (input) => client.social.updateProfile(input),
    patch: (input, cache) => {
      const key = orpc.social.myProfile.queryOptions().queryKey;
      const previous = queryClient.getQueryData<Parameters<typeof client.social.updateProfile>[0]>(key);
      cache.value(key, (old) => (old === undefined ? undefined : { ...old, ...input }));
      return previous ?? null;
    },
    success: (_input, _data, context) => {
      setEditOpen(false);
      const previous = context ?? null;
      return {
        message: t("feed.saved"),
        undo: previous === null ? undefined : () => update.mutate(previous),
      };
    },
    onError: (e) => toast.error(t("feed.saveFailed"), errorMessage(e)),
    invalidate: () => [orpc.social.key()],
  });

  const unblock = useMutation({
    mutationFn: (userId: string) => client.social.unblock({ userId }),
    onSuccess: refresh,
  });

  const data = profile.data ?? null;

  return (
    <>
      <Text style={styles.sectionLabel}>{t("section.feed")}</Text>
      {profile.isPending ? (
        <Skeleton width="100%" height={160} radius={24} />
      ) : profile.isError ? (
        <Card>
          <Text style={styles.error}>{errorMessage(profile.error)}</Text>
        </Card>
      ) : (
        <ListGroup>
          <ListRow
            icon="at"
            iconTint="makan"
            title={t("feed.handle.title")}
            subtitle={data?.handle ? `@${data.handle}` : t("feed.handle.none")}
            chevron
            onPress={() => setEditOpen(true)}
          />
          <ListRow
            icon="globe-outline"
            iconTint="tidur"
            title={t("feed.public.title")}
            subtitle={t("feed.public.subtitleNative")}
            value={data?.publicProfile ? t("feed.public.on") : t("feed.public.off")}
          />
          <ListRow
            icon="lock-closed-outline"
            iconTint="bakar"
            title={t("feed.blocked.rowNative")}
            subtitle={
              (blockList.data?.length ?? 0) > 0
                ? t("feed.blocked.blockedCount", { count: blockList.data!.length })
                : t("feed.blocked.none")
            }
            chevron
            onPress={() => setBlockOpen(true)}
          />
        </ListGroup>
      )}

      {data ? (
        <FeedSettingsSheet
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          initial={{
            handle: data.handle ?? "",
            bio: data.bio ?? "",
            publicProfile: data.publicProfile,
            defaultVisibility: data.defaultVisibility,
          }}
          pending={update.isPending}
          error={update.isError ? errorMessage(update.error) : null}
          onSave={(input) => update.mutate(input)}
        />
      ) : null}

      <Sheet
        visible={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={t("feed.blocked.title")}
      >
        {blockList.isPending ? (
          <Skeleton width="100%" height={120} radius={24} />
        ) : (blockList.data?.length ?? 0) === 0 ? (
          <Text style={styles.muted}>{t("feed.blocked.emptyNative")}</Text>
        ) : (
          <View style={styles.peopleList}>
            {blockList.data!.map((person) => (
              <View key={person.id} style={styles.personRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("feed.blocked.profileAria", { name: person.name })}
                  onPress={() => {
                    setBlockOpen(false);
                    openAuthor(person.handle);
                  }}
                  style={({ pressed }) => [styles.personMain, pressed && styles.pressed]}
                >
                  <Avatar name={person.name} image={person.image} size={32} />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{person.name}</Text>
                    {person.handle ? <Text style={styles.muted}>@{person.handle}</Text> : null}
                  </View>
                </Pressable>
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("feed.blocked.unblock")}
                  loading={unblock.isPending && unblock.variables === person.id}
                  onPress={() => unblock.mutate(person.id)}
                />
              </View>
            ))}
          </View>
        )}
        {unblock.isError ? <Text style={styles.error}>{errorMessage(unblock.error)}</Text> : null}
      </Sheet>
    </>
  );
}

/** Handle + bio + publik toggle + visibility default editor. */
function FeedSettingsSheet({
  visible,
  onClose,
  initial,
  pending,
  error,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  initial: {
    handle: string;
    bio: string;
    publicProfile: boolean;
    defaultVisibility: Visibility;
  };
  pending: boolean;
  error: string | null;
  onSave: (input: {
    handle?: string;
    bio?: string;
    publicProfile?: boolean;
    defaultVisibility?: Visibility;
  }) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [publicProfile, setPublicProfile] = useState(initial.publicProfile);
  const [visibility, setVisibility] = useState<Visibility>(initial.defaultVisibility);

  useEffect(() => {
    if (visible) {
      setHandle(initial.handle);
      setBio(initial.bio);
      setPublicProfile(initial.publicProfile);
      setVisibility(initial.defaultVisibility);
    }
  }, [visible, initial]);

  const handleValid = HANDLE_REGEX.test(handle);
  const BIO_MAX = 160;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("feed.sheetTitleNative")}
      footer={
        <Button
          label={t("common:actions.save")}
          loading={pending}
          disabled={pending || !handleValid}
          onPress={() =>
            onSave({
              handle: handle.trim(),
              bio: bio.trim(),
              publicProfile,
              defaultVisibility: visibility,
            })
          }
        />
      }
    >
      <Field label={t("feed.handle.label")} hint={t("feed.handle.hint")}>
        <Input
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t("feed.handle.placeholderNative")}
        />
      </Field>
      {!handleValid ? <Text style={styles.error}>{t("feed.handle.error")}</Text> : null}

      <Field label={t("feed.bio.labelCount", { length: bio.length, max: BIO_MAX })}>
        <Input
          value={bio}
          onChangeText={setBio}
          maxLength={BIO_MAX}
          multiline
          placeholder={t("feed.bio.placeholderNative")}
        />
      </Field>

      <Field label={t("feed.public.title")}>
        <ListRow
          title={t("feed.public.title")}
          subtitle={t("feed.public.requiredNative")}
          right={
            <Switch
              value={publicProfile}
              onValueChange={setPublicProfile}
              accessibilityLabel={t("feed.public.title")}
            />
          }
        />
      </Field>

      <Field label={t("feed.visibility.label")}>
        <View style={styles.chipRow}>
          <Chip
            label={t("feed.visibility.groupShort")}
            selected={visibility === "grup"}
            onPress={() => setVisibility("grup")}
          />
          <Chip
            label={t("feed.visibility.public")}
            selected={visibility === "publik"}
            disabled={!publicProfile}
            onPress={() => setVisibility("publik")}
          />
        </View>
        {!publicProfile ? (
          <Text style={styles.muted}>{t("feed.visibility.publicNeeded")}</Text>
        ) : null}
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  peopleList: {
    gap: theme.spacing.md,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  personMain: {
    flex: 1,
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
  error: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
}));
