import "@/unistyles";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";

import type { TFunction } from "@joyorogo/i18n";

import type {
  SleepCard,
  SleepInsightsStatus,
  SleepInsightsView,
  SleepLastNight,
  SleepProgressRow,
} from "@joyorogo/api/lib/sleep-insights-types";

import { useAppConfig } from "@/components/billing";
import { SleepConsentSheet } from "@/components/sleep-insights/consent";
import {
  useSleepSettings,
  useSleepStatus,
  useSleepView,
} from "@/components/sleep-insights/use-sleep-insights";
import { Button, Card, ErrorState, Num, SectionTitle, Skeleton, Text } from "@/components/ui";
import { errorMessage, fmtDateShort } from "@/utils/format";

function duration(t: TFunction<"sleepInsights">, minutes: number): string {
  const total = Math.round(minutes);
  return total < 60
    ? t("ui.durationM", { m: total })
    : t("ui.durationHm", { h: Math.floor(total / 60), m: total % 60 });
}

/** Dots of the compared nights, newest first: filled = night with the habit. */
function NightDots({ nights }: { nights: SleepCard["nights"] }) {
  const { t } = useTranslation("sleepInsights");
  return (
    <View style={styles.nights}>
      <View style={styles.dots}>
        {nights.map((night) => (
          <View
            key={night.date}
            accessible
            accessibilityLabel={`${fmtDateShort(night.date)}: ${
              night.exposed ? t("ui.legendExposed") : t("ui.legendOther")
            }`}
            style={[styles.dot, night.exposed && styles.dotExposed]}
          />
        ))}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, styles.dotExposed]} />
          <Text style={styles.legendText}>{t("ui.legendExposed")}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.dot} />
          <Text style={styles.legendText}>{t("ui.legendOther")}</Text>
        </View>
      </View>
    </View>
  );
}

function InsightCard({ card, onDismiss, busy }: { card: SleepCard; onDismiss: () => void; busy: boolean }) {
  const { t } = useTranslation("sleepInsights");
  const [open, setOpen] = useState(false);
  const personal = card.kind === "personal";
  return (
    <Card style={styles.card}>
      <Text style={styles.kind}>{personal ? t("ui.personal") : t("ui.general")}</Text>
      <Text style={styles.cardText}>{card.text}</Text>
      {personal && card.exposed !== null && card.other !== null ? (
        <Text style={styles.compare}>
          {t("ui.compare", { exposed: card.exposed, other: card.other })}
          {card.confidence ? ` · ${t(`confidence.${card.confidence}`)}` : ""}
        </Text>
      ) : null}
      {card.nights.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((v) => !v)}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>{open ? t("ui.hideNights") : t("ui.showNights")}</Text>
          </Pressable>
          {open ? <NightDots nights={card.nights} /> : null}
        </>
      ) : null}
      {card.sources.length > 0 ? (
        <View style={styles.sources}>
          <Text style={styles.legendText}>{t("ui.sources")}</Text>
          {card.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              onPress={() => void WebBrowser.openBrowserAsync(source.url)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text style={styles.actionText}>{source.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onDismiss}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.mutedAction}>{t("ui.dismiss")}</Text>
      </Pressable>
      <Text style={styles.legendText}>{t("disclaimer")}</Text>
    </Card>
  );
}

function ProgressRows({ rows }: { rows: SleepProgressRow[] }) {
  const { t } = useTranslation("sleepInsights");
  return (
    <Card style={styles.card}>
      <Text style={styles.kind}>{t("ui.progress")}</Text>
      {rows.map((row) => (
        <View key={row.id} style={styles.progressRow}>
          <Text style={styles.cardText}>{row.text}</Text>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: row.need, now: Math.min(row.have, row.need) }}
            style={styles.barTrack}
          >
            <View
              style={[
                styles.barFill,
                { width: `${row.need > 0 ? Math.min(100, (row.have / row.need) * 100) : 0}%` },
              ]}
            />
          </View>
          <Num style={styles.legendText}>
            {Math.min(row.have, row.need)}/{row.need}
          </Num>
        </View>
      ))}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.legendText}>{label}</Text>
      <Num style={styles.statValue}>{value}</Num>
    </View>
  );
}

function LastNightCard({ night, regularity }: { night: SleepLastNight | null; regularity: SleepInsightsView["regularity"] }) {
  const { t } = useTranslation("sleepInsights");
  if (!night && !regularity) return null;
  return (
    <Card style={styles.card}>
      {night ? (
        <>
          <Text style={styles.kind}>{`${t("ui.lastNight")} · ${fmtDateShort(night.wakeDate)}`}</Text>
          <View style={styles.stats}>
            <Stat label={t("ui.asleep")} value={duration(t, night.asleepMin)} />
            <Stat label={t("ui.awake")} value={duration(t, night.awakeMin)} />
            <Stat label={t("ui.awakenings")} value={String(night.awakenings)} />
            {night.hasStages && night.deepMin !== null ? (
              <Stat label={t("ui.deep")} value={duration(t, night.deepMin)} />
            ) : null}
            {night.hasStages && night.remMin !== null ? (
              <Stat label={t("ui.rem")} value={duration(t, night.remMin)} />
            ) : null}
            {night.hrvMs !== null ? <Stat label={t("ui.hrv")} value={`${Math.round(night.hrvMs)} ms`} /> : null}
            {night.rhrBpm !== null ? (
              <Stat label={t("ui.rhr")} value={`${Math.round(night.rhrBpm)} bpm`} />
            ) : null}
            {night.room ? (
              <Stat
                label={t("ui.room")}
                value={t("ui.roomValue", { temp: Math.round(night.room.tempC), rh: Math.round(night.room.rhPct) })}
              />
            ) : null}
          </View>
        </>
      ) : null}
      {regularity ? (
        <View style={styles.regularity}>
          <Text style={styles.kind}>{t("ui.regularity")}</Text>
          <Text style={styles.cardText}>{t("ui.regularitySd", { minutes: Math.round(regularity.sdMin) })}</Text>
        </View>
      ) : null}
    </Card>
  );
}

