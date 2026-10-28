import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, Clock, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import { useCheckoutPicker } from "@/components/checkout-picker";
import { PublicHeader } from "@/components/public-header";
import { fromProps, trackConversion } from "@/lib/analytics";
import { checkOrder, fetchOrder, fmtFounderDate } from "@/lib/billing";
import { pageHead } from "@/lib/seo";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/pembayaran")({
  component: PembayaranPage,
  validateSearch: (search: Record<string, unknown>): { order?: string } => ({
    order: typeof search.order === "string" ? search.order : undefined,
  }),
  head: () => pageHead("/pembayaran"),
});

// Gateways usually notify within seconds; stop polling after 3 minutes.
const POLL_MS = 3000;
const POLL_WINDOW_MS = 3 * 60 * 1000;

function PembayaranPage() {
  const { t } = useTranslation("billing");
  const { order } = Route.useSearch();
  const queryClient = useQueryClient();
  const checkout = useCheckoutPicker();
  const [openedAt] = useState(() => Date.now());

  const status = useQuery({
    queryKey: ["billing-order", order],
    queryFn: () => fetchOrder(order as string),
    enabled: Boolean(order),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" && Date.now() - openedAt < POLL_WINDOW_MS
        ? POLL_MS
        : false,
    retry: 1,
  });

  const paid = status.data?.status === "paid";
  // Ask the gateway directly (and settle) instead of waiting for its webhook.
  const check = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error(t("order.notFoundError"));
      return checkOrder(order);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["billing-order", order], updated);
      if (updated.status !== "paid") {
        toast.error(t("order.notPaidYet"));
      }
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    if (!paid || !order) return;
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
    // Counts once per order, not on every reload of this page. No revenue here: the server forwards the sale.
    const key = `jrg-kp-paid-${order}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    trackConversion("founder_purchase", { order, ...fromProps() });
  }, [paid, order, queryClient]);

  let body: React.ReactNode;
  if (!order) {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-muted-foreground" aria-hidden />}
        title={t("order.missing.title")}
        text={t("order.missing.text")}
        action={<Button render={<Link to="/harga" />}>{t("order.missing.action")}</Button>}
      />
    );
  } else if (status.isPending) {
    body = (
      <div
        className="h-56 animate-pulse rounded-3xl bg-card motion-reduce:animate-none"
        aria-busy="true"
        aria-label={t("order.checking")}
      />
    );
  } else if (status.isError) {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-muted-foreground" aria-hidden />}
        title={t("order.error.title")}
        text={t("order.error.text", { message: status.error.message })}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => status.refetch()}>
              {t("order.error.retry")}
            </Button>
            <Button render={<Link to="/login" />}>{t("order.error.signIn")}</Button>
          </div>
        }
      />
    );
  } else if (status.data.status === "paid") {
    body = (
      <State
        icon={<CircleCheck className="size-7 text-primary" aria-hidden />}
        title={t("order.paid.title")}
        text={
          status.data.founderUntil
            ? t("order.paid.until", { date: fmtFounderDate(status.data.founderUntil) })
            : t("order.paid.thanks")
        }
        action={<Button render={<Link to="/beranda" />}>{t("order.paid.action")}</Button>}
      />
    );
  } else if (status.data.status === "failed") {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-bakar" aria-hidden />}
        title={t("order.failed.title")}
        text={t("order.failed.text")}
        action={
          <Button disabled={checkout.isPending} onClick={() => checkout.start()}>
            {checkout.isPending ? t("paywall.opening") : t("order.failed.action")}
          </Button>
        }
      />
    );
  } else {
    const stillPolling = status.dataUpdatedAt - openedAt < POLL_WINDOW_MS;
    body = (
      <State
        icon={<Clock className="size-7 text-muted-foreground" aria-hidden />}
        title={t("order.pending.title")}
        text={stillPolling ? t("order.pending.polling") : t("order.pending.stale")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? t("order.pending.checkingNow") : t("order.pending.check")}
            </Button>
            <Button
              variant="secondary"
              disabled={status.isFetching}
              onClick={() => status.refetch()}
            >
              {status.isFetching ? t("order.pending.checkingNow") : t("order.pending.refresh")}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-md px-4 py-10 md:py-14" aria-live="polite">
        {body}
        {checkout.sheet}
        {checkout.error && (
          <p role="alert" className="mt-4 text-center text-sm text-muted-foreground">
            {checkout.error.message}
          </p>
        )}
      </main>
    </div>
  );
}

function State({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-card p-6 text-center md:p-8">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted">
        {icon}
      </div>
      <h1 className="mt-4 text-xl font-extrabold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p>
      <div className="mt-5 flex justify-center">{action}</div>
    </section>
  );
}
