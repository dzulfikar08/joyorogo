import type { Locale } from "./locale";

/**
 * Markets the product knows how to serve with local food data (docs/marketing/malaysia-plan.md).
 * A region picks the preferred nutrient table and the dish defaults of the scan prompt; it is
 * not the UI language: an English-speaking Malaysian is `MY` with locale `en`.
 */
export const REGIONS = ["ID", "MY", "SG"] as const;
export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = "ID";

let activeRegion: Region = DEFAULT_REGION;

/** Clients call this with the `region` of GET /api/config (the server decides it from the UI language and CF-IPCountry). */
export function setActiveRegion(region: Region): void {
  activeRegion = region;
}

export function getActiveRegion(): Region {
  return activeRegion;
}

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
 * read `id`), then the network country (`CF-IPCountry`: Malaysia, Singapore or Indonesia), then `ID`,
 * the original market. Anything else (Brunei, a VPN exit) keeps the default table. Singapore has no
 * language of its own: an English UI in Singapore is `SG`.
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
