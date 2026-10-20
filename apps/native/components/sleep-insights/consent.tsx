import "@/unistyles";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { SleepInsightsStatus } from "@joyorogo/api/lib/sleep-insights-types";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { useSleepSettings, useSleepStatus } from "@/components/sleep-insights/use-sleep-insights";
import { Button, Card, Chip, ListGroup, ListRow, Sheet, Skeleton, Text } from "@/components/ui";

/** What JoyoFit sends, what it does not, how long it is kept, and how it is deleted. */
function ConsentDetails() {
  const { t } = useTranslation("sleepInsights");
  return (
    <View style={styles.details}>
      <Text style={styles.body}>{t("consent.summary")}</Text>
      <View style={styles.detailBlock}>
        <Text style={styles.detailTitle}>{t("consent.fieldsTitle")}</Text>
        <Text style={styles.body}>{t("consent.fields")}</Text>
      </View>
      <Text style={styles.body}>{t("consent.notSent")}</Text>
      <Text style={styles.body}>{t("consent.retention")}</Text>
      <Text style={styles.body}>{t("consent.delete")}</Text>
      <Text style={styles.body}>{t("consent.shared")}</Text>
    </View>
  );
}

/** Shows the consent text and turns the switch on at the server's current version. */
export function SleepConsentSheet({
  visible,
  onClose,
  status,
}: {
  visible: boolean;
  onClose: () => void;
  status: SleepInsightsStatus;
}) {
  const { t } = useTranslation("sleepInsights");
  const { setConsent } = useSleepSettings();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("consent.title")}
      footer={
        <Button
          label={t("ui.off.enable")}
          loading={setConsent.isPending}
          onPress={() =>
            setConsent.mutate(
              { enabled: true, version: status.currentVersion },
              { onSuccess: onClose },
            )
          }
        />
      }
    >
      <ConsentDetails />
    </Sheet>
  );
}

/** Confirm before the switch goes off: it deletes every stored night. */
export function SleepOffConfirm({
  visible,
  onClose,
  status,
}: {
  visible: boolean;
  onClose: () => void;
  status: SleepInsightsStatus;
}) {
  const { t } = useTranslation(["sleepInsights", "common"]);
  const { setConsent } = useSleepSettings();
  return (
    <ConfirmSheet
      visible={visible}
      onClose={onClose}
      title={t("sleepInsights:consent.offConfirmTitle")}
      message={t("sleepInsights:consent.offConfirmBody")}
      confirmLabel={t("sleepInsights:consent.offConfirm")}
      cancelLabel={t("common:actions.cancel")}
      loading={setConsent.isPending}
      onConfirm={() =>
        setConsent.mutate(
          { enabled: false, version: status.currentVersion },
          { onSuccess: onClose },
        )
      }
    />
  );
}

/** Weekday chips (Sunday first, bit i = weekday i) for the free days used by the regularity math. */
function FreeDays({ status }: { status: SleepInsightsStatus }) {
  const { t } = useTranslation("sleepInsights");
  const { setFreeDays } = useSleepSettings();
  const days = t("ui.settings.days", { returnObjects: true }) as unknown as string[];
  return (
    <View style={styles.details}>
      <Text style={styles.detailTitle}>{t("ui.settings.title")}</Text>
      <Text style={styles.body}>{t("ui.settings.body")}</Text>
      <View style={styles.chips}>
        {days.map((label, i) => (
          <Chip
            key={label}
            label={label}
            selected={(status.freeDaysMask & (1 << i)) !== 0}
            disabled={setFreeDays.isPending}
            onPress={() => setFreeDays.mutate({ mask: status.freeDaysMask ^ (1 << i) })}
          />
        ))}
      </View>
    </View>
  );
}

/** Privasi screen block: the same server switch the Tidur screen's enable card turns on. */
export function SleepConsentCard() {
  const { t } = useTranslation("sleepInsights");
  const { theme } = useUnistyles();
  const statusQuery = useSleepStatus();
  const [consentOpen, setConsentOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const status = statusQuery.data;

  if (statusQuery.isPending) return <Skeleton width="100%" height={120} radius={24} />;
  if (!status) return null;

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t("consent.title")}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t("consent.switch")}</Text>
          <Switch
            value={status.enabled}
            onValueChange={(value) => (value ? setConsentOpen(true) : setOffOpen(true))}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={theme.colors.background}
            accessibilityLabel={t("consent.switch")}
          />
        </View>
        <ConsentDetails />
        {status.enabled ? <FreeDays status={status} /> : null}
      </Card>
      {status.enabled ? (
        <ListGroup>
          <ListRow
            icon="trash"
            title={t("ui.deleteData")}
            destructive
            onPress={() => setOffOpen(true)}
          />
        </ListGroup>
      ) : null}
      <SleepConsentSheet
        visible={consentOpen}
        onClose={() => setConsentOpen(false)}
        status={status}
      />
      <SleepOffConfirm visible={offOpen} onClose={() => setOffOpen(false)} status={status} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.md },
  cardTitle: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: 48,
  },
  switchLabel: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  details: { gap: theme.spacing.sm },
  detailBlock: { gap: 2 },
  detailTitle: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  body: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
}));
