import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmtFounderDate, openManageSubscriptions } from "@/components/billing";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorState, Skeleton, Text } from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { extractKeluargaCode } from "@/src/lib/keluarga";
import { CONTENT_MAX_WIDTH } from "@/src/lib/layout";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * Joyo Keluarga seat invite (https://joyorogo.com/keluarga/<CODE> and joyorogo://keluarga/<CODE>), like the web
 * /keluarga/$code. The preview works before sign-in, so the invitee sees whose household it is; joining sends a
 * signed-out person through login and back here via `next`. Someone who pays Pro themselves is told first whether
 * their own subscription renews and where to cancel it (docs/pricing/joyo-keluarga.md section 2).
 */
export default function KeluargaInvite() {
  const { t } = useTranslation(["keluarga", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const toast = useToast();
  const { code: rawCode } = useLocalSearchParams<{ code?: string }>();
  const code = extractKeluargaCode(Array.isArray(rawCode) ? (rawCode[0] ?? "") : (rawCode ?? ""));
  const valid = /^[A-Za-z0-9]{4,20}$/.test(code);

  const preview = useQuery({
    ...orpc.household.preview.queryOptions({ input: { code } }),
    enabled: gate !== "loading" && valid,
    retry: false,
  });

  const accept = useMutation(
    orpc.household.accept.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.household.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
        ]);
        toast.success(t("invite.joined"));
        router.replace("/profil/langganan");
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return <Skeleton width="100%" height={280} radius={24} />;
  }
  const signIn = () => router.replace({ pathname: "/login", params: { next: `/keluarga/${code}` } });
  const openLangganan = () => router.replace("/profil/langganan");
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const data = preview.data;
  const membership = data?.viewer?.membership ?? null;
  const ownPro = data?.viewer?.ownPro ?? null;

  let body: React.ReactNode;
  if (!valid || preview.isError) {
    body = (
      <View style={styles.center}>
        <ErrorState
          message={!valid ? t("invite.invalidTitle") : errorMessage(preview.error)}
          onRetry={() => void preview.refetch()}
        />
        {!valid ? <Text style={styles.meta}>{t("invite.invalidBody")}</Text> : null}
        <Button variant="secondary" label={t("common:actions.back")} onPress={close} style={styles.action} />
      </View>
    );
  } else if (preview.isPending || !data) {
    body = (
      <View style={styles.center} accessibilityLabel={t("invite.checking")}>
        <Skeleton width={84} height={84} radius={42} circle />
        <Skeleton width="100%" height={24} radius={8} />
        <Skeleton width={120} height={16} radius={8} />
      </View>
    );
  } else {
    const blocked = data.state !== "ok" && membership !== "this";
    body = (
      <View style={styles.center}>
        <View style={[styles.iconChip, { backgroundColor: theme.colors.makanSoft }]}>
          <Ionicons name="home" size={30} color={theme.colors.makan} />
        </View>
        <Text style={styles.name}>{t("invite.invitedBy", { name: data.ownerFirstName })}</Text>
        <Text style={styles.meta}>{t("invite.seats", { used: data.seatsUsed, count: data.seats })}</Text>
        <Text style={styles.pitch}>{t("invite.pitch")}</Text>

        {membership === "this" ? (
          <>
            <Card style={styles.notice}>
              <Text style={styles.noticeText}>{t("invite.already")}</Text>
            </Card>
            <Button label={t("invite.open")} onPress={openLangganan} style={styles.action} />
          </>
        ) : blocked ? (
          <Card style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {t(`server.error.invite_${data.state as "expired" | "used" | "revoked" | "unpaid"}`)}
            </Text>
          </Card>
        ) : membership === "other" ? (
          <>
            <Card style={styles.notice}>
              <Text accessibilityRole="alert" style={styles.noticeText}>
                {t("invite.other")}
              </Text>
            </Card>
            <Button variant="secondary" label={t("invite.open")} onPress={openLangganan} style={styles.action} />
          </>
        ) : (
          <>
            {ownPro ? (
              <Card style={styles.notice}>
                <Text style={styles.noticeText}>
                  {ownPro.renews === "polar"
                    ? t("invite.ownPro.polar")
                    : ownPro.renews
                      ? t("invite.ownPro.store")
                      : t("invite.ownPro.web", { date: fmtFounderDate(ownPro.until ?? new Date()) })}
                </Text>
                {ownPro.renews === "apple" || ownPro.renews === "google_play" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label={t("invite.ownPro.manage")}
                    onPress={() => void openManageSubscriptions().catch(() => {})}
                  />
                ) : null}
              </Card>
            ) : null}
            {gate === "anon" ? (
              <>
                <Button label={t("invite.signIn")} onPress={signIn} style={styles.action} />
                <Text style={styles.meta}>{t("invite.signInHint")}</Text>
              </>
            ) : (
              <Button
                label={accept.isPending ? t("invite.joining") : t("invite.join")}
                loading={accept.isPending}
                onPress={() => accept.mutate({ code })}
                style={styles.action}
              />
            )}
          </>
        )}
      </View>
    );
  }

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
        {body}
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
  name: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  pitch: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    marginBottom: theme.spacing.sm,
  },
  notice: {
    width: "100%",
    gap: theme.spacing.sm,
  },
  noticeText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
  action: {
    minWidth: 220,
  },
}));
