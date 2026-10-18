import "@/unistyles";
import { useTranslation } from "react-i18next";

import { ProfilPage } from "@/components/profil/page";
import { RemindersCard } from "@/components/reminders/reminders-card";

/** Pengingat: local notifications for meals, water, weigh-in and the fasting window. */
export default function Pengingat() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.reminders.title")}>
      <RemindersCard />
    </ProfilPage>
  );
}
