import { dailyTip } from "@joyorogo/api/lib/tips";
import { useTranslation } from "react-i18next";

import { SectionTitle } from "@/components/ui";
import { TipCard } from "@/components/tips/tip-card";

/** "Tips hari ini" di Beranda; tip-nya deterministik per hari Asia/Jakarta. */
export function DailyTipCard() {
  const { t } = useTranslation("tips");
  return (
    <>
      <SectionTitle title={t("daily.title")} />
      <TipCard tip={dailyTip()} />
    </>
  );
}
