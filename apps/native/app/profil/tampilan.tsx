import "@/unistyles";
import { useTranslation } from "react-i18next";

import { ProfilPage } from "@/components/profil/page";
import { AppearanceList, LanguageList } from "@/components/profil/sections";

/** Tampilan & bahasa: light/dark/system theme and the app language. */
export default function Tampilan() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.display.title")}>
      <AppearanceList />
      <LanguageList />
    </ProfilPage>
  );
}
