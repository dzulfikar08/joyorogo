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
  freeDailyScans: number | null;
  founderDailyCap: number | null;
  founderPriceIdr: number;
  /** Yearly founder bundle: 12 months for the price of 10. */
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

export function apiUrl(path: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}${path}`;
}

/** Latest signed release APK, served by the API worker from R2. */
export const APK_URL = apiUrl("/downloads/latest-apk");

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
  return `Rp${amount.toLocaleString("id-ID")}`;
}

/** Founder scan allowance as sold: the daily cap when the server sets one. */
export function founderScans(config: Pick<AppConfig, "founderDailyCap">): string {
  return config.founderDailyCap === null
    ? "Scan AI tanpa batas"
    : `${config.founderDailyCap} scan AI per hari`;
}
