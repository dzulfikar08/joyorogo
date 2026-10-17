import { cn } from "@joyorogo/ui/lib/utils";
import type { Basis } from "@joyorogo/api/lib/challenge";
import type { TFunction } from "@joyorogo/i18n";
import { Camera, Pencil, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ChallengeSummary } from "@/lib/api-types";

type StatusFields = Pick<ChallengeSummary, "status" | "startsInDays" | "dayNumber" | "durationDays">;

/** "Starts in 3 days" / "Day 2 of 7" / "Ended". */
export function statusText(t: TFunction<"challenge">, c: StatusFields): string {
  if (c.status === "ended") return t("status.ended");
  if (c.status === "upcoming") {
    return c.startsInDays === 1
      ? t("status.startsTomorrow")
      : t("status.startsIn", { count: c.startsInDays });
  }
  return t("status.day", { day: c.dayNumber, total: c.durationDays });
}

const CHIP_TONE: Record<ChallengeSummary["status"], string> = {
  upcoming: "bg-tidur-soft text-tidur-ink",
  active: "bg-makan-soft text-makan-ink",
  ended: "bg-muted text-muted-foreground",
};

export function StatusChip({ challenge }: { challenge: StatusFields }) {
  const { t } = useTranslation("challenge");
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-xs font-bold whitespace-nowrap",
        CHIP_TONE[challenge.status],
      )}
    >
      {statusText(t, challenge)}
    </span>
  );
}

/** Shield for device-backed data, camera for photo scans, pencil for manual entries. */
export function BasisIcon({ basis, className }: { basis: Basis; className?: string }) {
  const Icon = basis === "device" ? ShieldCheck : basis === "photo" ? Camera : Pencil;
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />;
}
