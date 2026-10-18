import "@/unistyles";
import { useTranslation } from "react-i18next";

import { FeedSettingsCard } from "@/components/feed/settings";
import { ProfilPage } from "@/components/profil/page";

/** Feed komunitas: handle, bio, public profile, default visibility, blocked accounts. */
export default function FeedSettings() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.feed.title")}>
      <FeedSettingsCard />
    </ProfilPage>
  );
}
