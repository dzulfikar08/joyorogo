import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import { fmtUsdDate } from "@/lib/app-config";
import { usePolarPortal } from "@/lib/billing";
import type { PolarSubscription } from "@/lib/billing";
import { useEnglishBilling } from "@/lib/usd-copy";

/**
 * Status line and portal button for a Polar (USD) subscriber. English on
 * purpose, like the rest of the USD flow.
 */
export function PolarSubscriptionCard({ subscription }: { subscription: PolarSubscription }) {
  const portal = usePolarPortal();
  const te = useEnglishBilling();

  const end = subscription.currentPeriodEnd;
  const date = end === null ? null : fmtUsdDate(end);
  const canceled = subscription.state === "canceled" || subscription.cancelAtPeriodEnd;
  let status: string;
  if (subscription.state === "past_due") status = te("usd.manage.pastDue");
  else if (subscription.state === "revoked") status = te("usd.manage.revoked");
  else if (canceled) {
    status = date ? te("usd.manage.canceled", { date }) : te("usd.manage.canceledNoDate");
  } else {
    status = date ? te("usd.manage.renews", { date }) : te("usd.manage.renewsNoDate");
  }

  return (
    <div lang="en" className="mb-3 flex items-center justify-between gap-3 rounded-3xl bg-card p-5">
      <p className="min-w-0 text-sm leading-snug text-muted-foreground">{status}</p>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={portal.isPending}
        onClick={() => portal.mutate(undefined, { onError: (error) => toast.error(error.message) })}
      >
        <ExternalLink className="size-4" aria-hidden />
        {portal.isPending ? te("usd.manage.opening") : te("usd.manage.button")}
      </Button>
    </div>
  );
}
