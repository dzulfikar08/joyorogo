import { Sheet } from "@joyorogo/ui/components/sheet";
import { ChevronRight, CreditCard, Landmark, QrCode } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { fmtUsd, useAppConfig } from "@/lib/app-config";
import type { PaymentMethod } from "@/lib/app-config";
import { useFounderCheckout, useUsdCheckout } from "@/lib/billing";
import type { CheckoutPlan } from "@/lib/billing";

const ICONS: Record<PaymentMethod | "usd", LucideIcon> = {
  qris: QrCode,
  transfer: Landmark,
  usd: CreditCard,
};

/**
 * Pro checkout behind a "how do you want to pay" choice: QRIS, bank transfer
 * and, when the server offers it, USD by card (Polar). USD comes first for
 * visitors outside Indonesia, last otherwise. `start()` opens the picker when
 * more than one option exists, otherwise goes straight to the one gateway (or
 * the server default when the config predates the picker). `startUsd()` skips
 * the picker. Render `sheet` once next to the buttons that call `start()`.
 */
export function useCheckoutPicker(plan: CheckoutPlan = "monthly") {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const checkout = useFounderCheckout(plan);
  const usdCheckout = useUsdCheckout(plan);
  const [open, setOpen] = useState(false);
  const onErrorRef = useRef<((error: Error) => void) | undefined>(undefined);
  const methods = config.data?.paymentMethods ?? [];
  const usd = config.data?.usd ?? null;
  const options: Array<PaymentMethod | "usd"> = usd
    ? usd.preferred
      ? ["usd", ...methods]
      : [...methods, "usd"]
    : methods;

  const startUsd = (onError?: (error: Error) => void) => {
    usdCheckout.mutate(undefined, { onError });
  };

  const choose = (option: PaymentMethod | "usd") => {
    setOpen(false);
    if (option === "usd") usdCheckout.mutate(undefined, { onError: onErrorRef.current });
    else checkout.mutate(option, { onError: onErrorRef.current });
  };

  const start = (onError?: (error: Error) => void) => {
    onErrorRef.current = onError;
    if (options.length > 1) setOpen(true);
    else if (options[0] === "usd") startUsd(onError);
    else checkout.mutate(options[0], { onError });
  };

  const pending = checkout.isPending || usdCheckout.isPending;
  const usdPrice = usd ? fmtUsd(plan === "yearly" ? usd.yearlyCents : usd.monthlyCents) : "";

  const sheet = (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t("picker.title")}
      description={t("picker.description")}
    >
      <div className="grid gap-2">
        {options.map((option) => {
          const Icon = ICONS[option];
          const isUsd = option === "usd";
          return (
            <button
              key={option}
              type="button"
              disabled={pending}
              onClick={() => choose(option)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold tracking-tight">
                  {isUsd ? t("usd.optionLabel", { lng: "en" }) : t(`picker.${option}.label`)}
                </span>
                <span className="block text-sm leading-snug text-muted-foreground">
                  {isUsd
                    ? t(plan === "yearly" ? "usd.noteYearly" : "usd.noteMonthly", {
                        lng: "en",
                        price: usdPrice,
                      })
                    : t(`picker.${option}.note`)}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          );
        })}
      </div>
    </Sheet>
  );

  return {
    start,
    startUsd,
    sheet,
    isPending: pending,
    isError: checkout.isError || usdCheckout.isError,
    error: checkout.error ?? usdCheckout.error,
  };
}
