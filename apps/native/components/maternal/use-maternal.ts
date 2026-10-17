import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { MaternalInfo, MaternalMode } from "@joyorogo/api/lib/maternal";

import { orpc } from "@/utils/orpc";

/** Hamil / Menyusui state of the signed-in user, from the cached profile query. */
export function useMaternal(): { mode: MaternalMode; info: MaternalInfo | null } {
  const { data } = useQuery(orpc.profile.myProfile.queryOptions());
  const info = data?.targets?.maternal ?? null;
  return { mode: info?.mode ?? "none", info };
}

/** Caffeine so far on today's log; null outside the maternal modes. */
export function useCaffeineToday() {
  const { mode } = useMaternal();
  const { data } = useQuery({
    ...orpc.day.summary.queryOptions({ input: {} }),
    enabled: mode !== "none",
  });
  return data?.maternal?.caffeine ?? null;
}

/** Stage summary: line = "Minggu 12 hari ke-3" / "Bayi 4 bulan", detail = trimester or feeding type. */
export function useStageText(info: MaternalInfo): { line: string; detail: string } {
  const { t } = useTranslation("maternal");
  if (info.mode === "pregnant" && info.gestation) {
    const { weeks, dayOfWeek, trimester } = info.gestation;
    return {
      line:
        dayOfWeek > 0
          ? t("summary.weekDay", { week: weeks, day: dayOfWeek })
          : t("summary.week", { week: weeks }),
      detail: t("summary.trimester", { n: trimester }),
    };
  }
  return {
    line: t("summary.babyAge", { months: info.babyMonths ?? 0 }),
    detail: info.feedingType ? t(`summary.feeding.${info.feedingType}`) : "",
  };
}
