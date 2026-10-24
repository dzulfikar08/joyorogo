import "@/unistyles";
import { useTranslation } from "react-i18next";

import { GarminCard } from "@/components/garmin-card";
import { ProfilPage } from "@/components/profil/page";

/** Garmin: paste the Personal API key, sync, disconnect. */
export default function GarminScreen() {
  const { t } = useTranslation("garmin");
  return (
    <ProfilPage title={t("title")}>
      <GarminCard headless />
    </ProfilPage>
  );
}
