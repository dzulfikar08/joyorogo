// Polar (polar.sh, merchant of record): USD subscriptions for Pro on the web.
// Checkout session + customer portal over the REST API, and Standard Webhooks
// signature verification. No SDK: three calls and one HMAC.

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
};

export type PolarConfig = {
  accessToken: string;
  webhookSecret: string;
  baseUrl: string;
  productIds: Record<FounderPlan, string>;
  priceUsdCents: Record<FounderPlan, number>;
};

function cents(name: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    // Loud on purpose: a typo must not silently advertise the wrong price.
    throw new Error(`${name} must be a whole number of US cents > 0, got "${raw}"`);
  }
  return Number(value);
}

/** Null until the token, webhook secret and both product ids are set: USD checkout stays off. */
export function polarConfig(env: PolarEnv): PolarConfig | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  const monthly = env.POLAR_PRODUCT_MONTHLY_ID?.trim();
  const yearly = env.POLAR_PRODUCT_YEARLY_ID?.trim();
  if (!accessToken || !webhookSecret || !monthly || !yearly) return null;
  return {
    accessToken,
    webhookSecret,
    baseUrl: env.POLAR_SERVER?.trim() === "sandbox" ? POLAR_SANDBOX_URL : POLAR_PRODUCTION_URL,
    productIds: { monthly, yearly },
    priceUsdCents: {
      monthly: cents("POLAR_PRICE_MONTHLY_USD_CENTS", env.POLAR_PRICE_MONTHLY_USD_CENTS, DEFAULT_MONTHLY_USD_CENTS),
      yearly: cents("POLAR_PRICE_YEARLY_USD_CENTS", env.POLAR_PRICE_YEARLY_USD_CENTS, DEFAULT_YEARLY_USD_CENTS),
    },
  };
}

/** Which plan a Polar product sells; null = not a JoyoRogo Pro product (the org may sell other apps). */
export function polarProductPlan(config: Pick<PolarConfig, "productIds">, productId: string | null | undefined): FounderPlan | null {
  if (!productId) return null;
  if (productId === config.productIds.monthly) return "monthly";
  if (productId === config.productIds.yearly) return "yearly";
  return null;
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
    userId: string;
    email: string;
    name: string;
    successUrl: string;
    returnUrl: string;
  },
): Promise<{ url: string }> {
  const checkout = await call<{ url?: unknown }>(config, "/v1/checkouts/", {
    products: [config.productIds[params.plan]],
    external_customer_id: params.userId,
    customer_email: params.email,
    customer_name: params.name,
    success_url: params.successUrl,
    return_url: params.returnUrl,
    locale: "en",
    metadata: { app: "joyorogo", user_id: params.userId, plan: params.plan },
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
