import "@/unistyles";
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { BrandMark, HEALTH_BRAND } from "@/components/brand-mark";
import { KoneksiRow } from "@/components/koneksi-row";
import {
  BootLoader,
  ErrorState,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
} from "@/components/ui";
import { openJoyoFit } from "@/lib/workout/joyofit";
import { useSessionGate } from "@/lib/use-session-gate";
import type { SourceRow } from "@/src/lib/sources";
import { useSources } from "@/src/lib/use-sources";
import { errorMessage, timeAgo } from "@/utils/format";
import { queryClient } from "@/utils/orpc";

/**
 * Sumber data: the places JoyoRogo's numbers come from (the watch through JoyoFit, Health Connect / Apple Health,
 * Strava, a smart scale, what you type yourself), split into connected and not, each with when it last delivered. Every
 * row opens the screen that manages it; the permission screens themselves stay where they were.
 */
export default function Sumber() {
  const { t } = useTranslation(["sumber", "common", "settings"]);
  const gate = useSessionGate();
  const sources = useSources();

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;

  const ios = HEALTH_BRAND === "appleHealth";
  const healthTitle = t(ios ? "sumber:rows.health.titleIos" : "sumber:rows.health.titleAndroid");
  const healthVia = t(ios ? "sumber:rows.health.viaIos" : "sumber:rows.health.viaAndroid");
  const health = sources.health;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["health", "status"] });
    await sources.refetch();
  };

  const rowFor = (row: SourceRow) => {
    const last = (key: "lastIn" | "lastSync") =>
      row.lastAt === null ? null : t(`sumber:${key}`, { when: timeAgo(new Date(row.lastAt)) });
    const used = row.usedToday ? t("sumber:usedToday") : undefined;
    const common = { key: row.id, used };
    switch (row.id) {
      case "joyofit":
        return {
          ...common,
          icon: "watch" as const,
          tint: "bakar" as const,
          title: t("sumber:rows.joyofit.title"),
          subtitle: row.connected
            ? [
                t("sumber:rows.joyofit.via"),
                last("lastIn"),
                row.recent > 0 ? t("sumber:counts.workouts", { count: row.recent }) : null,
              ]
            : [t("sumber:rows.joyofit.empty")],
          onPress: () => void openJoyoFit("home"),
        };
      case "health":
        return {
          ...common,
          brand: HEALTH_BRAND,
          title: healthTitle,
          subtitle: row.connected
            ? [healthVia, last("lastSync") ?? t("sumber:rows.health.noRecord")]
            : [t("sumber:rows.health.empty")],
          footer:
            row.connected && health?.last
              ? [
                  t("settings:health.summary.workouts", { count: health.last.workoutsImported }),
                  t("settings:health.summary.activityDays", { count: health.last.activityDays }),
                  t("settings:health.summary.sleepNights", { count: health.last.sleepNights }),
                  t("settings:health.summary.skipped", { count: health.last.workoutsSkipped }),
                ].join(", ")
              : undefined,
          onPress: () => router.push("/profil/kesehatan"),
        };
      case "strava":
        return {
          ...common,
          brand: "strava" as const,
          title: t("sumber:rows.strava.title"),
          subtitle: row.connected
            ? [
                t("sumber:rows.strava.via"),
                row.lastAt === null ? t("sumber:rows.strava.none") : last("lastIn"),
                row.recent > 0 ? t("sumber:counts.workouts", { count: row.recent }) : null,
              ]
            : [t("sumber:rows.strava.empty")],
          onPress: () => router.push("/profil/strava"),
        };
      case "coros":
        return {
          ...common,
          icon: "watch" as const,
          tint: "bakar" as const,
          title: t("sumber:rows.coros.title"),
          subtitle: row.connected
            ? [
                t("sumber:rows.coros.via"),
                row.lastAt === null ? t("sumber:rows.coros.none") : last("lastIn"),
                row.recent > 0 ? t("sumber:counts.workouts", { count: row.recent }) : null,
              ]
            : [t("sumber:rows.coros.empty")],
          onPress: () => router.push("/profil/coros"),
        };
      case "garmin":
        return {
          ...common,
          icon: "fitness" as const,
          tint: "bakar" as const,
          title: t("sumber:rows.garmin.title"),
          subtitle: row.connected
            ? [
                t("sumber:rows.garmin.via"),
                row.lastAt === null ? t("sumber:rows.garmin.none") : last("lastIn"),
                row.recent > 0 ? t("sumber:counts.workouts", { count: row.recent }) : null,
              ]
            : [t("sumber:rows.garmin.empty")],
          onPress: () => router.push("/profil/garmin"),
        };
      case "scale":
        return {
          ...common,
          icon: "scale" as const,
          tint: "tidur" as const,
          title: t("sumber:rows.scale.title"),
          subtitle: row.connected
            ? [
                t("sumber:rows.scale.via"),
                last("lastIn"),
                row.recent > 0 ? t("sumber:counts.weighIns", { count: row.recent }) : null,
              ]
            : [t("sumber:rows.scale.empty")],
          onPress: () => router.push("/berat"),
        };
      case "manual":
        return {
          ...common,
          icon: "create" as const,
          tint: "muted" as const,
          title: t("sumber:rows.manual.title"),
          subtitle:
            row.lastAt === null
              ? [t("sumber:rows.manual.sub"), t("sumber:rows.manual.none")]
              : [
                  t("sumber:rows.manual.sub"),
                  last("lastIn"),
                  row.recent > 0 ? t("sumber:counts.entries", { count: row.recent }) : null,
                ],
          onPress: undefined,
        };
    }
  };

  const render = (rows: SourceRow[]) => (
    <ListGroup>
      {rows.map((row) => {
        const view = rowFor(row);
        return (
          <ListRow
            key={view.key}
            thumb={"brand" in view && view.brand ? <BrandMark brand={view.brand} /> : undefined}
            icon={"icon" in view ? view.icon : undefined}
            iconTint={"tint" in view ? view.tint : undefined}
            title={view.title}
            subtitle={view.subtitle.filter(Boolean).join(" · ")}
            footer={
              "footer" in view && view.footer ? (
                <Text style={styles.detail}>{view.footer}</Text>
              ) : undefined
            }
            right={
              view.used ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{view.used}</Text>
                </View>
              ) : undefined
            }
            chevron={view.onPress !== undefined}
            onPress={view.onPress}
          />
        );
      })}
    </ListGroup>
  );

  // The health store row only exists where this build can reach one (not an iOS build without the HealthKit module).
  const rows = sources.rows?.filter((row) => row.id !== "health" || health?.supported) ?? null;
  const connected = rows?.filter((row) => row.connected) ?? [];
  const available = rows?.filter((row) => !row.connected) ?? [];

  return (
    <Screen refreshing={sources.refreshing && rows !== null} onRefresh={() => void refresh()}>
      <PageHeader title={t("sumber:title")} />
      <Text style={styles.intro}>{t("sumber:intro")}</Text>
      {sources.error ? (
        <ErrorState message={errorMessage(sources.error)} onRetry={() => void refresh()} />
      ) : rows === null ? (
        <>
          <Skeleton width="100%" height={200} radius={24} />
          <Skeleton width="100%" height={140} radius={24} />
        </>
      ) : (
        <>
          <SectionTitle title={t("sumber:sections.connected")} />
          {render(connected)}
          {available.length > 0 ? (
            <>
              <SectionTitle title={t("sumber:sections.available")} />
              {render(available)}
            </>
          ) : null}
          {connected.some((row) => row.usedToday) ? (
            <Text style={styles.note}>{t("sumber:usedTodayNote")}</Text>
          ) : null}
          <SectionTitle title={t("sumber:sections.apps")} />
          <ListGroup>
            <KoneksiRow />
          </ListGroup>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  note: { fontSize: theme.fontSize.xs, lineHeight: 18, color: theme.colors.mutedForeground },
  detail: { fontSize: theme.fontSize.xs, lineHeight: 18, color: theme.colors.mutedForeground },
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makanSoft,
  },
  chipText: { fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.makanText },
}));
