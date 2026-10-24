import "@/unistyles";
import { useTranslation } from "react-i18next";

import { CorosCard } from "@/components/coros-card";
import { ProfilPage } from "@/components/profil/page";

/** COROS: connect, sync, disconnect. */
export default function CorosScreen() {
  const { t } = useTranslation("coros");
  return (
    <ProfilPage title={t("title")}>
      <CorosCard headless />
    </ProfilPage>
  );
}
