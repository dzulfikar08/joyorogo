import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { api, fmtDateTime, fmtIdr, get, type AdminOrder, type PagedOrders } from "../api";
import { useHashQuery } from "../hash";
import { Badge, Pagination, Select } from "../ui";

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
  const { params, set } = useHashQuery("orders");
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("pageSize") ?? 50) || 50;
  const [search, setSearch] = useState(q);
  const [checkingAll, setCheckingAll] = useState(0);

  // Debounce the search box into the hash param so reloads keep state.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) set({ q: search || null, page: null });
    }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) sp.set("status", status);
  if (q.trim()) sp.set("q", q.trim());

  const orders = useQuery({
    queryKey: ["orders", sp.toString()],
    queryFn: () => get<PagedOrders>(`/api/admin/orders?${sp}`),
    placeholderData: keepPreviousData,
  });

  const rows = orders.data?.orders ?? [];
  const refetch = () => void orders.refetch();
  const setFilter = (patch: Record<string, string | number | null>) => set({ ...patch, page: null });

  /** Page through ALL pending orders (server-side), checking each with the gateway. */
  const checkAllPending = async () => {
    setCheckingAll(1);
    try {
      const pageSizeAll = 100;
      for (let p = 1; ; p++) {
        const qAll = new URLSearchParams({ status: "pending", page: String(p), pageSize: String(pageSizeAll) });
        const res = await get<PagedOrders>(`/api/admin/orders?${qAll}`);
        if (res.orders.length === 0) break;
        for (const o of res.orders) {
          try {
            const r = await api<{ outcome: string }>(`/api/admin/orders/${o.orderId}/check`, {
              method: "POST",
            });
            toast.info(`${o.orderId}: ${r.outcome}`);
          } catch (err) {
            toast.error(`${o.orderId}: ${String(err)}`);
          }
          setCheckingAll((n) => n + 1);
        }
        if (res.orders.length < pageSizeAll || p * pageSizeAll >= res.total) break;
      }
    } finally {
      setCheckingAll(0);
      refetch();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, email, atau order id…"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setFilter({ status: v || null })}
          aria-label="Filter status"
          options={[
            { value: "", label: "Status: semua" },
            { value: "pending", label: "Status: pending" },
            { value: "paid", label: "Status: paid" },
            { value: "failed", label: "Status: failed" },
          ]}
        />
        <Button
          size="sm"
          disabled={checkingAll > 0}
          onClick={() => void checkAllPending()}
        >
          {checkingAll > 0 ? `Checking… (${checkingAll})` : "Check all pending"}
        </Button>
      </div>

      <div className={cn("rounded-xl border border-border bg-card", orders.isPlaceholderData && "opacity-60")}>
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
              {rows.map((o) => (
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted-foreground">
                    {orders.isPending ? "Loading…" : "No orders."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {orders.data && (
          <div className="p-3">
            <Pagination
              page={orders.data.page}
              pageSize={orders.data.pageSize}
              total={orders.data.total}
              onPage={(p) => set({ page: p === 1 ? null : p })}
              onPageSize={(s) => set({ pageSize: s === 50 ? null : s, page: null })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
