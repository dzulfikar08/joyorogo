import { cn } from "@joyorogo/ui/lib/utils";
import type { Basis } from "@joyorogo/api/lib/challenge";
import { Camera, Pencil, ShieldCheck } from "lucide-react";

import type { ChallengeSummary } from "@/lib/api-types";

type StatusFields = Pick<ChallengeSummary, "status" | "startsInDays" | "dayNumber" | "durationDays">;

/** "Mulai 3 hari lagi" / "Hari ke-2 dari 7" / "Selesai". */
export function statusText(c: StatusFields): string {
  if (c.status === "ended") return "Selesai";
  if (c.status === "upcoming") {
    return c.startsInDays === 1 ? "Mulai besok" : `Mulai ${c.startsInDays} hari lagi`;
  }
  return `Hari ke-${c.dayNumber} dari ${c.durationDays}`;
}

/** "12 Okt" for a 'YYYY-MM-DD' calendar day. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const CHIP_TONE: Record<ChallengeSummary["status"], string> = {
  upcoming: "bg-tidur-soft text-tidur-ink",
  active: "bg-makan-soft text-makan-ink",
  ended: "bg-muted text-muted-foreground",
};

export function StatusChip({ challenge }: { challenge: StatusFields }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-xs font-bold whitespace-nowrap",
        CHIP_TONE[challenge.status],
      )}
    >
      {statusText(challenge)}
    </span>
  );
}

/** Shield for device-backed data, camera for photo scans, pencil for manual entries. */
export function BasisIcon({ basis, className }: { basis: Basis; className?: string }) {
  const Icon = basis === "device" ? ShieldCheck : basis === "photo" ? Camera : Pencil;
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />;
}
