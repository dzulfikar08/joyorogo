import "@/unistyles";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { ProfilPage } from "@/components/profil/page";
import { RemindersCard } from "@/components/reminders/reminders-card";
import { Button, Text } from "@/components/ui";

/** Pengingat: local notifications for meals, water, weigh-in and the fasting window. */
export default function Pengingat() {
  const { t } = useTranslation(["settings", "notifications"]);
  return (
    <ProfilPage title={t("settings:hub.rows.reminders.title")}>
      <RemindersCard />
      <Text style={styles.note}>{t("notifications:native.reminderNote")}</Text>
      <Button
        variant="secondary"
        size="sm"
        label={t("notifications:native.reminderNoteAction")}
        onPress={() => router.push("/profil/notifikasi")}
      />
    </ProfilPage>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
}));