function LockedTeaser({ count }: { count: number }) {
  const { t } = useTranslation("sleepInsights");
  const config = useAppConfig();
  // /founder bounces back when billing is off, so the CTA only shows when it can sell.
  const canSell =
    config.data?.paywall === true &&
    (Platform.OS === "ios" ? config.data.appleBilling : config.data.billing);
  return (
    <Card style={styles.card}>
      <Text style={styles.cardText}>{t("ui.lockedTeaser", { count })}</Text>
      {canSell ? (
        <Button
          variant="ghost"
          label={t("ui.lockedCta")}
          onPress={() => router.push({ pathname: "/founder", params: { from: "sleep" } })}
          style={styles.cta}
        />
      ) : null}
    </Card>
  );
}

function EnabledSection({ view }: { view: SleepInsightsView }) {
  const { t } = useTranslation("sleepInsights");
  const { dismiss } = useSleepSettings();
  const cards = view.cards.slice(0, 3);
  const nightsRow = view.progress.find((row) => row.id === "nights");
  const teaser = view.personal === "locked" && view.lockedCount > 0;
  const showEmpty = cards.length === 0 && view.progress.length === 0 && !teaser && !nightsRow;
  return (
    <>
      {view.personal === "needs_nights" && nightsRow ? (
        <Text style={styles.cardText}>
          {t("ui.needsNights", { need: Math.max(0, nightsRow.need - nightsRow.have), have: nightsRow.have })}
        </Text>
      ) : null}
      {cards.map((card) => (
        <InsightCard
          key={card.id}
          card={card}
          busy={dismiss.isPending}
          onDismiss={() => dismiss.mutate({ id: card.id })}
        />
      ))}
      {teaser ? (
        <LockedTeaser count={view.lockedCount} />
      ) : null}
      {view.progress.length > 0 ? <ProgressRows rows={view.progress} /> : null}
      <LastNightCard night={view.lastNight} regularity={view.regularity} />
      {showEmpty ? (
        <Text style={styles.cardText}>{t("ui.empty")}</Text>
      ) : null}
    </>
  );
}

/** 'Wawasan tidur' on the Tidur screen: enable card, or cards + progress + last night + regularity. */
export function SleepInsightsSection() {
  const { t } = useTranslation("sleepInsights");
  const [consentOpen, setConsentOpen] = useState(false);
  const statusQuery = useSleepStatus();
  const status: SleepInsightsStatus | undefined = statusQuery.data;
  const viewQuery = useSleepView(status?.enabled === true);

  if (statusQuery.isPending) {
    return (
      <>
        <SectionTitle title={t("title")} />
        <Skeleton width="100%" height={140} radius={24} />
      </>
    );
  }
  if (statusQuery.isError || !status) {
    return (
      <>
        <SectionTitle title={t("title")} />
        <ErrorState message={errorMessage(statusQuery.error)} onRetry={() => statusQuery.refetch()} />
      </>
    );
  }

  if (!status.enabled) {
    return (
      <>
        <SectionTitle title={t("title")} />
        <Card style={styles.card}>
          <Text style={styles.kind}>{t("ui.off.title")}</Text>
          <Text style={styles.cardText}>{t("ui.off.body")}</Text>
          <Button label={t("ui.off.enable")} onPress={() => setConsentOpen(true)} />
        </Card>
        <SleepConsentSheet visible={consentOpen} onClose={() => setConsentOpen(false)} status={status} />
      </>
    );
  }

  return (
    <>
      <SectionTitle title={t("title")} />
      {viewQuery.isError ? (
        <ErrorState message={errorMessage(viewQuery.error)} onRetry={() => viewQuery.refetch()} />
      ) : viewQuery.data ? (
        <EnabledSection view={viewQuery.data} />
      ) : (
        <Skeleton width="100%" height={140} radius={24} />
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.md },
  kind: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.tidurText },
  cardText: { fontSize: theme.fontSize.base, lineHeight: 22, color: theme.colors.foreground },
  compare: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.mutedForeground },
  action: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  pressed: { opacity: 0.7 },
  actionText: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.tidurText },
  mutedAction: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.mutedForeground },
  sources: { gap: 0 },
  nights: { gap: theme.spacing.sm },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.colors.tidur,
    backgroundColor: "transparent",
  },
  dotExposed: { backgroundColor: theme.colors.tidur },
  legend: { gap: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  legendText: { fontSize: theme.fontSize.xs, lineHeight: 16, color: theme.colors.mutedForeground },
  progressRow: { gap: theme.spacing.sm },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.tidurSoft,
  },
  barFill: { height: 8, borderRadius: 4, backgroundColor: theme.colors.tidur },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.lg },
  stat: { gap: 2, minWidth: 80 },
  statValue: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  regularity: { gap: 2 },
  cta: { alignSelf: "flex-start", minHeight: 48 },
}));
