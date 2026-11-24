// Polar (polar.sh, merchant of record): USD subscriptions for Pro on the web.
// Checkout session + customer portal over the REST API, and Standard Webhooks
// signature verification. No SDK: three calls and one HMAC.

import type { PaidProduct } from "./household";
import type { FounderPlan } from "./tiers";

export const WEBHOOK_PATH = "/api/billing/polar/webhook";
export const POLAR_PRODUCTION_URL = "https://api.polar.sh";
export const POLAR_SANDBOX_URL = "https://sandbox-api.polar.sh";
export const DEFAULT_MONTHLY_USD_CENTS = 999;
export const DEFAULT_YEARLY_USD_CENTS = 5999;
/** Standard Webhooks: reject deliveries whose timestamp is further than this from now. */
const TOLERANCE_MS = 5 * 60 * 1000;

export type PolarEnv = {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  /** "sandbox" talks to sandbox-api.polar.sh; anything else is production. */
  POLAR_SERVER?: string;
  POLAR_PRODUCT_MONTHLY_ID?: string;
  POLAR_PRODUCT_YEARLY_ID?: string;
  /** Displayed prices in US cents. The charge is the Polar product's price: keep them equal. */
  POLAR_PRICE_MONTHLY_USD_CENTS?: string;
  POLAR_PRICE_YEARLY_USD_CENTS?: string;
  /**
   * Malaysian ringgit prices in sen, shown on /api/config for Malaysian visitors. Set both, and only after the same
   * MYR prices exist on the two Polar products: Polar charges the product's price in the buyer's currency, these only
   * advertise it (docs/marketing/malaysia-plan.md, "Payments"). Unset = no ringgit price is shown.
   */
  POLAR_PRICE_MONTHLY_MYR_SEN?: string;
  POLAR_PRICE_YEARLY_MYR_SEN?: string;
  /** Singapore dollar prices in cents, same rule as MYR: both or neither, only after the SGD prices exist on the two Polar products. */
  POLAR_PRICE_MONTHLY_SGD_CENTS?: string;
  POLAR_PRICE_YEARLY_SGD_CENTS?: string;
  /**
   * Joyo Keluarga products (docs/pricing/joyo-keluarga.md 4.2). Both ids or neither: empty = Keluarga is not sold by
   * card. Their orders credit the payer's household instead of their own Pro period.
   */
  POLAR_PRODUCT_KELUARGA_MONTHLY_ID?: string;
  POLAR_PRODUCT_KELUARGA_YEARLY_ID?: string;
  /** Displayed Keluarga prices in US cents; default 2x the Pro price (keep equal to the Polar products' prices). */
  POLAR_PRICE_KELUARGA_MONTHLY_USD_CENTS?: string;
  POLAR_PRICE_KELUARGA_YEARLY_USD_CENTS?: string;
};

export type PolarConfig = {
  accessToken: string;
  webhookSecret: string;
  baseUrl: string;
  productIds: Record<FounderPlan, string>;
  priceUsdCents: Record<FounderPlan, number>;
  /** Advertised MYR prices in sen; null = none (both env vars must be set). */
  priceMyrSen?: Record<FounderPlan, number> | null;
  /** Advertised SGD prices in cents; null = none (both env vars must be set). */
  priceSgdCents?: Record<FounderPlan, number> | null;
  /** Joyo Keluarga products and displayed USD prices; null = not sold by card (both ids must be set). */
  keluarga?: { productIds: Record<FounderPlan, string>; priceUsdCents: Record<FounderPlan, number> } | null;
};

function cents(name: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    // Loud on purpose: a typo must not silently advertise the wrong price.
    throw new Error(`${name} must be a whole number of minor currency units (cents, sen) > 0, got "${raw}"`);
  }
  return Number(value);
}

function optionalSen(name: string, raw: string | undefined): number | null {
  return raw?.trim() ? cents(name, raw, 0) : null;
}

/** Both MYR prices or neither: a lone monthly price would leave the yearly card without a ringgit amount. */
function myrPrices(env: PolarEnv): Record<FounderPlan, number> | null {
  const monthly = optionalSen("POLAR_PRICE_MONTHLY_MYR_SEN", env.POLAR_PRICE_MONTHLY_MYR_SEN);
  const yearly = optionalSen("POLAR_PRICE_YEARLY_MYR_SEN", env.POLAR_PRICE_YEARLY_MYR_SEN);
  if (monthly === null || yearly === null) return null;
  return { monthly, yearly };
}

