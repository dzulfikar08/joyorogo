import type { Locale } from "./locale";

/**
 * Markets the product knows how to serve with local food data (docs/marketing/malaysia-plan.md).
 * A region picks the preferred nutrient table and the dish defaults of the scan prompt; it is
 * not the UI language: an English-speaking Malaysian is `MY` with locale `en`.
 */
export const REGIONS = ["ID", "MY"] as const;
export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = "ID";

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

/** ISO 3166-1 alpha-2 country (CF-IPCountry, SIM or store country) to a region; null when not served locally. */
export function regionFromCountry(country: string | null | undefined): Region | null {
  const code = country?.trim().toUpperCase();
  return isRegion(code) ? code : null;
}

/**
 * The region a request belongs to. Order: an explicit Bahasa Melayu UI is Malaysia (Indonesians
 * read `id`), then the network country (`CF-IPCountry`: Malaysia or Indonesia), then `ID`, the
 * original market. Anything else (Singapore, Brunei, a VPN exit) keeps the default table.
 */
export function resolveRegion({
  locale,
  country,
}: {
  locale?: Locale | null;
  country?: string | null;
}): Region {
  if (locale === "ms") return "MY";
  return regionFromCountry(country) ?? DEFAULT_REGION;
}
