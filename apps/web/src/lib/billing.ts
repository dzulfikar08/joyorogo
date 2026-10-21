import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { LOCALE_HEADER, dayOfMs, i18n } from "@joyorogo/i18n";

import { trackEvent } from "./analytics";
import { apiUrl } from "./app-config";
import type { PaymentMethod } from "./app-config";
import { fmtDateLong } from "./format";

/** Where the Pro paywall screen was opened from; picks its subhead. */
export type PaywallFrom = "onboarding" | "quota" | "banner" | "profile" | "fitness" | "challenge" | "joyofit";

export type PaywallSearch = { next?: string; from?: PaywallFrom; polar?: "success" };

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
    polar: search.polar === "success" ? ("success" as const) : undefined,
  };
}

/**
 * Quota-exhausted AI call: the server throws FORBIDDEN carrying
 * `data.paywall` instead of a generic denial.
 */
export function isPaywallError(err: unknown): boolean {
  return err instanceof ORPCError && err.code === "FORBIDDEN" && err.data?.paywall === true;
}

/** The server writes billing errors in the language the UI shows. */
const localeHeader = () => ({ [LOCALE_HEADER]: i18n.language });

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
        headers: { "Content-Type": "application/json", ...localeHeader() },
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
        throw new Error(body?.error ?? i18n.t("billing:error.checkoutFailed"));
      }
      trackEvent("checkout_start");
      window.location.assign(body.paymentUrl);
      return body.paymentUrl;
    },
  });
}

/**
 * Start a Polar (USD, card, auto-renewing) checkout. Same sign-in handling
 * as useFounderCheckout. Messages stay English: the USD flow is English-only.
 */
export function useUsdCheckout(plan: CheckoutPlan = "monthly") {
  const navigate = useNavigate();
  const location = useLocation();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/billing/polar/checkout"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...localeHeader() },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        navigate({ to: "/login", search: { redirect: location.pathname } });
        return null;
      }
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? i18n.t("billing:usd.error.checkoutFailed", { lng: "en" }));
      }
      trackEvent("checkout_start");
      window.location.assign(body.url);
      return body.url;
    },
  });
}

export type PolarSubscription = {
  plan: CheckoutPlan;
  /** "active" | "canceled" (still Pro until period end) | "past_due" | "revoked" */
  state: string;
  /** Epoch ms. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
};

/** The caller's Polar subscription, or null when there is none. */
export async function fetchPolarSubscription(): Promise<PolarSubscription | null> {
  const res = await fetch(apiUrl("/api/billing/polar/subscription"), {
    credentials: "include",
    headers: localeHeader(),
  });
  if (!res.ok) throw new Error(`polar subscription ${res.status}`);
  const body = (await res.json()) as { subscription?: PolarSubscription | null };
  return body.subscription ?? null;
}

/** Open Polar's customer portal (cancel, manage, invoices). */
export function usePolarPortal() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/billing/polar/portal"), {
        method: "POST",
        credentials: "include",
        headers: localeHeader(),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? i18n.t("billing:usd.error.portalFailed", { lng: "en" }));
      }
      window.location.assign(body.url);
      return body.url;
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
    headers: localeHeader(),
  });
  const body = (await res.json().catch(() => null)) as (OrderStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? i18n.t("billing:error.statusFailed"));
  return body;
}

export type PendingOrder = { orderId: string; status: "pending"; createdAt: string };

/** The caller's latest unpaid order, if any. */
export async function fetchPendingOrder(): Promise<PendingOrder | null> {
  const res = await fetch(apiUrl("/api/billing/orders"), {
    credentials: "include",
    headers: localeHeader(),
  });
  const body = (await res.json().catch(() => null)) as
    | ({ pending?: PendingOrder | null } & Partial<OrderStatus> & { error?: string })
    | null;
  if (!res.ok || !body) throw new Error(body?.error ?? i18n.t("billing:error.statusFailed"));
  return body.pending ?? null;
}

/** Ask the gateway directly (and settle) instead of waiting for the webhook. */
export async function checkOrder(orderId: string): Promise<OrderStatus> {
  const res = await fetch(apiUrl(`/api/billing/orders/${encodeURIComponent(orderId)}/check`), {
    method: "POST",
    credentials: "include",
    headers: localeHeader(),
  });
  const body = (await res.json().catch(() => null)) as (OrderStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? i18n.t("billing:error.checkFailed"));
  return body;
}

/** "12 November 2026" / "November 12, 2026" on the user's day, in the active language. */
export function fmtFounderDate(value: string | Date): string {
  return fmtDateLong(dayOfMs(new Date(value).getTime())).replace(/^\w+, /, "");
}
