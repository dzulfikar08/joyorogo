import "@/unistyles";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { FounderCards, useAppConfig } from "@/components/billing";
import { ProfilDataPage, type ProfileData } from "@/components/profil/page";
import { usePlanStatus } from "@/components/profil/status";
import { Card, Text } from "@/components/ui";

/** Langganan: free scan quota and Pro (FounderCards); a status card when there is nothing to buy. */
export default function Langganan() {
  const { t } = useTranslation("settings");
  return (
    <ProfilDataPage title={t("hub.rows.subscription.title")}>
      {(profile) => <LanggananContent profile={profile} />}
    </ProfilDataPage>
  );
}

function LanggananContent({ profile }: { profile: ProfileData }) {
  const config = useAppConfig();
  const status = usePlanStatus(profile);
  const billing = Platform.OS === "ios" ? config.data?.appleBilling : config.data?.billing;
  // FounderCards draws nothing for a free account without checkout, or Pro without an end date.
  const bare = profile.tier === "founder" ? !profile.founderUntil : billing !== true;
  return (
    <>
      <FounderCards tier={profile.tier ?? "free"} founderUntil={profile.founderUntil ?? null} />
      {config.data && bare && status.text ? (
        <Card>
          <Text style={styles.status}>{status.text}</Text>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  status: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
}));
