import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, Clock, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
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
  const amountIdr = status.data?.amountIdr;
  // Ask the gateway directly (and settle) instead of waiting for its webhook.
  const check = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Pesanan tidak ditemukan.");
      return checkOrder(order);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["billing-order", order], updated);
      if (updated.status !== "paid") {
        toast.error("Belum ada pembayaran masuk. Coba lagi sebentar.");
      }
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    if (!paid || !order) return;
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
    // Revenue counts once per order, not on every reload of this page.
    const key = `jrg-kp-paid-${order}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    trackConversion("founder_purchase", amountIdr, { order, ...fromProps() });
  }, [paid, order, amountIdr, queryClient]);

  let body: React.ReactNode;
  if (!order) {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-muted-foreground" aria-hidden />}
        title="Pesanan tidak ditemukan"
        text="Tautan ini tidak membawa nomor pesanan."
        action={<Button render={<Link to="/harga" />}>Lihat harga</Button>}
      />
    );
  } else if (status.isPending) {
    body = (
      <div
        className="h-56 animate-pulse rounded-3xl bg-card motion-reduce:animate-none"
        aria-busy="true"
        aria-label="Memeriksa pembayaran"
      />
    );
  } else if (status.isError) {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-muted-foreground" aria-hidden />}
        title="Status belum bisa dimuat"
        text={`${status.error.message} Pastikan kamu masuk dengan akun yang sama saat membayar.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => status.refetch()}>
              Coba lagi
            </Button>
            <Button render={<Link to="/login" />}>Masuk</Button>
          </div>
        }
      />
    );
  } else if (status.data.status === "paid") {
    body = (
      <State
        icon={<CircleCheck className="size-7 text-primary" aria-hidden />}
        title="Kamu sekarang Pro"
        text={
          status.data.founderUntil
            ? `Aktif sampai ${fmtFounderDate(status.data.founderUntil)}. Terima kasih sudah mendukung JoyoRogo.`
            : "Terima kasih sudah mendukung JoyoRogo."
        }
        action={<Button render={<Link to="/beranda" />}>Ke beranda</Button>}
      />
    );
  } else if (status.data.status === "failed") {
    body = (
      <State
        icon={<CircleAlert className="size-7 text-bakar" aria-hidden />}
        title="Pembayaran tidak selesai"
        text="Pesanan ini kedaluwarsa atau dibatalkan. Tidak ada dana yang ditarik."
        action={
          <Button disabled={checkout.isPending} onClick={() => checkout.start()}>
            {checkout.isPending ? "Membuka pembayaran..." : "Bayar lagi"}
          </Button>
        }
      />
    );
  } else {
    const stillPolling = status.dataUpdatedAt - openedAt < POLL_WINDOW_MS;
    body = (
      <State
        icon={<Clock className="size-7 text-muted-foreground" aria-hidden />}
        title="Menunggu konfirmasi pembayaran"
        text={
          stillPolling
            ? "Halaman ini diperbarui sendiri. Biasanya hanya beberapa detik setelah kamu membayar."
            : "Konfirmasi belum masuk. Kalau kamu sudah membayar, cek lagi sebentar lagi."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? "Memeriksa..." : "Cek pembayaran"}
            </Button>
            <Button
              variant="secondary"
              disabled={status.isFetching}
              onClick={() => status.refetch()}
            >
              {status.isFetching ? "Memeriksa..." : "Segarkan halaman"}
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
