import { useQuery } from "@tanstack/react-query";

import { env } from "@/env.public";
import { getServerUrl } from "@/utils/orpc";

/** Server-decided paywall/billing settings (GET /api/config). */
export type AppConfig = {
  /** Free users have a daily scan limit. */
  paywall: boolean;
  /** Founder checkout is available (paywall + a payment gateway configured). */
  billing: boolean;
  freeDailyScans: number | null;
  founderDailyCap: number | null;
  founderPriceIdr: number;
  anonScans: number;
};

export function apiUrl(path: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}${path}`;
}

/** Latest signed release APK, served by the API worker from R2. */
export const APK_URL = apiUrl("/downloads/latest-apk");

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