/** Both SGD prices or neither, like `myrPrices`. */
function sgdPrices(env: PolarEnv): Record<FounderPlan, number> | null {
  const monthly = optionalSen("POLAR_PRICE_MONTHLY_SGD_CENTS", env.POLAR_PRICE_MONTHLY_SGD_CENTS);
  const yearly = optionalSen("POLAR_PRICE_YEARLY_SGD_CENTS", env.POLAR_PRICE_YEARLY_SGD_CENTS);
  if (monthly === null || yearly === null) return null;
  return { monthly, yearly };
}

/** Null until the token, webhook secret and both product ids are set: USD checkout stays off. */
export function polarConfig(env: PolarEnv): PolarConfig | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  const monthly = env.POLAR_PRODUCT_MONTHLY_ID?.trim();
  const yearly = env.POLAR_PRODUCT_YEARLY_ID?.trim();
  if (!accessToken || !webhookSecret || !monthly || !yearly) return null;
  const priceUsdCents = {
    monthly: cents("POLAR_PRICE_MONTHLY_USD_CENTS", env.POLAR_PRICE_MONTHLY_USD_CENTS, DEFAULT_MONTHLY_USD_CENTS),
    yearly: cents("POLAR_PRICE_YEARLY_USD_CENTS", env.POLAR_PRICE_YEARLY_USD_CENTS, DEFAULT_YEARLY_USD_CENTS),
  };
  return {
    accessToken,
    webhookSecret,
    baseUrl: env.POLAR_SERVER?.trim() === "sandbox" ? POLAR_SANDBOX_URL : POLAR_PRODUCTION_URL,
    productIds: { monthly, yearly },
    priceUsdCents,
    priceMyrSen: myrPrices(env),
    priceSgdCents: sgdPrices(env),
    keluarga: keluargaProducts(env, priceUsdCents),
  };
}

/** Both Keluarga product ids or neither; prices default to 2x Pro's (decision C: Keluarga is 2x the Pro step). */
function keluargaProducts(env: PolarEnv, pro: Record<FounderPlan, number>): PolarConfig["keluarga"] {
  const monthly = env.POLAR_PRODUCT_KELUARGA_MONTHLY_ID?.trim();
  const yearly = env.POLAR_PRODUCT_KELUARGA_YEARLY_ID?.trim();
  if (!monthly || !yearly) return null;
  return {
    productIds: { monthly, yearly },
    priceUsdCents: {
      monthly: cents("POLAR_PRICE_KELUARGA_MONTHLY_USD_CENTS", env.POLAR_PRICE_KELUARGA_MONTHLY_USD_CENTS, pro.monthly * 2),
      yearly: cents("POLAR_PRICE_KELUARGA_YEARLY_USD_CENTS", env.POLAR_PRICE_KELUARGA_YEARLY_USD_CENTS, pro.yearly * 2),
    },
  };
}

/** Which product and plan a Polar product sells; null = neither Joyo Pro nor Joyo Keluarga (the org sells other apps). */
export function polarProduct(
  config: Pick<PolarConfig, "productIds" | "keluarga">,
  productId: string | null | undefined,
): { product: PaidProduct; plan: FounderPlan } | null {
  if (!productId) return null;
  if (productId === config.productIds.monthly) return { product: "pro", plan: "monthly" };
  if (productId === config.productIds.yearly) return { product: "pro", plan: "yearly" };
  if (config.keluarga) {
    if (productId === config.keluarga.productIds.monthly) return { product: "keluarga", plan: "monthly" };
    if (productId === config.keluarga.productIds.yearly) return { product: "keluarga", plan: "yearly" };
  }
  return null;
}

/** Which plan a Polar product sells (Pro or Keluarga); null = not ours. */
export function polarProductPlan(
  config: Pick<PolarConfig, "productIds" | "keluarga">,
  productId: string | null | undefined,
): FounderPlan | null {
  return polarProduct(config, productId)?.plan ?? null;
}

/** Order id of a Polar order in the shared payment ledger. */
export function polarLedgerId(orderId: string): string {
  return `polar:${orderId}`;
}

// ---- Standard Webhooks ------------------------------------------------------

const enc = new TextEncoder();

