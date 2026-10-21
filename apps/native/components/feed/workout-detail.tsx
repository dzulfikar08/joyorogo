import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { Button, Card, Skeleton, Text } from "@/components/ui";
import { BasicDetail, WorkoutAnalysisView } from "@/components/workout-analysis";
import { useAnalysisMapTheme, useAnalysisPalette, useAnalysisT } from "@/components/workout-analysis/adapters";
import { orpc } from "@/utils/orpc";

/**
 * Detail latihan JoyoFit: peta, grafik, split, zona, dan analisis lainnya. Penulis
 * dan viewer Pro melihat datanya; viewer lain mendapat kartu upsell ke /founder.
 * `onScrubActive` memberi tahu halaman agar mengunci scroll saat grafik/peta disentuh.
 */
export function WorkoutDetail({
  postId,
  onScrubActive,
}: {
  postId: string;
  onScrubActive?: (active: boolean) => void;
}) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const palette = useAnalysisPalette();
  const mapTheme = useAnalysisMapTheme();
  const analysisT = useAnalysisT();
  const detail = useQuery(orpc.social.workoutDetail.queryOptions({ input: { postId } }));
  const legacyHr = useMemo(
    () =>
      detail.data?.hr
        ? { intervalSec: detail.data.hr.intervalSec, bpm: detail.data.hr.bpm.map((v) => v ?? 0) }
        : null,
    [detail.data?.hr],
  );

  if (detail.isPending) return <Skeleton width="100%" height={160} radius={24} />;
  if (detail.isError)
    return (
      <Card>
        <Text style={styles.muted}>{t("watch.loadFailed")}</Text>
      </Card>
    );

  const { locked, route, analysis } = detail.data;
  if (locked)
    return (
      <Card style={styles.upsell}>
        <View style={styles.upsellHead}>
          <Ionicons name="lock-closed" size={18} color={theme.colors.mutedForeground} />
          <Text style={styles.title}>{t("watch.lockedTitle")}</Text>
        </View>
        <Text style={styles.muted}>{t("watch.lockedBody")}</Text>
        <Button
          size="sm"
          label={t("watch.lockedCta")}
          onPress={() => router.push({ pathname: "/founder", params: { from: "workout" } })}
        />
      </Card>
    );

  if (analysis)
    return (
      <WorkoutAnalysisView
        analysis={analysis}
        palette={palette}
        t={analysisT}
        mapTheme={mapTheme}
        onScrubActive={onScrubActive}
      />
    );

  return <BasicDetail hr={legacyHr} route={route} palette={palette} t={analysisT} mapTheme={mapTheme} />;
}

const styles = StyleSheet.create((theme) => ({
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  upsell: {
    gap: theme.spacing.md,
  },
  upsellHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
}));
