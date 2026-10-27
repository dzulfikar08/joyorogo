import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { IconChip, ListGroup, ListRow } from "@/components/kit/surface";
import { useCheckoutPicker } from "@/components/checkout-picker";
import { PolarSubscriptionCard } from "@/components/polar-subscription";
import { PrioritySupportCard } from "@/components/profil/priority-support";
import type { ProfilCtx } from "@/components/profil/shared";
import { useAppConfig } from "@/lib/app-config";
import { checkOrder, fetchPendingOrder, fetchPolarSubscription, fmtFounderDate } from "@/lib/billing";
import { orpc } from "@/utils/orpc";

/** Free quota or Pro status, the pending-payment check, renewal and the Polar portal. */
export function SubscriptionScreen({ ctx }: { ctx: ProfilCtx }) {
  const { t } = useTranslation(["settings", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useAppConfig();
  const checkout = useCheckoutPicker();
  const billing = config.data?.billing === true;
  const { tier, founderUntil } = ctx;

  // A checkout the user abandoned at the gateway can still be settled: the
  // check endpoint asks DOKU/Pakasir directly and flips Founder on if paid.
  const pendingOrder = useQuery({
    queryKey: ["billing", "pending-order"],
    queryFn: fetchPendingOrder,
    enabled: tier === "free" && billing,
  });
  // Polar (USD) subscribers manage renewal in Polar's portal. Errors mean
  // "none" (older server, signed out): the card just stays hidden.
  const polarSubscription = useQuery({
    queryKey: ["billing", "polar-subscription"],
    queryFn: () => fetchPolarSubscription().catch(() => null),
    staleTime: 5 * 60_000,
  });
  const polarRenewsItself =
    polarSubscription.data?.state === "active" || polarSubscription.data?.state === "past_due";
  const checkPending = useMutation({
    mutationFn: () => {
      const orderId = pendingOrder.data?.orderId;
      if (!orderId) throw new Error(t("pro.pending.none"));
      return checkOrder(orderId);
    },
    onSuccess: (order) => {
      if (order.status !== "paid") {
        toast.error(t("pro.pending.notPaid"));
        return;
      }
      toast.success(t("pro.pending.paid"));
      queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      queryClient.invalidateQueries({ queryKey: ["billing", "pending-order"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const showsCard =
    (tier === "free" && billing) ||
    (tier === "founder" && founderUntil !== null) ||
    polarSubscription.data != null;

  return (
    <>
      {!showsCard && (
        <ListGroup>
          <ListRow
            icon={
              <IconChip tone={tier === "founder" ? "makan" : "muted"}>
                <Sparkles />
              </IconChip>
            }
            title={tier === "founder" ? t("pro.active.title") : t("hub.summary.free")}
          />
        </ListGroup>
      )}
      {tier === "free" && billing && (
        <div className="mb-3 rounded-3xl bg-makan-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-bold text-makan-ink">
                {t("pro.free.scansPerDay", { count: config.data?.freeDailyScans ?? 0 })}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {config.data?.founderDailyCap == null
                  ? t("pro.free.proUnlimited")
                  : t("pro.free.proCapped", { count: config.data.founderDailyCap })}
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() =>
                navigate({ to: "/pro", search: { from: "profile", next: "/profil/langganan" } })
              }
            >
              {t("pro.free.upgrade")}
            </Button>
          </div>
          {pendingOrder.data && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm leading-snug text-muted-foreground">
                {t("pro.pending.note")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={checkPending.isPending}
                onClick={() => checkPending.mutate()}
              >
                {checkPending.isPending ? t("pro.pending.checking") : t("pro.pending.check")}
              </Button>
            </div>
          )}
        </div>
      )}

      {tier === "founder" && founderUntil && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-3xl bg-card p-5">
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-bold">{t("pro.active.title")}</p>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {t("pro.active.until", { date: fmtFounderDate(founderUntil) })}
            </p>
          </div>
          {billing && !polarRenewsItself && (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={checkout.isPending}
              onClick={() => checkout.start((error) => toast.error(error.message))}
            >
              {checkout.isPending ? t("pro.active.opening") : t("pro.active.renew")}
            </Button>
          )}
          {billing && !polarRenewsItself && checkout.sheet}
        </div>
      )}

      {polarSubscription.data && <PolarSubscriptionCard subscription={polarSubscription.data} />}
      {tier === "founder" && <PrioritySupportCard email={ctx.email} />}
    </>
  );
}