function b64decode(value: string): Uint8Array | null {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * HMAC keys a `whsec_...` secret may mean. Secrets minted on or after 2026-09-08
 * follow Standard Webhooks (key = base64-decoded part after the prefix); older
 * Polar secrets key the HMAC with the UTF-8 bytes of the whole string.
 */
function candidateKeys(secret: string): Uint8Array[] {
  const keys: Uint8Array[] = [];
  const decoded = b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (decoded && decoded.length > 0) keys.push(decoded);
  keys.push(enc.encode(secret));
  return keys;
}

export type WebhookHeaders = { id: string; timestamp: string; signature: string };

/**
 * Verifies a Standard Webhooks delivery over the raw body. `webhook-signature`
 * holds space-separated "v1,<base64>" entries; any one matching under any
 * candidate key passes. The comparison is crypto.subtle.verify (constant time).
 */
export async function verifyWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const seconds = Number(headers.timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > TOLERANCE_MS) return false;

  const signed = enc.encode(`${headers.id}.${headers.timestamp}.${rawBody}`);
  const signatures: Uint8Array[] = [];
  for (const entry of headers.signature.split(" ")) {
    const [version, value] = entry.split(",");
    const bytes = version === "v1" && value ? b64decode(value) : null;
    if (bytes) signatures.push(bytes);
  }
  if (signatures.length === 0) return false;

  for (const raw of candidateKeys(secret)) {
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const signature of signatures) {
      if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
    }
  }
  return false;
}

// ---- REST API ---------------------------------------------------------------

async function call<T>(config: PolarConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PolarApiError(path, res.status, text.slice(0, 300));
  return JSON.parse(text) as T;
}

export class PolarApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`polar ${path} failed: HTTP ${status} ${detail}`);
  }
}

/**
 * Hosted checkout for one Pro plan. `external_customer_id` is our user id, so
 * every later event and the customer portal find the account without a lookup.
 */
export async function createCheckout(
  config: PolarConfig,
  params: {
    plan: FounderPlan;
    /** "keluarga" sells the Joyo Keluarga product of that plan; the caller checks it is configured. */
    product?: PaidProduct;
    userId: string;
    email: string;
    name: string;
    successUrl: string;
    returnUrl: string;
    /**
     * The buyer's IP (CF-Connecting-IP). Polar picks the presentment currency (MYR for Malaysia) and the tax
     * jurisdiction from it; without it Polar sees our Worker and would show the default currency.
     */
    customerIp?: string | null;
    /** RevKlik ids of the buyer's browser; they come back on the order's metadata for sale attribution. */
    revklik?: { visitorId: string | null; sessionId: string | null };
    /** Where the checkout was started from besides JoyoRogo ("joyoarto"); kept on the order's metadata. */
    source?: string | null;
  },
): Promise<{ url: string }> {
  const checkout = await call<{ url?: unknown }>(config, "/v1/checkouts/", {
    products: [
      params.product === "keluarga" && config.keluarga
        ? config.keluarga.productIds[params.plan]
        : config.productIds[params.plan],
    ],
    external_customer_id: params.userId,
    customer_email: params.email,
    customer_name: params.name,
    success_url: params.successUrl,
    return_url: params.returnUrl,
    locale: "en",
    ...(params.customerIp ? { customer_ip_address: params.customerIp } : {}),
    metadata: {
      app: "joyorogo",
      user_id: params.userId,
      plan: params.plan,
      ...(params.product === "keluarga" ? { product: "keluarga" } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.revklik?.visitorId ? { revklik_vid: params.revklik.visitorId } : {}),
      ...(params.revklik?.sessionId ? { revklik_sid: params.revklik.sessionId } : {}),
    },
  });
  if (typeof checkout.url !== "string") throw new Error("polar checkout answered without a url");
  return { url: checkout.url };
}

/** Short-lived customer portal link (cancel, change plan, payment method, invoices). */
export async function createPortalSession(
  config: PolarConfig,
  params: { userId: string; returnUrl: string },
): Promise<{ url: string }> {
  const session = await call<{ customer_portal_url?: unknown }>(config, "/v1/customer-sessions/", {
    external_customer_id: params.userId,
    return_url: params.returnUrl,
  });
  if (typeof session.customer_portal_url !== "string") {
    throw new Error("polar portal session answered without a url");
  }
  return { url: session.customer_portal_url };
}
