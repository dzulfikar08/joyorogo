/**
 * IDR exchange rates for the revenue ledger. Polar's order payload carries only the currency the customer paid in:
 * there is no settlement amount, no rate. So a MYR/SGD order is converted here, and the rate and its source are
 * stored on the payment row.
 *
 * Source: the European Central Bank reference rates through Frankfurter (frankfurter.dev, free, no key, covers
 * IDR, MYR, SGD). Asked for the day the order was created, it answers the latest ECB fixing on or before that day,
 * so a late redelivery books the same rate as the first one. When it does not answer in time, `FALLBACK_IDR_RATES`
 * is used so the webhook never fails because of a rate. Booking a rate is bookkeeping, not what the buyer paid.
 */

export type FxQuote = {
  /** IDR for 1 whole unit of the currency (1 ringgit, 1 Singapore dollar). */
  rate: number;
  /** "frankfurter:<date of the ECB fixing>" or "static:<date the fallback table was read>". */
  source: string;
};

/** A rate lookup for a currency at a moment; null = no rate known. */
export type FxRateSource = (currency: string, at: Date) => Promise<FxQuote | null>;

/** Read from Frankfurter on 2026-10-20 (MYR 4405.3, SGD 14068), rounded down. Review when the ringgit or SGD moves by 10%. */
export const FALLBACK_IDR_RATES: Readonly<Record<string, number>> = { MYR: 4400, SGD: 14000 };
export const FALLBACK_RATES_DATE = "2026-10-20";

const FRANKFURTER = "https://api.frankfurter.dev/v1";
const FRANKFURTER_TIMEOUT_MS = 3000;

const frankfurterAnswer = (body: unknown): { rate: number; date: string } | null => {
  if (typeof body !== "object" || body === null) return null;
  const { rates, date } = body as { rates?: { IDR?: unknown }; date?: unknown };
  const rate = rates?.IDR;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return { rate, date: typeof date === "string" ? date : "unknown" };
};

/** The ECB reference rate (IDR per unit of `currency`) on or before the day of `at`, UTC. Null on any failure. */
export function frankfurterRate(fetcher: typeof fetch = fetch): FxRateSource {
  return async (currency, at) => {
    try {
      const day = at.toISOString().slice(0, 10);
      const res = await fetcher(`${FRANKFURTER}/${day}?base=${currency.toUpperCase()}&symbols=IDR`, {
        signal: AbortSignal.timeout(FRANKFURTER_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const answer = frankfurterAnswer(await res.json());
      return answer ? { rate: answer.rate, source: `frankfurter:${answer.date}` } : null;
    } catch {
      return null;
    }
  };
}

/** The live source first, the fallback table second; null only for a currency neither knows. */
export async function idrQuote(source: FxRateSource | undefined, currency: string, at: Date): Promise<FxQuote | null> {
  const live = await source?.(currency, at);
  if (live) return live;
  const fallback = FALLBACK_IDR_RATES[currency.toUpperCase()];
  return fallback ? { rate: fallback, source: `static:${FALLBACK_RATES_DATE}` } : null;
}

/** Decimals of a currency's minor unit: 2 for USD/MYR/SGD, 0 for JPY. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Whole IDR for an amount in a currency's minor units at `rate` (IDR per whole unit). */
export function minorToIdr(minor: number, currency: string, rate: number): number {
  return Math.round((minor / 10 ** minorDigits(currency)) * rate);
}

const SYMBOLS: Readonly<Record<string, string>> = { USD: "US$", MYR: "RM", SGD: "S$", IDR: "Rp" };

/** "RM43.99", "S$13.98", "US$9.99"; "EUR 9.99" for a currency without a short symbol. */
export function formatMinor(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const amount = (minor / 10 ** minorDigits(code)).toFixed(minorDigits(code));
  const symbol = SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
}
