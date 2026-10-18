import "@/unistyles";
import { useTranslation } from "react-i18next";

import { FastingSettingsCard } from "@/components/fasting/settings-card";
import { BudgetSetting } from "@/components/plate/budget-setting";
import { ProfilDataPage } from "@/components/profil/page";
import { RamadanList } from "@/components/profil/sections";

/** Makan & puasa: Ramadan mode, intermittent fasting, shopping budget. */
export default function Makan() {
  const { t } = useTranslation("settings");
  return (
    <ProfilDataPage title={t("hub.rows.meals.title")}>
      {(profile) => {
        const prof = profile.profile;
        const maternal = profile.targets?.maternal ?? null;
        return (
          <>
            {prof ? <RamadanList mode={prof.ramadanMode} maternal={maternal !== null} /> : null}
            {prof && !maternal ? <FastingSettingsCard /> : null}
            <BudgetSetting />
          </>
        );
      }}
    </ProfilDataPage>
  );
}
