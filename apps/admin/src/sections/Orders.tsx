import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SearchX } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  errorMessage,
  fmtDateTime,
  fmtNum,
  get,
  chargedLabel,
  orderMethod,
  type AdminOrder,
  type PagedOrders,
} from "../api";
import { useClampPage, useHashQuery, usePaging } from "../hash";
import { Amount, CheckOrderButton, OrderStatus } from "../order-parts";
import {
  Button,
  CardFacts,
  DataList,
  Pagination,
  QueryBoundary,
  SearchBox,
  Select,
  type Column,
} from "../ui";

const STATUSES = ["pending", "paid", "failed"];

const COLUMNS = (onDone: () => void): Column<AdminOrder>[] => [
  { key: "order", header: "Order", cell: (o) => o.orderId, nowrap: true, className: "font-mono text-[0.6875rem]" },
  {
    key: "user",
    header: "User",
    cell: (o) => (
      <>
        <div className="font-medium">{o.name ?? "—"}</div>
        <div className="text-muted-foreground">{o.email}</div>
      </>
    ),
  },
  { key: "amount", header: "Amount", numeric: true, cell: (o) => <Amount value={o.amountIdr} charged={chargedLabel(o)} />, className: "w-32" },
  { key: "method", header: "Method", cell: (o) => orderMethod(o), className: "whitespace-nowrap" },
  { key: "status", header: "Status", cell: (o) => <OrderStatus status={o.status} /> },
  { key: "created", header: "Created", nowrap: true, cell: (o) => fmtDateTime(o.createdAt) },
  { key: "paid", header: "Paid", nowrap: true, cell: (o) => fmtDateTime(o.paidAt) },
  { key: "until", header: "Founder until", nowrap: true, cell: (o) => fmtDateTime(o.founderUntil) },
  {
    key: "check",
    header: "",
    cell: (o) => o.status === "pending" && <CheckOrderButton orderId={o.orderId} onDone={onDone} />,
  },
];

function OrderCard({ order: o, onDone }: { order: AdminOrder; onDone: () => void }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{o.name ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{o.email}</div>
        </div>
        <span className="shrink-0 text-sm font-semibold">
          <Amount value={o.amountIdr} charged={chargedLabel(o)} />
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <OrderStatus status={o.status} />
        <span className="text-muted-foreground">{orderMethod(o)}</span>
      </div>
      <p className="mt-1.5 font-mono text-[0.6875rem] break-all text-muted-foreground">{o.orderId}</p>
      <CardFacts
        facts={[
          { label: "Created", value: fmtDateTime(o.createdAt) },
          { label: "Paid", value: fmtDateTime(o.paidAt) },
          { label: "Founder until", value: fmtDateTime(o.founderUntil) },
        ]}
      />
      {o.status === "pending" && (
        <div className="mt-3">
          <CheckOrderButton orderId={o.orderId} onDone={onDone} />
        </div>
      )}
    </>
  );
}

export function OrdersSection() {
  const { params, set } = useHashQuery("orders");
  const statusParam = params.get("status") ?? "";
  const status = STATUSES.includes(statusParam) ? statusParam : "";
  const q = params.get("q") ?? "";
  const paging = usePaging(params, set);
  const [checkingAll, setCheckingAll] = useState(0);

  const sp = new URLSearchParams({
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  if (status) sp.set("status", status);
  if (q) sp.set("q", q);

  const orders = useQuery({
    queryKey: ["orders", sp.toString()],
    queryFn: () => get<PagedOrders>(`/api/admin/orders?${sp}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(orders.data?.total, paging, !orders.isPlaceholderData);

  const refetch = () => void orders.refetch();
  const filtered = Boolean(q || status);

  /**
   * Check every pending order with the gateway. The pending ids are collected
   * first (paging through the whole list): checking settles orders, which
   * would otherwise shift later pages while we walk them.
   */
  const checkAllPending = async () => {
    setCheckingAll(1);
    try {
      const pageSizeAll = 100;
      const ids: string[] = [];
      for (let p = 1; ; p++) {
        const qAll = new URLSearchParams({
          status: "pending",
          page: String(p),
          pageSize: String(pageSizeAll),
        });
        const res = await get<PagedOrders>(`/api/admin/orders?${qAll}`);
        ids.push(...res.orders.map((o) => o.orderId));
        if (res.orders.length < pageSizeAll || p * pageSizeAll >= res.total) break;
      }
      for (const orderId of ids) {
        try {
          const r = await api<{ outcome: string }>(`/api/admin/orders/${orderId}/check`, {
            method: "POST",
          });
          toast.info(`${orderId}: ${r.outcome}`);
        } catch (err) {
          toast.error(`${orderId}: ${errorMessage(err)}`);
        }
        setCheckingAll((n) => n + 1);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCheckingAll(0);
      refetch();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={q}
          onSearch={(v) => set({ q: v || null, page: null }, { replace: true })}
          placeholder="Cari nama, email, atau order id…"
          label="Cari order"
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Select
            value={status}
            onValueChange={(v) => set({ status: v || null, page: null })}
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
            className="h-12 sm:h-10"
            disabled={checkingAll > 0}
            onClick={() => void checkAllPending()}
          >
            {checkingAll > 0 ? `Checking… (${fmtNum(checkingAll)})` : "Check all pending"}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <QueryBoundary
          query={orders}
          isEmpty={(d) => d.orders.length === 0}
          empty={{
            icon: SearchX,
            title: "Tidak ada order",
            description: filtered ? "Tidak ada yang cocok dengan pencarian atau filter ini." : undefined,
          }}
        >
          {(d) => (
            <>
              <DataList
                rows={d.orders}
                rowKey={(o) => o.orderId}
                columns={COLUMNS(refetch)}
                card={(o) => <OrderCard order={o} onDone={refetch} />}
              />
              <Pagination
                page={d.page}
                pageSize={d.pageSize}
                total={d.total}
                onPage={paging.setPage}
                onPageSize={paging.setPageSize}
              />
            </>
          )}
        </QueryBoundary>
      </div>
    </div>
  );
}
