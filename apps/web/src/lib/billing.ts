import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { trackEvent } from "./analytics";
import { apiUrl } from "./app-config";

/** Start a DOKU Checkout for one month of Founder, then leave for DOKU's page. */
export function useFounderCheckout() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/billing/checkout"), {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        navigate({ to: "/login" });
        return null;
      }
      const body = (await res.json().catch(() => null)) as {
        paymentUrl?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.paymentUrl) {
        throw new Error(body?.error ?? "Pembayaran belum bisa diproses. Coba lagi nanti.");
      }
      trackEvent("checkout_start");
      window.location.assign(body.paymentUrl);
      return body.paymentUrl;
    },
  });
}

export type OrderStatus = {
  orderId: string;
  status: "pending" | "paid" | "failed";
  amountIdr: number;
  founderUntil: string | null;
};

export async function fetchOrder(orderId: string): Promise<OrderStatus> {
  const res = await fetch(apiUrl(`/api/billing/orders/${encodeURIComponent(orderId)}`), {
    credentials: "include",
  });
  const body = (await res.json().catch(() => null)) as (OrderStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Status pembayaran belum bisa dimuat.");
  return body;
}

/** "12 November 2026" in WIB. */
export function fmtFounderDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}
