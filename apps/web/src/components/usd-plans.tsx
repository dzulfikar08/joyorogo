import { Check } from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { fmtUsd } from "@/lib/app-config";
import type { AppConfig, UsdConfig } from "@/lib/app-config";
import { useEnglishBilling } from "@/lib/usd-copy";

type Checkout = { start: () => void; pending: boolean };

/**
 * Pro in US dollars (Polar, card, auto-renewing). The copy is English on
 * purpose, whatever the UI language is: the buyers are outside Indonesia.
 */
export function UsdPlans({
  usd,
  config,
  yearly,
  monthly,
  className,
}: {
  usd: UsdConfig;
  config: Pick<AppConfig, "founderDailyCap">;
  yearly: Checkout;
  monthly: Checkout;
  className?: string;
}) {
  const te = useEnglishBilling();

  const yearlyFullPrice = usd.monthlyCents * 12;
  const saving = yearlyFullPrice - usd.yearlyCents;
  const percent = yearlyFullPrice > 0 ? Math.round((saving / yearlyFullPrice) * 100) : 0;

  const features = [
    config.founderDailyCap === null
      ? te("benefits.scansUnlimited")
      : te("benefits.scansCapped", { count: config.founderDailyCap }),
    te("benefits.advice"),
    te("benefits.backup"),
    te("benefits.badge"),
    te("benefits.support"),
  ];

  const plans = [
    {
      key: "yearly",
      name: te("usd.section.yearly"),
      cents: usd.yearlyCents,
      per: te("usd.section.perYear"),
      sub: te("usd.section.equivalent", { price: fmtUsd(Math.round(usd.yearlyCents / 12)) }),
      badge:
        saving > 0
          ? te("usd.section.save", { amount: fmtUsd(saving), percent })
          : undefined,
      highlight: true,
      cta: te("usd.section.buyYearly"),
      checkout: yearly,
    },
    {
      key: "monthly",
      name: te("usd.section.monthly"),
      cents: usd.monthlyCents,
      per: te("usd.section.perMonth"),
      sub: undefined,
      badge: undefined,
      highlight: false,
      cta: te("usd.section.buyMonthly"),
      checkout: monthly,
    },
  ];

  return (
    <section lang="en" aria-label={te("usd.section.title")} className={className}>
      <div className="max-w-xl">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {te("usd.section.eyebrow")}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
          {te("usd.section.title")}
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {te("usd.section.subtitle")}
        </p>
      </div>
      <div className="mt-6 grid items-start gap-4 sm:grid-cols-2">
        {plans.map((plan) => (
          <div
            key={plan.key}
            className={cn(
              "card-lift flex flex-col rounded-3xl p-6",
              plan.highlight ? "bg-makan-soft" : "bg-card",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3
                className={cn(
                  "text-base font-bold tracking-tight",
                  plan.highlight && "text-makan-ink",
                )}
              >
                {plan.name}
              </h3>
              {plan.badge && (
                <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-bold text-makan-ink">
                  {plan.badge}
                </span>
              )}
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">
              {fmtUsd(plan.cents)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{plan.per}</p>
            {plan.sub && <p className="mt-0.5 text-xs font-semibold text-makan-ink">{plan.sub}</p>}
            <ul className="mt-5 space-y-2.5">
              {features.map((feature) => (
                <li key={feature} className="flex gap-2.5 text-sm leading-relaxed">
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      plan.highlight ? "text-makan-ink" : "text-primary",
                    )}
                    aria-hidden
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button
              className="mt-6"
              variant={plan.highlight ? undefined : "secondary"}
              disabled={plan.checkout.pending}
              onClick={() => plan.checkout.start()}
            >
              {plan.checkout.pending ? te("usd.section.opening") : plan.cta}
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {te("usd.section.note")}
      </p>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {te("usd.section.rupiahHint")}
      </p>
    </section>
  );
}
