import { cn } from "@joyorogo/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { ProgressBar } from "@/components/progress-bar";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";

/**
 * Intro-price banner with slot progress. Hidden while the config
 * loads, when the promo is off, and once every slot is taken. The
 * "after that" price and the price-lock note sit in a collapsed row.
 */
export function FounderPromo({ className }: { className?: string }) {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const promo = config.data?.promo;
  if (!config.data || !promo || promo.slots - promo.taken <= 0) return null;
  const left = promo.slots - promo.taken;
  const nextPriceIdr = promo.nextPriceIdr ?? null;
  return (
    <aside
      className={cn("rounded-3xl bg-card px-5 py-4", className)}
      data-revklik-goal-location="founder-promo"
    >
      <p className="text-sm font-bold leading-snug">
        {t("promo.headline", { price: fmtRupiah(config.data.founderPriceIdr) })}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
        <Trans
          ns="billing"
          i18nKey="promo.slots"
          count={left}
          values={{ total: promo.slots, left }}
          components={{ b: <span className="font-bold tabular-nums text-foreground" /> }}
        />
      </p>
      <ProgressBar
        value={promo.taken}
        max={promo.slots}
        ariaLabel={t("promo.progress", { count: left, left, total: promo.slots })}
        className="mt-2 h-1.5"
      />
      <details className="group mt-1">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between rounded-xl text-xs font-semibold text-muted-foreground select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {t("promo.details")}
          <ChevronDown
            className="size-4 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground">
          {nextPriceIdr !== null && <p>{t("promo.then", { price: fmtRupiah(nextPriceIdr) })}</p>}
          <p>{t("promo.locked")}</p>
        </div>
      </details>
    </aside>
  );
}
