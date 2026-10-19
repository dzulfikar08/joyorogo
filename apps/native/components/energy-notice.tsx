import "@/unistyles";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { EnergyNotice as EnergyNoticeData } from "@joyorogo/api/lib/energy-notice";
import { fmtNumber } from "@joyorogo/i18n";

import { Button, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { readDismissal, saveDismissal } from "@/src/lib/dismissals";
import { fmtInt } from "@/utils/format";
import { SITE_ORIGIN } from "@/src/lib/share-links";

/**
 * One-time note that the eat target now starts from TDEE (BMR x the level's factor). `notice` is the server's verdict
 * (`day.summary.energyNotice`); null hides it. Closing it is stored locally and synced (`dismissed.energyModel`).
 */
export function EnergyNotice({ notice }: { notice: EnergyNoticeData | null }) {
  const { t } = useTranslation("energy");
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readDismissal("dismissed.energyModel", userId).then((stored) => {
      if (live) setDismissed(stored);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!notice || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    if (userId) void saveDismissal("dismissed.energyModel", userId);
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("notice.title")}</Text>
      <Text style={styles.body}>{t("notice.body")}</Text>
      <Text style={styles.figure}>
        {notice.oldKcal === notice.newKcal
          ? t("notice.same", { new: fmtInt(notice.newKcal) })
          : t("notice.change", { old: fmtInt(notice.oldKcal), new: fmtInt(notice.newKcal) })}
      </Text>
      <Text style={styles.figure}>
        {t("notice.level", {
          level: t(`levels.${notice.level}.name`),
          factor: fmtNumber(notice.factor, 3),
        })}
      </Text>
      <Text style={styles.body}>{t("notice.hint")}</Text>
      <View style={styles.actions}>
        <Button
          label={t("notice.action")}
          onPress={() => {
            dismiss();
            router.push("/profil/target");
          }}
        />
        <Button variant="ghost" label={t("readMore")} onPress={() => void Linking.openURL(`${SITE_ORIGIN}/panduan/kalori`)} />
        <Button variant="secondary" label={t("notice.dismiss")} onPress={dismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.sm },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  figure: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
}));
