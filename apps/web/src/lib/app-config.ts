import { fmtIdr, i18n } from "@joyorogo/i18n";
import { useQuery } from "@tanstack/react-query";

import { env } from "@/env.public";
import { getServerUrl } from "@/utils/orpc";

/** Server-decided paywall/billing settings (GET /api/config). */
export type AppConfig = {
  /** Free users have a daily scan limit. */
  paywall: boolean;
  /** Founder checkout is available (paywall + a payment gateway configured). */
  billing: boolean;
  /**
   * Checkout picker options in display order: "qris" (Pakasir) and/or
   * "transfer" (DOKU). Missing on servers older than the picker.
   */
  paymentMethods?: PaymentMethod[];
  /**
   * Polar USD subscription; null = not configured. `preferred` = the
   * visitor's country is known and is not Indonesia. Prices in US cents.
   */
  usd?: UsdConfig | null;
  freeDailyScans: number | null;
  founderDailyCap: number | null;
  founderPriceIdr: number;
  /** Yearly Pro price of the current ladder step (Rp199.000 at buyers 11-110). */
  founderYearlyPriceIdr: number;
  /**
   * Founder intro-price ladder; null when the promo is off. `slots` = buyers
   * allowed at the current step, `taken` = buyers so far, `nextPriceIdr` =
   * monthly price after this step fills (null/undefined = no further increase).
   */
  promo: { slots: number; taken: number; nextPriceIdr?: number | null } | null;
  anonScans: number;
};

/** Buyer-facing payment choice; the server maps each to its gateway. */
export type PaymentMethod = "qris" | "transfer";

export type UsdConfig = {
  monthlyCents: number;
  yearlyCents: number;
  preferred: boolean;
  country: string | null;
};

/** US cents as "$9.99" (always English formatting). */
export function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Epoch ms as "November 12, 2026" (English, UTC day). */
export function fmtUsdDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function apiUrl(path: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}${path}`;
}

/** Store listings with the UTM convention from docs/utm.md (Play via `referrer`, App Store via `ct`). */
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyorogo%26utm_medium%3Dreferral%26utm_campaign%3Devergreen-web";
export const APP_STORE_URL = "https://apps.apple.com/id/app/id6823222101?ct=joyorogo-evergreen-web";

/** Google Play closed test: join the group first, then opt in on Play. */
export const TESTER_GROUP_URL = "https://groups.google.com/g/joyorogo-testers";
export const TESTER_OPTIN_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyorogo";
/** Landing section with the tester steps; AppDownload links here from any page. */
export const TESTER_SECTION_HREF = "/#tester";

/**
 * Read at runtime, not build time: the same web build serves the hosted
 * cloud and self-hosted copies. While loading, callers render no pricing
 * at all rather than guessing.
 */
export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(apiUrl("/api/config"));
      if (!res.ok) throw new Error(`config ${res.status}`);
      return (await res.json()) as AppConfig;
    },
    // Persisted with the rest of the cache; refresh hourly so a price or
    // paywall change reaches returning visitors the same day.
    staleTime: 60 * 60 * 1000,
    retry: 2,
  });
}

export function fmtRupiah(amount: number): string {
  return fmtIdr(amount);
}

/** Founder scan allowance as sold: the daily cap when the server sets one. */
export function founderScans(config: Pick<AppConfig, "founderDailyCap">): string {
  return config.founderDailyCap === null
    ? i18n.t("billing:benefits.scansUnlimited")
    : i18n.t("billing:benefits.scansCapped", { count: config.founderDailyCap });
}
