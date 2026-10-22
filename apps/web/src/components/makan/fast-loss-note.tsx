import { isFastLossDismissed } from "@joyorogo/api/lib/safety";
import type { FastLossNote as FastLossNoteData } from "@joyorogo/api/lib/safety";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/lib/auth-client";
import { readFastLossClosedOn, writeFastLossClosedOn } from "@/lib/fast-loss-store";
import { fmtDecimal } from "@/lib/format";

/**
 * One calm card when weight is falling fast or food has sat far below the body's resting need (`day.summary.fastLoss`,
 * today only; the server sends nothing for Hamil / Menyusui, gain plans or thin data). "Tutup" snoozes it in this
 * browser for a few days. `today` is the summary's day.
 */
export function FastLossNote({
  note,
  today,
  className,
}: {
  note: FastLossNoteData | null | undefined;
  today: string;
  className?: string;
}) {
  const { t } = useTranslation("makan");
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  // Hidden until the stored stamp has been read, so a closed card never flashes.
  const [closedOn, setClosedOn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (userId) setClosedOn(readFastLossClosedOn(userId));
  }, [userId]);

  if (!note || !userId || closedOn === undefined || isFastLossDismissed(closedOn, today)) return null;

  const pct = fmtDecimal(note.weeklyPct ?? 0, 1);
  const body =
    note.reasons.length === 2
      ? t("safety.fastLoss.both", { pct })
      : note.reasons[0] === "weight"
        ? t("safety.fastLoss.weight", { pct })
        : t("safety.fastLoss.intake");

  return (
    <section
      aria-label={t("safety.fastLoss.title")}
      className={cn("flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3", className)}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-snug">
        <p className="font-semibold text-foreground">{t("safety.fastLoss.title")}</p>
        <p className="text-muted-foreground">{body}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("safety.fastLoss.hint")}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="-my-1 -mr-2 min-h-11 shrink-0"
        onClick={() => {
          setClosedOn(today);
          writeFastLossClosedOn(userId, today);
        }}
      >
        {t("safety.fastLoss.dismiss")}
      </Button>
    </section>
  );
}
