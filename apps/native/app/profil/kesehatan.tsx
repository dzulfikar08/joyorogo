import "@/unistyles";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { BrandMark, HEALTH_BRAND } from "@/components/brand-mark";
import { ErrorLine, Note, ProfilDataPage, type ProfileData } from "@/components/profil/page";
import { Button, Card, Text } from "@/components/ui";
import { isHealthSyncSupported, syncHealthData } from "@/src/lib/health-sync";
import { backfillNutritionToHealth, isNutritionMirrorSupported } from "@/src/lib/health-nutrition";
import { errorMessage } from "@/utils/format";
import { queryClient } from "@/utils/orpc";

/** Health Connect (Android) / Apple Health (iOS): 7-day import and the nutrition write-back. */
export default function Kesehatan() {
  const { t } = useTranslation("settings");
  const ios = HEALTH_BRAND === "appleHealth";
  return (
    <ProfilDataPage
      title={t(ios ? "hub.rows.healthIos.title" : "hub.rows.healthAndroid.title")}
    >
      {(profile) => <KesehatanContent profile={profile} />}
    </ProfilDataPage>
  );
}

function KesehatanContent({ profile }: { profile: ProfileData }) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isHealthSyncSupported()) return <Note>{t("hubNative.health.unsupported")}</Note>;

  const importHealthData = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncHealthData(profile.latestWeightKg ?? null);
      const parts = [
        t("health.summary.workouts", { count: result.workoutsImported }),
        t("health.summary.activityDays", { count: result.activityDays }),
        t("health.summary.sleepNights", { count: result.sleepNights }),
        t("health.summary.skipped", { count: result.workoutsSkipped }),
      ];
      let summary = `${parts.join(", ")}.`;
      const empty =
        result.workoutsImported === 0 && result.activityDays === 0 && result.sleepNights === 0;
      // HealthKit menolak izin secara diam: kueri hanya kembali kosong, jadi
      // arahkan ke Setelan tanpa mengklaim tahu penyebabnya.
      if (Platform.OS === "ios" && empty) {
        summary += ` ${t("health.summary.iosEmpty")}`;
      }
      setMessage(summary);
      queryClient.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const writeNutrition = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await backfillNutritionToHealth();
      setMessage(t("health.nutritionWritten", { count: result.meals }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={styles.head}>
        {/* The mark always sits next to the product name (docs/brand-marks.md). */}
        <BrandMark brand={HEALTH_BRAND} />
        <Text style={styles.title}>
          {HEALTH_BRAND === "appleHealth" ? "Apple Health" : "Health Connect"}
        </Text>
      </View>
      <Note>{Platform.OS === "ios" ? t("health.noteIos") : t("health.noteAndroid")}</Note>
      <Button
        variant="secondary"
        label={t("health.syncButton")}
        onPress={() => void importHealthData()}
        loading={busy}
      />
      {isNutritionMirrorSupported() ? (
        <>
          <Note>{t("health.nutritionNote")}</Note>
          <Button
            variant="secondary"
            label={t("health.nutritionButton")}
            onPress={() => void writeNutrition()}
            loading={busy}
          />
        </>
      ) : null}
      {message ? <Note>{message}</Note> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
}));
