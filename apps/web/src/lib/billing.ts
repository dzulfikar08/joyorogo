import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { trackEvent } from "./analytics";
import { apiUrl } from "./app-config";
import type { PaymentMethod } from "./app-config";
import { fmtDateLong } from "./format";

/** Where the Pro paywall screen was opened from; picks its subhead. */
export type PaywallFrom = "onboarding" | "quota" | "banner" | "profile" | "fitness" | "challenge" | "joyofit";

export type PaywallSearch = { next?: string; from?: PaywallFrom };

/** Search params of the paywall route: `next` must be an in-app path. */
export function validatePaywallSearch(search: Record<string, unknown>): PaywallSearch {
  return {
    next:
      typeof search.next === "string" &&
      search.next.startsWith("/") &&
      !search.next.startsWith("//")
        ? search.next
        : undefined,
    from: (["onboarding", "quota", "banner", "profile", "fitness", "challenge", "joyofit"] as const).find(
      (value) => search.from === value,
    ),
  };
}

/**
 * Quota-exhausted AI call: the server throws FORBIDDEN carrying
 * `data.paywall` instead of a generic denial.
 */
export function isPaywallError(err: unknown): boolean {
  return err instanceof ORPCError && err.code === "FORBIDDEN" && err.data?.paywall === true;
}

/** Pro billing period; yearly stacks 12 months on the remaining period. */
export type CheckoutPlan = "monthly" | "yearly";

/**
 * Start a Pro checkout, then leave for the gateway's page. `method`
 * picks QRIS (Pakasir) or bank transfer (DOKU); omitted = server default.
 * UI goes through useCheckoutPicker, which asks the buyer first.
 */
export function useFounderCheckout(plan: CheckoutPlan = "monthly") {
  const navigate = useNavigate();
  const location = useLocation();
  return useMutation({
    mutationFn: async (method: PaymentMethod | undefined) => {
      const res = await fetch(apiUrl("/api/billing/checkout"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, method }),
      });
      if (res.status === 401) {
        // Signed out (e.g. the /harga visitor): let them sign in first, then
        // bring them straight back to where they clicked.
        navigate({ to: "/login", search: { redirect: location.pathname } });
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

export type PendingOrder = { orderId: string; status: "pending"; createdAt: string };

/** The caller's latest unpaid order, if any. */
export async function fetchPendingOrder(): Promise<PendingOrder | null> {
  const res = await fetch(apiUrl("/api/billing/orders"), { credentials: "include" });
  const body = (await res.json().catch(() => null)) as
    | ({ pending?: PendingOrder | null } & Partial<OrderStatus> & { error?: string })
    | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Status pembayaran belum bisa dimuat.");
  return body.pending ?? null;
}

/** Ask the gateway directly (and settle) instead of waiting for the webhook. */
export async function checkOrder(orderId: string): Promise<OrderStatus> {
  const res = await fetch(apiUrl(`/api/billing/orders/${encodeURIComponent(orderId)}/check`), {
    method: "POST",
    credentials: "include",
  });
  const body = (await res.json().catch(() => null)) as (OrderStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Pembayaran belum bisa diperiksa.");
  return body;
}

/** "12 November 2026" / "November 12, 2026" in WIB, in the active language. */
export function fmtFounderDate(value: string | Date): string {
  const wibDay = new Date(new Date(value).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return fmtDateLong(wibDay).replace(/^\w+, /, "");
}
