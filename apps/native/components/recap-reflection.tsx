import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { WeekReflectionView } from "@joyorogo/api/lib/recap-reflection";

import { useAppConfig } from "@/components/billing";
import { Button, Card, SectionTitle, Skeleton, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

type Point = WeekReflectionView["wins"][number];

function PointList({
  heading,
  items,
  icon,
}: {
  heading: string;
  items: Point[];
  icon: "checkmark-circle" | "flag";
}) {
  const { theme } = useUnistyles();
  if (items.length === 0) return null;
  return (
    <View style={styles.list}>
      <Text style={styles.listHeading}>{heading}</Text>
      {items.map((item) => (
        <View key={`${item.code}-${item.variant}`} style={styles.listRow}>
          <Ionicons name={icon} size={18} color={theme.colors.primary} style={styles.listIcon} />
          <Text style={styles.listText}>{item.title}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * "Refleksi minggu ini" on the recap screen. The cheap query never calls the model;
 * a Pro account whose AI text is due triggers `generateWeekReflection` once per mount
 * (the screen keys this component by week) and keeps the template text on failure.
 */
export function RecapReflection({ weekStart }: { weekStart: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("reflection");
  const queryClient = useQueryClient();
  const query = useQuery(orpc.stats.weekReflection.queryOptions({ input: { weekStart } }));
  const generate = useMutation(
    orpc.stats.generateWeekReflection.mutationOptions({
      onSuccess: (result, vars) => {
        queryClient.setQueryData(
          orpc.stats.weekReflection.queryOptions({ input: { weekStart: vars.weekStart } }).queryKey,
          result,
        );
      },
    }),
  );
  const config = useAppConfig();

  const data = query.data;
  const attempted = useRef(false);
  const due = data?.ai === "pending";
  useEffect(() => {
    if (!due || attempted.current) return;
    attempted.current = true;
    generate.mutate({ weekStart });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, weekStart]);

  if (query.isPending) {
    return (
      <>
        <SectionTitle title={t("title")} />
        <Skeleton width="100%" height={220} radius={24} />
      </>
    );
  }
  if (query.isError || !data) return null;

  const isAi = data.source === "ai";
  const generating = data.ai === "pending" && !generate.isError;
  // /founder bounces back when billing is off, so the upsell only shows when it can sell.
  const canSell =
    config.data?.paywall === true &&
    (Platform.OS === "ios" ? config.data.appleBilling : config.data.billing);

  return (
    <>
      <SectionTitle title={t("title")} />
      <Card style={styles.card}>
        <View style={styles.sourceRow}>
          <Ionicons
            name={isAi ? "sparkles" : "analytics"}
            size={16}
            color={isAi ? theme.colors.primary : theme.colors.mutedForeground}
            style={styles.sourceIcon}
          />
          <Text style={styles.source}>{isAi ? t("source.ai") : t("source.template")}</Text>
        </View>

        <Text style={styles.body}>{data.text}</Text>

        {generating ? (
          <View accessibilityLiveRegion="polite" style={styles.status}>
            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
            <Text style={styles.statusText}>{t("generating")}</Text>
          </View>
        ) : null}

        <PointList heading={t("wins")} items={data.wins} icon="checkmark-circle" />
        <PointList heading={t("focus")} items={data.focus} icon="flag" />

        {data.ai === "locked" && canSell ? (
          <View style={styles.upsell}>
            <Text style={styles.upsellTitle}>{t("upsell.title")}</Text>
            <Text style={styles.upsellBody}>{t("upsell.body")}</Text>
            <Button
              variant="ghost"
              label={t("upsell.cta")}
              onPress={() => router.push({ pathname: "/founder", params: { from: "profile" } })}
              style={styles.upsellCta}
            />
          </View>
        ) : null}

        {data.complete ? null : <Text style={styles.muted}>{t("ongoing")}</Text>}
        <Text style={styles.muted}>{t("disclaimer")}</Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.md },
  sourceRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  sourceIcon: { marginTop: 1 },
  source: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  body: { fontSize: theme.fontSize.base, lineHeight: 23, color: theme.colors.foreground },
  status: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  statusText: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
  list: { gap: theme.spacing.sm },
  listHeading: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
  listIcon: { marginTop: 1 },
  listText: { flex: 1, fontSize: theme.fontSize.base, lineHeight: 22, color: theme.colors.foreground },
  upsell: {
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  upsellTitle: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  upsellBody: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  upsellCta: { alignSelf: "flex-start", minHeight: 48 },
  muted: { fontSize: theme.fontSize.xs, lineHeight: 18, color: theme.colors.mutedForeground },
}));
