import "@/unistyles";
import { Image, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { BrandMark } from "@/components/brand-mark";
import { ProfilPage } from "@/components/profil/page";
import { StravaCard } from "@/components/strava-card";

/**
 * Strava: connect (official button), sync, disconnect and the 7-day retention notice. The
 * "Powered by Strava" logo sits at the bottom, small and apart from JoyoRogo's own UI, on a
 * white plate because its "powered by" text is black (unreadable on the dark theme).
 */
export default function StravaScreen() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.strava.title")} headerRight={<BrandMark brand="strava" />}>
      <StravaCard headless />
      <View style={styles.powered}>
        <View style={styles.plate}>
          <Image
            source={require("@/assets/images/brand/powered-by-strava.png")}
            style={styles.poweredImage}
            accessibilityLabel={t("hubNative.strava.poweredByLabel")}
            accessibilityIgnoresInvertColors
          />
        </View>
      </View>
    </ProfilPage>
  );
}

const styles = StyleSheet.create((theme) => ({
  powered: {
    alignItems: "center",
    marginTop: theme.spacing.md,
  },
  plate: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  poweredImage: {
    width: 146,
    height: 14.8,
  },
}));
