import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@joyorogo/ui/lib/utils";
import { api, errorMessage, fmtIdr } from "./api";
import { Badge, Button } from "./ui";

/**
 * Rp with dot separators; Rp 0 rows (App Store grants, tests) are dimmed so real money stands out. A Polar order
 * in another currency also shows what was charged ("RM43.99"), the Rp being its ledger equivalent.
 */
export function Amount({ value, charged }: { value: number; charged?: string | null }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", value === 0 && "text-muted-foreground")}>
      {fmtIdr(value)}
      {charged && <span className="block text-[0.6875rem] font-normal text-muted-foreground">{charged}</span>}
    </span>
  );
}

export function OrderStatus({ status }: { status: string }) {
  return (
    <Badge tone={status === "paid" ? "green" : status === "pending" ? "amber" : "red"}>{status}</Badge>
  );
}

/** Asks the payment gateway about a pending order and settles it if paid. */
export function CheckOrderButton({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone?: (outcome: string) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={async (e) => {
        e.stopPropagation();
        setPending(true);
        try {
          const res = await api<{ outcome: string }>(`/api/admin/orders/${orderId}/check`, {
            method: "POST",
          });
          toast.info(res.outcome);
          onDone?.(res.outcome);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Checking…" : "Check with gateway"}
    </Button>
  );
}
