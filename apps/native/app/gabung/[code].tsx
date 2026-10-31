import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, ErrorState, Skeleton, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useSessionGate } from "@/lib/use-session-gate";
import { extractInviteCode } from "@/src/lib/group";
import { CONTENT_MAX_WIDTH } from "@/src/lib/layout";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * Invite landing (https://joyorogo.com/gabung/<CODE> and joyorogo://gabung/<CODE>):
 * preview the group, then join. The preview works before sign-in, so a
 * signed-out visitor sees which group invited them; joining sends them
 * through login and back here via the `next` param.
 */
export default function GabungInvite() {
  const { t } = useTranslation(["grup", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const toast = useToast();
  const { code: rawCode } = useLocalSearchParams<{ code?: string }>();
  const code = extractInviteCode(Array.isArray(rawCode) ? (rawCode[0] ?? "") : (rawCode ?? ""));

  const preview = useQuery({
    ...orpc.group.preview.queryOptions({ input: { code } }),
    enabled: gate !== "loading" && code !== "",
    retry: false,
  });

  const join = useMutation(
    orpc.group.join.mutationOptions({
      onSuccess: async (res) => {
        await queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        router.replace(`/grup/${res.groupId}`);
      },
      onError: (e) => toast.error(t("invite.joinFailed"), errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return <Skeleton width="100%" height={280} radius={24} />;
  }
  const signIn = () => router.replace({ pathname: "/login", params: { next: `/gabung/${code}` } });

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/grup");
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common:actions.back")}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={24} color={theme.colors.foreground} />
        </Pressable>

        {code === "" || preview.isError ? (
          <View style={styles.center}>
            <ErrorState
              message={code === "" ? t("invite.incomplete") : errorMessage(preview.error)}
              onRetry={() => preview.refetch()}
            />
            <Button variant="secondary" label={t("common:actions.back")} onPress={close} style={styles.action} />
          </View>
        ) : preview.isPending ? (
          <View style={styles.center}>
            <Skeleton width={220} height={220} radius={110} circle />
            <Skeleton width="100%" height={24} radius={8} />
            <Skeleton width={120} height={16} radius={8} />
          </View>
        ) : (
          <View style={styles.center}>
            <View style={[styles.iconChip, { backgroundColor: theme.colors.makanSoft }]}>
              <Ionicons name="people" size={30} color={theme.colors.makan} />
            </View>
            <Text style={styles.caption}>{t("invite.invitedToGroup")}</Text>
            <Text style={styles.name}>{preview.data.name}</Text>
            <Text style={styles.meta}>
              {preview.data.alreadyMember
                ? t("invite.membersAlready", { count: preview.data.memberCount })
                : t("members", { count: preview.data.memberCount })}
            </Text>
            <Button
              label={
                gate === "anon"
                  ? t("invite.signIn")
                  : preview.data.alreadyMember
                    ? t("invite.open")
                    : t("invite.join")
              }
              loading={join.isPending}
              onPress={() => (gate === "anon" ? signIn() : join.mutate({ code }))}
              style={styles.action}
            />
            <Button variant="ghost" label={t("invite.later")} onPress={close} style={styles.action} />
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    margin: theme.spacing.md,
    backgroundColor: theme.colors.card,
  },
  pressed: {
    opacity: 0.7,
  },
  center: {
    flex: 1,
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
  },
  iconChip: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  name: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginBottom: theme.spacing.md,
  },
  action: {
    minWidth: 220,
  },
}));
