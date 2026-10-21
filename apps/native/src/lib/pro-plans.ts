/**
 * Plan arithmetic for the Pro screen: what a yearly plan costs per month and how much it saves against twelve monthly
 * payments. Works on the amounts the store reports (any currency), so a buyer in Malaysia sees ringgit figures derived
 * from Play's own prices, never rupiah converted by us.
 */

/** An amount the store reported, in millionths of the currency unit (Play's priceAmountMicros). */
export type StorePrice = { micros: number; currency: string };

export type YearlySaving = {
  /** The yearly price spread over twelve months. */
  perMonth: StorePrice;
  /** Twelve monthly payments minus one yearly payment. */
  saved: StorePrice;
  /** Whole percent saved, 1..99. */
  percent: number;
};

/** Null unless both prices exist, share a currency, and yearly really is cheaper than twelve months. */
export function yearlySaving(
  monthly: StorePrice | null | undefined,
  yearly: StorePrice | null | undefined,
): YearlySaving | null {
  if (!monthly || !yearly) return null;
  if (monthly.currency !== yearly.currency) return null;
  if (!(monthly.micros > 0) || !(yearly.micros > 0)) return null;
  const twelve = monthly.micros * 12;
  if (yearly.micros >= twelve) return null;
  const percent = Math.round((1 - yearly.micros / twelve) * 100);
  if (percent < 1) return null;
  return {
    perMonth: { micros: yearly.micros / 12, currency: yearly.currency },
    saved: { micros: twelve - yearly.micros, currency: yearly.currency },
    percent,
  };
}

/**
 * "Rp16.583" for rupiah (the app's own style, like Play's "Rp29.000"), the currency's own symbol and rounding for every
 * other store currency. `locale` is a BCP-47 tag.
 */
export function formatStorePrice(price: StorePrice, locale: string): string {
  const units = price.micros / 1_000_000;
  if (price.currency === "IDR") {
    return `Rp${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(units))}`;
  }
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: price.currency }).format(units);
  } catch {
    return `${price.currency} ${units.toFixed(2)}`;
  }
}
