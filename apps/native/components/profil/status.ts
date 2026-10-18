import { useTranslation } from "react-i18next";

import { fmtFounderDate, useAppConfig } from "@/components/billing";
import type { ProfileData } from "@/components/profil/page";

/** Plan status shown under the name on the Profil summary card. */
export interface PlanStatus {
  pro: boolean;
  /** Null when the server has no paywall (self-hosted copies): there is no plan to talk about. */
  text: string | null;
}

export function usePlanStatus(profile: ProfileData): PlanStatus {
  const { t } = useTranslation("settings");
  const config = useAppConfig();
  if (profile.tier === "founder") {
    return {
      pro: true,
      text: profile.founderUntil
        ? t("hub.summary.proUntil", { date: fmtFounderDate(profile.founderUntil) })
        : t("hub.summary.pro"),
    };
  }
  if (!config.data?.paywall) return { pro: false, text: null };
  const scans = config.data.freeDailyScans;
  return {
    pro: false,
    text:
      scans === null ? t("hub.summary.free") : t("hub.summary.freeScans", { count: scans }),
  };
}
