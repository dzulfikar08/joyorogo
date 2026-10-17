import { Sheet } from "@joyorogo/ui/components/sheet";
import { ChevronRight, Landmark, QrCode } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppConfig } from "@/lib/app-config";
import type { PaymentMethod } from "@/lib/app-config";
import { useFounderCheckout } from "@/lib/billing";
import type { CheckoutPlan } from "@/lib/billing";

const ICONS: Record<PaymentMethod, LucideIcon> = { qris: QrCode, transfer: Landmark };

/**
 * Founder checkout behind a "QRIS atau Transfer Bank" choice. `start()` opens
 * the picker when the server offers both, otherwise goes straight to the one
 * gateway (or the server default when the config predates the picker).
 * Render `sheet` once next to the buttons that call `start()`.
 */
export function useCheckoutPicker(plan: CheckoutPlan = "monthly") {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const checkout = useFounderCheckout(plan);
  const [open, setOpen] = useState(false);
  const onErrorRef = useRef<((error: Error) => void) | undefined>(undefined);
  const methods = config.data?.paymentMethods ?? [];

  const start = (onError?: (error: Error) => void) => {
    onErrorRef.current = onError;
    if (methods.length > 1) setOpen(true);
    else checkout.mutate(methods[0], { onError });
  };

  const sheet = (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t("picker.title")}
      description={t("picker.description")}
    >
      <div className="grid gap-2">
        {methods.map((method) => {
          const Icon = ICONS[method];
          return (
            <button
              key={method}
              type="button"
              disabled={checkout.isPending}
              onClick={() => {
                setOpen(false);
                checkout.mutate(method, { onError: onErrorRef.current });
              }}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold tracking-tight">
                  {t(`picker.${method}.label`)}
                </span>
                <span className="block text-sm leading-snug text-muted-foreground">
                  {t(`picker.${method}.note`)}
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
    sheet,
    isPending: checkout.isPending,
    isError: checkout.isError,
    error: checkout.error,
  };
}
