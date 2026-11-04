import { cn } from "@joyorogo/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type { Locale } from "@joyorogo/i18n";

import { ProgressBar } from "@/components/progress-bar";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";

/**
 * Intro-price banner with slot progress. Hidden while the config
 * loads, when the promo is off, and once every slot is taken. The
 * "after that" price and the price-lock note sit in a collapsed row.
 * `lng` pins the language (public pages that are not translated).
 */
export function FounderPromo({ className, lng }: { className?: string; lng?: Locale }) {
  const { t: tActive, i18n } = useTranslation("billing");
  // Public pages are fixed-language (Indonesian), so they pin the banner to theirs instead of the device's.
  const t = lng ? i18n.getFixedT(lng, "billing") : tActive;
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
              {fmtRupiah(config.data.founderPriceIdr, lng)}
            </span>
            <span className="text-sm font-semibold">{t("promo.perMonth")}</span>
            {nextPriceIdr !== null && (
              <span className="text-sm text-makan-ink/85 tabular-nums">
                <span className="sr-only">
                  {t("promo.wasPrice", { price: fmtRupiah(nextPriceIdr, lng) })}
                </span>
                <s aria-hidden>{fmtRupiah(nextPriceIdr, lng)}</s>
              </span>
            )}
          </p>
        </div>
        <div className="w-full sm:max-w-xs">
          <p className="text-sm leading-snug">
            <Trans
              t={t}
              ns="billing"
              i18nKey="promo.slots"
              count={left}
              values={{ total: promo.slots, left }}
              components={{ b: <span className="font-extrabold tabular-nums" /> }}
            />
          </p>
          <ProgressBar
            value={left}
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
        <div className="space-y-1 pb-1 text-sm leading-relaxed text-makan-ink/90">
          {nextPriceIdr !== null && (
            <p>{t("promo.then", { price: fmtRupiah(nextPriceIdr, lng) })}</p>
          )}
          <p>{t("promo.locked")}</p>
        </div>
      </details>
    </aside>
  );
}
