import { fmtSgd } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import { WhatsAppLink } from "@/components/landing/my-whatsapp";
import { useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { CONTACT_EMAIL } from "@/lib/contact";

const SGD_PENDING = "The Pro price in S$ will be announced before the Singapore launch";

const dollars = (cents: number) => fmtSgd(cents / 100, "en");

/** Daily AI photo allowance as sold: the cap when the server sets one, unlimited when it does not. */
const scanText = (cap: number | null) => (cap === null ? "unlimited AI photos a day" : `${cap} AI photos a day`);

/**
 * The Singapore dollar answer follows the server's config: prices only when `sgd` is set, a plain statement when it is
 * not, and nothing until the config has loaded (an empty answer is better than a guessed one).
 */
export function sgdFaq(config: AppConfig | undefined): Array<{ q: string; a: string }> {
  if (!config) return [];
  const q = "Can I pay in Singapore dollars?";
  if (!config.paywall) return [{ q, a: "On this server every feature is free, including unlimited AI photos a day." }];
  const free = `The free features work without paying, with ${scanText(config.freeDailyScans)}.`;
  if (!config.sgd) return [{ q, a: `${SGD_PENDING}. ${free}` }];
  const { monthlyCents, yearlyCents } = config.sgd;
  return [
    {
      q,
      a: `Yes. Pro is ${dollars(monthlyCents)} a month or ${dollars(yearlyCents)} a year, which works out to ${dollars(Math.round(yearlyCents / 12))} a month. Pay by card, Apple Pay or Google Pay through Polar. ${free}`,
    },
  ];
}

function Point({ children, tone }: { children: ReactNode; tone: "free" | "pro" }) {
  return (
    <li className="flex gap-2">
      <Check
        className={`mt-0.5 size-4 shrink-0 ${tone === "pro" ? "text-makan-ink" : "text-primary"}`}
        aria-hidden
      />
      {children}
    </li>
  );
}

/**
 * Free tier and Pro as one ledger: two stacked rows rather than two tier cards. Every number is read from
 * /api/config; loading and failure get their own text (the page must not look finished while it has no prices).
 */
export function PricingSg() {
  const config = useAppConfig();
  const data = config.data;

  if (config.isPending) {
    return (
      <p role="status" className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] text-muted-foreground">
        Loading prices and daily limits from the JoyoRogo server...
      </p>
    );
  }
  if (!data) {
    return (
      <p role="alert" className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] leading-relaxed">
        Prices cannot be loaded right now. Reload this page, or email{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {CONTACT_EMAIL}
        </a>
        , or message us on{" "}
        <WhatsAppLink
          location="sg-pricing-error"
          lang="en"
          className="inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-4"
        />
        .
      </p>
    );
  }
  if (!data.paywall) {
    return (
      <p className="rounded-[1.75rem] bg-card p-6 text-[0.9375rem] leading-relaxed">
        On this server every feature is free, including unlimited AI photos a day.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.75rem]">
      <div className="bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-xl font-extrabold tracking-tight">Free</h3>
          <p className="text-sm text-muted-foreground">no card, no expiry</p>
        </div>
        <ul className="mt-4 space-y-2 text-[0.9375rem]">
          <Point tone="free">
            {data.freeDailyScans === null ? "Unlimited AI photos a day" : `${data.freeDailyScans} AI photos a day`}
          </Point>
          <Point tone="free">Food, workout, weight and sleep diary</Point>
          <Point tone="free">No ads</Point>
        </ul>
        <Button
          variant="secondary"
          className="mt-6"
          render={
            <AppLink to="/login" data-revklik-goal="signup_click" data-revklik-goal-location="sg-pricing" />
          }
        >
          Sign up free with Google
        </Button>
      </div>
      <div className="bg-makan-soft p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-xl font-extrabold tracking-tight text-makan-ink">Pro</h3>
          {data.sgd ? (
            <p className="text-4xl font-extrabold tracking-tight tabular-nums">
              {dollars(data.sgd.monthlyCents)}
              <span className="ml-1.5 text-base font-semibold text-makan-ink/80">a month</span>
            </p>
          ) : (
            <p className="max-w-xs text-[0.9375rem] font-semibold text-makan-ink sm:text-right">{SGD_PENDING}</p>
          )}
        </div>
        <ul className="mt-4 space-y-2 text-[0.9375rem]">
          <Point tone="pro">
            {data.founderDailyCap === null
              ? "Unlimited AI photos a day"
              : `Up to ${data.founderDailyCap} AI photos a day`}
          </Point>
          <Point tone="pro">A Pro badge on your profile</Point>
          <Point tone="pro">Priority support: your reports and feature requests go first</Point>
          {data.sgd && (
            <>
              <Point tone="pro">
                Yearly plan {dollars(data.sgd.yearlyCents)} a year, which works out to{" "}
                {dollars(Math.round(data.sgd.yearlyCents / 12))} a month
              </Point>
              <Point tone="pro">
                Pay by card, Apple Pay or Google Pay through Polar. Renews automatically until you cancel; manage
                or cancel it from Profile.
              </Point>
            </>
          )}
        </ul>
        <p className="mt-5 text-sm leading-relaxed text-makan-ink/90">
          Questions about price or payment?{" "}
          <WhatsAppLink
            location="sg-pricing"
            lang="en"
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline underline-offset-4"
          />
        </p>
      </div>
    </div>
  );
}
