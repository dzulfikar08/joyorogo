import "@/unistyles";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ProfilPage } from "@/components/profil/page";
import { useNotificationGate } from "@/components/reminders/permission-sheet";
import { TimePickerSheet } from "@/components/reminders/time-picker-sheet";
import { useToast } from "@/components/toast";
import { Button, ListGroup, ListRow, Text } from "@/components/ui";
import { getNotificationPermission, type NotificationPermission } from "@/src/lib/notifications";
import { registerPush } from "@/src/lib/push";
import { client, orpc, queryClient } from "@/utils/orpc";

const CATEGORIES = [
  { key: "social", icon: "heart" },
  { key: "group", icon: "people" },
  { key: "meal", icon: "restaurant" },
  { key: "weigh", icon: "scale" },
  { key: "recap", icon: "stats-chart" },
] as const;

type Prefs = InferClientOutputs<AppRouterClient>["push"]["prefs"];

/** Pengaturan > Notifikasi: remote push permission, per-category switches, quiet hours and a test push. */
export default function Notifikasi() {
  const { t } = useTranslation("notifications");
  const { theme } = useUnistyles();
  const toast = useToast();
  const gate = useNotificationGate();
  const prefsQuery = useQuery(orpc.push.prefs.queryOptions());
  const prefs = prefsQuery.data;
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [testing, setTesting] = useState(false);
  const { refetch } = prefsQuery;

  useEffect(() => {
    const refresh = () => void getNotificationPermission().then(setPermission);
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, []);

  const prefsKey = orpc.push.prefs.queryKey();
  const setPrefs = useMutation(
    orpc.push.setPrefs.mutationOptions({
      onMutate: async (patch) => {
        await queryClient.cancelQueries({ queryKey: prefsKey });
        const before = queryClient.getQueryData<Prefs>(prefsKey);
        if (before) {
          queryClient.setQueryData<Prefs>(prefsKey, {
            ...before,
            ...patch,
            quiet: { ...before.quiet, ...patch.quiet },
          });
        }
        return { before };
      },
      onError: (_e, _patch, context) => {
        if (context?.before) queryClient.setQueryData(prefsKey, context.before);
        toast.error(t("saveFailed"));
      },
      onSuccess: (next) => queryClient.setQueryData(prefsKey, next),
    }),
  );

  const enable = async () => {
    const granted = await gate.ensure();
    setPermission(await getNotificationPermission());
    if (!granted) return;
    await registerPush({ force: true });
    void refetch();
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await client.push.sendTest();
      if (result.status === "skipped") toast.info(t("test.skipped"));
      else if (result.reached) toast.success(t("test.sent"));
      else toast.error(t("test.failed"));
    } catch {
      toast.error(t("test.failed"));
    } finally {
      setTesting(false);
    }
  };

  const statusKey =
    prefsQuery.isError
      ? "unavailable"
      : permission === "granted"
        ? "granted"
        : permission === "blocked"
          ? "denied"
          : "undetermined";

  const switchProps = {
    trackColor: { false: theme.colors.muted, true: theme.colors.primary },
    thumbColor: theme.colors.background,
    disabled: !prefs,
  } as const;

  return (
    <ProfilPage title={t("title")}>
      <Text style={styles.note}>{t("intro")}</Text>

      <View style={styles.card}>
        <Text style={styles.cardText}>{t(`status.${statusKey}`)}</Text>
        {prefs ? (
          <Text style={styles.note}>
            {t("devices", {
              web: prefs.devices.web,
              rogo: prefs.devices.joyorogo,
              fit: prefs.devices.joyofit,
            })}
          </Text>
        ) : null}
        {permission !== null && permission !== "granted" ? (
          <Button
            variant="secondary"
            size="sm"
            label={permission === "blocked" ? t("native.openSettings") : t("native.enable")}
            onPress={() => void enable()}
          />
        ) : null}
      </View>

      <ListGroup>
        {CATEGORIES.map(({ key, icon }) => (
          <ListRow
            key={key}
            icon={icon}
            iconTint="bakar"
            title={t(`categories.${key}.title`)}
            subtitle={t(`categories.${key}.desc`)}
            right={
              <Switch
                {...switchProps}
                value={prefs?.[key] ?? true}
                onValueChange={(value) => setPrefs.mutate({ [key]: value })}
                accessibilityLabel={t(`categories.${key}.title`)}
              />
            }
          />
        ))}
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="moon"
          iconTint="tidur"
          title={t("quiet.title")}
          subtitle={t("quiet.desc")}
          right={
            <Switch
              {...switchProps}
              value={prefs?.quiet.enabled ?? true}
              onValueChange={(enabled) => setPrefs.mutate({ quiet: { enabled } })}
              accessibilityLabel={t("quiet.title")}
            />
          }
        />
        {prefs?.quiet.enabled ? (
          <>
            <ListRow
              icon="time"
              iconTint="tidur"
              title={t("quiet.start")}
              value={prefs.quiet.start}
              onPress={() => setPicker("start")}
            />
            <ListRow
              icon="time"
              iconTint="tidur"
              title={t("quiet.end")}
              value={prefs.quiet.end}
              onPress={() => setPicker("end")}
            />
          </>
        ) : null}
      </ListGroup>

      <Text style={styles.note}>{t("limits")}</Text>

      <Button
        variant="secondary"
        label={testing ? t("test.sending") : t("test.button")}
        disabled={testing || !prefs}
        onPress={() => void sendTest()}
      />

      <TimePickerSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === "end" ? t("quiet.end") : t("quiet.start")}
        value={(picker === "end" ? prefs?.quiet.end : prefs?.quiet.start) ?? "21:30"}
        onSave={(time) => {
          const which = picker;
          setPicker(null);
          if (which) setPrefs.mutate({ quiet: { [which]: time } });
        }}
      />
      {gate.sheet}
    </ProfilPage>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.card,
    alignItems: "flex-start",
  },
  cardText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.foreground,
    fontWeight: "600",
    lineHeight: 22,
  },
}));
