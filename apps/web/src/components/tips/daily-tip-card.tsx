import { dailyTip } from "@joyorogo/api/lib/tips";
import { useTranslation } from "react-i18next";

import { SectionTitle } from "@/components/kit/surface";
import { TipCard } from "@/components/tips/tip-card";

/** "Tips hari ini" di Beranda; tip-nya deterministik per hari di zona pengguna. */
export function DailyTipCard() {
  const { t } = useTranslation("tips");
  return (
    <section aria-label={t("daily.title")} className="mt-7">
      <SectionTitle>{t("daily.title")}</SectionTitle>
      <div className="mt-3">
        <TipCard tip={dailyTip()} />
      </div>
    </section>
  );
}
