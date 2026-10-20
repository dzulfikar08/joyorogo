import "@/unistyles";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { serverUrl } from "@/components/billing";
import { Group, ProfilDataPage } from "@/components/profil/page";
import { PrivacyList, ShareRow } from "@/components/profil/sections";
import { SleepConsentCard } from "@/components/sleep-insights/consent";
import { useAccountActions } from "@/components/profil/use-account-actions";
import { ListRow, Text } from "@/components/ui";

/** Privasi & data: share progress, keep original photos, privacy policy, wipe all data. */
export default function Privasi() {
  const { t } = useTranslation("settings");
  return (
    <ProfilDataPage title={t("hub.rows.privacy.title")}>
      {(profile) => <PrivasiContent profile={profile.profile} maternal={profile.targets?.maternal != null} />}
    </ProfilDataPage>
  );
}

function PrivasiContent({
  profile,
  maternal,
}: {
  profile: { keepPhotos: boolean } | null;
  maternal: boolean;
}) {
  const { t } = useTranslation("settings");
  const account = useAccountActions();
  return (
    <>
      {profile && !maternal ? <ShareRow /> : null}
      {profile ? <PrivacyList keepPhotos={profile.keepPhotos} /> : null}
      <SleepConsentCard />
      <Group>
        <ListRow
          icon="shield-checkmark"
          iconTint="makan"
          title={t("privacy.policy")}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(`${serverUrl()}/privasi`)}
        />
      </Group>
      <Group>
        <ListRow
          icon="trash"
          title={t("privacy.wipe.title")}
          subtitle={t("privacy.wipe.subtitleNative")}
          destructive
          onPress={account.askWipeData}
          right={
            account.wipeDataPending ? (
              <Text style={styles.pending}>{t("privacy.wipe.deletingNative")}</Text>
            ) : undefined
          }
        />
      </Group>
      {account.sheets}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pending: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructiveText,
  },
}));
