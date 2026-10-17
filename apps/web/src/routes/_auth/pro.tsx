import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useCheckoutPicker } from "@/components/checkout-picker";
import { Mascot } from "@/components/mascot";
import { FounderPromo } from "@/components/founder-promo";
import { Page, Segmented } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { fmtRupiah, founderScans, useAppConfig } from "@/lib/app-config";
import { validatePaywallSearch } from "@/lib/billing";
import type { CheckoutPlan } from "@/lib/billing";
import { orpc } from "@/utils/orpc";

const profileOptions = orpc.profile.myProfile.queryOptions();

/** Skippable Pro offer; `next` is where "Not now" and redirects land. */
export const Route = createFileRoute("/_auth/pro")({
  validateSearch: validatePaywallSearch,
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: FounderSkeleton,
  component: FounderPage,
});

function FounderPage() {
  const { t } = useTranslation("billing");
  const navigate = useNavigate();
  const { next, from } = Route.useSearch();
  const config = useAppConfig();
  const profile = useQuery(profileOptions);
  const [plan, setPlan] = useState<CheckoutPlan>("yearly");
  const checkout = useCheckoutPicker(plan);

  if (config.isError) {
    return (
      <ScreenError message={t("paywall.loadError")} onRetry={() => void config.refetch()} />
    );
  }
  if (!config.data) return <FounderSkeleton />;

  const destination = next ?? "/beranda";
  // Nothing to sell here (billing off) or nothing left to buy (sudah Pro):
  // continue straight away, no flash of the offer.
  if (!config.data.billing || profile.data?.tier === "founder") {
    return <Navigate to={destination} replace />;
  }

  const standardMonthly = config.data.promo?.nextPriceIdr ?? config.data.founderPriceIdr;
  const yearlySaving = standardMonthly * 12 - config.data.founderYearlyPriceIdr;
  const yearly = plan === "yearly";
  const steps = [
    t("details.step.web.one"),
    t("details.step.web.two"),
    t("details.step.done"),
  ];

  return (
    <Page className="max-w-md">
      <FounderPromo className="mb-3" />
      <section aria-labelledby="founder-title" className="rounded-3xl bg-card p-5">
        <div className="flex items-center gap-3">
          <Mascot
            pose={from === "quota" ? "sleepy" : "happy"}
            size="sm"
            eager
            className="mx-0 shrink-0"
          />
          <div className="min-w-0">
            <h1 id="founder-title" className="text-2xl font-extrabold tracking-tight">
              {t("paywall.title")}
            </h1>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {t(`paywall.subhead.${from ?? "banner"}`)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-sm font-semibold leading-snug">{t("paywall.bundle")}</p>
        <Segmented
          label={t("plan.label")}
          className="mt-4"
          value={plan}
          onChange={setPlan}
          options={[
            {
              value: "yearly",
              label: (
                <>
                  {t("plan.yearly")}{" "}
                  {yearlySaving > 0 && (
                    <span className="text-xs font-bold text-primary">
                      {t("plan.save", { amount: fmtRupiah(yearlySaving) })}
                    </span>
                  )}
                </>
              ),
            },
            { value: "monthly", label: t("plan.monthly") },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-3xl font-extrabold tracking-tight tabular-nums">
            {fmtRupiah(yearly ? config.data.founderYearlyPriceIdr : config.data.founderPriceIdr)}
            <span className="text-sm font-semibold text-muted-foreground">
              {" "}
              {yearly ? t("plan.perYear") : t("plan.perMonth")}
            </span>
          </p>
          {yearly && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("plan.equivalent", {
                price: fmtRupiah(Math.round(config.data.founderYearlyPriceIdr / 12)),
              })}
            </p>
          )}
        </div>
        <ul className="mt-3 space-y-1.5">
          {[
            founderScans(config.data),
            t("benefits.advice"),
            t("benefits.backup"),
            t("benefits.badge"),
            t("benefits.support"),
          ].map((feature) => (
            <li key={feature} className="flex gap-2.5 text-sm leading-snug">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        {config.data.freeDailyScans !== null && (
          <p className="mt-3 text-xs leading-snug text-muted-foreground">
            {t("benefits.free", { count: config.data.freeDailyScans })}
          </p>
        )}

        <Button
          className="mt-4 w-full"
          disabled={checkout.isPending}
          onClick={() => checkout.start((error) => toast.error(error.message))}
        >
          {checkout.isPending ? t("paywall.opening") : t("paywall.buy")}
        </Button>
        {checkout.sheet}
        <Button
          variant="secondary"
          className="mt-2 w-full"
          onClick={() => navigate({ to: destination, replace: true })}
        >
          {t("paywall.later")}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t("paywall.noAutoRenew")}
        </p>

        <details className="group mt-2 rounded-2xl bg-muted">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-2xl px-4 text-sm font-bold select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            {t("details.title")}
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <div>
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                {t("details.stepsTitle")}
              </p>
              <ol className="mt-2 space-y-2">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-2.5 text-sm leading-snug">
                    <span
                      aria-hidden
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="text-sm leading-snug text-muted-foreground">{t("details.backup")}</p>
            {yearly && (
              <p className="text-sm leading-snug text-muted-foreground">{t("details.stacks")}</p>
            )}
            <p className="flex items-start gap-1.5 text-sm leading-snug text-muted-foreground">
              <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{t("details.later")}</span>
            </p>
          </div>
        </details>
      </section>
    </Page>
  );
}

function FounderSkeleton() {
  const { t } = useTranslation("billing");
  return (
    <Page className="max-w-md">
      <div
        className="rounded-3xl bg-card p-6"
        aria-busy="true"
        aria-label={t("paywall.loading")}
      >
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="mt-4 h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-6 h-9 w-36" />
        <div className="mt-5 space-y-2.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-3/4" />
        </div>
        <Skeleton className="mt-5 h-12 w-full rounded-full" />
        <Skeleton className="mt-2 h-12 w-full rounded-full" />
      </div>
    </Page>
  );
}
