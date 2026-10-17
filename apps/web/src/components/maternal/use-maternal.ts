import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { MaternalInfo } from "@joyorogo/api/lib/maternal";

import { orpc } from "@/utils/orpc";

/** The Hamil / Menyusui plan of the signed-in user; null for everyone else (and while loading). */
export function useMaternalInfo(): MaternalInfo | null {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  return profile.data?.targets?.maternal ?? null;
}

/** "Minggu 20 hari ke-3 · Trimester 2" / "ASI eksklusif · Bayi 3 bulan". */
export function useMaternalStageLine(): (info: MaternalInfo) => string {
  const { t } = useTranslation("maternal");
  return (info) => stageLine(t, info);
}

type MaternalT = ReturnType<typeof useTranslation<"maternal">>["t"];

function stageLine(t: MaternalT, info: MaternalInfo): string {
  if (info.mode === "pregnant" && info.gestation) {
    const { weeks, dayOfWeek, trimester } = info.gestation;
    return [
      dayOfWeek > 0
        ? t("summary.weekDay", { week: weeks, day: dayOfWeek })
        : t("summary.week", { week: weeks }),
      t("summary.trimester", { n: trimester }),
    ].join(" · ");
  }
  return [
    info.feedingType ? t(`summary.feeding.${info.feedingType}`) : null,
    t("summary.babyAge", { months: info.babyMonths ?? 0 }),
  ]
    .filter(Boolean)
    .join(" · ");
}
