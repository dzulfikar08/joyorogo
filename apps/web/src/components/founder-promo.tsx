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
      className={cn("rounded-3xl bg-makan-soft p-5 text-makan-ink md:p-6", className)}
      data-revklik-goal-location="founder-promo"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div>
          <p className="text-xs font-bold tracking-wide uppercase">{t("promo.eyebrow")}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-extrabold tracking-tight tabular-nums">
              {fmtRupiah(config.data.founderPriceIdr)}
            </span>
            <span className="text-sm font-semibold">{t("promo.perMonth")}</span>
            {nextPriceIdr !== null && (
              <span className="text-sm text-makan-ink/60 tabular-nums">
                <span className="sr-only">{t("promo.wasPrice", { price: fmtRupiah(nextPriceIdr) })}</span>
                <s aria-hidden>{fmtRupiah(nextPriceIdr)}</s>
              </span>
            )}
          </p>
        </div>
        <div className="w-full sm:max-w-xs">
          <p className="text-sm leading-snug">
            <Trans
              ns="billing"
              i18nKey="promo.slots"
              count={left}
              values={{ total: promo.slots, left }}
              components={{ b: <span className="font-extrabold tabular-nums" /> }}
            />
          </p>
          <ProgressBar
            value={promo.taken}
            max={promo.slots}
            ariaLabel={t("promo.progress", { count: left, left, total: promo.slots })}
            className="mt-2 h-2 bg-card"
          />
        </div>
      </div>
      <details className="group mt-3 border-t border-makan-ink/10 pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl text-sm font-semibold select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {t("promo.details")}
          <ChevronDown
            className="size-4 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-1 pb-1 text-sm leading-relaxed text-makan-ink/80">
          {nextPriceIdr !== null && <p>{t("promo.then", { price: fmtRupiah(nextPriceIdr) })}</p>}
          <p>{t("promo.locked")}</p>
        </div>
      </details>
    </aside>
  );
}
