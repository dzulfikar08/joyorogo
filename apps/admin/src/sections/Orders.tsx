import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@joyorogo/ui/components/button";
import { api, fmtDateTime, fmtIdr, get, type AdminOrder } from "../api";
import { Badge } from "../ui";

function CheckButton({
  orderId,
  onDone,
  label = "Check with gateway",
}: {
  orderId: string;
  onDone?: (outcome: string) => void;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const res = await api<{ outcome: string }>(`/api/admin/orders/${orderId}/check`, {
            method: "POST",
          });
          toast.info(res.outcome);
          onDone?.(res.outcome);
        } catch (err) {
          toast.error(String(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Checking…" : label}
    </Button>
  );
}

export function OrdersSection() {
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => get<{ orders: AdminOrder[] }>("/api/admin/orders"),
  });

  const all = orders.data?.orders ?? [];
  const pending = all.filter((o) => o.status === "pending");
  const [checkedAll, setCheckedAll] = useState(0);

  const refetch = () => void orders.refetch();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {all.length} orders · {pending.length} pending
        </p>
        <Button
          size="sm"
          disabled={pending.length === 0 || checkedAll > 0}
          onClick={async () => {
            setCheckedAll(pending.length);
            for (const o of pending) {
              try {
                const res = await api<{ outcome: string }>(`/api/admin/orders/${o.orderId}/check`, {
                  method: "POST",
                });
                toast.info(`${o.orderId}: ${res.outcome}`);
              } catch (err) {
                toast.error(`${o.orderId}: ${String(err)}`);
              }
            }
            setCheckedAll(0);
            refetch();
          }}
        >
          {checkedAll > 0
            ? `Checking… (${pending.length - checkedAll + 1}/${pending.length})`
            : `Check all pending (${pending.length})`}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>User</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Paid</th>
                <th>Founder until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {all.map((o) => (
                <tr key={o.orderId}>
                  <td className="font-mono text-[0.6875rem]">{o.orderId}</td>
                  <td>
                    <div className="font-medium">{o.name ?? "—"}</div>
                    <div className="text-muted-foreground">{o.email}</div>
                  </td>
                  <td className="tabular-nums">{fmtIdr(o.amountIdr)}</td>
                  <td>
                    <Badge
                      tone={
                        o.status === "paid" ? "green" : o.status === "pending" ? "amber" : "muted"
                      }
                    >
                      {o.status}
                    </Badge>
                  </td>
                  <td>{fmtDateTime(o.createdAt)}</td>
                  <td>{fmtDateTime(o.paidAt)}</td>
                  <td>{fmtDateTime(o.founderUntil)}</td>
                  <td>
                    {o.status === "pending" && <CheckButton orderId={o.orderId} onDone={refetch} />}
                  </td>
                </tr>
              ))}
              {all.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted-foreground">
                    {orders.isPending ? "Loading…" : "No orders."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
